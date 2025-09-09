/**
 * @fileoverview Enterprise Web3 Provider with Multi-Chain Support
 * @author QuantLink Team
 * @version 1.0.0
 */

import { ethers } from 'ethers';
import { createPublicClient, createWalletClient, http, webSocket } from 'viem';
import { mainnet, arbitrum, optimism, polygon, bsc } from 'viem/chains';

/**
 * Network configuration interface
 */
interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  wsUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

/**
 * Supported blockchain networks
 */
export const NETWORKS: Record<string, NetworkConfig> = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    wsUrl: 'wss://ethereum-rpc.publicnode.com',
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: 'https://arbitrum-one-rpc.publicnode.com',
    wsUrl: 'wss://arbitrum-one-rpc.publicnode.com',
    explorerUrl: 'https://arbiscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  optimism: {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: 'https://optimism-rpc.publicnode.com',
    wsUrl: 'wss://optimism-rpc.publicnode.com',
    explorerUrl: 'https://optimistic.etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  polygon: {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: 'https://polygon-bor-rpc.publicnode.com',
    wsUrl: 'wss://polygon-bor-rpc.publicnode.com',
    explorerUrl: 'https://polygonscan.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  },
  bsc: {
    chainId: 56,
    name: 'BNB Smart Chain',
    rpcUrl: 'https://bsc-rpc.publicnode.com',
    wsUrl: 'wss://bsc-rpc.publicnode.com',
    explorerUrl: 'https://bscscan.com',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  },
};

/**
 * Connection status interface
 */
export interface ConnectionStatus {
  network: string;
  connected: boolean;
  blockNumber: number;
  latency: number;
  lastUpdate: number;
  peerCount?: number;
  gasPrice?: string;
  error?: string;
}

/**
 * Enterprise Web3 Provider Class
 */
export class Web3Provider {
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private wsProviders: Map<string, ethers.WebSocketProvider> = new Map();
  private viemClients: Map<string, any> = new Map();
  private connectionStatus: Map<string, ConnectionStatus> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeProviders();
    this.startHealthMonitoring();
  }

  /**
   * Initialize providers for all networks
   */
  private initializeProviders(): void {
    Object.entries(NETWORKS).forEach(([networkName, config]) => {
      try {
        // Initialize ethers providers
        const httpProvider = new ethers.JsonRpcProvider(config.rpcUrl);
        const wsProvider = new ethers.WebSocketProvider(config.wsUrl);
        
        this.providers.set(networkName, httpProvider);
        this.wsProviders.set(networkName, wsProvider);

        // Initialize viem clients
        const viemClient = createPublicClient({
          chain: this.getViemChain(networkName),
          transport: http(config.rpcUrl),
        });
        
        this.viemClients.set(networkName, viemClient);

        // Initialize connection status
        this.connectionStatus.set(networkName, {
          network: networkName,
          connected: false,
          blockNumber: 0,
          latency: 0,
          lastUpdate: Date.now(),
        });

        console.log(`✅ Initialized providers for ${config.name}`);
      } catch (error) {
        console.error(`❌ Failed to initialize ${networkName}:`, error);
      }
    });
  }

  /**
   * Get viem chain configuration
   */
  private getViemChain(networkName: string) {
    switch (networkName) {
      case 'ethereum': return mainnet;
      case 'arbitrum': return arbitrum;
      case 'optimism': return optimism;
      case 'polygon': return polygon;
      case 'bsc': return bsc;
      default: return mainnet;
    }
  }

  /**
   * Start health monitoring for all networks
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 5000); // Check every 5 seconds
  }

  /**
   * Perform health checks on all networks
   */
  private async performHealthChecks(): Promise<void> {
    const healthPromises = Array.from(this.providers.entries()).map(
      async ([networkName, provider]) => {
        try {
          const startTime = Date.now();
          const blockNumber = await provider.getBlockNumber();
          const latency = Date.now() - startTime;

          // Get additional network info
          const gasPrice = await provider.getFeeData();
          
          this.connectionStatus.set(networkName, {
            network: networkName,
            connected: true,
            blockNumber,
            latency,
            lastUpdate: Date.now(),
            gasPrice: gasPrice.gasPrice?.toString() || '0',
          });
        } catch (error) {
          this.connectionStatus.set(networkName, {
            network: networkName,
            connected: false,
            blockNumber: 0,
            latency: 0,
            lastUpdate: Date.now(),
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    );

    await Promise.allSettled(healthPromises);
  }

  /**
   * Get provider for specific network
   */
  public getProvider(network: string): ethers.JsonRpcProvider | null {
    return this.providers.get(network) || null;
  }

  /**
   * Get WebSocket provider for specific network
   */
  public getWSProvider(network: string): ethers.WebSocketProvider | null {
    return this.wsProviders.get(network) || null;
  }

  /**
   * Get viem client for specific network
   */
  public getViemClient(network: string): any {
    return this.viemClients.get(network) || null;
  }

  /**
   * Get connection status for all networks
   */
  public getConnectionStatus(): ConnectionStatus[] {
    return Array.from(this.connectionStatus.values());
  }

  /**
   * Get connection status for specific network
   */
  public getNetworkStatus(network: string): ConnectionStatus | null {
    return this.connectionStatus.get(network) || null;
  }

  /**
   * Subscribe to new blocks on specific network
   */
  public subscribeToBlocks(
    network: string,
    callback: (blockNumber: number) => void
  ): () => void {
    const wsProvider = this.getWSProvider(network);
    if (!wsProvider) {
      throw new Error(`WebSocket provider not available for ${network}`);
    }

    wsProvider.on('block', callback);

    // Return unsubscribe function
    return () => {
      wsProvider.off('block', callback);
    };
  }

  /**
   * Get current gas prices across all networks
   */
  public async getGasPrices(): Promise<Record<string, string>> {
    const gasPrices: Record<string, string> = {};
    
    const promises = Array.from(this.providers.entries()).map(
      async ([networkName, provider]) => {
        try {
          const feeData = await provider.getFeeData();
          gasPrices[networkName] = feeData.gasPrice?.toString() || '0';
        } catch (error) {
          gasPrices[networkName] = '0';
        }
      }
    );

    await Promise.allSettled(promises);
    return gasPrices;
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Close WebSocket connections
    this.wsProviders.forEach((provider) => {
      provider.destroy();
    });

    this.providers.clear();
    this.wsProviders.clear();
    this.viemClients.clear();
    this.connectionStatus.clear();
  }
}

// Singleton instance
export const web3Provider = new Web3Provider();
