import { NextRequest, NextResponse } from 'next/server';

// Exchange API endpoints
const EXCHANGE_APIS = {
  binance: {
    baseUrl: 'https://api.binance.com',
    endpoints: {
      ping: '/api/v3/ping',
      time: '/api/v3/time',
      ticker: '/api/v3/ticker/24hr',
      klines: '/api/v3/klines'
    }
  },
  coinbase: {
    baseUrl: 'https://api.exchange.coinbase.com',
    endpoints: {
      time: '/time',
      products: '/products',
      ticker: '/products/{symbol}/ticker',
      stats: '/products/{symbol}/stats'
    }
  },
  kraken: {
    baseUrl: 'https://api.kraken.com',
    endpoints: {
      time: '/0/public/Time',
      assets: '/0/public/Assets',
      ticker: '/0/public/Ticker',
      ohlc: '/0/public/OHLC'
    }
  },
  okx: {
    baseUrl: 'https://www.okx.com',
    endpoints: {
      time: '/api/v5/public/time',
      instruments: '/api/v5/public/instruments',
      ticker: '/api/v5/market/ticker',
      candles: '/api/v5/market/candles'
    }
  },
  bybit: {
    baseUrl: 'https://api.bybit.com',
    endpoints: {
      time: '/v5/market/time',
      instruments: '/v5/market/instruments-info',
      ticker: '/v5/market/tickers',
      kline: '/v5/market/kline'
    }
  }
};

interface ExchangeHealth {
  exchange: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  latency: number;
  lastUpdate: number;
  errorCount: number;
  uptimePercentage: number;
  responseTime: number;
}

interface MarketData {
  exchange: string;
  symbol: string;
  price: number;
  volume24h: number;
  change24h: number;
  timestamp: number;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout: number = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'QuantLink-Oracle-Dashboard/1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function checkBinanceHealth(): Promise<ExchangeHealth> {
  const startTime = Date.now();
  try {
    const response = await fetchWithTimeout(`${EXCHANGE_APIS.binance.baseUrl}${EXCHANGE_APIS.binance.endpoints.ping}`);
    const latency = Date.now() - startTime;
    
    if (response.ok) {
      return {
        exchange: 'BINANCE',
        status: 'HEALTHY',
        latency,
        lastUpdate: Date.now(),
        errorCount: 0,
        uptimePercentage: 99.9,
        responseTime: latency
      };
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    return {
      exchange: 'BINANCE',
      status: 'DOWN',
      latency: Date.now() - startTime,
      lastUpdate: Date.now(),
      errorCount: 1,
      uptimePercentage: 95.0,
      responseTime: Date.now() - startTime
    };
  }
}

async function checkCoinbaseHealth(): Promise<ExchangeHealth> {
  const startTime = Date.now();
  try {
    const response = await fetchWithTimeout(`${EXCHANGE_APIS.coinbase.baseUrl}${EXCHANGE_APIS.coinbase.endpoints.time}`);
    const latency = Date.now() - startTime;
    
    if (response.ok) {
      return {
        exchange: 'COINBASE',
        status: 'HEALTHY',
        latency,
        lastUpdate: Date.now(),
        errorCount: 0,
        uptimePercentage: 99.8,
        responseTime: latency
      };
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    return {
      exchange: 'COINBASE',
      status: 'DOWN',
      latency: Date.now() - startTime,
      lastUpdate: Date.now(),
      errorCount: 1,
      uptimePercentage: 96.0,
      responseTime: Date.now() - startTime
    };
  }
}

async function checkKrakenHealth(): Promise<ExchangeHealth> {
  const startTime = Date.now();
  try {
    const response = await fetchWithTimeout(`${EXCHANGE_APIS.kraken.baseUrl}${EXCHANGE_APIS.kraken.endpoints.time}`);
    const latency = Date.now() - startTime;
    
    if (response.ok) {
      const data = await response.json();
      if (data.error && data.error.length === 0) {
        return {
          exchange: 'KRAKEN',
          status: 'HEALTHY',
          latency,
          lastUpdate: Date.now(),
          errorCount: 0,
          uptimePercentage: 99.7,
          responseTime: latency
        };
      } else {
        throw new Error('API Error');
      }
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    return {
      exchange: 'KRAKEN',
      status: 'DOWN',
      latency: Date.now() - startTime,
      lastUpdate: Date.now(),
      errorCount: 1,
      uptimePercentage: 94.0,
      responseTime: Date.now() - startTime
    };
  }
}

async function checkOKXHealth(): Promise<ExchangeHealth> {
  const startTime = Date.now();
  try {
    const response = await fetchWithTimeout(`${EXCHANGE_APIS.okx.baseUrl}${EXCHANGE_APIS.okx.endpoints.time}`);
    const latency = Date.now() - startTime;
    
    if (response.ok) {
      const data = await response.json();
      if (data.code === '0') {
        return {
          exchange: 'OKX',
          status: 'HEALTHY',
          latency,
          lastUpdate: Date.now(),
          errorCount: 0,
          uptimePercentage: 99.6,
          responseTime: latency
        };
      } else {
        throw new Error('API Error');
      }
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    return {
      exchange: 'OKX',
      status: 'DOWN',
      latency: Date.now() - startTime,
      lastUpdate: Date.now(),
      errorCount: 1,
      uptimePercentage: 93.0,
      responseTime: Date.now() - startTime
    };
  }
}

async function checkBybitHealth(): Promise<ExchangeHealth> {
  const startTime = Date.now();
  try {
    const response = await fetchWithTimeout(`${EXCHANGE_APIS.bybit.baseUrl}${EXCHANGE_APIS.bybit.endpoints.time}`);
    const latency = Date.now() - startTime;
    
    if (response.ok) {
      const data = await response.json();
      if (data.retCode === 0) {
        return {
          exchange: 'BYBIT',
          status: 'HEALTHY',
          latency,
          lastUpdate: Date.now(),
          errorCount: 0,
          uptimePercentage: 99.5,
          responseTime: latency
        };
      } else {
        throw new Error('API Error');
      }
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    return {
      exchange: 'BYBIT',
      status: 'DOWN',
      latency: Date.now() - startTime,
      lastUpdate: Date.now(),
      errorCount: 1,
      uptimePercentage: 92.0,
      responseTime: Date.now() - startTime
    };
  }
}

async function getBinanceMarketData(): Promise<MarketData[]> {
  try {
    const response = await fetchWithTimeout(`${EXCHANGE_APIS.binance.baseUrl}${EXCHANGE_APIS.binance.endpoints.ticker}?symbols=["BTCUSDT","ETHUSDT","BNBUSDT","ADAUSDT","SOLUSDT"]`);
    
    if (response.ok) {
      const data = await response.json();
      return data.map((ticker: any) => ({
        exchange: 'BINANCE',
        symbol: ticker.symbol,
        price: parseFloat(ticker.lastPrice),
        volume24h: parseFloat(ticker.volume),
        change24h: parseFloat(ticker.priceChangePercent),
        timestamp: Date.now()
      }));
    }
  } catch (error) {
    console.error('Error fetching Binance market data:', error);
  }
  return [];
}

async function getCoinbaseMarketData(): Promise<MarketData[]> {
  try {
    const symbols = ['BTC-USD', 'ETH-USD', 'ADA-USD', 'SOL-USD'];
    const marketData: MarketData[] = [];
    
    for (const symbol of symbols) {
      try {
        const [tickerResponse, statsResponse] = await Promise.all([
          fetchWithTimeout(`${EXCHANGE_APIS.coinbase.baseUrl}/products/${symbol}/ticker`),
          fetchWithTimeout(`${EXCHANGE_APIS.coinbase.baseUrl}/products/${symbol}/stats`)
        ]);
        
        if (tickerResponse.ok && statsResponse.ok) {
          const ticker = await tickerResponse.json();
          const stats = await statsResponse.json();
          
          marketData.push({
            exchange: 'COINBASE',
            symbol: symbol.replace('-', ''),
            price: parseFloat(ticker.price),
            volume24h: parseFloat(stats.volume),
            change24h: ((parseFloat(ticker.price) - parseFloat(stats.open)) / parseFloat(stats.open)) * 100,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        console.error(`Error fetching Coinbase data for ${symbol}:`, error);
      }
    }
    
    return marketData;
  } catch (error) {
    console.error('Error fetching Coinbase market data:', error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'health';

  try {
    if (type === 'health') {
      const healthChecks = await Promise.allSettled([
        checkBinanceHealth(),
        checkCoinbaseHealth(),
        checkKrakenHealth(),
        checkOKXHealth(),
        checkBybitHealth()
      ]);

      const exchangeHealth = healthChecks.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          const exchanges = ['BINANCE', 'COINBASE', 'KRAKEN', 'OKX', 'BYBIT'];
          return {
            exchange: exchanges[index],
            status: 'DOWN' as const,
            latency: 5000,
            lastUpdate: Date.now(),
            errorCount: 1,
            uptimePercentage: 0,
            responseTime: 5000
          };
        }
      });

      return NextResponse.json({ exchangeHealth });
    } else if (type === 'market') {
      const [binanceData, coinbaseData] = await Promise.allSettled([
        getBinanceMarketData(),
        getCoinbaseMarketData()
      ]);

      const marketData = [
        ...(binanceData.status === 'fulfilled' ? binanceData.value : []),
        ...(coinbaseData.status === 'fulfilled' ? coinbaseData.value : [])
      ];

      return NextResponse.json({ marketData });
    } else {
      return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
    }
  } catch (error) {
    console.error('Exchange API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch exchange data' },
      { status: 500 }
    );
  }
}
