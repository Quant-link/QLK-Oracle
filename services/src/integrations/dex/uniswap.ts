/**
 * @fileoverview Uniswap V3 DEX integration with subgraph and direct contract calls
 * @author QuantLink Team
 * @version 1.0.0
 */

import { ethers } from 'ethers';
import { BaseDEXIntegration, PoolData, SwapEvent, LiquidityEvent } from './base';
import { FeeData, PriceData, FlashloanDetectionResult, MEVProtectionResult } from '@/types';

// Uniswap V3 contract ABIs (simplified)
const POOL_ABI = [
  'function fee() external view returns (uint24)',
  'function liquidity() external view returns (uint128)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

interface UniswapPool {
  id: string;
  token0: {
    id: string;
    symbol: string;
    decimals: string;
  };
  token1: {
    id: string;
    symbol: string;
    decimals: string;
  };
  feeTier: string;
  liquidity: string;
  sqrtPrice: string;
  tick: string;
  volumeUSD: string;
  feesUSD: string;
  createdAtTimestamp: string;
}

interface UniswapSwap {
  id: string;
  transaction: {
    id: string;
    blockNumber: string;
    gasUsed: string;
    gasPrice: string;
  };
  pool: {
    id: string;
  };
  sender: string;
  recipient: string;
  amount0: string;
  amount1: string;
  sqrtPriceX96: string;
  liquidity: string;
  tick: string;
  timestamp: string;
  logIndex: string;
}

export class UniswapV3Integration extends BaseDEXIntegration {
  private factoryAddress = '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Mainnet
  private factoryContract: ethers.Contract;
  private poolContracts: Map<string, ethers.Contract> = new Map();
  private tokenCache: Map<string, { symbol: string; decimals: number }> = new Map();

  constructor(config: any) {
    super(config);
    this.factoryContract = new ethers.Contract(this.factoryAddress, FACTORY_ABI, this.provider);
  }

  /**
   * Load initial pool data from subgraph
   */
  protected async loadInitialPoolData(): Promise<void> {
    try {
      const query = `
        query GetTopPools($first: Int!) {
          pools(
            first: $first
            orderBy: volumeUSD
            orderDirection: desc
            where: { liquidity_gt: "0" }
          ) {
            id
            token0 {
              id
              symbol
              decimals
            }
            token1 {
              id
              symbol
              decimals
            }
            feeTier
            liquidity
            sqrtPrice
            tick
            volumeUSD
            feesUSD
            createdAtTimestamp
          }
        }
      `;

      const result = await this.executeSubgraphQuery<{ pools: UniswapPool[] }>(query, {
        first: 100,
      });

      for (const pool of result.pools) {
        const poolData = this.convertToPoolData(pool);
        this.poolCache.set(pool.id.toLowerCase(), poolData);
        
        // Cache token information
        this.tokenCache.set(pool.token0.id.toLowerCase(), {
          symbol: pool.token0.symbol,
          decimals: parseInt(pool.token0.decimals),
        });
        this.tokenCache.set(pool.token1.id.toLowerCase(), {
          symbol: pool.token1.symbol,
          decimals: parseInt(pool.token1.decimals),
        });
      }

      this.logger.info('Loaded initial pool data', { 
        exchange: this.config.name, 
        poolCount: result.pools.length 
      });
    } catch (error) {
      this.logger.error('Failed to load initial pool data', { 
        exchange: this.config.name, 
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Process new block events
   */
  protected async processNewBlock(blockNumber: number): Promise<void> {
    try {
      // Get recent swaps from the new block
      const swaps = await this.getSwapEvents([], blockNumber);
      
      for (const swap of swaps) {
        this.emit('data:swap', swap);
        
        // Update pool cache if needed
        const poolData = this.poolCache.get(swap.pool.toLowerCase());
        if (poolData) {
          // Update pool data with latest swap information
          poolData.timestamp = swap.timestamp;
          this.poolCache.set(swap.pool.toLowerCase(), poolData);
        }
      }

      // Emit block processed event
      this.emit('block:processed', { blockNumber, swapCount: swaps.length });
    } catch (error) {
      this.logger.error('Error processing new block', { 
        exchange: this.config.name, 
        blockNumber, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get current fee data for specified trading pairs
   */
  public async getFeeData(symbols: string[]): Promise<FeeData[]> {
    const feeDataPromises = symbols.map(async (symbol) => {
      try {
        const [token0Symbol, token1Symbol] = symbol.split('/');
        const pools = await this.findPoolsForPair(token0Symbol, token1Symbol);
        
        if (pools.length === 0) {
          throw new Error(`No pools found for pair ${symbol}`);
        }

        // Use the pool with highest liquidity
        const bestPool = pools.reduce((prev, current) => 
          parseFloat(current.liquidity) > parseFloat(prev.liquidity) ? current : prev
        );

        return this.createFeeData(symbol, bestPool);
      } catch (error) {
        this.logger.error('Failed to get fee data for symbol', { 
          symbol, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw error;
      }
    });

    const results = await Promise.allSettled(feeDataPromises);
    return results
      .filter((result): result is PromiseFulfilledResult<FeeData> => result.status === 'fulfilled')
      .map(result => result.value);
  }

  /**
   * Get current price data for specified trading pairs
   */
  public async getPriceData(symbols: string[]): Promise<PriceData[]> {
    const priceDataPromises = symbols.map(async (symbol) => {
      try {
        const [token0Symbol, token1Symbol] = symbol.split('/');
        const pools = await this.findPoolsForPair(token0Symbol, token1Symbol);
        
        if (pools.length === 0) {
          throw new Error(`No pools found for pair ${symbol}`);
        }

        // Calculate VWAP from recent swaps
        const recentSwaps = await this.getRecentSwapsForPools(pools.map(p => p.address));
        const vwap = this.calculateVWAP(recentSwaps);

        return this.createPriceData(symbol, vwap, pools[0]);
      } catch (error) {
        this.logger.error('Failed to get price data for symbol', { 
          symbol, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw error;
      }
    });

    const results = await Promise.allSettled(priceDataPromises);
    return results
      .filter((result): result is PromiseFulfilledResult<PriceData> => result.status === 'fulfilled')
      .map(result => result.value);
  }

  /**
   * Get pool data for specified pools
   */
  public async getPoolData(poolAddresses: string[]): Promise<PoolData[]> {
    const poolDataPromises = poolAddresses.map(async (address) => {
      try {
        // Check cache first
        const cached = this.poolCache.get(address.toLowerCase());
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
          return cached;
        }

        // Fetch fresh data from contract
        const poolContract = this.getPoolContract(address);
        const [fee, liquidity, slot0, token0Address, token1Address] = await Promise.all([
          poolContract.fee(),
          poolContract.liquidity(),
          poolContract.slot0(),
          poolContract.token0(),
          poolContract.token1(),
        ]);

        const poolData: PoolData = {
          address: address.toLowerCase(),
          token0: token0Address.toLowerCase(),
          token1: token1Address.toLowerCase(),
          fee: fee,
          liquidity: liquidity.toString(),
          sqrtPriceX96: slot0.sqrtPriceX96.toString(),
          tick: slot0.tick,
          volume24h: '0', // Would need to calculate from events
          volumeUSD: '0',
          feesUSD: '0',
          timestamp: Date.now(),
        };

        // Cache the result
        this.poolCache.set(address.toLowerCase(), poolData);
        return poolData;
      } catch (error) {
        this.logger.error('Failed to get pool data', { 
          address, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw error;
      }
    });

    const results = await Promise.allSettled(poolDataPromises);
    return results
      .filter((result): result is PromiseFulfilledResult<PoolData> => result.status === 'fulfilled')
      .map(result => result.value);
  }

  /**
   * Get recent swap events
   */
  public async getSwapEvents(poolAddresses: string[], fromBlock?: number): Promise<SwapEvent[]> {
    try {
      const blockFilter = fromBlock ? `blockNumber_gte: "${fromBlock}"` : '';
      const poolFilter = poolAddresses.length > 0 ? 
        `pool_in: [${poolAddresses.map(addr => `"${addr.toLowerCase()}"`).join(', ')}]` : '';
      
      const whereClause = [blockFilter, poolFilter].filter(Boolean).join(', ');
      
      const query = `
        query GetSwaps($first: Int!) {
          swaps(
            first: $first
            orderBy: timestamp
            orderDirection: desc
            ${whereClause ? `where: { ${whereClause} }` : ''}
          ) {
            id
            transaction {
              id
              blockNumber
              gasUsed
              gasPrice
            }
            pool {
              id
            }
            sender
            recipient
            amount0
            amount1
            sqrtPriceX96
            liquidity
            tick
            timestamp
            logIndex
          }
        }
      `;

      const result = await this.executeSubgraphQuery<{ swaps: UniswapSwap[] }>(query, {
        first: 1000,
      });

      return result.swaps.map(swap => this.convertToSwapEvent(swap));
    } catch (error) {
      this.logger.error('Failed to get swap events', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Get liquidity events
   */
  public async getLiquidityEvents(poolAddresses: string[], fromBlock?: number): Promise<LiquidityEvent[]> {
    try {
      const blockFilter = fromBlock ? `blockNumber_gte: "${fromBlock}"` : '';
      const poolFilter = poolAddresses.length > 0 ? 
        `pool_in: [${poolAddresses.map(addr => `"${addr.toLowerCase()}"`).join(', ')}]` : '';
      
      const whereClause = [blockFilter, poolFilter].filter(Boolean).join(', ');
      
      const query = `
        query GetLiquidityEvents($first: Int!) {
          mints(
            first: $first
            orderBy: timestamp
            orderDirection: desc
            ${whereClause ? `where: { ${whereClause} }` : ''}
          ) {
            id
            transaction {
              id
              blockNumber
            }
            pool {
              id
            }
            owner
            tickLower
            tickUpper
            amount
            amount0
            amount1
            timestamp
          }
          burns(
            first: $first
            orderBy: timestamp
            orderDirection: desc
            ${whereClause ? `where: { ${whereClause} }` : ''}
          ) {
            id
            transaction {
              id
              blockNumber
            }
            pool {
              id
            }
            owner
            tickLower
            tickUpper
            amount
            amount0
            amount1
            timestamp
          }
        }
      `;

      const result = await this.executeSubgraphQuery<{ 
        mints: any[], 
        burns: any[] 
      }>(query, { first: 500 });

      const liquidityEvents: LiquidityEvent[] = [];
      
      // Process mint events
      for (const mint of result.mints) {
        liquidityEvents.push({
          transactionHash: mint.transaction.id,
          blockNumber: parseInt(mint.transaction.blockNumber),
          pool: mint.pool.id,
          owner: mint.owner,
          tickLower: parseInt(mint.tickLower),
          tickUpper: parseInt(mint.tickUpper),
          amount: mint.amount,
          amount0: mint.amount0,
          amount1: mint.amount1,
          timestamp: parseInt(mint.timestamp) * 1000,
          type: 'mint',
        });
      }
      
      // Process burn events
      for (const burn of result.burns) {
        liquidityEvents.push({
          transactionHash: burn.transaction.id,
          blockNumber: parseInt(burn.transaction.blockNumber),
          pool: burn.pool.id,
          owner: burn.owner,
          tickLower: parseInt(burn.tickLower),
          tickUpper: parseInt(burn.tickUpper),
          amount: burn.amount,
          amount0: burn.amount0,
          amount1: burn.amount1,
          timestamp: parseInt(burn.timestamp) * 1000,
          type: 'burn',
        });
      }

      return liquidityEvents.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      this.logger.error('Failed to get liquidity events', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }
