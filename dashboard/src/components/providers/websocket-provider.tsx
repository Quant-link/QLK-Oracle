/**
 * @fileoverview WebSocket Provider for real-time data management
 * @author QuantLink Team
 * @version 1.0.0
 */

'use client';

import React, { createContext, useContext, useEffect, useRef } from 'react';
import { useWebSocketStore } from '@/lib/store/websocket-store';
import { useAuthStore } from '@/lib/store/auth-store';

interface WebSocketContextType {
  isConnected: boolean;
  connectionState: string;
  latency: number;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
  sendMessage: (event: string, data: any) => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}

interface WebSocketProviderProps {
  children: React.ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const {
    isConnected,
    connectionState,
    averageLatency,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    sendMessage,
  } = useWebSocketStore();
  
  const { isAuthenticated, tokens } = useAuthStore();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const isInitializedRef = useRef(false);

  // Auto-connect when authenticated
  useEffect(() => {
    if (isAuthenticated && tokens && !isInitializedRef.current) {
      isInitializedRef.current = true;
      
      const initializeConnection = async () => {
        try {
          await connect();
          
          // Subscribe to default channels
          const defaultChannels = [
            'oracle:BTC/USDT',
            'oracle:ETH/USDT',
            'health:system',
            'metrics:performance',
          ];
          
          subscribe(defaultChannels);
        } catch (error) {
          console.error('Failed to initialize WebSocket connection:', error);
          
          // Retry connection after delay
          reconnectTimeoutRef.current = setTimeout(() => {
            initializeConnection();
          }, 5000);
        }
      };

      initializeConnection();
    }
  }, [isAuthenticated, tokens, connect, subscribe]);

  // Disconnect when not authenticated
  useEffect(() => {
    if (!isAuthenticated && isInitializedRef.current) {
      disconnect();
      isInitializedRef.current = false;
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    }
  }, [isAuthenticated, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const contextValue: WebSocketContextType = {
    isConnected,
    connectionState,
    latency: averageLatency,
    subscribe,
    unsubscribe,
    sendMessage,
  };

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}
