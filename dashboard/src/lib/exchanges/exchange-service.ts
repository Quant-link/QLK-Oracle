/**
 * @fileoverview Real-time Exchange Data Service
 * @author QuantLink Team
 * @version 1.0.0
 */

import axios, { AxiosInstance } from 'axios';

/**
 * Exchange configuration interface
 */
interface ExchangeConfig {
  name: string;
  baseUrl: string;
  wsUrl: string;
  apiKey?: string;
  apiSecret?: string;
  rateLimit: number; // requests per minute
  symbols: string[];
}

/**
 * Market data interface
 */
export interface MarketData {
  exchange: string;
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume24h: number;
  change24h: number;
  timestamp: number;
  spread: number;
  spreadPercent: number;
}

/**
 * Order book data interface
 */
export interface OrderBookData {
  exchange: string;
  symbol: string;
  bids: [number, number][]; // [price, quantity]
  asks: [number, number][]; // [price, quantity]
  timestamp: number;
}

/**
 * Exchange health status
 */
export interface ExchangeHealth {
  exchange: string;
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'OFFLINE';
  latency: number;
  lastUpdate: number;
  errorCount: number;
  uptimePercentage: number;
  apiLimitUsed: number;
  apiLimitRemaining: number;
}

/**
 * Exchange configurations
 */
const EXCHANGE_CONFIGS: Record<string, ExchangeConfig> = {
  binance: {
    name: 'Binance',
    baseUrl: 'https://api.binance.com/api/v3',
    wsUrl: 'wss://stream.binance.com:9443/ws',
    rateLimit: 1200,
    symbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'SOLUSDT'],
  },
  coinbase: {
    name: 'Coinbase Pro',
    baseUrl: 'https://api.exchange.coinbase.com',
    wsUrl: 'wss://ws-feed.exchange.coinbase.com',
    rateLimit: 600,
    symbols: ['BTC-USD', 'ETH-USD', 'ADA-USD', 'SOL-USD'],
  },
  kraken: {
    name: 'Kraken',
    baseUrl: 'https://api.kraken.com/0/public',
    wsUrl: 'wss://ws.kraken.com',
    rateLimit: 300,
    symbols: ['XBTUSD', 'ETHUSD', 'ADAUSD', 'SOLUSD'],
  },
  okx: {
    name: 'OKX',
    baseUrl: 'https://www.okx.com/api/v5',
    wsUrl: 'wss://ws.okx.com:8443/ws/v5/public',
    rateLimit: 600,
    symbols: ['BTC-USDT', 'ETH-USDT', 'ADA-USDT', 'SOL-USDT'],
  },
  bybit: {
    name: 'Bybit',
    baseUrl: 'https://api.bybit.com/v5',
    wsUrl: 'wss://stream.bybit.com/v5/public/spot',
    rateLimit: 600,
    symbols: ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'SOLUSDT'],
  },
};

/**
 * Exchange Service Class
 */
export class ExchangeService {
  private clients: Map<string, AxiosInstance> = new Map();
  private wsConnections: Map<string, WebSocket> = new Map();
  private marketData: Map<string, MarketData[]> = new Map();
  private orderBooks: Map<string, OrderBookData> = new Map();
  private healthStatus: Map<string, ExchangeHealth> = new Map();
  private rateLimiters: Map<string, { count: number; resetTime: number }> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeClients();
    this.startHealthMonitoring();
    this.connectWebSockets();
  }

  /**
   * Initialize HTTP clients for all exchanges
   */
  private initializeClients(): void {
    Object.entries(EXCHANGE_CONFIGS).forEach(([exchange, config]) => {
      const client = axios.create({
        baseURL: config.baseUrl,
        timeout: 10000,
        headers: {
          'User-Agent': 'QuantLink-Oracle/1.0.0',
        },
      });

      // Add request interceptor for rate limiting
      client.interceptors.request.use((config) => {
        return this.checkRateLimit(exchange) ? config : Promise.reject(new Error('Rate limit exceeded'));
      });

      // Add response interceptor for monitoring
      client.interceptors.response.use(
        (response) => {
          this.updateHealthStatus(exchange, true, response.config.url || '');
          return response;
        },
        (error) => {
          this.updateHealthStatus(exchange, false, error.config?.url || '', error.message);
          return Promise.reject(error);
        }
      );

      this.clients.set(exchange, client);

      // Initialize health status
      this.healthStatus.set(exchange, {
        exchange,
        status: 'HEALTHY',
        latency: 0,
        lastUpdate: Date.now(),
        errorCount: 0,
        uptimePercentage: 100,
        apiLimitUsed: 0,
        apiLimitRemaining: config.rateLimit,
      });

      // Initialize rate limiter
      this.rateLimiters.set(exchange, {
        count: 0,
        resetTime: Date.now() + 60000, // Reset every minute
      });

      console.log(`✅ Initialized ${config.name} client`);
    });
  }

  /**
   * Check rate limit for exchange
   */
  private checkRateLimit(exchange: string): boolean {
    const limiter = this.rateLimiters.get(exchange);
    const config = EXCHANGE_CONFIGS[exchange];
    
    if (!limiter || !config) return false;

    const now = Date.now();
    
    // Reset counter if minute has passed
    if (now >= limiter.resetTime) {
      limiter.count = 0;
      limiter.resetTime = now + 60000;
    }

    // Check if under limit
    if (limiter.count >= config.rateLimit) {
      return false;
    }

    limiter.count++;
    return true;
  }

  /**
   * Update health status for exchange
   */
  private updateHealthStatus(
    exchange: string,
    success: boolean,
    endpoint: string,
    error?: string
  ): void {
    const health = this.healthStatus.get(exchange);
    if (!health) return;

    const now = Date.now();
    
    if (success) {
      health.latency = now - health.lastUpdate;
      health.status = health.latency > 5000 ? 'DEGRADED' : 'HEALTHY';
    } else {
      health.errorCount++;
      health.status = health.errorCount > 10 ? 'UNHEALTHY' : 'DEGRADED';
    }

    health.lastUpdate = now;
    
    // Update API limit usage
    const limiter = this.rateLimiters.get(exchange);
    if (limiter) {
      health.apiLimitUsed = limiter.count;
      health.apiLimitRemaining = EXCHANGE_CONFIGS[exchange].rateLimit - limiter.count;
    }
  }

  /**
   * Connect to WebSocket feeds
   */
  private connectWebSockets(): void {
    Object.entries(EXCHANGE_CONFIGS).forEach(([exchange, config]) => {
      try {
        const ws = new WebSocket(config.wsUrl);
        
        ws.onopen = () => {
          console.log(`✅ Connected to ${config.name} WebSocket`);
          this.subscribeToStreams(exchange, ws);
        };

        ws.onmessage = (event) => {
          this.handleWebSocketMessage(exchange, event.data);
        };

        ws.onerror = (error) => {
          console.error(`❌ ${config.name} WebSocket error:`, error);
          this.updateHealthStatus(exchange, false, 'websocket', 'WebSocket error');
        };

        ws.onclose = () => {
          console.log(`🔌 ${config.name} WebSocket disconnected`);
          // Attempt reconnection after 5 seconds
          setTimeout(() => this.reconnectWebSocket(exchange), 5000);
        };

        this.wsConnections.set(exchange, ws);
      } catch (error) {
        console.error(`❌ Failed to connect to ${config.name} WebSocket:`, error);
      }
    });
  }

  /**
   * Subscribe to market data streams
   */
  private subscribeToStreams(exchange: string, ws: WebSocket): void {
    const config = EXCHANGE_CONFIGS[exchange];
    
    switch (exchange) {
      case 'binance':
        // Subscribe to ticker streams for all symbols
        const binanceStreams = config.symbols.map(symbol => `${symbol.toLowerCase()}@ticker`);
        ws.send(JSON.stringify({
          method: 'SUBSCRIBE',
          params: binanceStreams,
          id: 1,
        }));
        break;

      case 'coinbase':
        // Subscribe to ticker channel
        ws.send(JSON.stringify({
          type: 'subscribe',
          product_ids: config.symbols,
          channels: ['ticker'],
        }));
        break;

      case 'kraken':
        // Subscribe to ticker data
        ws.send(JSON.stringify({
          event: 'subscribe',
          pair: config.symbols,
          subscription: { name: 'ticker' },
        }));
        break;

      case 'okx':
        // Subscribe to tickers
        const okxChannels = config.symbols.map(symbol => ({
          channel: 'tickers',
          instId: symbol,
        }));
        ws.send(JSON.stringify({
          op: 'subscribe',
          args: okxChannels,
        }));
        break;

      case 'bybit':
        // Subscribe to tickers
        const bybitTopics = config.symbols.map(symbol => `tickers.${symbol}`);
        ws.send(JSON.stringify({
          op: 'subscribe',
          args: bybitTopics,
        }));
        break;
    }
  }

  /**
   * Handle WebSocket messages
   */
  private handleWebSocketMessage(exchange: string, data: string): void {
    try {
      const message = JSON.parse(data);
      
      switch (exchange) {
        case 'binance':
          if (message.e === '24hrTicker') {
            this.processBinanceTickerData(message);
          }
          break;

        case 'coinbase':
          if (message.type === 'ticker') {
            this.processCoinbaseTickerData(message);
          }
          break;

        case 'kraken':
          if (Array.isArray(message) && message[1] && typeof message[1] === 'object') {
            this.processKrakenTickerData(message);
          }
          break;

        case 'okx':
          if (message.data && Array.isArray(message.data)) {
            message.data.forEach((ticker: any) => this.processOKXTickerData(ticker));
          }
          break;

        case 'bybit':
          if (message.data && message.topic?.startsWith('tickers.')) {
            this.processBybitTickerData(message.data);
          }
          break;
      }
    } catch (error) {
      console.error(`Error parsing WebSocket message from ${exchange}:`, error);
    }
  }

  /**
   * Process Binance ticker data
   */
  private processBinanceTickerData(data: any): void {
    const marketData: MarketData = {
      exchange: 'binance',
      symbol: data.s,
      price: parseFloat(data.c),
      bid: parseFloat(data.b),
      ask: parseFloat(data.a),
      volume24h: parseFloat(data.v),
      change24h: parseFloat(data.P),
      timestamp: Date.now(),
      spread: parseFloat(data.a) - parseFloat(data.b),
      spreadPercent: ((parseFloat(data.a) - parseFloat(data.b)) / parseFloat(data.c)) * 100,
    };

    this.updateMarketData('binance', marketData);
  }

  /**
   * Process Coinbase ticker data
   */
  private processCoinbaseTickerData(data: any): void {
    const marketData: MarketData = {
      exchange: 'coinbase',
      symbol: data.product_id,
      price: parseFloat(data.price),
      bid: parseFloat(data.best_bid),
      ask: parseFloat(data.best_ask),
      volume24h: parseFloat(data.volume_24h),
      change24h: 0, // Not provided in ticker
      timestamp: Date.now(),
      spread: parseFloat(data.best_ask) - parseFloat(data.best_bid),
      spreadPercent: ((parseFloat(data.best_ask) - parseFloat(data.best_bid)) / parseFloat(data.price)) * 100,
    };

    this.updateMarketData('coinbase', marketData);
  }

  /**
   * Process Kraken ticker data
   */
  private processKrakenTickerData(data: any): void {
    const symbol = data[3];
    const tickerData = data[1];
    
    const marketData: MarketData = {
      exchange: 'kraken',
      symbol: symbol,
      price: parseFloat(tickerData.c[0]),
      bid: parseFloat(tickerData.b[0]),
      ask: parseFloat(tickerData.a[0]),
      volume24h: parseFloat(tickerData.v[1]),
      change24h: 0, // Calculate from open price
      timestamp: Date.now(),
      spread: parseFloat(tickerData.a[0]) - parseFloat(tickerData.b[0]),
      spreadPercent: ((parseFloat(tickerData.a[0]) - parseFloat(tickerData.b[0])) / parseFloat(tickerData.c[0])) * 100,
    };

    this.updateMarketData('kraken', marketData);
  }

  /**
   * Process OKX ticker data
   */
  private processOKXTickerData(data: any): void {
    const marketData: MarketData = {
      exchange: 'okx',
      symbol: data.instId,
      price: parseFloat(data.last),
      bid: parseFloat(data.bidPx),
      ask: parseFloat(data.askPx),
      volume24h: parseFloat(data.vol24h),
      change24h: parseFloat(data.chgUtc),
      timestamp: Date.now(),
      spread: parseFloat(data.askPx) - parseFloat(data.bidPx),
      spreadPercent: ((parseFloat(data.askPx) - parseFloat(data.bidPx)) / parseFloat(data.last)) * 100,
    };

    this.updateMarketData('okx', marketData);
  }

  /**
   * Process Bybit ticker data
   */
  private processBybitTickerData(data: any): void {
    const marketData: MarketData = {
      exchange: 'bybit',
      symbol: data.symbol,
      price: parseFloat(data.lastPrice),
      bid: parseFloat(data.bid1Price),
      ask: parseFloat(data.ask1Price),
      volume24h: parseFloat(data.volume24h),
      change24h: parseFloat(data.price24hPcnt) * 100,
      timestamp: Date.now(),
      spread: parseFloat(data.ask1Price) - parseFloat(data.bid1Price),
      spreadPercent: ((parseFloat(data.ask1Price) - parseFloat(data.bid1Price)) / parseFloat(data.lastPrice)) * 100,
    };

    this.updateMarketData('bybit', marketData);
  }

  /**
   * Update market data storage
   */
  private updateMarketData(exchange: string, data: MarketData): void {
    const exchangeData = this.marketData.get(exchange) || [];
    
    // Remove old data for same symbol
    const filteredData = exchangeData.filter(item => item.symbol !== data.symbol);
    
    // Add new data
    filteredData.push(data);
    
    // Keep only last 100 entries per exchange
    if (filteredData.length > 100) {
      filteredData.splice(0, filteredData.length - 100);
    }
    
    this.marketData.set(exchange, filteredData);
  }

  /**
   * Reconnect WebSocket
   */
  private reconnectWebSocket(exchange: string): void {
    const config = EXCHANGE_CONFIGS[exchange];
    if (!config) return;

    try {
      const ws = new WebSocket(config.wsUrl);
      this.wsConnections.set(exchange, ws);
      
      ws.onopen = () => {
        console.log(`🔄 Reconnected to ${config.name} WebSocket`);
        this.subscribeToStreams(exchange, ws);
      };

      ws.onmessage = (event) => {
        this.handleWebSocketMessage(exchange, event.data);
      };

      ws.onerror = (error) => {
        console.error(`❌ ${config.name} WebSocket reconnection error:`, error);
      };

      ws.onclose = () => {
        setTimeout(() => this.reconnectWebSocket(exchange), 5000);
      };
    } catch (error) {
      console.error(`❌ Failed to reconnect to ${config.name}:`, error);
      setTimeout(() => this.reconnectWebSocket(exchange), 10000);
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Perform health checks
   */
  private async performHealthChecks(): Promise<void> {
    const promises = Array.from(this.clients.entries()).map(
      async ([exchange, client]) => {
        try {
          const startTime = Date.now();
          
          // Perform a simple API call to check health
          switch (exchange) {
            case 'binance':
              await client.get('/ping');
              break;
            case 'coinbase':
              await client.get('/time');
              break;
            case 'kraken':
              await client.get('/Time');
              break;
            case 'okx':
              await client.get('/public/time');
              break;
            case 'bybit':
              await client.get('/market/time');
              break;
          }

          const latency = Date.now() - startTime;
          this.updateHealthMetrics(exchange, true, latency);
        } catch (error) {
          this.updateHealthMetrics(exchange, false, 0);
        }
      }
    );

    await Promise.allSettled(promises);
  }

  /**
   * Update health metrics
   */
  private updateHealthMetrics(exchange: string, success: boolean, latency: number): void {
    const health = this.healthStatus.get(exchange);
    if (!health) return;

    if (success) {
      health.latency = latency;
      health.status = latency > 5000 ? 'DEGRADED' : 'HEALTHY';
      health.errorCount = Math.max(0, health.errorCount - 1);
    } else {
      health.errorCount++;
      health.status = health.errorCount > 5 ? 'OFFLINE' : 'UNHEALTHY';
    }

    health.lastUpdate = Date.now();
    
    // Calculate uptime percentage (simplified)
    const totalChecks = 100; // Assume 100 checks for calculation
    const successfulChecks = totalChecks - health.errorCount;
    health.uptimePercentage = Math.max(0, (successfulChecks / totalChecks) * 100);
  }

  /**
   * Get all market data
   */
  public getAllMarketData(): MarketData[] {
    const allData: MarketData[] = [];
    this.marketData.forEach(exchangeData => {
      allData.push(...exchangeData);
    });
    return allData;
  }

  /**
   * Get market data for specific exchange
   */
  public getMarketData(exchange: string): MarketData[] {
    return this.marketData.get(exchange) || [];
  }

  /**
   * Get health status for all exchanges
   */
  public getAllHealthStatus(): ExchangeHealth[] {
    return Array.from(this.healthStatus.values());
  }

  /**
   * Get health status for specific exchange
   */
  public getHealthStatus(exchange: string): ExchangeHealth | null {
    return this.healthStatus.get(exchange) || null;
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.wsConnections.forEach((ws) => {
      ws.close();
    });

    this.clients.clear();
    this.wsConnections.clear();
    this.marketData.clear();
    this.orderBooks.clear();
    this.healthStatus.clear();
    this.rateLimiters.clear();
  }
}

// Singleton instance
export const exchangeService = new ExchangeService();
