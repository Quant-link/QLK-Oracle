/**
 * @fileoverview WebSocket Store with real-time data management
 * @author QuantLink Team
 * @version 1.0.0
 */

import { create } from 'zustand';
import { subscribeWithSelector, devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import WebSocketConnectionManager, { ConnectionState, ConnectionMetrics } from '../websocket/connection-manager';
import MessageQueue, { MessagePriority } from '../websocket/message-queue';
import { getProtobufManager } from '../protobuf/protobuf-manager';

export interface OracleData {
  symbol: string;
  cexFees: number[];
  dexFees: number[];
  weightedMedianCexFee: number;
  weightedMedianDexFee: number;
  confidence: number;
  timestamp: number;
  sources: string[];
  outliers: string[];
}

export interface PriceData {
  symbol: string;
  exchange: string;
  exchangeType: 'CEX' | 'DEX';
  price: number;
  volume24h: number;
  timestamp: number;
  bid: number;
  ask: number;
  spread: number;
  confidenceScore: number;
}

export interface FeeData {
  symbol: string;
  exchange: string;
  exchangeType: 'CEX' | 'DEX';
  makerFee: number;
  takerFee: number;
  volume24h: number;
  timestamp: number;
  confidenceScore: number;
}

export interface HealthStatus {
  sourceId: string;
  sourceType: 'EXCHANGE' | 'AGGREGATOR' | 'ORACLE';
  healthState: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'OFFLINE';
  lastUpdate: number;
  latencyMs: number;
  errorCount: number;
  errorMessage?: string;
  uptimePercentage: number;
}

export interface WebSocketState {
  // Connection state
  connectionState: ConnectionState;
  connectionMetrics: ConnectionMetrics | null;
  isConnected: boolean;
  isReconnecting: boolean;
  lastError: Error | null;
  
  // Data state
  oracleData: Map<string, OracleData>;
  priceData: Map<string, PriceData[]>;
  feeData: Map<string, FeeData[]>;
  healthStatuses: Map<string, HealthStatus>;
  
  // Subscription state
  activeSubscriptions: Set<string>;
  subscriptionQueue: string[];
  
  // Message state
  messageQueue: MessageQueue;
  pendingMessages: Map<string, any>;
  
  // Performance metrics
  messagesReceived: number;
  messagesSent: number;
  averageLatency: number;
  dataFreshness: Map<string, number>;
  
  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  reconnect: () => Promise<void>;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
  sendMessage: (event: string, data: any, priority?: MessagePriority) => string;
  updateOracleData: (symbol: string, data: OracleData) => void;
  updatePriceData: (symbol: string, data: PriceData) => void;
  updateFeeData: (symbol: string, data: FeeData) => void;
  updateHealthStatus: (sourceId: string, status: HealthStatus) => void;
  clearData: () => void;
  getLatestData: (symbol: string) => {
    oracle?: OracleData;
    prices?: PriceData[];
    fees?: FeeData[];
  };
}

// WebSocket connection manager instance
let connectionManager: WebSocketConnectionManager | null = null;

export const useWebSocketStore = create<WebSocketState>()(
  devtools(
    subscribeWithSelector(
      immer((set, get) => ({
        // Initial state
        connectionState: ConnectionState.DISCONNECTED,
        connectionMetrics: null,
        isConnected: false,
        isReconnecting: false,
        lastError: null,
        
        oracleData: new Map(),
        priceData: new Map(),
        feeData: new Map(),
        healthStatuses: new Map(),
        
        activeSubscriptions: new Set(),
        subscriptionQueue: [],
        
        messageQueue: new MessageQueue({
          maxSize: 1000,
          maxRetries: 3,
          defaultTimeout: 30000,
          batchSize: 10,
          flushInterval: 100,
        }),
        pendingMessages: new Map(),
        
        messagesReceived: 0,
        messagesSent: 0,
        averageLatency: 0,
        dataFreshness: new Map(),

        // Actions
        connect: async () => {
          const state = get();
          
          if (state.isConnected || state.connectionState === ConnectionState.CONNECTING) {
            return;
          }

          try {
            // Initialize connection manager if not exists
            if (!connectionManager) {
              connectionManager = new WebSocketConnectionManager({
                url: process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'ws://localhost:3001',
                auth: {
                  token: localStorage.getItem('auth_token') || undefined,
                  apiKey: localStorage.getItem('api_key') || undefined,
                },
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                maxReconnectionAttempts: 10,
                timeout: 20000,
              });

              // Setup event listeners
              setupConnectionEventListeners(connectionManager, set, get);
            }

            await connectionManager.connect();
            
            set((state) => {
              state.connectionState = ConnectionState.CONNECTED;
              state.isConnected = true;
              state.isReconnecting = false;
              state.lastError = null;
            });

            // Initialize protobuf manager
            const protobufManager = getProtobufManager();
            await protobufManager.initialize();

            // Resubscribe to channels
            const subscriptions = Array.from(state.activeSubscriptions);
            if (subscriptions.length > 0) {
              state.subscribe(subscriptions);
            }

          } catch (error) {
            set((state) => {
              state.connectionState = ConnectionState.ERROR;
              state.isConnected = false;
              state.isReconnecting = false;
              state.lastError = error as Error;
            });
            throw error;
          }
        },

        disconnect: () => {
          if (connectionManager) {
            connectionManager.disconnect();
          }
          
          set((state) => {
            state.connectionState = ConnectionState.DISCONNECTED;
            state.isConnected = false;
            state.isReconnecting = false;
            state.connectionMetrics = null;
          });
        },

        reconnect: async () => {
          const state = get();
          
          set((draft) => {
            draft.isReconnecting = true;
          });

          try {
            if (connectionManager) {
              await connectionManager.connect();
            } else {
              await state.connect();
            }
          } catch (error) {
            set((draft) => {
              draft.isReconnecting = false;
              draft.lastError = error as Error;
            });
            throw error;
          }
        },

        subscribe: (channels: string[]) => {
          const state = get();
          
          channels.forEach(channel => {
            if (!state.activeSubscriptions.has(channel)) {
              set((draft) => {
                draft.activeSubscriptions.add(channel);
              });

              if (connectionManager && state.isConnected) {
                connectionManager.subscribe(channel);
              } else {
                set((draft) => {
                  draft.subscriptionQueue.push(channel);
                });
              }
            }
          });
        },

        unsubscribe: (channels: string[]) => {
          channels.forEach(channel => {
            set((draft) => {
              draft.activeSubscriptions.delete(channel);
            });

            if (connectionManager && get().isConnected) {
              connectionManager.unsubscribe(channel);
            }
          });
        },

        sendMessage: (event: string, data: any, priority: MessagePriority = MessagePriority.NORMAL) => {
          const state = get();
          
          if (connectionManager && state.isConnected) {
            connectionManager.send(event, data);
            
            set((draft) => {
              draft.messagesSent++;
            });
            
            return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          } else {
            // Queue message
            return state.messageQueue.enqueue(event, data, priority);
          }
        },

        updateOracleData: (symbol: string, data: OracleData) => {
          set((draft) => {
            draft.oracleData.set(symbol, data);
            draft.dataFreshness.set(`oracle_${symbol}`, Date.now());
            draft.messagesReceived++;
          });
        },

        updatePriceData: (symbol: string, data: PriceData) => {
          set((draft) => {
            const existing = draft.priceData.get(symbol) || [];
            
            // Keep only last 100 price updates per symbol
            const updated = [data, ...existing.slice(0, 99)];
            draft.priceData.set(symbol, updated);
            draft.dataFreshness.set(`price_${symbol}`, Date.now());
            draft.messagesReceived++;
          });
        },

        updateFeeData: (symbol: string, data: FeeData) => {
          set((draft) => {
            const existing = draft.feeData.get(symbol) || [];
            
            // Keep only last 100 fee updates per symbol
            const updated = [data, ...existing.slice(0, 99)];
            draft.feeData.set(symbol, updated);
            draft.dataFreshness.set(`fee_${symbol}`, Date.now());
            draft.messagesReceived++;
          });
        },

        updateHealthStatus: (sourceId: string, status: HealthStatus) => {
          set((draft) => {
            draft.healthStatuses.set(sourceId, status);
            draft.dataFreshness.set(`health_${sourceId}`, Date.now());
            draft.messagesReceived++;
          });
        },

        clearData: () => {
          set((draft) => {
            draft.oracleData.clear();
            draft.priceData.clear();
            draft.feeData.clear();
            draft.healthStatuses.clear();
            draft.dataFreshness.clear();
            draft.messagesReceived = 0;
            draft.messagesSent = 0;
            draft.averageLatency = 0;
          });
        },

        getLatestData: (symbol: string) => {
          const state = get();
          
          return {
            oracle: state.oracleData.get(symbol),
            prices: state.priceData.get(symbol),
            fees: state.feeData.get(symbol),
          };
        },
      }))
    ),
    {
      name: 'websocket-store',
      partialize: (state) => ({
        activeSubscriptions: Array.from(state.activeSubscriptions),
        // Don't persist connection state or real-time data
      }),
    }
  )
);

/**
 * Setup connection event listeners
 */
function setupConnectionEventListeners(
  manager: WebSocketConnectionManager,
  set: any,
  get: any
) {
  manager.on('connected', () => {
    set((draft: any) => {
      draft.connectionState = ConnectionState.CONNECTED;
      draft.isConnected = true;
      draft.isReconnecting = false;
      draft.lastError = null;
    });

    // Process queued subscriptions
    const state = get();
    if (state.subscriptionQueue.length > 0) {
      state.subscriptionQueue.forEach((channel: string) => {
        manager.subscribe(channel);
      });
      
      set((draft: any) => {
        draft.subscriptionQueue = [];
      });
    }
  });

  manager.on('disconnected', (reason: string) => {
    set((draft: any) => {
      draft.connectionState = ConnectionState.DISCONNECTED;
      draft.isConnected = false;
      draft.connectionMetrics = null;
    });
  });

  manager.on('reconnecting', () => {
    set((draft: any) => {
      draft.connectionState = ConnectionState.RECONNECTING;
      draft.isReconnecting = true;
    });
  });

  manager.on('reconnected', () => {
    set((draft: any) => {
      draft.connectionState = ConnectionState.CONNECTED;
      draft.isConnected = true;
      draft.isReconnecting = false;
      draft.lastError = null;
    });
  });

  manager.on('error', (error: Error) => {
    set((draft: any) => {
      draft.connectionState = ConnectionState.ERROR;
      draft.lastError = error;
    });
  });

  manager.on('latency', (latency: number) => {
    set((draft: any) => {
      const currentAvg = draft.averageLatency;
      const count = draft.messagesReceived || 1;
      draft.averageLatency = (currentAvg * (count - 1) + latency) / count;
    });
  });

  manager.on('stateChange', (newState: ConnectionState) => {
    set((draft: any) => {
      draft.connectionState = newState;
    });
  });

  // Handle incoming messages
  manager.on('message', async (event: string, ...args: any[]) => {
    const protobufManager = getProtobufManager();
    const state = get();

    try {
      // Handle different message types
      switch (event) {
        case 'oracle_data':
          if (args[0] instanceof Uint8Array) {
            const data = protobufManager.decodeOracleData(args[0]);
            state.updateOracleData(data.symbol, data);
          } else {
            state.updateOracleData(args[0].symbol, args[0]);
          }
          break;

        case 'price_update':
          if (args[0] instanceof Uint8Array) {
            const data = protobufManager.decodePriceUpdate(args[0]);
            state.updatePriceData(data.symbol, data);
          } else {
            state.updatePriceData(args[0].symbol, args[0]);
          }
          break;

        case 'fee_update':
          if (args[0] instanceof Uint8Array) {
            const data = protobufManager.decodeFeeUpdate(args[0]);
            state.updateFeeData(data.symbol, data);
          } else {
            state.updateFeeData(args[0].symbol, args[0]);
          }
          break;

        case 'health_status':
          if (args[0] instanceof Uint8Array) {
            const data = protobufManager.decodeError(args[0]);
            state.updateHealthStatus(data.sourceId, data);
          } else {
            state.updateHealthStatus(args[0].sourceId, args[0]);
          }
          break;

        default:
          // Handle other message types
          console.log('Unhandled message type:', event, args);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });
}

// Export connection manager for direct access if needed
export { connectionManager };

// Cleanup function
export const cleanupWebSocketStore = () => {
  if (connectionManager) {
    connectionManager.destroy();
    connectionManager = null;
  }
};
