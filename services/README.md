# QuantLink Data Aggregation Service

##  Production-Ready Oracle Data Fetching Service

A comprehensive, enterprise-grade data aggregation service for the QuantLink Oracle system that connects to real CEX and DEX exchanges without any mock data. Built with TypeScript, featuring real-time streaming, advanced data quality validation, and production-ready monitoring.

##  Features

###  **CEX Integration Module**
- **Binance API**: Real-time WebSocket streams for ticker, depth, and trade data
- **Coinbase Pro**: REST API with OAuth2 authentication and rate limiting
- **Kraken**: WebSocket and REST API integration with retry logic
- **OKX & Bybit**: Fallback data sources with circuit breaker protection
- **Rate Limiting**: Exponential backoff and intelligent request throttling
- **Circuit Breakers**: Automatic failover and recovery mechanisms

###  **DEX Integration Module**
- **Uniswap V3**: Subgraph queries and smart contract interactions
- **SushiSwap**: Pool data and swap event monitoring
- **Curve**: Specialized stablecoin pool integration
- **MEV Protection**: Flashloan attack detection and MEV-resistant pricing
- **Real-time Events**: Block subscription and event processing

###  **Data Quality Validation**
- **Statistical Analysis**: Z-score and IQR outlier detection
- **Cross-Source Validation**: Weighted consensus calculation
- **Timestamp Verification**: Staleness detection and filtering
- **VWAP Calculations**: Volume-weighted average pricing
- **ML Anomaly Detection**: Historical pattern analysis
- **Data Integrity**: Comprehensive validation pipelines

###  **Aggregation Engine**
- **Weighted Median**: Advanced statistical aggregation
- **Confidence Scoring**: Multi-factor confidence calculation
- **Historical Storage**: Time-series optimized PostgreSQL
- **Real-time Streaming**: WebSocket server for live data
- **Data Compression**: Efficient storage with gzip compression
- **Caching Layer**: Redis-based high-performance caching

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CEX Sources   │    │   DEX Sources   │    │  Data Quality   │
│                 │    │                 │    │   Validation    │
│ • Binance       │    │ • Uniswap V3    │    │                 │
│ • Coinbase      │    │ • SushiSwap     │    │ • Outlier Det.  │
│ • Kraken        │    │ • Curve         │    │ • Cross Valid.  │
│ • OKX/Bybit     │    │                 │    │ • ML Anomaly    │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │   Aggregation Engine      │
                    │                           │
                    │ • Weighted Median         │
                    │ • Confidence Scoring      │
                    │ • Real-time Processing    │
                    └─────────────┬─────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
┌─────────▼───────┐    ┌─────────▼───────┐    ┌─────────▼───────┐
│ PostgreSQL DB   │    │   Redis Cache   │    │ WebSocket API   │
│                 │    │                 │    │                 │
│ • Time-series   │    │ • Real-time     │    │ • Live Streams  │
│ • Partitioned   │    │ • Pub/Sub       │    │ • Subscriptions │
│ • Compressed    │    │ • Rate Limiting │    │ • Broadcasting  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🛠️ Technology Stack

- **Runtime**: Node.js 18+ with TypeScript
- **HTTP Client**: Axios with retry logic and interceptors
- **WebSocket**: ws library for real-time connections
- **Blockchain**: ethers.js v5 for Ethereum interactions
- **Database**: PostgreSQL with time-series optimization
- **Cache**: Redis with clustering support
- **Security**: HashiCorp Vault for credential management
- **Monitoring**: Prometheus metrics and structured logging
- **Compression**: gzip for efficient data storage

##  Quick Start

### Prerequisites

```bash
# Required services
- PostgreSQL 14+
- Redis 6+
- HashiCorp Vault
- Node.js 18+
```

### Installation

```bash
# Clone and install dependencies
cd services
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your configuration

# Initialize database schema
npm run db:migrate

# Start the service
npm start
```

### Environment Configuration

```env
# Service Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=quantlink_data
DATABASE_SSL=true

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# HashiCorp Vault
VAULT_ENDPOINT=https://vault.example.com
VAULT_TOKEN=your_vault_token
VAULT_NAMESPACE=quantlink

# Monitoring
PROMETHEUS_ENABLED=true
METRICS_PORT=9090
LOG_LEVEL=info
```

##  API Endpoints

### Health Check
```http
GET /health
```

### Latest Data
```http
GET /api/v1/data/{symbol}
```

### Historical Data
```http
GET /api/v1/data/{symbol}/history?from=1640995200000&to=1641081600000
```

### Service Statistics
```http
GET /api/v1/stats
```

### Metrics (Prometheus)
```http
GET /metrics
```

##  WebSocket API

### Connection
```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Received:', message);
});
```

### Message Types
- `fee_data`: Real-time fee updates
- `price_data`: Live price feeds
- `aggregated_data`: Processed aggregation results
- `health_status`: Service health updates

##  Monitoring & Observability

### Prometheus Metrics
- **HTTP Requests**: Request count, duration, status codes
- **Exchange APIs**: Request latency, error rates, rate limits
- **Data Quality**: Validation results, confidence scores
- **Aggregation**: Processing time, data points, outliers
- **Database**: Query performance, connection pool stats
- **Redis**: Operation latency, cache hit/miss ratios

### Structured Logging
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "context": "AggregationEngine",
  "message": "Fee data aggregation completed",
  "symbol": "BTC/USDT",
  "processingTime": 45,
  "confidence": 0.95,
  "dataPoints": 8,
  "outliers": 1
}
```

## 🔒 Security Features

- **Credential Management**: HashiCorp Vault integration
- **Rate Limiting**: Per-exchange and global limits
- **Circuit Breakers**: Automatic failover protection
- **Input Validation**: Comprehensive data sanitization
- **Error Handling**: Graceful degradation and recovery
- **Monitoring**: Real-time security event tracking

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Run with coverage
npm run test:coverage

# Load testing
npm run test:load
```

## 📦 Deployment

### Docker
```bash
# Build image
docker build -t quantlink-data-service .

# Run container
docker run -p 3000:3000 quantlink-data-service
```

### Kubernetes
```bash
# Deploy to cluster
kubectl apply -f k8s/
```

## 🔧 Configuration

### Exchange Configuration
```typescript
{
  name: 'binance',
  type: 'CEX',
  enabled: true,
  rateLimit: {
    requestsPerSecond: 10,
    burstLimit: 50
  },
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 30000
  }
}
```

### Data Quality Settings
```typescript
{
  outlierThreshold: 2.5,        // Z-score threshold
  stalenessThreshold: 300000,   // 5 minutes
  minimumSources: 3,            // Required data sources
  confidenceThreshold: 0.8,     // Minimum confidence
  priceDeviationThreshold: 0.1  // 10% max deviation
}
```

##  Documentation

- [API Reference](./docs/api.md)
- [Configuration Guide](./docs/configuration.md)
- [Deployment Guide](./docs/deployment.md)
- [Monitoring Setup](./docs/monitoring.md)
- [Troubleshooting](./docs/troubleshooting.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes with tests
4. Submit a pull request

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.

## Support

- **Issues**: GitHub Issues

---

**Built with ❤️ by the QuantLink Team**
