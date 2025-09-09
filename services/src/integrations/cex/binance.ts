/**
 * @fileoverview Binance CEX integration with real-time WebSocket streams
 * @author QuantLink Team
 * @version 1.0.0
 */

import crypto from 'crypto';
import { BaseCEXIntegration } from './base';
import { FeeData, PriceData, OrderBookData, TradeData, ExchangeCredentials } from '@/types';
import { VaultService } from '@/services/vault';

interface BinanceTickerData {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

interface BinanceOrderBookData {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

interface BinanceTradeData {
  id: number;
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
  isBestMatch: boolean;
}

interface BinanceExchangeInfo {
  timezone: string;
  serverTime: number;
  rateLimits: Array<{
    rateLimitType: string;
    interval: string;
    intervalNum: number;
    limit: number;
  }>;
  symbols: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    filters: Array<{
      filterType: string;
      [key: string]: any;
    }>;
  }>;
}

interface BinanceTradingFees {
  symbol: string;
  makerCommission: string;
  takerCommission: string;
}

export class BinanceIntegration extends BaseCEXIntegration {
  private credentials?: ExchangeCredentials;
  private vaultService: VaultService;
  private supportedSymbols: Set<string> = new Set();
  private feeCache: Map<string, { makerFee: number; takerFee: number; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 300000; // 5 minutes

  constructor(config: any, vaultService: VaultService) {
    super(config);
    this.vaultService = vaultService;
  }

  /**
   * Validate API credentials by making a test request
   */
  protected async validateCredentials(): Promise<void> {
    try {
      // Fetch credentials from Vault
      this.credentials = await this.vaultService.getExchangeCredentials('binance');
      
      if (!this.credentials?.apiKey || !this.credentials?.apiSecret) {
        throw new Error('Binance API credentials not found in Vault');
      }

      // Test credentials with account info endpoint
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      const signature = this.createSignature(queryString);
      
      await this.makeRequest({
        method: 'GET',
        url: '/api/v3/account',
        params: {
          timestamp,
          signature,
        },
        headers: {
          'X-MBX-APIKEY': this.credentials.apiKey,
        },
      });

      this.logger.info('Binance credentials validated successfully');
    } catch (error) {
      this.logger.error('Failed to validate Binance credentials', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw new Error('Invalid Binance API credentials');
    }
  }

  /**
   * Subscribe to real-time data streams
   */
  protected async subscribeToDataStreams(): Promise<void> {
    if (!this.wsConnection) {
      throw new Error('WebSocket connection not established');
    }

    // Subscribe to all symbol ticker stream
    const subscribeMessage = {
      method: 'SUBSCRIBE',
      params: ['!ticker@arr'],
      id: 1,
    };

    this.wsConnection.send(JSON.stringify(subscribeMessage));
    this.logger.info('Subscribed to Binance ticker stream');

    // Subscribe to individual symbol streams for major pairs
    const majorPairs = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'DOTUSDT'];
    for (const symbol of majorPairs) {
      const depthSubscribe = {
        method: 'SUBSCRIBE',
        params: [`${symbol.toLowerCase()}@depth20@100ms`],
        id: Date.now(),
      };
      
      const tradeSubscribe = {
        method: 'SUBSCRIBE',
        params: [`${symbol.toLowerCase()}@trade`],
        id: Date.now() + 1,
      };

      this.wsConnection.send(JSON.stringify(depthSubscribe));
      this.wsConnection.send(JSON.stringify(tradeSubscribe));
    }

    this.logger.info('Subscribed to Binance depth and trade streams', { symbols: majorPairs });
  }

  /**
   * Process incoming WebSocket messages
   */
  protected processWebSocketMessage(message: any): void {
    try {
      if (message.stream) {
        const [symbol, dataType] = message.stream.split('@');
        
        switch (dataType) {
          case 'ticker':
            this.processTicker(message.data);
            break;
          case 'depth20':
            this.processDepthUpdate(symbol.toUpperCase(), message.data);
            break;
          case 'trade':
            this.processTradeUpdate(symbol.toUpperCase(), message.data);
            break;
        }
      } else if (Array.isArray(message)) {
        // All symbol ticker array
        message.forEach((ticker: BinanceTickerData) => {
          this.processTicker(ticker);
        });
      }
    } catch (error) {
      this.logger.error('Error processing Binance WebSocket message', { 
        error: error instanceof Error ? error.message : String(error),
        message: JSON.stringify(message).substring(0, 500)
      });
    }
  }

  /**
   * Get current fee data for specified trading pairs
   */
  public async getFeeData(symbols: string[]): Promise<FeeData[]> {
    const feeDataPromises = symbols.map(async (symbol) => {
      try {
        // Check cache first
        const cached = this.feeCache.get(symbol);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
          return this.createFeeData(symbol, cached.makerFee, cached.takerFee);
        }

        // Fetch fresh fee data
        const feeInfo = await this.getTradingFees(symbol);
        
        // Cache the result
        this.feeCache.set(symbol, {
          makerFee: parseFloat(feeInfo.makerCommission),
          takerFee: parseFloat(feeInfo.takerCommission),
          timestamp: Date.now(),
        });

        return this.createFeeData(
          symbol, 
          parseFloat(feeInfo.makerCommission), 
          parseFloat(feeInfo.takerCommission)
        );
      } catch (error) {
        this.logger.error('Failed to get fee data for symbol', { 
          symbol, 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        // Return cached data if available, even if stale
        const cached = this.feeCache.get(symbol);
        if (cached) {
          return this.createFeeData(symbol, cached.makerFee, cached.takerFee, 0.5); // Lower confidence
        }
        
        throw error;
      }
    });

    const results = await Promise.allSettled(feeDataPromises);
    return results
      .filter((result): result is PromiseFulfilledResult<FeeData> => result.status === 'fulfilled')
      .map(result => result.value);
  }

  /**
   * Get current price data for specified trading pairs
   */
  public async getPriceData(symbols: string[]): Promise<PriceData[]> {
    try {
      const tickers: BinanceTickerData[] = await this.makeRequest({
        method: 'GET',
        url: '/api/v3/ticker/24hr',
      });

      return tickers
        .filter(ticker => symbols.includes(ticker.symbol))
        .map(ticker => this.createPriceData(ticker));
    } catch (error) {
      this.logger.error('Failed to get price data from Binance', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Get order book data for specified trading pairs
   */
  public async getOrderBookData(symbols: string[]): Promise<OrderBookData[]> {
    const orderBookPromises = symbols.map(async (symbol) => {
      try {
        const orderBook: BinanceOrderBookData = await this.makeRequest({
          method: 'GET',
          url: '/api/v3/depth',
          params: {
            symbol,
            limit: 20,
          },
        });

        return this.createOrderBookData(symbol, orderBook);
      } catch (error) {
        this.logger.error('Failed to get order book data for symbol', { 
          symbol, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw error;
      }
    });

    const results = await Promise.allSettled(orderBookPromises);
    return results
      .filter((result): result is PromiseFulfilledResult<OrderBookData> => result.status === 'fulfilled')
      .map(result => result.value);
  }

  /**
   * Get recent trade data for specified trading pairs
   */
  public async getTradeData(symbols: string[]): Promise<TradeData[]> {
    const tradePromises = symbols.map(async (symbol) => {
      try {
        const trades: BinanceTradeData[] = await this.makeRequest({
          method: 'GET',
          url: '/api/v3/trades',
          params: {
            symbol,
            limit: 100,
          },
        });

        return trades.map(trade => this.createTradeData(symbol, trade));
      } catch (error) {
        this.logger.error('Failed to get trade data for symbol', {
          symbol,
          error: error instanceof Error ? error.message : String(error)
        });
        return [];
      }
    });

    const results = await Promise.allSettled(tradePromises);
    return results
      .filter((result): result is PromiseFulfilledResult<TradeData[]> => result.status === 'fulfilled')
      .flatMap(result => result.value);
  }

  /**
   * Get trading fees for a specific symbol
   */
  private async getTradingFees(symbol: string): Promise<BinanceTradingFees> {
    if (!this.credentials) {
      throw new Error('Credentials not initialized');
    }

    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&timestamp=${timestamp}`;
    const signature = this.createSignature(queryString);

    return this.makeRequest({
      method: 'GET',
      url: '/api/v3/tradeFee',
      params: {
        symbol,
        timestamp,
        signature,
      },
      headers: {
        'X-MBX-APIKEY': this.credentials.apiKey,
      },
    });
  }

  /**
   * Create HMAC SHA256 signature for authenticated requests
   */
  private createSignature(queryString: string): string {
    if (!this.credentials?.apiSecret) {
      throw new Error('API secret not available');
    }

    return crypto
      .createHmac('sha256', this.credentials.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  /**
   * Create FeeData object from Binance data
   */
  private createFeeData(symbol: string, makerFee: number, takerFee: number, confidence: number = 1.0): FeeData {
    return {
      exchange: 'binance',
      type: 'CEX',
      symbol,
      makerFee: makerFee * 10000, // Convert to basis points
      takerFee: takerFee * 10000, // Convert to basis points
      timestamp: Date.now(),
      confidence,
      source: 'binance_api',
      metadata: {
        originalMakerFee: makerFee,
        originalTakerFee: takerFee,
      },
    };
  }

  /**
   * Create PriceData object from Binance ticker data
   */
  private createPriceData(ticker: BinanceTickerData): PriceData {
    return {
      exchange: 'binance',
      symbol: ticker.symbol,
      price: parseFloat(ticker.lastPrice),
      timestamp: ticker.closeTime,
      volume: parseFloat(ticker.volume),
      bid: parseFloat(ticker.bidPrice),
      ask: parseFloat(ticker.askPrice),
      spread: parseFloat(ticker.askPrice) - parseFloat(ticker.bidPrice),
      confidence: 1.0,
    };
  }

  /**
   * Create OrderBookData object from Binance order book data
   */
  private createOrderBookData(symbol: string, orderBook: BinanceOrderBookData): OrderBookData {
    return {
      exchange: 'binance',
      symbol,
      bids: orderBook.bids.map(([price, quantity]) => [parseFloat(price), parseFloat(quantity)]),
      asks: orderBook.asks.map(([price, quantity]) => [parseFloat(price), parseFloat(quantity)]),
      timestamp: Date.now(),
    };
  }

  /**
   * Create TradeData object from Binance trade data
   */
  private createTradeData(symbol: string, trade: BinanceTradeData): TradeData {
    return {
      exchange: 'binance',
      symbol,
      price: parseFloat(trade.price),
      quantity: parseFloat(trade.qty),
      side: trade.isBuyerMaker ? 'sell' : 'buy',
      timestamp: trade.time,
      tradeId: trade.id.toString(),
    };
  }

  /**
   * Process ticker data from WebSocket
   */
  private processTicker(ticker: BinanceTickerData): void {
    const priceData = this.createPriceData(ticker);
    this.emit('data:price', priceData);
  }

  /**
   * Process depth update from WebSocket
   */
  private processDepthUpdate(symbol: string, depthData: any): void {
    const orderBookData: OrderBookData = {
      exchange: 'binance',
      symbol,
      bids: depthData.bids.map(([price, quantity]: [string, string]) => [parseFloat(price), parseFloat(quantity)]),
      asks: depthData.asks.map(([price, quantity]: [string, string]) => [parseFloat(price), parseFloat(quantity)]),
      timestamp: Date.now(),
    };

    this.emit('data:orderbook', orderBookData);
  }

  /**
   * Process trade update from WebSocket
   */
  private processTradeUpdate(symbol: string, tradeData: any): void {
    const trade: TradeData = {
      exchange: 'binance',
      symbol,
      price: parseFloat(tradeData.p),
      quantity: parseFloat(tradeData.q),
      side: tradeData.m ? 'sell' : 'buy', // m = true means buyer is market maker
      timestamp: tradeData.T,
      tradeId: tradeData.t.toString(),
    };

    this.emit('data:trade', trade);
  }
}
