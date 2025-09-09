/**
 * @fileoverview WebSocket Connection Manager with automatic reconnection and health monitoring
 * @author QuantLink Team
 * @version 1.0.0
 */

import { io, Socket } from 'socket.io-client';
import { EventEmitter } from 'events';

export interface ConnectionConfig {
  url: string;
  auth?: {
    token?: string;
    apiKey?: string;
  };
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
  maxReconnectionAttempts?: number;
  timeout?: number;
  forceNew?: boolean;
  transports?: string[];
}

export interface ConnectionMetrics {
  latency: number;
  packetsReceived: number;
  packetsSent: number;
  bytesReceived: number;
  bytesSent: number;
  reconnectCount: number;
  lastReconnectTime?: Date;
  connectionTime: Date;
  isHealthy: boolean;
}

export interface HeartbeatConfig {
  interval: number;
  timeout: number;
  maxMissed: number;
}

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

export class WebSocketConnectionManager extends EventEmitter {
  private socket: Socket | null = null;
  private config: ConnectionConfig;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private metrics: ConnectionMetrics;
  private heartbeatConfig: HeartbeatConfig;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private missedHeartbeats = 0;
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private messageQueue: Array<{ event: string; data: any }> = [];
  private subscriptions = new Set<string>();
  private isDestroyed = false;

  constructor(config: ConnectionConfig) {
    super();
    this.config = {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      maxReconnectionAttempts: 10,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      ...config,
    };

    this.heartbeatConfig = {
      interval: 30000, // 30 seconds
      timeout: 5000,   // 5 seconds
      maxMissed: 3,    // 3 missed heartbeats before considering connection dead
    };

    this.metrics = {
      latency: 0,
      packetsReceived: 0,
      packetsSent: 0,
      bytesReceived: 0,
      bytesSent: 0,
      reconnectCount: 0,
      connectionTime: new Date(),
      isHealthy: false,
    };

    this.setupEventListeners();
  }

  /**
   * Connect to WebSocket server
   */
  public async connect(): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('Connection manager has been destroyed');
    }

    if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.CONNECTING) {
      return;
    }

    this.setState(ConnectionState.CONNECTING);

    try {
      this.socket = io(this.config.url, {
        auth: this.config.auth,
        reconnection: false, // We handle reconnection manually
        timeout: this.config.timeout,
        forceNew: this.config.forceNew,
        transports: this.config.transports,
        autoConnect: false,
      });

      this.setupSocketEventListeners();
      this.socket.connect();

      // Wait for connection or timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, this.config.timeout);

        this.socket!.once('connect', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.socket!.once('connect_error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

    } catch (error) {
      this.setState(ConnectionState.ERROR);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  public disconnect(): void {
    this.clearHeartbeat();
    this.clearReconnectTimeout();
    
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    this.setState(ConnectionState.DISCONNECTED);
    this.metrics.isHealthy = false;
  }

  /**
   * Destroy the connection manager
   */
  public destroy(): void {
    this.isDestroyed = true;
    this.disconnect();
    this.removeAllListeners();
    this.messageQueue = [];
    this.subscriptions.clear();
  }

  /**
   * Send message to server
   */
  public send(event: string, data?: any): void {
    if (this.state === ConnectionState.CONNECTED && this.socket) {
      this.socket.emit(event, data);
      this.metrics.packetsSent++;
      this.metrics.bytesSent += this.estimateMessageSize(data);
    } else {
      // Queue message for later delivery
      this.messageQueue.push({ event, data });
    }
  }

  /**
   * Subscribe to a channel
   */
  public subscribe(channel: string): void {
    this.subscriptions.add(channel);
    this.send('subscribe', { channel });
  }

  /**
   * Unsubscribe from a channel
   */
  public unsubscribe(channel: string): void {
    this.subscriptions.delete(channel);
    this.send('unsubscribe', { channel });
  }

  /**
   * Get current connection state
   */
  public getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get connection metrics
   */
  public getMetrics(): ConnectionMetrics {
    return { ...this.metrics };
  }

  /**
   * Check if connection is healthy
   */
  public isHealthy(): boolean {
    return this.metrics.isHealthy && this.state === ConnectionState.CONNECTED;
  }

  /**
   * Measure latency to server
   */
  public async measureLatency(): Promise<number> {
    if (!this.socket || this.state !== ConnectionState.CONNECTED) {
      return -1;
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      
      this.socket!.emit('ping', startTime, (response: number) => {
        const latency = Date.now() - startTime;
        this.metrics.latency = latency;
        resolve(latency);
      });

      // Timeout after 5 seconds
      setTimeout(() => resolve(-1), 5000);
    });
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Handle browser visibility changes
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.state === ConnectionState.DISCONNECTED) {
          this.reconnect();
        }
      });
    }

    // Handle network status changes
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      window.addEventListener('online', () => {
        if (this.state === ConnectionState.DISCONNECTED) {
          this.reconnect();
        }
      });

      window.addEventListener('offline', () => {
        this.disconnect();
      });
    }
  }

  /**
   * Setup socket event listeners
   */
  private setupSocketEventListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      this.setState(ConnectionState.CONNECTED);
      this.metrics.connectionTime = new Date();
      this.metrics.isHealthy = true;
      this.reconnectAttempts = 0;
      
      // Resubscribe to channels
      this.subscriptions.forEach(channel => {
        this.send('subscribe', { channel });
      });

      // Send queued messages
      this.flushMessageQueue();

      // Start heartbeat
      this.startHeartbeat();

      this.emit('connected');
    });

    this.socket.on('disconnect', (reason) => {
      this.setState(ConnectionState.DISCONNECTED);
      this.metrics.isHealthy = false;
      this.clearHeartbeat();
      
      this.emit('disconnected', reason);

      // Attempt reconnection if not manually disconnected
      if (reason !== 'io client disconnect' && this.config.reconnection) {
        this.scheduleReconnect();
      }
    });

    this.socket.on('connect_error', (error) => {
      this.setState(ConnectionState.ERROR);
      this.metrics.isHealthy = false;
      this.emit('error', error);

      if (this.config.reconnection) {
        this.scheduleReconnect();
      }
    });

    this.socket.on('pong', (timestamp: number) => {
      const latency = Date.now() - timestamp;
      this.metrics.latency = latency;
      this.missedHeartbeats = 0;
      this.emit('latency', latency);
    });

    // Forward all other events
    this.socket.onAny((event, ...args) => {
      if (!['connect', 'disconnect', 'connect_error', 'pong'].includes(event)) {
        this.metrics.packetsReceived++;
        this.metrics.bytesReceived += this.estimateMessageSize(args);
        this.emit('message', event, ...args);
      }
    });
  }

  /**
   * Set connection state
   */
  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      const previousState = this.state;
      this.state = state;
      this.emit('stateChange', state, previousState);
    }
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.clearHeartbeat();
    
    this.heartbeatInterval = setInterval(() => {
      if (this.socket && this.state === ConnectionState.CONNECTED) {
        const timestamp = Date.now();
        this.socket.emit('ping', timestamp);
        
        // Set timeout for pong response
        this.heartbeatTimeout = setTimeout(() => {
          this.missedHeartbeats++;
          
          if (this.missedHeartbeats >= this.heartbeatConfig.maxMissed) {
            this.metrics.isHealthy = false;
            this.emit('unhealthy', 'Missed heartbeats');
            
            // Force reconnection
            this.disconnect();
            if (this.config.reconnection) {
              this.scheduleReconnect();
            }
          }
        }, this.heartbeatConfig.timeout);
      }
    }, this.heartbeatConfig.interval);
  }

  /**
   * Clear heartbeat timers
   */
  private clearHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.isDestroyed || this.reconnectAttempts >= this.config.maxReconnectionAttempts!) {
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.setState(ConnectionState.RECONNECTING);
    this.clearReconnectTimeout();

    const delay = Math.min(
      this.config.reconnectionDelay! * Math.pow(2, this.reconnectAttempts),
      this.config.reconnectionDelayMax!
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnect();
    }, delay);

    this.emit('reconnectScheduled', delay, this.reconnectAttempts + 1);
  }

  /**
   * Attempt to reconnect
   */
  private async reconnect(): Promise<void> {
    if (this.isDestroyed) return;

    this.reconnectAttempts++;
    this.metrics.reconnectCount++;
    this.metrics.lastReconnectTime = new Date();

    try {
      await this.connect();
      this.emit('reconnected', this.reconnectAttempts);
    } catch (error) {
      this.emit('reconnectFailed', error, this.reconnectAttempts);
      
      if (this.reconnectAttempts < this.config.maxReconnectionAttempts!) {
        this.scheduleReconnect();
      } else {
        this.emit('maxReconnectAttemptsReached');
      }
    }
  }

  /**
   * Clear reconnect timeout
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message.event, message.data);
      }
    }
  }

  /**
   * Estimate message size in bytes
   */
  private estimateMessageSize(data: any): number {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      return 0;
    }
  }
}

export default WebSocketConnectionManager;
