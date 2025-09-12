import { ethers } from 'ethers';

// Blockchain explorer APIs
const EXPLORER_APIS = {
  ethereum: {
    etherscan: 'https://api.etherscan.io/api',
    blockchair: 'https://api.blockchair.com/ethereum',
    alchemy: 'https://eth-mainnet.g.alchemy.com/v2/demo'
  },
  polygon: {
    polygonscan: 'https://api.polygonscan.com/api',
    blockchair: 'https://api.blockchair.com/polygon'
  },
  arbitrum: {
    arbiscan: 'https://api.arbiscan.io/api',
    blockchair: 'https://api.blockchair.com/arbitrum-one'
  },
  bsc: {
    bscscan: 'https://api.bscscan.com/api',
    blockchair: 'https://api.blockchair.com/bitcoin-sv'
  },
  optimism: {
    optimistic: 'https://api-optimistic.etherscan.io/api'
  }
};

// Node monitoring endpoints (these would be your own nodes in production)
const NODE_MONITORING = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  polygon: 'https://polygon-bor-rpc.publicnode.com',
  arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
  bsc: 'https://bsc-rpc.publicnode.com',
  optimism: 'https://optimism-rpc.publicnode.com'
};

interface NetworkMetrics {
  network: string;
  blockHeight: number;
  blockTime: number;
  tps: number;
  gasPrice: string;
  gasUsed: number;
  gasLimit: number;
  gasUtilization: number;
  difficulty: string;
  hashrate: string;
  networkLatency: number;
  nodeCount: number;
  memoryUsage: number;
  cpuUsage: number;
  diskUsage: number;
  pendingTransactions: number;
  totalTransactions: number;
  activeAddresses: number;
}

interface PerformanceHistory {
  timestamp: number;
  blockNumber: number;
  blockTime: number;
  tps: number;
  gasUsed: number;
  gasPrice: string;
  networkLatency: number;
  memoryUsage: number;
  cpuUsage: number;
}

interface SystemResources {
  cpu: {
    usage: number;
    cores: number;
    frequency: number;
  };
  memory: {
    used: number;
    total: number;
    usage: number;
  };
  disk: {
    used: number;
    total: number;
    usage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
}

export class BlockchainMetricsService {
  private providers: Record<string, ethers.JsonRpcProvider>;
  private performanceHistory: Record<string, PerformanceHistory[]> = {};

  constructor() {
    this.providers = {};
    this.initializeProviders();
    this.startPerformanceTracking();
  }

  private initializeProviders() {
    for (const [network, rpcUrl] of Object.entries(NODE_MONITORING)) {
      this.providers[network] = new ethers.JsonRpcProvider(rpcUrl);
    }
  }

  private startPerformanceTracking() {
    // Track performance every 30 seconds
    setInterval(() => {
      this.collectPerformanceData();
    }, 30000);

    // Initial collection
    this.collectPerformanceData();
  }

  private async collectPerformanceData() {
    for (const network of Object.keys(this.providers)) {
      try {
        const metrics = await this.getNetworkMetrics(network);
        
        if (!this.performanceHistory[network]) {
          this.performanceHistory[network] = [];
        }

        const historyEntry: PerformanceHistory = {
          timestamp: Date.now(),
          blockNumber: metrics.blockHeight,
          blockTime: metrics.blockTime,
          tps: metrics.tps,
          gasUsed: metrics.gasUsed,
          gasPrice: metrics.gasPrice,
          networkLatency: metrics.networkLatency,
          memoryUsage: metrics.memoryUsage,
          cpuUsage: metrics.cpuUsage
        };

        this.performanceHistory[network].push(historyEntry);

        // Keep only last 200 entries (about 100 minutes of data)
        if (this.performanceHistory[network].length > 200) {
          this.performanceHistory[network] = this.performanceHistory[network].slice(-200);
        }
      } catch (error) {
        console.error(`Error collecting performance data for ${network}:`, error);
      }
    }
  }

  async getNetworkMetrics(network: string): Promise<NetworkMetrics> {
    try {
      const provider = this.providers[network];
      if (!provider) {
        throw new Error(`Provider not found for network: ${network}`);
      }

      const startTime = Date.now();
      
      // Get basic network data
      const [
        latestBlock,
        gasPrice,
        pendingTxCount
      ] = await Promise.all([
        provider.getBlock('latest'),
        provider.getFeeData(),
        this.getPendingTransactionCount(network)
      ]);

      const networkLatency = Date.now() - startTime;

      if (!latestBlock) {
        throw new Error('Failed to fetch latest block');
      }

      // Calculate block time
      const blockTime = await this.calculateAverageBlockTime(network);
      
      // Calculate TPS
      const tps = await this.calculateTPS(network);

      // Get gas utilization
      const gasUtilization = latestBlock.gasLimit > 0 ? 
        (Number(latestBlock.gasUsed) / Number(latestBlock.gasLimit)) * 100 : 0;

      // Get network difficulty and hashrate
      const { difficulty, hashrate } = await this.getNetworkDifficulty(network);

      // Get system resources (simulated for demo - in production, this would come from actual node monitoring)
      const systemResources = await this.getSystemResources(network);

      // Get network statistics
      const networkStats = await this.getNetworkStatistics(network);

      return {
        network,
        blockHeight: latestBlock.number,
        blockTime,
        tps,
        gasPrice: ethers.formatUnits(gasPrice.gasPrice || 0, 'gwei'),
        gasUsed: Number(latestBlock.gasUsed),
        gasLimit: Number(latestBlock.gasLimit),
        gasUtilization,
        difficulty,
        hashrate,
        networkLatency,
        nodeCount: networkStats.nodeCount,
        memoryUsage: systemResources.memory.usage,
        cpuUsage: systemResources.cpu.usage,
        diskUsage: systemResources.disk.usage,
        pendingTransactions: pendingTxCount,
        totalTransactions: networkStats.totalTransactions,
        activeAddresses: networkStats.activeAddresses
      };
    } catch (error) {
      console.error(`Error fetching network metrics for ${network}:`, error);
      throw error;
    }
  }

  private async calculateAverageBlockTime(network: string): Promise<number> {
    try {
      const provider = this.providers[network];
      const currentBlock = await provider.getBlock('latest');
      const previousBlock = await provider.getBlock(currentBlock!.number - 10);

      if (currentBlock && previousBlock) {
        const timeDiff = currentBlock.timestamp - previousBlock.timestamp;
        return timeDiff / 10; // Average over 10 blocks
      }

      // Default block times for different networks
      const defaultBlockTimes: Record<string, number> = {
        ethereum: 12,
        polygon: 2,
        arbitrum: 0.25,
        bsc: 3,
        optimism: 2
      };

      return defaultBlockTimes[network] || 12;
    } catch (error) {
      console.error(`Error calculating block time for ${network}:`, error);
      return 12;
    }
  }

  private async calculateTPS(network: string): Promise<number> {
    try {
      const provider = this.providers[network];
      const latestBlock = await provider.getBlock('latest', true);
      
      if (!latestBlock || !latestBlock.transactions) {
        return 0;
      }

      const blockTime = await this.calculateAverageBlockTime(network);
      const txCount = latestBlock.transactions.length;
      
      return txCount / blockTime;
    } catch (error) {
      console.error(`Error calculating TPS for ${network}:`, error);
      return 0;
    }
  }

  private async getPendingTransactionCount(network: string): Promise<number> {
    try {
      // This would require access to mempool data
      // For now, we'll use a simulated value based on network activity
      const provider = this.providers[network];
      const latestBlock = await provider.getBlock('latest');
      
      if (latestBlock) {
        // Estimate pending transactions based on recent block fullness
        const gasUtilization = Number(latestBlock.gasUsed) / Number(latestBlock.gasLimit);
        return Math.floor(gasUtilization * 1000); // Rough estimation
      }
      
      return 0;
    } catch (error) {
      console.error(`Error getting pending transaction count for ${network}:`, error);
      return 0;
    }
  }

  private async getNetworkDifficulty(network: string): Promise<{ difficulty: string; hashrate: string }> {
    try {
      const provider = this.providers[network];
      const latestBlock = await provider.getBlock('latest');
      
      if (latestBlock && latestBlock.difficulty) {
        const difficulty = latestBlock.difficulty.toString();
        
        // Calculate hashrate (simplified)
        const blockTime = await this.calculateAverageBlockTime(network);
        const hashrateNum = Number(latestBlock.difficulty) / blockTime;
        
        let hashrate: string;
        if (hashrateNum > 1e18) {
          hashrate = `${(hashrateNum / 1e18).toFixed(2)} EH/s`;
        } else if (hashrateNum > 1e15) {
          hashrate = `${(hashrateNum / 1e15).toFixed(2)} PH/s`;
        } else if (hashrateNum > 1e12) {
          hashrate = `${(hashrateNum / 1e12).toFixed(2)} TH/s`;
        } else {
          hashrate = `${(hashrateNum / 1e9).toFixed(2)} GH/s`;
        }
        
        return { difficulty, hashrate };
      }
      
      return { difficulty: 'N/A', hashrate: 'N/A' };
    } catch (error) {
      console.error(`Error getting network difficulty for ${network}:`, error);
      return { difficulty: 'N/A', hashrate: 'N/A' };
    }
  }

  private async getSystemResources(network: string): Promise<SystemResources> {
    // In production, this would come from actual node monitoring
    // For now, we'll simulate realistic values
    
    const baseLoad = Math.random() * 0.3 + 0.2; // 20-50% base load
    const networkMultiplier = {
      ethereum: 1.5,
      polygon: 1.2,
      arbitrum: 0.8,
      bsc: 1.0,
      optimism: 0.9
    }[network] || 1.0;

    const cpuUsage = Math.min(95, baseLoad * 100 * networkMultiplier + Math.random() * 20);
    const memoryUsage = Math.min(90, baseLoad * 80 * networkMultiplier + Math.random() * 15);
    const diskUsage = Math.min(85, 30 + Math.random() * 20);

    return {
      cpu: {
        usage: cpuUsage,
        cores: 8,
        frequency: 3200
      },
      memory: {
        used: memoryUsage * 32 / 100, // 32GB total
        total: 32,
        usage: memoryUsage
      },
      disk: {
        used: diskUsage * 2000 / 100, // 2TB total
        total: 2000,
        usage: diskUsage
      },
      network: {
        bytesIn: Math.floor(Math.random() * 1000000),
        bytesOut: Math.floor(Math.random() * 800000),
        packetsIn: Math.floor(Math.random() * 10000),
        packetsOut: Math.floor(Math.random() * 8000)
      }
    };
  }

  private async getNetworkStatistics(network: string): Promise<{
    nodeCount: number;
    totalTransactions: number;
    activeAddresses: number;
  }> {
    try {
      // In production, this would come from network crawlers and analytics APIs
      const networkStats = {
        ethereum: { nodeCount: 5000, totalTransactions: 2000000000, activeAddresses: 200000 },
        polygon: { nodeCount: 100, totalTransactions: 3000000000, activeAddresses: 300000 },
        arbitrum: { nodeCount: 50, totalTransactions: 500000000, activeAddresses: 100000 },
        bsc: { nodeCount: 21, totalTransactions: 4000000000, activeAddresses: 400000 },
        optimism: { nodeCount: 30, totalTransactions: 200000000, activeAddresses: 80000 }
      };

      return networkStats[network as keyof typeof networkStats] || 
             { nodeCount: 0, totalTransactions: 0, activeAddresses: 0 };
    } catch (error) {
      console.error(`Error getting network statistics for ${network}:`, error);
      return { nodeCount: 0, totalTransactions: 0, activeAddresses: 0 };
    }
  }

  getPerformanceHistory(network: string, hours: number = 1): PerformanceHistory[] {
    const history = this.performanceHistory[network] || [];
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
    
    return history.filter(entry => entry.timestamp >= cutoffTime);
  }

  async getMultiNetworkMetrics(): Promise<Record<string, NetworkMetrics>> {
    const metrics: Record<string, NetworkMetrics> = {};
    
    const networks = Object.keys(this.providers);
    const promises = networks.map(async (network) => {
      try {
        metrics[network] = await this.getNetworkMetrics(network);
      } catch (error) {
        console.error(`Error fetching metrics for ${network}:`, error);
      }
    });

    await Promise.all(promises);
    return metrics;
  }

  async getNetworkHealth(network: string): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    score: number;
    issues: string[];
    uptime: number;
  }> {
    try {
      const metrics = await this.getNetworkMetrics(network);
      const issues: string[] = [];
      let score = 100;

      // Check various health indicators
      if (metrics.networkLatency > 1000) {
        issues.push('High network latency');
        score -= 20;
      }

      if (metrics.gasUtilization > 90) {
        issues.push('Network congestion');
        score -= 15;
      }

      if (metrics.cpuUsage > 90) {
        issues.push('High CPU usage');
        score -= 10;
      }

      if (metrics.memoryUsage > 85) {
        issues.push('High memory usage');
        score -= 10;
      }

      if (metrics.diskUsage > 80) {
        issues.push('High disk usage');
        score -= 5;
      }

      // Calculate uptime (simplified)
      const uptime = Math.max(95, 100 - (issues.length * 2));

      let status: 'healthy' | 'warning' | 'critical';
      if (score >= 80) {
        status = 'healthy';
      } else if (score >= 60) {
        status = 'warning';
      } else {
        status = 'critical';
      }

      return {
        status,
        score: Math.max(0, score),
        issues,
        uptime
      };
    } catch (error) {
      console.error(`Error calculating network health for ${network}:`, error);
      return {
        status: 'critical',
        score: 0,
        issues: ['Unable to fetch network data'],
        uptime: 0
      };
    }
  }
}

export const blockchainMetricsService = new BlockchainMetricsService();
