/**
 * @fileoverview Oracle Data Store with Real-time Updates
 * @author QuantLink Team
 * @version 1.0.0
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { persist } from 'zustand/middleware';
import { OracleData, OracleEvent } from '@/lib/blockchain/oracle-contracts';
import { MarketData, ExchangeHealth } from '@/lib/exchanges/exchange-service';
import { ConnectionStatus } from '@/lib/blockchain/web3-provider';

/**
 * Oracle store state interface
 */
interface OracleState {
  // Oracle data
  oracleData: OracleData[];
  oracleEvents: OracleEvent[];
  
  // Exchange data
  marketData: MarketData[];
  exchangeHealth: ExchangeHealth[];
  
  // Network status
  connectionStatus: ConnectionStatus[];
  
  // UI state
  isLoading: boolean;
  error: string | null;
  lastUpdate: number;
  
  // Real-time subscriptions
  subscriptions: {
    oracle: boolean;
    exchange: boolean;
    network: boolean;
  };
  
  // Performance metrics
  metrics: {
    totalUpdates: number;
    averageLatency: number;
    errorRate: number;
    uptimePercentage: number;
  };
  
  // Actions
  setOracleData: (data: OracleData[]) => void;
  addOracleEvent: (event: OracleEvent) => void;
  setMarketData: (data: MarketData[]) => void;
  setExchangeHealth: (health: ExchangeHealth[]) => void;
  setConnectionStatus: (status: ConnectionStatus[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  updateMetrics: (metrics: Partial<OracleState['metrics']>) => void;
  toggleSubscription: (type: keyof OracleState['subscriptions']) => void;
  clearData: () => void;
  
  // Computed getters
  getLatestOraclePrice: (network: string) => number | null;
  getExchangeByName: (name: string) => ExchangeHealth | null;
  getNetworkStatus: (network: string) => ConnectionStatus | null;
  getAveragePrice: (symbol: string) => number | null;
  getPriceSpread: (symbol: string) => number | null;
}

/**
 * Create Oracle Store
 */
export const useOracleStore = create<OracleState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // Initial state
        oracleData: [],
        oracleEvents: [],
        marketData: [],
        exchangeHealth: [],
        connectionStatus: [],
        isLoading: false,
        error: null,
        lastUpdate: Date.now(),
        
        subscriptions: {
          oracle: false,
          exchange: false,
          network: false,
        },
        
        metrics: {
          totalUpdates: 0,
          averageLatency: 0,
          errorRate: 0,
          uptimePercentage: 100,
        },

        // Actions
        setOracleData: (data: OracleData[]) => {
          set((state) => ({
            oracleData: data,
            lastUpdate: Date.now(),
            metrics: {
              ...state.metrics,
              totalUpdates: state.metrics.totalUpdates + 1,
            },
          }));
        },

        addOracleEvent: (event: OracleEvent) => {
          set((state) => ({
            oracleEvents: [event, ...state.oracleEvents].slice(0, 1000), // Keep last 1000 events
            lastUpdate: Date.now(),
          }));
        },

        setMarketData: (data: MarketData[]) => {
          set((state) => {
            // Calculate average latency from exchange data
            const totalLatency = data.reduce((sum, item) => {
              const latency = Date.now() - item.timestamp;
              return sum + latency;
            }, 0);
            const averageLatency = data.length > 0 ? totalLatency / data.length : 0;

            return {
              marketData: data,
              lastUpdate: Date.now(),
              metrics: {
                ...state.metrics,
                averageLatency,
                totalUpdates: state.metrics.totalUpdates + 1,
              },
            };
          });
        },

        setExchangeHealth: (health: ExchangeHealth[]) => {
          set((state) => {
            // Calculate overall uptime percentage
            const totalUptime = health.reduce((sum, exchange) => sum + exchange.uptimePercentage, 0);
            const uptimePercentage = health.length > 0 ? totalUptime / health.length : 100;

            // Calculate error rate
            const totalErrors = health.reduce((sum, exchange) => sum + exchange.errorCount, 0);
            const totalRequests = state.metrics.totalUpdates || 1;
            const errorRate = (totalErrors / totalRequests) * 100;

            return {
              exchangeHealth: health,
              lastUpdate: Date.now(),
              metrics: {
                ...state.metrics,
                uptimePercentage,
                errorRate,
              },
            };
          });
        },

        setConnectionStatus: (status: ConnectionStatus[]) => {
          set(() => ({
            connectionStatus: status,
            lastUpdate: Date.now(),
          }));
        },

        setLoading: (loading: boolean) => {
          set(() => ({ isLoading: loading }));
        },

        setError: (error: string | null) => {
          set(() => ({ error }));
        },

        updateMetrics: (metrics: Partial<OracleState['metrics']>) => {
          set((state) => ({
            metrics: { ...state.metrics, ...metrics },
          }));
        },

        toggleSubscription: (type: keyof OracleState['subscriptions']) => {
          set((state) => ({
            subscriptions: {
              ...state.subscriptions,
              [type]: !state.subscriptions[type],
            },
          }));
        },

        clearData: () => {
          set(() => ({
            oracleData: [],
            oracleEvents: [],
            marketData: [],
            exchangeHealth: [],
            connectionStatus: [],
            error: null,
            lastUpdate: Date.now(),
          }));
        },

        // Computed getters
        getLatestOraclePrice: (network: string) => {
          const { oracleData } = get();
          const networkData = oracleData.find(data => data.network === network);
          return networkData ? networkData.priceUSD : null;
        },

        getExchangeByName: (name: string) => {
          const { exchangeHealth } = get();
          return exchangeHealth.find(exchange => exchange.exchange === name) || null;
        },

        getNetworkStatus: (network: string) => {
          const { connectionStatus } = get();
          return connectionStatus.find(status => status.network === network) || null;
        },

        getAveragePrice: (symbol: string) => {
          const { marketData } = get();
          const symbolData = marketData.filter(data => 
            data.symbol.includes(symbol) || symbol.includes(data.symbol.split(/[-_]/)[0])
          );
          
          if (symbolData.length === 0) return null;
          
          const totalPrice = symbolData.reduce((sum, data) => sum + data.price, 0);
          return totalPrice / symbolData.length;
        },

        getPriceSpread: (symbol: string) => {
          const { marketData } = get();
          const symbolData = marketData.filter(data => 
            data.symbol.includes(symbol) || symbol.includes(data.symbol.split(/[-_]/)[0])
          );
          
          if (symbolData.length < 2) return null;
          
          const prices = symbolData.map(data => data.price);
          const maxPrice = Math.max(...prices);
          const minPrice = Math.min(...prices);
          
          return ((maxPrice - minPrice) / minPrice) * 100;
        },
      }),
      {
        name: 'oracle-store',
        partialize: (state) => ({
          // Only persist essential data, not real-time streams
          subscriptions: state.subscriptions,
          metrics: state.metrics,
        }),
      }
    )
  )
);

/**
 * Oracle store selectors for optimized re-renders
 */
export const oracleSelectors = {
  // Data selectors
  oracleData: (state: OracleState) => state.oracleData,
  marketData: (state: OracleState) => state.marketData,
  exchangeHealth: (state: OracleState) => state.exchangeHealth,
  connectionStatus: (state: OracleState) => state.connectionStatus,
  
  // UI selectors
  isLoading: (state: OracleState) => state.isLoading,
  error: (state: OracleState) => state.error,
  lastUpdate: (state: OracleState) => state.lastUpdate,
  
  // Metrics selectors
  metrics: (state: OracleState) => state.metrics,
  subscriptions: (state: OracleState) => state.subscriptions,
  
  // Computed selectors
  healthyExchanges: (state: OracleState) => 
    state.exchangeHealth.filter(exchange => exchange.status === 'HEALTHY'),
  
  connectedNetworks: (state: OracleState) => 
    state.connectionStatus.filter(status => status.connected),
  
  totalMarketVolume: (state: OracleState) => 
    state.marketData.reduce((sum, data) => sum + data.volume24h, 0),
  
  averageSpread: (state: OracleState) => {
    const spreads = state.marketData.map(data => data.spreadPercent);
    return spreads.length > 0 ? spreads.reduce((sum, spread) => sum + spread, 0) / spreads.length : 0;
  },
  
  recentEvents: (state: OracleState) => 
    state.oracleEvents.slice(0, 10), // Last 10 events
  
  networkLatencies: (state: OracleState) => 
    state.connectionStatus.reduce((acc, status) => {
      acc[status.network] = status.latency;
      return acc;
    }, {} as Record<string, number>),
};

/**
 * Hook for subscribing to specific oracle data changes
 */
export const useOracleSubscription = (
  selector: (state: OracleState) => any,
  callback: (value: any) => void
) => {
  return useOracleStore.subscribe(
    selector,
    callback,
    {
      equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      fireImmediately: true,
    }
  );
};

/**
 * Hook for getting oracle data with automatic updates
 */
export const useOracleData = () => {
  const oracleData = useOracleStore(oracleSelectors.oracleData);
  const marketData = useOracleStore(oracleSelectors.marketData);
  const exchangeHealth = useOracleStore(oracleSelectors.exchangeHealth);
  const connectionStatus = useOracleStore(oracleSelectors.connectionStatus);
  const isLoading = useOracleStore(oracleSelectors.isLoading);
  const error = useOracleStore(oracleSelectors.error);
  const metrics = useOracleStore(oracleSelectors.metrics);
  
  return {
    oracleData,
    marketData,
    exchangeHealth,
    connectionStatus,
    isLoading,
    error,
    metrics,
  };
};

/**
 * Hook for oracle actions
 */
export const useOracleActions = () => {
  const setOracleData = useOracleStore((state) => state.setOracleData);
  const addOracleEvent = useOracleStore((state) => state.addOracleEvent);
  const setMarketData = useOracleStore((state) => state.setMarketData);
  const setExchangeHealth = useOracleStore((state) => state.setExchangeHealth);
  const setConnectionStatus = useOracleStore((state) => state.setConnectionStatus);
  const setLoading = useOracleStore((state) => state.setLoading);
  const setError = useOracleStore((state) => state.setError);
  const updateMetrics = useOracleStore((state) => state.updateMetrics);
  const toggleSubscription = useOracleStore((state) => state.toggleSubscription);
  const clearData = useOracleStore((state) => state.clearData);
  
  return {
    setOracleData,
    addOracleEvent,
    setMarketData,
    setExchangeHealth,
    setConnectionStatus,
    setLoading,
    setError,
    updateMetrics,
    toggleSubscription,
    clearData,
  };
};
