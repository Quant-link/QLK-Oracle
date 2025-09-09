/**
 * @fileoverview Base CEX integration class with common functionality
 * @author QuantLink Team
 * @version 1.0.0
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { backOff } from 'exponential-backoff';
import pRetry from 'p-retry';
import { 
  ExchangeConfig, 
  FeeData, 
  PriceData, 
  OrderBookData, 
  TradeData,
  CircuitBreakerState,
  RateLimiterState,
  HealthCheckResult,
  WebSocketConnection,
  DataStreamEvent
} from '@/types';
import { Logger } from '@/utils/logger';
import { MetricsCollector } from '@/monitoring/metrics';

export abstract class BaseCEXIntegration extends EventEmitter {
  protected config: ExchangeConfig;
  protected logger: Logger;
  protected metrics: MetricsCollector;
  protected httpClient: AxiosInstance;
  protected wsConnection?: WebSocket;
  protected wsConnectionState: WebSocketConnection;
  protected circuitBreaker: CircuitBreakerState;
  protected rateLimiter: RateLimiterState;
  protected isInitialized: boolean = false;
  protected reconnectTimer?: NodeJS.Timeout;
  protected heartbeatTimer?: NodeJS.Timeout;

  constructor(config: ExchangeConfig) {
    super();
    this.config = config;
    this.logger = new Logger(`CEX:${config.name}`);
    this.metrics = new MetricsCollector(`cex_${config.name}`);
    
    this.initializeHttpClient();
    this.initializeCircuitBreaker();
    this.initializeRateLimiter();
    this.initializeWebSocketState();
  }

  /**
   * Initialize the exchange integration
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing CEX integration', { exchange: this.config.name });
      
      await this.validateCredentials();
      await this.setupWebSocketConnection();
      await this.subscribeToDataStreams();
      
      this.isInitialized = true;
      this.logger.info('CEX integration initialized successfully', { exchange: this.config.name });
      
      this.metrics.incrementCounter('initialization_success');
    } catch (error) {
      this.logger.error('Failed to initialize CEX integration', { 
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
    this.logger.info('Shutting down CEX integration', { exchange: this.config.name });
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
    }
    
    if (this.wsConnection) {
      this.wsConnection.close();
    }
    
    this.isInitialized = false;
    this.logger.info('CEX integration shutdown complete', { exchange: this.config.name });
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
   * Get order book data for specified trading pairs
   */
  public abstract getOrderBookData(symbols: string[]): Promise<OrderBookData[]>;

  /**
   * Get recent trade data for specified trading pairs
   */
  public abstract getTradeData(symbols: string[]): Promise<TradeData[]>;

  /**
   * Validate API credentials
   */
  protected abstract validateCredentials(): Promise<void>;

  /**
   * Subscribe to real-time data streams
   */
  protected abstract subscribeToDataStreams(): Promise<void>;

  /**
   * Process incoming WebSocket messages
   */
  protected abstract processWebSocketMessage(message: any): void;

  /**
   * Initialize HTTP client with retry logic and circuit breaker
   */
  private initializeHttpClient(): void {
    this.httpClient = axios.create({
      baseURL: this.config.endpoints.rest,
      timeout: 30000,
      headers: {
        'User-Agent': 'QuantLink-DataService/1.0.0',
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for rate limiting
    this.httpClient.interceptors.request.use(async (config) => {
      await this.checkRateLimit();
      return config;
    });

    // Add response interceptor for circuit breaker
    this.httpClient.interceptors.response.use(
      (response) => {
        this.onRequestSuccess();
        return response;
      },
      (error) => {
        this.onRequestFailure(error);
        throw error;
      }
    );
  }

  /**
   * Initialize circuit breaker state
   */
  private initializeCircuitBreaker(): void {
    this.circuitBreaker = {
      state: 'CLOSED',
      failureCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
    };
  }

  /**
   * Initialize rate limiter state
   */
  private initializeRateLimiter(): void {
    this.rateLimiter = {
      tokens: this.config.rateLimit.burstLimit,
      lastRefill: Date.now(),
      requestQueue: [],
    };
  }

  /**
   * Initialize WebSocket connection state
   */
  private initializeWebSocketState(): void {
    this.wsConnectionState = {
      id: `${this.config.name}_${Date.now()}`,
      exchange: this.config.name,
      url: this.config.endpoints.websocket || '',
      status: 'disconnected',
      lastPing: 0,
      lastPong: 0,
      subscriptions: [],
      reconnectAttempts: 0,
      maxReconnectAttempts: 10,
    };
  }

  /**
   * Setup WebSocket connection with auto-reconnect
   */
  protected async setupWebSocketConnection(): Promise<void> {
    if (!this.config.endpoints.websocket) {
      this.logger.warn('WebSocket endpoint not configured', { exchange: this.config.name });
      return;
    }

    try {
      this.wsConnectionState.status = 'connecting';
      this.wsConnection = new WebSocket(this.config.endpoints.websocket);

      this.wsConnection.on('open', () => {
        this.logger.info('WebSocket connection established', { exchange: this.config.name });
        this.wsConnectionState.status = 'connected';
        this.wsConnectionState.reconnectAttempts = 0;
        this.startHeartbeat();
        this.metrics.incrementCounter('websocket_connections');
      });

      this.wsConnection.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.processWebSocketMessage(message);
          this.metrics.incrementCounter('websocket_messages_received');
        } catch (error) {
          this.logger.error('Failed to parse WebSocket message', { 
            exchange: this.config.name, 
            error: error instanceof Error ? error.message : String(error)
          });
          this.metrics.incrementCounter('websocket_parse_errors');
        }
      });

      this.wsConnection.on('close', (code: number, reason: Buffer) => {
        this.logger.warn('WebSocket connection closed', { 
          exchange: this.config.name, 
          code, 
          reason: reason.toString() 
        });
        this.wsConnectionState.status = 'disconnected';
        this.scheduleReconnect();
      });

      this.wsConnection.on('error', (error: Error) => {
        this.logger.error('WebSocket error', { 
          exchange: this.config.name, 
          error: error.message 
        });
        this.wsConnectionState.status = 'error';
        this.metrics.incrementCounter('websocket_errors');
      });

      this.wsConnection.on('pong', () => {
        this.wsConnectionState.lastPong = Date.now();
      });

    } catch (error) {
      this.logger.error('Failed to setup WebSocket connection', { 
        exchange: this.config.name, 
        error: error instanceof Error ? error.message : String(error)
      });
      this.scheduleReconnect();
    }
  }

  /**
   * Start WebSocket heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
        this.wsConnectionState.lastPing = Date.now();
        this.wsConnection.ping();
        
        // Check if pong was received within timeout
        setTimeout(() => {
          const timeSinceLastPong = Date.now() - this.wsConnectionState.lastPong;
          if (timeSinceLastPong > 30000) { // 30 second timeout
            this.logger.warn('WebSocket heartbeat timeout', { exchange: this.config.name });
            this.wsConnection?.terminate();
          }
        }, 30000);
      }
    }, 30000); // Send ping every 30 seconds
  }

  /**
   * Schedule WebSocket reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.wsConnectionState.reconnectAttempts >= this.wsConnectionState.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached', { exchange: this.config.name });
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.wsConnectionState.reconnectAttempts), 60000);
    this.wsConnectionState.reconnectAttempts++;

    this.logger.info('Scheduling WebSocket reconnection', { 
      exchange: this.config.name, 
      attempt: this.wsConnectionState.reconnectAttempts,
      delay 
    });

    this.reconnectTimer = setTimeout(() => {
      this.setupWebSocketConnection();
    }, delay);
  }

  /**
   * Check rate limit before making requests
   */
  protected async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRefill = now - this.rateLimiter.lastRefill;
    const tokensToAdd = Math.floor(timeSinceLastRefill / 1000) * this.config.rateLimit.requestsPerSecond;
    
    if (tokensToAdd > 0) {
      this.rateLimiter.tokens = Math.min(
        this.config.rateLimit.burstLimit,
        this.rateLimiter.tokens + tokensToAdd
      );
      this.rateLimiter.lastRefill = now;
    }

    if (this.rateLimiter.tokens <= 0) {
      const waitTime = 1000 / this.config.rateLimit.requestsPerSecond;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.rateLimiter.tokens = 1;
    } else {
      this.rateLimiter.tokens--;
    }
  }

  /**
   * Handle successful request for circuit breaker
   */
  private onRequestSuccess(): void {
    if (this.circuitBreaker.state === 'HALF_OPEN') {
      this.circuitBreaker.state = 'CLOSED';
      this.circuitBreaker.failureCount = 0;
      this.logger.info('Circuit breaker closed', { exchange: this.config.name });
      this.emit('circuit:close', this.config.name);
    }
  }

  /**
   * Handle failed request for circuit breaker
   */
  private onRequestFailure(error: any): void {
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailureTime = Date.now();

    if (this.circuitBreaker.failureCount >= this.config.circuitBreaker.failureThreshold) {
      this.circuitBreaker.state = 'OPEN';
      this.circuitBreaker.nextAttemptTime = Date.now() + this.config.circuitBreaker.resetTimeoutMs;
      
      this.logger.warn('Circuit breaker opened', { 
        exchange: this.config.name, 
        failureCount: this.circuitBreaker.failureCount 
      });
      this.emit('circuit:open', this.config.name);
    }

    this.metrics.incrementCounter('request_failures');
  }

  /**
   * Check if circuit breaker allows requests
   */
  protected isCircuitBreakerOpen(): boolean {
    if (this.circuitBreaker.state === 'CLOSED') {
      return false;
    }

    if (this.circuitBreaker.state === 'OPEN') {
      if (Date.now() >= this.circuitBreaker.nextAttemptTime) {
        this.circuitBreaker.state = 'HALF_OPEN';
        this.logger.info('Circuit breaker half-open', { exchange: this.config.name });
        return false;
      }
      return true;
    }

    return false; // HALF_OPEN state allows one request
  }

  /**
   * Make HTTP request with retry logic and circuit breaker
   */
  protected async makeRequest<T>(config: AxiosRequestConfig): Promise<T> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error(`Circuit breaker is open for ${this.config.name}`);
    }

    const startTime = Date.now();
    
    try {
      const response = await pRetry(
        () => this.httpClient.request(config),
        {
          retries: this.config.retryConfig.maxRetries,
          factor: this.config.retryConfig.backoffMultiplier,
          maxTimeout: this.config.retryConfig.maxBackoffMs,
          onFailedAttempt: (error) => {
            this.logger.warn('Request attempt failed', {
              exchange: this.config.name,
              attempt: error.attemptNumber,
              retriesLeft: error.retriesLeft,
              error: error.message,
            });
          },
        }
      );

      const duration = Date.now() - startTime;
      this.metrics.recordLatency('http_request', duration);
      this.metrics.incrementCounter('http_requests_success');

      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.recordLatency('http_request', duration);
      this.metrics.incrementCounter('http_requests_failure');
      
      this.logger.error('Request failed after retries', {
        exchange: this.config.name,
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw error;
    }
  }

  /**
   * Perform health check
   */
  public async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Implement exchange-specific health check
      await this.validateCredentials();
      
      const latency = Date.now() - startTime;
      
      return {
        service: `cex_${this.config.name}`,
        status: 'healthy',
        latency,
        timestamp: Date.now(),
        details: {
          circuitBreakerState: this.circuitBreaker.state,
          websocketStatus: this.wsConnectionState.status,
          rateLimitTokens: this.rateLimiter.tokens,
        },
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      return {
        service: `cex_${this.config.name}`,
        status: 'unhealthy',
        latency,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
        details: {
          circuitBreakerState: this.circuitBreaker.state,
          websocketStatus: this.wsConnectionState.status,
        },
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
   * Check if integration is initialized
   */
  public isReady(): boolean {
    return this.isInitialized && this.circuitBreaker.state !== 'OPEN';
  }
}
