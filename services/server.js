/**
 * Simple Mock Data Aggregation Server
 */

const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3001;
const WEBSOCKET_PORT = process.env.WEBSOCKET_PORT || 3002;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());

// Mock data
const symbols = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'ADA/USDT', 'SOL/USDT'];
const exchanges = ['Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit'];

function generateMockOracleData(symbol) {
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

function generateMockPriceData(symbol, exchange, exchangeType) {
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

function generateMockHealthStatus(sourceId) {
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

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

app.get('/api/oracle/:symbol', (req, res) => {
  const { symbol } = req.params;
  const data = generateMockOracleData(symbol);
  res.json(data);
});

app.get('/api/health-status', (req, res) => {
  const healthStatuses = exchanges.map(source => generateMockHealthStatus(source));
  res.json(healthStatuses);
});

// WebSocket
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Send initial data
  symbols.forEach(symbol => {
    socket.emit('oracle_data', generateMockOracleData(symbol));
  });
  
  socket.on('subscribe', (channels) => {
    console.log(`Client ${socket.id} subscribed to:`, channels);
    channels.forEach(channel => socket.join(channel));
  });
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Broadcast real-time data
setInterval(() => {
  symbols.forEach(symbol => {
    const oracleData = generateMockOracleData(symbol);
    io.emit('oracle_data', oracleData);
    
    const priceData = generateMockPriceData(symbol, exchanges[0], 'CEX');
    io.emit('price_update', priceData);
  });
  
  exchanges.forEach(source => {
    const healthData = generateMockHealthStatus(source);
    io.emit('health_status', healthData);
  });
}, 2000);

// Start server
server.listen(WEBSOCKET_PORT, () => {
  console.log(`🚀 WebSocket Server running on port ${WEBSOCKET_PORT}`);
});

app.listen(PORT, () => {
  console.log(`🚀 Data Aggregation Service running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 WebSocket: ws://localhost:${WEBSOCKET_PORT}`);
});
