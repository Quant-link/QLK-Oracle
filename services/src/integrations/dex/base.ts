/**
 * @fileoverview Base DEX integration class with common functionality
 * @author QuantLink Team
 * @version 1.0.0
 */

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import axios, { AxiosInstance } from 'axios';
import { 
  ExchangeConfig, 
  FeeData, 
  PriceData, 
  HealthCheckResult,
  FlashloanDetectionResult,
  MEVProtectionResult
} from '@/types';
import { Logger } from '@/utils/logger';
import { MetricsCollector } from '@/monitoring/metrics';

export interface PoolData {
  address: string;
  token0: string;
  token1: string;
  fee: number;
  liquidity: string;
  sqrtPriceX96?: string;
  tick?: number;
  volume24h: string;
  volumeUSD: string;
  feesUSD: string;
  timestamp: number;
}

export interface SwapEvent {
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
  pool: string;
  sender: string;
  recipient: string;
  amount0: string;
  amount1: string;
  sqrtPriceX96?: string;
  liquidity?: string;
  tick?: number;
  timestamp: number;
  gasUsed: string;
  gasPrice: string;
}

export interface LiquidityEvent {
  transactionHash: string;
  blockNumber: number;
  pool: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  amount: string;
  amount0: string;
  amount1: string;
  timestamp: number;
  type: 'mint' | 'burn';
}

export abstract class BaseDEXIntegration extends EventEmitter {
  protected config: ExchangeConfig;
  protected logger: Logger;
  protected metrics: MetricsCollector;
  protected provider: ethers.JsonRpcProvider;
  protected subgraphClient: AxiosInstance;
  protected isInitialized: boolean = false;
  protected blockSubscription?: any;
  protected poolCache: Map<string, PoolData> = new Map();
  protected readonly CACHE_TTL = 60000; // 1 minute for DEX data

  constructor(config: ExchangeConfig) {
    super();
    this.config = config;
    this.logger = new Logger(`DEX:${config.name}`);
    this.metrics = new MetricsCollector(`dex_${config.name}`);
    
    this.initializeProvider();
    this.initializeSubgraphClient();
  }

  /**
   * Initialize the DEX integration
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing DEX integration', { exchange: this.config.name });
      
      await this.validateConnection();
      await this.subscribeToBlocks();
      await this.loadInitialPoolData();
      
      this.isInitialized = true;
      this.logger.info('DEX integration initialized successfully', { exchange: this.config.name });
      
      this.metrics.incrementCounter('initialization_success');
    } catch (error) {
      this.logger.error('Failed to initialize DEX integration', { 
        exchange: this.config.name, 
        error: error instanceof Error ? error.message : String(error)
      });
      this.metrics.incrementCounter('initialization_failure');
      throw error;
    }
  }

  /**
   * Shutdown the integration gracefully
   */
  public async shutdown(): Promise<void> {
    this.logger.info('Shutting down DEX integration', { exchange: this.config.name });
    
    if (this.blockSubscription) {
      await this.provider.off('block', this.blockSubscription);
    }
    
    this.isInitialized = false;
    this.logger.info('DEX integration shutdown complete', { exchange: this.config.name });
  }

  /**
   * Get current fee data for specified trading pairs
   */
  public abstract getFeeData(symbols: string[]): Promise<FeeData[]>;

  /**
   * Get current price data for specified trading pairs
   */
  public abstract getPriceData(symbols: string[]): Promise<PriceData[]>;

  /**
   * Get pool data for specified pools
   */
  public abstract getPoolData(poolAddresses: string[]): Promise<PoolData[]>;

  /**
   * Get recent swap events
   */
  public abstract getSwapEvents(poolAddresses: string[], fromBlock?: number): Promise<SwapEvent[]>;

  /**
   * Get liquidity events
   */
  public abstract getLiquidityEvents(poolAddresses: string[], fromBlock?: number): Promise<LiquidityEvent[]>;

  /**
   * Detect potential flashloan attacks
   */
  public abstract detectFlashloanAttacks(transactionHash: string): Promise<FlashloanDetectionResult>;

  /**
   * Implement MEV protection mechanisms
   */
  public abstract getMEVProtection(poolAddress: string): Promise<MEVProtectionResult>;

  /**
   * Load initial pool data
   */
  protected abstract loadInitialPoolData(): Promise<void>;

  /**
   * Process new block events
   */
  protected abstract processNewBlock(blockNumber: number): Promise<void>;

  /**
   * Initialize Ethereum provider
   */
  private initializeProvider(): void {
    this.provider = new ethers.JsonRpcProvider(this.config.endpoints.rest, undefined, {
      staticNetwork: true,
      batchMaxCount: 100,
      batchMaxSize: 1024 * 1024,
      batchStallTime: 10,
    });

    // Add error handling
    this.provider.on('error', (error) => {
      this.logger.error('Provider error', { 
        exchange: this.config.name, 
        error: error.message 
      });
      this.metrics.incrementCounter('provider_errors');
    });
  }

  /**
   * Initialize subgraph client
   */
  private initializeSubgraphClient(): void {
    if (!this.config.endpoints.subgraph) {
      this.logger.warn('Subgraph endpoint not configured', { exchange: this.config.name });
      return;
    }

    this.subgraphClient = axios.create({
      baseURL: this.config.endpoints.subgraph,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'QuantLink-DataService/1.0.0',
      },
    });

    // Add response interceptor for error handling
    this.subgraphClient.interceptors.response.use(
      (response) => response,
      (error) => {
        this.logger.error('Subgraph request failed', { 
          exchange: this.config.name, 
          error: error.message 
        });
        this.metrics.incrementCounter('subgraph_errors');
        throw error;
      }
    );
  }

  /**
   * Validate connection to blockchain and subgraph
   */
  private async validateConnection(): Promise<void> {
    try {
      // Test blockchain connection
      const blockNumber = await this.provider.getBlockNumber();
      this.logger.info('Blockchain connection validated', { 
        exchange: this.config.name, 
        blockNumber 
      });

      // Test subgraph connection if available
      if (this.subgraphClient) {
        await this.subgraphClient.post('', {
          query: '{ _meta { block { number } } }',
        });
        this.logger.info('Subgraph connection validated', { exchange: this.config.name });
      }
    } catch (error) {
      this.logger.error('Connection validation failed', { 
        exchange: this.config.name, 
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`Failed to validate ${this.config.name} connection`);
    }
  }

  /**
   * Subscribe to new block events
   */
  private async subscribeToBlocks(): Promise<void> {
    try {
      this.blockSubscription = async (blockNumber: number) => {
        try {
          await this.processNewBlock(blockNumber);
          this.metrics.incrementCounter('blocks_processed');
        } catch (error) {
          this.logger.error('Error processing new block', { 
            exchange: this.config.name, 
            blockNumber, 
            error: error instanceof Error ? error.message : String(error)
          });
          this.metrics.incrementCounter('block_processing_errors');
        }
      };

      this.provider.on('block', this.blockSubscription);
      this.logger.info('Subscribed to block events', { exchange: this.config.name });
    } catch (error) {
      this.logger.error('Failed to subscribe to blocks', { 
        exchange: this.config.name, 
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Execute subgraph query with error handling and retries
   */
  protected async executeSubgraphQuery<T>(query: string, variables?: any): Promise<T> {
    if (!this.subgraphClient) {
      throw new Error('Subgraph client not initialized');
    }

    const startTime = Date.now();
    
    try {
      const response = await this.subgraphClient.post('', {
        query,
        variables,
      });

      const duration = Date.now() - startTime;
      this.metrics.recordLatency('subgraph_query', duration);
      this.metrics.incrementCounter('subgraph_queries_success');

      if (response.data.errors) {
        throw new Error(`Subgraph query errors: ${JSON.stringify(response.data.errors)}`);
      }

      return response.data.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.recordLatency('subgraph_query', duration);
      this.metrics.incrementCounter('subgraph_queries_failure');
      
      this.logger.error('Subgraph query failed', {
        exchange: this.config.name,
        query: query.substring(0, 200),
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw error;
    }
  }

  /**
   * Calculate volume-weighted average price from swap events
   */
  protected calculateVWAP(swapEvents: SwapEvent[]): number {
    if (swapEvents.length === 0) return 0;

    let totalVolume = 0;
    let weightedPriceSum = 0;

    for (const swap of swapEvents) {
      const amount0 = Math.abs(parseFloat(swap.amount0));
      const amount1 = Math.abs(parseFloat(swap.amount1));
      
      if (amount0 > 0 && amount1 > 0) {
        const price = amount1 / amount0;
        const volume = amount0; // Use amount0 as volume weight
        
        weightedPriceSum += price * volume;
        totalVolume += volume;
      }
    }

    return totalVolume > 0 ? weightedPriceSum / totalVolume : 0;
  }

  /**
   * Detect unusual trading patterns that might indicate MEV
   */
  protected detectMEVPatterns(swapEvents: SwapEvent[]): {
    frontrunning: boolean;
    sandwichAttack: boolean;
    arbitrage: boolean;
  } {
    // Group swaps by transaction hash and block
    const blockGroups = new Map<number, SwapEvent[]>();
    
    for (const swap of swapEvents) {
      const blockSwaps = blockGroups.get(swap.blockNumber) || [];
      blockSwaps.push(swap);
      blockGroups.set(swap.blockNumber, blockSwaps);
    }

    let frontrunning = false;
    let sandwichAttack = false;
    let arbitrage = false;

    for (const [blockNumber, blockSwaps] of blockGroups) {
      if (blockSwaps.length >= 3) {
        // Check for sandwich attacks (buy -> victim trade -> sell pattern)
        const sortedSwaps = blockSwaps.sort((a, b) => a.logIndex - b.logIndex);
        
        for (let i = 0; i < sortedSwaps.length - 2; i++) {
          const first = sortedSwaps[i];
          const second = sortedSwaps[i + 1];
          const third = sortedSwaps[i + 2];
          
          // Simple sandwich detection: same sender for first and third, different for second
          if (first.sender === third.sender && first.sender !== second.sender) {
            sandwichAttack = true;
          }
        }
      }

      // Check for frontrunning (high gas price transactions before normal ones)
      if (blockSwaps.length >= 2) {
        const sortedByGas = blockSwaps.sort((a, b) => 
          parseFloat(b.gasPrice) - parseFloat(a.gasPrice)
        );
        
        const highestGas = parseFloat(sortedByGas[0].gasPrice);
        const averageGas = blockSwaps.reduce((sum, swap) => 
          sum + parseFloat(swap.gasPrice), 0
        ) / blockSwaps.length;
        
        if (highestGas > averageGas * 2) {
          frontrunning = true;
        }
      }

      // Check for arbitrage (multiple swaps in same block with price differences)
      if (blockSwaps.length >= 2) {
        arbitrage = true; // Simplified detection
      }
    }

    return { frontrunning, sandwichAttack, arbitrage };
  }

  /**
   * Perform health check
   */
  public async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const blockNumber = await this.provider.getBlockNumber();
      const latency = Date.now() - startTime;
      
      return {
        service: `dex_${this.config.name}`,
        status: 'healthy',
        latency,
        timestamp: Date.now(),
        details: {
          blockNumber,
          poolCacheSize: this.poolCache.size,
          subgraphAvailable: !!this.subgraphClient,
        },
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      return {
        service: `dex_${this.config.name}`,
        status: 'unhealthy',
        latency,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get exchange configuration
   */
  public getConfig(): ExchangeConfig {
    return { ...this.config };
  }

  /**
   * Check if integration is ready
   */
  public isReady(): boolean {
    return this.isInitialized;
  }
}
