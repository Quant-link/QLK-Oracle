/**
 * @fileoverview Configuration management for QuantLink Data Aggregation Service
 * @author QuantLink Team
 * @version 1.0.0
 */

import { config } from 'dotenv';
import Joi from 'joi';
import { ServiceConfig, ExchangeConfig } from '@/types';

// Load environment variables
config();

const configSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'staging', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  HOST: Joi.string().default('0.0.0.0'),
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').default('info'),
  
  // Database configuration
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_NAME: Joi.string().required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_SSL: Joi.boolean().default(true),
  DB_POOL_SIZE: Joi.number().min(1).max(50).default(10),
  DB_CONNECTION_TIMEOUT: Joi.number().default(30000),
  DB_QUERY_TIMEOUT: Joi.number().default(60000),
  
  // Redis configuration
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().optional(),
  REDIS_DB: Joi.number().min(0).max(15).default(0),
  REDIS_KEY_PREFIX: Joi.string().default('quantlink:'),
  REDIS_TTL: Joi.number().default(3600),
  REDIS_MAX_RETRIES: Joi.number().default(3),
  REDIS_RETRY_DELAY: Joi.number().default(100),
  
  // Vault configuration
  VAULT_ENDPOINT: Joi.string().uri().required(),
  VAULT_TOKEN: Joi.string().required(),
  VAULT_NAMESPACE: Joi.string().optional(),
  VAULT_API_VERSION: Joi.string().default('v1'),
  
  // Monitoring configuration
  MONITORING_ENABLED: Joi.boolean().default(true),
  METRICS_PORT: Joi.number().port().default(9090),
  HEALTH_CHECK_INTERVAL: Joi.number().default(30000),
  
  // Aggregation configuration
  UPDATE_INTERVAL: Joi.number().default(300000), // 5 minutes
  CONSENSUS_THRESHOLD: Joi.number().min(0).max(1).default(0.6),
  OUTLIER_THRESHOLD: Joi.number().default(2.5),
  MAX_DATA_AGE: Joi.number().default(600000), // 10 minutes
  
  // Exchange API Keys (will be fetched from Vault in production)
  BINANCE_API_KEY: Joi.string().optional(),
  BINANCE_API_SECRET: Joi.string().optional(),
  COINBASE_API_KEY: Joi.string().optional(),
  COINBASE_API_SECRET: Joi.string().optional(),
  COINBASE_PASSPHRASE: Joi.string().optional(),
  KRAKEN_API_KEY: Joi.string().optional(),
  KRAKEN_API_SECRET: Joi.string().optional(),
  OKX_API_KEY: Joi.string().optional(),
  OKX_API_SECRET: Joi.string().optional(),
  OKX_PASSPHRASE: Joi.string().optional(),
  BYBIT_API_KEY: Joi.string().optional(),
  BYBIT_API_SECRET: Joi.string().optional(),
  
  // Blockchain configuration
  ETHEREUM_RPC_URL: Joi.string().uri().required(),
  ETHEREUM_WS_URL: Joi.string().uri().optional(),
  POLYGON_RPC_URL: Joi.string().uri().optional(),
  ARBITRUM_RPC_URL: Joi.string().uri().optional(),
  OPTIMISM_RPC_URL: Joi.string().uri().optional(),
});

const { error, value: envVars } = configSchema.validate(process.env, {
  allowUnknown: true,
  stripUnknown: true,
});

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

// Exchange configurations
const exchangeConfigs: ExchangeConfig[] = [
  {
    name: 'binance',
    type: 'CEX',
    enabled: true,
    weight: 0.25,
    rateLimit: {
      requestsPerSecond: 10,
      burstLimit: 50,
    },
    endpoints: {
      rest: 'https://api.binance.com',
      websocket: 'wss://stream.binance.com:9443',
    },
    retryConfig: {
      maxRetries: 3,
      backoffMultiplier: 2,
      maxBackoffMs: 10000,
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeoutMs: 60000,
      monitoringPeriodMs: 300000,
    },
  },
  {
    name: 'coinbase',
    type: 'CEX',
    enabled: true,
    weight: 0.25,
    rateLimit: {
      requestsPerSecond: 5,
      burstLimit: 25,
    },
    endpoints: {
      rest: 'https://api.exchange.coinbase.com',
      websocket: 'wss://ws-feed.exchange.coinbase.com',
    },
    retryConfig: {
      maxRetries: 3,
      backoffMultiplier: 2,
      maxBackoffMs: 10000,
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeoutMs: 60000,
      monitoringPeriodMs: 300000,
    },
  },
  {
    name: 'kraken',
    type: 'CEX',
    enabled: true,
    weight: 0.2,
    rateLimit: {
      requestsPerSecond: 1,
      burstLimit: 15,
    },
    endpoints: {
      rest: 'https://api.kraken.com',
      websocket: 'wss://ws.kraken.com',
    },
    retryConfig: {
      maxRetries: 3,
      backoffMultiplier: 2,
      maxBackoffMs: 15000,
    },
    circuitBreaker: {
      failureThreshold: 3,
      resetTimeoutMs: 120000,
      monitoringPeriodMs: 300000,
    },
  },
  {
    name: 'okx',
    type: 'CEX',
    enabled: true,
    weight: 0.15,
    rateLimit: {
      requestsPerSecond: 20,
      burstLimit: 100,
    },
    endpoints: {
      rest: 'https://www.okx.com',
      websocket: 'wss://ws.okx.com:8443',
    },
    retryConfig: {
      maxRetries: 3,
      backoffMultiplier: 2,
      maxBackoffMs: 10000,
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeoutMs: 60000,
      monitoringPeriodMs: 300000,
    },
  },
  {
    name: 'bybit',
    type: 'CEX',
    enabled: true,
    weight: 0.15,
    rateLimit: {
      requestsPerSecond: 10,
      burstLimit: 50,
    },
    endpoints: {
      rest: 'https://api.bybit.com',
      websocket: 'wss://stream.bybit.com',
    },
    retryConfig: {
      maxRetries: 3,
      backoffMultiplier: 2,
      maxBackoffMs: 10000,
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeoutMs: 60000,
      monitoringPeriodMs: 300000,
    },
  },
  {
    name: 'uniswap_v3',
    type: 'DEX',
    enabled: true,
    weight: 0.4,
    rateLimit: {
      requestsPerSecond: 5,
      burstLimit: 20,
    },
    endpoints: {
      rest: envVars.ETHEREUM_RPC_URL,
      subgraph: 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3',
    },
    retryConfig: {
      maxRetries: 3,
      backoffMultiplier: 2,
      maxBackoffMs: 10000,
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeoutMs: 60000,
      monitoringPeriodMs: 300000,
    },
  },
  {
    name: 'sushiswap',
    type: 'DEX',
    enabled: true,
    weight: 0.3,
    rateLimit: {
      requestsPerSecond: 5,
      burstLimit: 20,
    },
    endpoints: {
      rest: envVars.ETHEREUM_RPC_URL,
      subgraph: 'https://api.thegraph.com/subgraphs/name/sushiswap/exchange',
    },
    retryConfig: {
      maxRetries: 3,
      backoffMultiplier: 2,
      maxBackoffMs: 10000,
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeoutMs: 60000,
      monitoringPeriodMs: 300000,
    },
  },
  {
    name: 'curve',
    type: 'DEX',
    enabled: true,
    weight: 0.3,
    rateLimit: {
      requestsPerSecond: 5,
      burstLimit: 20,
    },
    endpoints: {
      rest: envVars.ETHEREUM_RPC_URL,
      subgraph: 'https://api.thegraph.com/subgraphs/name/convex-community/curve-pools',
    },
    retryConfig: {
      maxRetries: 3,
      backoffMultiplier: 2,
      maxBackoffMs: 10000,
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeoutMs: 60000,
      monitoringPeriodMs: 300000,
    },
  },
];

export const serviceConfig: ServiceConfig = {
  port: envVars.PORT,
  host: envVars.HOST,
  environment: envVars.NODE_ENV,
  logLevel: envVars.LOG_LEVEL,
  exchanges: exchangeConfigs,
  database: {
    host: envVars.DB_HOST,
    port: envVars.DB_PORT,
    database: envVars.DB_NAME,
    username: envVars.DB_USER,
    password: envVars.DB_PASSWORD,
    ssl: envVars.DB_SSL,
    poolSize: envVars.DB_POOL_SIZE,
    connectionTimeout: envVars.DB_CONNECTION_TIMEOUT,
    queryTimeout: envVars.DB_QUERY_TIMEOUT,
  },
  redis: {
    host: envVars.REDIS_HOST,
    port: envVars.REDIS_PORT,
    password: envVars.REDIS_PASSWORD,
    db: envVars.REDIS_DB,
    keyPrefix: envVars.REDIS_KEY_PREFIX,
    ttl: envVars.REDIS_TTL,
    maxRetries: envVars.REDIS_MAX_RETRIES,
    retryDelayOnFailover: envVars.REDIS_RETRY_DELAY,
  },
  vault: {
    endpoint: envVars.VAULT_ENDPOINT,
    token: envVars.VAULT_TOKEN,
    namespace: envVars.VAULT_NAMESPACE,
    apiVersion: envVars.VAULT_API_VERSION,
  },
  monitoring: {
    enabled: envVars.MONITORING_ENABLED,
    metricsPort: envVars.METRICS_PORT,
    healthCheckInterval: envVars.HEALTH_CHECK_INTERVAL,
  },
  aggregation: {
    updateInterval: envVars.UPDATE_INTERVAL,
    consensusThreshold: envVars.CONSENSUS_THRESHOLD,
    outlierThreshold: envVars.OUTLIER_THRESHOLD,
    maxDataAge: envVars.MAX_DATA_AGE,
  },
};

export default serviceConfig;
