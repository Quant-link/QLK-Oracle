/**
 * @fileoverview Real-time Data Service Orchestrator
 * @author QuantLink Team
 * @version 1.0.0
 */

import { web3Provider } from '@/lib/blockchain/web3-provider';
import { oracleService } from '@/lib/blockchain/oracle-contracts';
import { exchangeService } from '@/lib/exchanges/exchange-service';
import { useOracleStore } from '@/store/oracle-store';

/**
 * Service status interface
 */
interface ServiceStatus {
  oracle: boolean;
  exchange: boolean;
  network: boolean;
  websocket: boolean;
}

/**
 * Real-time Service Class
 */
export class RealTimeService {
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
  private subscriptions: Map<string, () => void> = new Map();
  private isRunning: boolean = false;
  private status: ServiceStatus = {
    oracle: false,
    exchange: false,
    network: false,
    websocket: false,
  };

  /**
   * Start all real-time services
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('Real-time service is already running');
      return;
    }

    console.log('🚀 Starting QuantLink Real-time Service...');
    
    try {
      // Start network monitoring
      await this.startNetworkMonitoring();
      
      // Start oracle monitoring
      await this.startOracleMonitoring();
      
      // Start exchange monitoring
      await this.startExchangeMonitoring();
      
      // Start WebSocket connections
      await this.startWebSocketConnections();
      
      this.isRunning = true;
      console.log('✅ All real-time services started successfully');
      
      // Update store with service status
      this.updateServiceStatus();
      
    } catch (error) {
      console.error('❌ Failed to start real-time services:', error);
      useOracleStore.getState().setError('Failed to start real-time services');
    }
  }

  /**
   * Stop all real-time services
   */
  public stop(): void {
    if (!this.isRunning) {
      console.warn('Real-time service is not running');
      return;
    }

    console.log('🛑 Stopping QuantLink Real-time Service...');

    // Clear all intervals
    this.updateIntervals.forEach((interval) => {
      clearInterval(interval);
    });
    this.updateIntervals.clear();

    // Unsubscribe from all subscriptions
    this.subscriptions.forEach((unsubscribe) => {
      unsubscribe();
    });
    this.subscriptions.clear();

    // Destroy services
    web3Provider.destroy();
    oracleService.destroy();
    exchangeService.destroy();

    this.isRunning = false;
    this.status = {
      oracle: false,
      exchange: false,
      network: false,
      websocket: false,
    };

    console.log('✅ All real-time services stopped');
  }

  /**
   * Start network monitoring
   */
  private async startNetworkMonitoring(): Promise<void> {
    console.log('📡 Starting network monitoring...');
    
    // Update connection status every 5 seconds
    const networkInterval = setInterval(() => {
      const connectionStatus = web3Provider.getConnectionStatus();
      useOracleStore.getState().setConnectionStatus(connectionStatus);
    }, 5000);
    
    this.updateIntervals.set('network', networkInterval);
    this.status.network = true;
    
    // Initial update
    const connectionStatus = web3Provider.getConnectionStatus();
    useOracleStore.getState().setConnectionStatus(connectionStatus);
    
    console.log('✅ Network monitoring started');
  }

  /**
   * Start oracle monitoring
   */
  private async startOracleMonitoring(): Promise<void> {
    console.log('🔮 Starting oracle monitoring...');
    
    // Subscribe to oracle events
    const oracleUnsubscribe = oracleService.subscribeToOracleEvents((event) => {
      useOracleStore.getState().addOracleEvent(event);
      console.log('📊 New oracle event:', event);
    });
    
    this.subscriptions.set('oracle-events', oracleUnsubscribe);
    
    // Update oracle data every 10 seconds
    const oracleInterval = setInterval(async () => {
      try {
        const oracleData = await oracleService.getAllOracleData();
        useOracleStore.getState().setOracleData(oracleData);
      } catch (error) {
        console.error('Failed to fetch oracle data:', error);
      }
    }, 10000);
    
    this.updateIntervals.set('oracle', oracleInterval);
    this.status.oracle = true;
    
    // Initial update
    try {
      const oracleData = await oracleService.getAllOracleData();
      useOracleStore.getState().setOracleData(oracleData);
    } catch (error) {
      console.error('Failed to fetch initial oracle data:', error);
    }
    
    console.log('✅ Oracle monitoring started');
  }

  /**
   * Start exchange monitoring
   */
  private async startExchangeMonitoring(): Promise<void> {
    console.log('💱 Starting exchange monitoring...');
    
    // Update market data every 2 seconds
    const marketInterval = setInterval(() => {
      const marketData = exchangeService.getAllMarketData();
      useOracleStore.getState().setMarketData(marketData);
    }, 2000);
    
    this.updateIntervals.set('market', marketInterval);
    
    // Update exchange health every 30 seconds
    const healthInterval = setInterval(() => {
      const exchangeHealth = exchangeService.getAllHealthStatus();
      useOracleStore.getState().setExchangeHealth(exchangeHealth);
    }, 30000);
    
    this.updateIntervals.set('health', healthInterval);
    this.status.exchange = true;
    
    // Initial updates
    const marketData = exchangeService.getAllMarketData();
    const exchangeHealth = exchangeService.getAllHealthStatus();
    
    useOracleStore.getState().setMarketData(marketData);
    useOracleStore.getState().setExchangeHealth(exchangeHealth);
    
    console.log('✅ Exchange monitoring started');
  }

  /**
   * Start WebSocket connections
   */
  private async startWebSocketConnections(): Promise<void> {
    console.log('🔌 Starting WebSocket connections...');
    
    // Subscribe to block updates for all networks
    const networks = ['ethereum', 'arbitrum', 'optimism', 'polygon', 'bsc'];
    
    networks.forEach((network) => {
      try {
        const unsubscribe = web3Provider.subscribeToBlocks(network, (blockNumber) => {
          console.log(`📦 New block on ${network}: ${blockNumber}`);
          
          // Update metrics
          const metrics = useOracleStore.getState().metrics;
          useOracleStore.getState().updateMetrics({
            ...metrics,
            totalUpdates: metrics.totalUpdates + 1,
          });
        });
        
        this.subscriptions.set(`blocks-${network}`, unsubscribe);
      } catch (error) {
        console.warn(`Failed to subscribe to blocks on ${network}:`, error);
      }
    });
    
    this.status.websocket = true;
    console.log('✅ WebSocket connections started');
  }

  /**
   * Update service status in store
   */
  private updateServiceStatus(): void {
    const store = useOracleStore.getState();
    
    // Update subscription status
    store.toggleSubscription('oracle');
    store.toggleSubscription('exchange');
    store.toggleSubscription('network');
    
    // Clear any previous errors if all services are running
    if (Object.values(this.status).every(status => status)) {
      store.setError(null);
    }
  }

  /**
   * Get service status
   */
  public getStatus(): ServiceStatus {
    return { ...this.status };
  }

  /**
   * Check if service is running
   */
  public isServiceRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Restart specific service
   */
  public async restartService(service: keyof ServiceStatus): Promise<void> {
    console.log(`🔄 Restarting ${service} service...`);
    
    switch (service) {
      case 'network':
        // Clear existing interval
        const networkInterval = this.updateIntervals.get('network');
        if (networkInterval) {
          clearInterval(networkInterval);
        }
        await this.startNetworkMonitoring();
        break;
        
      case 'oracle':
        // Clear existing interval and subscription
        const oracleInterval = this.updateIntervals.get('oracle');
        if (oracleInterval) {
          clearInterval(oracleInterval);
        }
        const oracleUnsubscribe = this.subscriptions.get('oracle-events');
        if (oracleUnsubscribe) {
          oracleUnsubscribe();
        }
        await this.startOracleMonitoring();
        break;
        
      case 'exchange':
        // Clear existing intervals
        const marketInterval = this.updateIntervals.get('market');
        const healthInterval = this.updateIntervals.get('health');
        if (marketInterval) clearInterval(marketInterval);
        if (healthInterval) clearInterval(healthInterval);
        await this.startExchangeMonitoring();
        break;
        
      case 'websocket':
        // Clear existing subscriptions
        this.subscriptions.forEach((unsubscribe, key) => {
          if (key.startsWith('blocks-')) {
            unsubscribe();
            this.subscriptions.delete(key);
          }
        });
        await this.startWebSocketConnections();
        break;
    }
    
    console.log(`✅ ${service} service restarted`);
  }

  /**
   * Get performance metrics
   */
  public getMetrics(): Record<string, any> {
    const store = useOracleStore.getState();
    
    return {
      ...store.metrics,
      serviceStatus: this.status,
      isRunning: this.isRunning,
      activeIntervals: this.updateIntervals.size,
      activeSubscriptions: this.subscriptions.size,
      lastUpdate: store.lastUpdate,
    };
  }

  /**
   * Force update all data
   */
  public async forceUpdate(): Promise<void> {
    console.log('🔄 Force updating all data...');
    
    try {
      useOracleStore.getState().setLoading(true);
      
      // Update all data sources in parallel
      const [oracleData, marketData, exchangeHealth, connectionStatus] = await Promise.all([
        oracleService.getAllOracleData(),
        Promise.resolve(exchangeService.getAllMarketData()),
        Promise.resolve(exchangeService.getAllHealthStatus()),
        Promise.resolve(web3Provider.getConnectionStatus()),
      ]);
      
      // Update store
      const store = useOracleStore.getState();
      store.setOracleData(oracleData);
      store.setMarketData(marketData);
      store.setExchangeHealth(exchangeHealth);
      store.setConnectionStatus(connectionStatus);
      
      console.log('✅ Force update completed');
    } catch (error) {
      console.error('❌ Force update failed:', error);
      useOracleStore.getState().setError('Failed to update data');
    } finally {
      useOracleStore.getState().setLoading(false);
    }
  }
}

// Singleton instance
export const realTimeService = new RealTimeService();

// Auto-start service when module is imported
if (typeof window !== 'undefined') {
  // Only start in browser environment
  realTimeService.start().catch(console.error);
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    realTimeService.stop();
  });
}
