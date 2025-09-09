/**
 * @fileoverview Core type definitions for QuantLink Data Aggregation Service
 * @author QuantLink Team
 * @version 1.0.0
 */

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  sandbox?: boolean;
  testnet?: boolean;
}

export interface ExchangeConfig {
  name: string;
  type: 'CEX' | 'DEX';
  enabled: boolean;
  weight: number;
  rateLimit: {
    requestsPerSecond: number;
    burstLimit: number;
  };
  endpoints: {
    rest: string;
    websocket?: string;
    subgraph?: string;
  };
  credentials?: ExchangeCredentials;
  retryConfig: {
    maxRetries: number;
    backoffMultiplier: number;
    maxBackoffMs: number;
  };
  circuitBreaker: {
    failureThreshold: number;
    resetTimeoutMs: number;
    monitoringPeriodMs: number;
  };
}

export interface FeeData {
  exchange: string;
  type: 'CEX' | 'DEX';
  symbol: string;
  makerFee: number;
  takerFee: number;
  timestamp: number;
  volume24h?: number;
  confidence: number;
  source: string;
  metadata?: Record<string, any>;
}

export interface PriceData {
  exchange: string;
  symbol: string;
  price: number;
  timestamp: number;
  volume: number;
  bid?: number;
  ask?: number;
  spread?: number;
  confidence: number;
}

export interface OrderBookData {
  exchange: string;
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  timestamp: number;
  checksum?: string;
}

export interface TradeData {
  exchange: string;
  symbol: string;
  price: number;
  quantity: number;
  side: 'buy' | 'sell';
  timestamp: number;
  tradeId: string;
  fee?: number;
}

export interface AggregatedData {
  symbol: string;
  cexFees: number[];
  dexFees: number[];
  weightedMedianCexFee: number;
  weightedMedianDexFee: number;
  confidence: number;
  timestamp: number;
  sources: string[];
  outliers: string[];
  dataQuality: {
    completeness: number;
    freshness: number;
    consistency: number;
    accuracy: number;
  };
}

export interface DataQualityMetrics {
  completeness: number;
  freshness: number;
  consistency: number;
  accuracy: number;
  outlierCount: number;
  sourceCount: number;
  timestamp: number;
}

export interface CircuitBreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

export interface RateLimiterState {
  tokens: number;
  lastRefill: number;
  requestQueue: Array<{
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timestamp: number;
  }>;
}

export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  timestamp: number;
  details?: Record<string, any>;
  error?: string;
}

export interface MonitoringMetrics {
  requestCount: number;
  errorCount: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number;
  errorRate: number;
  uptime: number;
  timestamp: number;
}

export interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'data' | 'error' | 'ping' | 'pong';
  channel?: string;
  symbol?: string;
  data?: any;
  timestamp: number;
  id?: string;
}

export interface DataValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  confidence: number;
  timestamp: number;
}

export interface OutlierDetectionResult {
  outliers: Array<{
    value: number;
    source: string;
    deviation: number;
    zScore: number;
  }>;
  cleanData: number[];
  statistics: {
    mean: number;
    median: number;
    standardDeviation: number;
    variance: number;
    min: number;
    max: number;
  };
}

export interface MLModelPrediction {
  predictedValue: number;
  confidence: number;
  features: Record<string, number>;
  modelVersion: string;
  timestamp: number;
}

export interface CompressionResult {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  algorithm: string;
  data: Buffer;
}

export interface VaultCredentials {
  endpoint: string;
  token: string;
  namespace?: string;
  apiVersion: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  poolSize: number;
  connectionTimeout: number;
  queryTimeout: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
  ttl: number;
  maxRetries: number;
  retryDelayOnFailover: number;
}

export interface ServiceConfig {
  port: number;
  host: string;
  environment: 'development' | 'staging' | 'production';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  exchanges: ExchangeConfig[];
  database: DatabaseConfig;
  redis: RedisConfig;
  vault: VaultCredentials;
  monitoring: {
    enabled: boolean;
    metricsPort: number;
    healthCheckInterval: number;
  };
  aggregation: {
    updateInterval: number;
    consensusThreshold: number;
    outlierThreshold: number;
    maxDataAge: number;
  };
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
  requestId: string;
  metadata?: Record<string, any>;
}

export interface WebSocketConnection {
  id: string;
  exchange: string;
  url: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastPing: number;
  lastPong: number;
  subscriptions: string[];
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

export interface DataStreamEvent {
  type: 'fee_update' | 'price_update' | 'trade' | 'orderbook' | 'error';
  exchange: string;
  symbol: string;
  data: any;
  timestamp: number;
}

export interface AnomalyDetectionResult {
  isAnomaly: boolean;
  anomalyScore: number;
  threshold: number;
  features: Record<string, number>;
  explanation: string;
  timestamp: number;
}

export interface FlashloanDetectionResult {
  isFlashloan: boolean;
  confidence: number;
  indicators: {
    largeVolumeSpike: boolean;
    priceDeviation: boolean;
    timePattern: boolean;
    gasUsagePattern: boolean;
  };
  riskLevel: 'low' | 'medium' | 'high';
  timestamp: number;
}

export interface MEVProtectionResult {
  isMEVResistant: boolean;
  protectionMethods: string[];
  riskAssessment: {
    frontrunningRisk: number;
    sandwichAttackRisk: number;
    arbitrageRisk: number;
  };
  recommendations: string[];
  timestamp: number;
}

export type EventEmitterEvents = {
  'data:fee': [FeeData];
  'data:price': [PriceData];
  'data:aggregated': [AggregatedData];
  'error': [Error];
  'health:check': [HealthCheckResult];
  'circuit:open': [string];
  'circuit:close': [string];
  'rate:limit': [string];
  'anomaly:detected': [AnomalyDetectionResult];
  'flashloan:detected': [FlashloanDetectionResult];
};
