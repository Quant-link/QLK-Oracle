/**
 * @fileoverview Oracle Smart Contract Integration
 * @author QuantLink Team
 * @version 1.0.0
 */

import { ethers } from 'ethers';
import { web3Provider } from './web3-provider';

/**
 * Oracle contract addresses across networks
 */
export const ORACLE_CONTRACTS: Record<string, Record<string, string>> = {
  ethereum: {
    priceOracle: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // Chainlink ETH/USD
    aggregator: '0x37bC7498f4FF12C19678ee8fE19d713b87F6a9e6', // Chainlink Registry
    accessController: '0x0000000000000000000000000000000000000000',
  },
  arbitrum: {
    priceOracle: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612', // Chainlink ETH/USD
    aggregator: '0x0000000000000000000000000000000000000000',
    accessController: '0x0000000000000000000000000000000000000000',
  },
  optimism: {
    priceOracle: '0x13e3Ee699D1909E989722E753853AE30b17e08c5', // Chainlink ETH/USD
    aggregator: '0x0000000000000000000000000000000000000000',
    accessController: '0x0000000000000000000000000000000000000000',
  },
  polygon: {
    priceOracle: '0xF9680D99D6C9589e2a93a78A04A279e509205945', // Chainlink ETH/USD
    aggregator: '0x0000000000000000000000000000000000000000',
    accessController: '0x0000000000000000000000000000000000000000',
  },
};

/**
 * Oracle ABI for price feeds
 */
export const PRICE_ORACLE_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
  'function description() external view returns (string memory)',
  'function version() external view returns (uint256)',
  'function getRoundData(uint80 _roundId) external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)',
];

/**
 * Oracle data interface
 */
export interface OracleData {
  roundId: string;
  answer: string;
  startedAt: number;
  updatedAt: number;
  answeredInRound: string;
  decimals: number;
  description: string;
  version: string;
  network: string;
  contractAddress: string;
  priceUSD: number;
  timestamp: number;
}

/**
 * Oracle event interface
 */
export interface OracleEvent {
  network: string;
  contractAddress: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  current: string;
  roundId: string;
  updatedAt: number;
  timestamp: number;
}

/**
 * Oracle Contract Service
 */
export class OracleContractService {
  private contracts: Map<string, Map<string, ethers.Contract>> = new Map();
  private eventListeners: Map<string, () => void> = new Map();

  constructor() {
    this.initializeContracts();
  }

  /**
   * Initialize oracle contracts for all networks
   */
  private initializeContracts(): void {
    Object.entries(ORACLE_CONTRACTS).forEach(([network, contracts]) => {
      const networkContracts = new Map<string, ethers.Contract>();
      const provider = web3Provider.getProvider(network);
      
      if (!provider) {
        console.warn(`Provider not available for ${network}`);
        return;
      }

      Object.entries(contracts).forEach(([contractType, address]) => {
        if (address !== '0x0000000000000000000000000000000000000000') {
          try {
            const contract = new ethers.Contract(
              address,
              PRICE_ORACLE_ABI,
              provider
            );
            networkContracts.set(contractType, contract);
            console.log(`✅ Initialized ${contractType} contract on ${network}: ${address}`);
          } catch (error) {
            console.error(`❌ Failed to initialize ${contractType} on ${network}:`, error);
          }
        }
      });

      this.contracts.set(network, networkContracts);
    });
  }

  /**
   * Get latest oracle data from all networks
   */
  public async getAllOracleData(): Promise<OracleData[]> {
    const allData: OracleData[] = [];
    
    const promises = Array.from(this.contracts.entries()).map(
      async ([network, networkContracts]) => {
        const priceOracle = networkContracts.get('priceOracle');
        if (!priceOracle) return;

        try {
          const [roundData, decimals, description, version] = await Promise.all([
            priceOracle.latestRoundData(),
            priceOracle.decimals(),
            priceOracle.description(),
            priceOracle.version(),
          ]);

          const oracleData: OracleData = {
            roundId: roundData.roundId.toString(),
            answer: roundData.answer.toString(),
            startedAt: Number(roundData.startedAt),
            updatedAt: Number(roundData.updatedAt),
            answeredInRound: roundData.answeredInRound.toString(),
            decimals: Number(decimals),
            description: description,
            version: version.toString(),
            network,
            contractAddress: await priceOracle.getAddress(),
            priceUSD: Number(roundData.answer) / Math.pow(10, Number(decimals)),
            timestamp: Date.now(),
          };

          allData.push(oracleData);
        } catch (error) {
          console.error(`Failed to fetch oracle data for ${network}:`, error);
        }
      }
    );

    await Promise.allSettled(promises);
    return allData;
  }

  /**
   * Get oracle data for specific network
   */
  public async getOracleData(network: string): Promise<OracleData | null> {
    const networkContracts = this.contracts.get(network);
    const priceOracle = networkContracts?.get('priceOracle');
    
    if (!priceOracle) {
      return null;
    }

    try {
      const [roundData, decimals, description, version] = await Promise.all([
        priceOracle.latestRoundData(),
        priceOracle.decimals(),
        priceOracle.description(),
        priceOracle.version(),
      ]);

      return {
        roundId: roundData.roundId.toString(),
        answer: roundData.answer.toString(),
        startedAt: Number(roundData.startedAt),
        updatedAt: Number(roundData.updatedAt),
        answeredInRound: roundData.answeredInRound.toString(),
        decimals: Number(decimals),
        description: description,
        version: version.toString(),
        network,
        contractAddress: await priceOracle.getAddress(),
        priceUSD: Number(roundData.answer) / Math.pow(10, Number(decimals)),
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Failed to fetch oracle data for ${network}:`, error);
      return null;
    }
  }

  /**
   * Subscribe to oracle events across all networks
   */
  public subscribeToOracleEvents(
    callback: (event: OracleEvent) => void
  ): () => void {
    const unsubscribeFunctions: (() => void)[] = [];

    Object.entries(ORACLE_CONTRACTS).forEach(([network, contracts]) => {
      const wsProvider = web3Provider.getWSProvider(network);
      if (!wsProvider || contracts.priceOracle === '0x0000000000000000000000000000000000000000') {
        return;
      }

      try {
        const contract = new ethers.Contract(
          contracts.priceOracle,
          PRICE_ORACLE_ABI,
          wsProvider
        );

        const eventHandler = async (current: bigint, roundId: bigint, updatedAt: bigint, event: any) => {
          const oracleEvent: OracleEvent = {
            network,
            contractAddress: contracts.priceOracle,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            current: current.toString(),
            roundId: roundId.toString(),
            updatedAt: Number(updatedAt),
            timestamp: Date.now(),
          };

          callback(oracleEvent);
        };

        contract.on('AnswerUpdated', eventHandler);

        unsubscribeFunctions.push(() => {
          contract.off('AnswerUpdated', eventHandler);
        });

        console.log(`✅ Subscribed to oracle events on ${network}`);
      } catch (error) {
        console.error(`❌ Failed to subscribe to oracle events on ${network}:`, error);
      }
    });

    // Return function to unsubscribe from all events
    return () => {
      unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
    };
  }

  /**
   * Get historical oracle data
   */
  public async getHistoricalData(
    network: string,
    fromRound: number,
    toRound: number
  ): Promise<OracleData[]> {
    const networkContracts = this.contracts.get(network);
    const priceOracle = networkContracts?.get('priceOracle');
    
    if (!priceOracle) {
      return [];
    }

    const historicalData: OracleData[] = [];
    const promises: Promise<void>[] = [];

    for (let roundId = fromRound; roundId <= toRound; roundId++) {
      promises.push(
        (async () => {
          try {
            const [roundData, decimals, description, version] = await Promise.all([
              priceOracle.getRoundData(roundId),
              priceOracle.decimals(),
              priceOracle.description(),
              priceOracle.version(),
            ]);

            if (roundData.updatedAt > 0) {
              historicalData.push({
                roundId: roundData.roundId.toString(),
                answer: roundData.answer.toString(),
                startedAt: Number(roundData.startedAt),
                updatedAt: Number(roundData.updatedAt),
                answeredInRound: roundData.answeredInRound.toString(),
                decimals: Number(decimals),
                description: description,
                version: version.toString(),
                network,
                contractAddress: await priceOracle.getAddress(),
                priceUSD: Number(roundData.answer) / Math.pow(10, Number(decimals)),
                timestamp: Number(roundData.updatedAt) * 1000,
              });
            }
          } catch (error) {
            // Round might not exist, skip silently
          }
        })()
      );
    }

    await Promise.allSettled(promises);
    return historicalData.sort((a, b) => a.updatedAt - b.updatedAt);
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    this.eventListeners.forEach(unsubscribe => unsubscribe());
    this.eventListeners.clear();
    this.contracts.clear();
  }
}

// Singleton instance
export const oracleService = new OracleContractService();
