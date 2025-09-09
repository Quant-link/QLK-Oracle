/**
 * @fileoverview Mock Data Aggregation Server for Development
 * @author QuantLink Team
 * @version 1.0.0
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3001;
const WEBSOCKET_PORT = process.env.WEBSOCKET_PORT || 3002;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());

// Mock data generators
const symbols = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'ADA/USDT', 'SOL/USDT'];
const exchanges = ['Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit'];
const dexProtocols = ['Uniswap V3', 'PancakeSwap', 'SushiSwap', 'Curve', '1inch'];

function generateMockOracleData(symbol: string) {
  const cexFees = Array.from({ length: 5 }, () => Math.random() * 0.002 + 0.0005);
  const dexFees = Array.from({ length: 5 }, () => Math.random() * 0.005 + 0.001);
  
  return {
    symbol,
    cexFees,
    dexFees,
    weightedMedianCexFee: cexFees.sort()[Math.floor(cexFees.length / 2)],
    weightedMedianDexFee: dexFees.sort()[Math.floor(dexFees.length / 2)],
    confidence: Math.random() * 0.3 + 0.7,
    timestamp: Date.now(),
    sources: exchanges.slice(0, Math.floor(Math.random() * 3) + 2),
    outliers: Math.random() > 0.8 ? [exchanges[0]] : [],
  };
}

function generateMockPriceData(symbol: string, exchange: string, exchangeType: 'CEX' | 'DEX') {
  const basePrice = symbol.includes('BTC') ? 45000 : symbol.includes('ETH') ? 2500 : 100;
  const price = basePrice * (1 + (Math.random() - 0.5) * 0.02);
  
  return {
    symbol,
    exchange,
    exchangeType,
    price,
    volume24h: Math.random() * 1000000 + 100000,
    timestamp: Date.now(),
    bid: price * 0.999,
    ask: price * 1.001,
    spread: price * 0.002,
    confidenceScore: Math.random() * 0.3 + 0.7,
  };
}

function generateMockFeeData(symbol: string, exchange: string, exchangeType: 'CEX' | 'DEX') {
  return {
    symbol,
    exchange,
    exchangeType,
    makerFee: Math.random() * 0.002 + 0.0005,
    takerFee: Math.random() * 0.003 + 0.001,
    volume24h: Math.random() * 1000000 + 100000,
    timestamp: Date.now(),
    confidenceScore: Math.random() * 0.3 + 0.7,
  };
}

function generateMockHealthStatus(sourceId: string) {
  const states = ['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'OFFLINE'];
  const weights = [0.7, 0.2, 0.08, 0.02];
  
  let random = Math.random();
  let healthState = 'HEALTHY';
  
  for (let i = 0; i < states.length; i++) {
    if (random < weights[i]) {
      healthState = states[i];
      break;
    }
    random -= weights[i];
  }
  
  return {
    sourceId,
    sourceType: 'EXCHANGE',
    healthState,
    lastUpdate: Date.now(),
    latencyMs: Math.random() * 200 + 10,
    errorCount: Math.floor(Math.random() * 5),
    errorMessage: healthState !== 'HEALTHY' ? 'Connection timeout' : undefined,
    uptimePercentage: Math.random() * 0.1 + 0.9,
  };
}

// REST API Routes
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

app.get('/api/oracle/:symbol', (req, res) => {
  const { symbol } = req.params;
  const data = generateMockOracleData(symbol);
  res.json(data);
});

app.get('/api/prices/:symbol', (req, res) => {
  const { symbol } = req.params;
  const prices = exchanges.map(exchange => 
    generateMockPriceData(symbol, exchange, 'CEX')
  );
  res.json(prices);
});

app.get('/api/fees/:symbol', (req, res) => {
  const { symbol } = req.params;
  const fees = [
    ...exchanges.map(exchange => generateMockFeeData(symbol, exchange, 'CEX')),
    ...dexProtocols.map(protocol => generateMockFeeData(symbol, protocol, 'DEX')),
  ];
  res.json(fees);
});

app.get('/api/health-status', (req, res) => {
  const healthStatuses = [...exchanges, ...dexProtocols].map(source => 
    generateMockHealthStatus(source)
  );
  res.json(healthStatuses);
});

// WebSocket connections
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Send initial data
  symbols.forEach(symbol => {
    socket.emit('oracle_data', generateMockOracleData(symbol));
  });
  
  // Handle subscriptions
  socket.on('subscribe', (channels) => {
    console.log(`Client ${socket.id} subscribed to:`, channels);
    channels.forEach((channel: string) => {
      socket.join(channel);
    });
  });
  
  socket.on('unsubscribe', (channels) => {
    console.log(`Client ${socket.id} unsubscribed from:`, channels);
    channels.forEach((channel: string) => {
      socket.leave(channel);
    });
  });
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Broadcast real-time data
setInterval(() => {
  symbols.forEach(symbol => {
    // Oracle data
    const oracleData = generateMockOracleData(symbol);
    io.to(`oracle:${symbol}`).emit('oracle_data', oracleData);
    
    // Price updates
    exchanges.forEach(exchange => {
      const priceData = generateMockPriceData(symbol, exchange, 'CEX');
      io.to(`price:${symbol}`).emit('price_update', priceData);
    });
    
    // Fee updates
    const feeData = generateMockFeeData(symbol, exchanges[0], 'CEX');
    io.to(`fee:${symbol}`).emit('fee_update', feeData);
  });
  
  // Health status updates
  [...exchanges, ...dexProtocols].forEach(source => {
    const healthData = generateMockHealthStatus(source);
    io.emit('health_status', healthData);
  });
  
}, 2000); // Update every 2 seconds

// Start servers
server.listen(WEBSOCKET_PORT, () => {
  console.log(`🚀 WebSocket Server running on port ${WEBSOCKET_PORT}`);
});

app.listen(PORT, () => {
  console.log(`🚀 Data Aggregation Service running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 WebSocket: ws://localhost:${WEBSOCKET_PORT}`);
});

export default app;
