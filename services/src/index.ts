/**
 * @fileoverview Main application entry point for QuantLink Data Aggregation Service
 * @author QuantLink Team
 * @version 1.0.0
 */

import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import WebSocket from 'ws';

import { serviceConfig } from '@/config';
import { Logger } from '@/utils/logger';
import { MetricsCollector } from '@/monitoring/metrics';
import { VaultService } from '@/services/vault';
import { RedisService } from '@/services/redis';
import { DatabaseService } from '@/services/database';
import { DataQualityService } from '@/services/dataQuality';
import { AggregationEngine } from '@/services/aggregation';

// CEX Integrations
import { BinanceIntegration } from '@/integrations/cex/binance';
// import { CoinbaseIntegration } from '@/integrations/cex/coinbase';
// import { KrakenIntegration } from '@/integrations/cex/kraken';

// DEX Integrations
import { UniswapV3Integration } from '@/integrations/dex/uniswap';
// import { SushiswapIntegration } from '@/integrations/dex/sushiswap';

import { FeeData, PriceData, AggregatedData, HealthCheckResult } from '@/types';

export class DataAggregationService {
  private app: express.Application;
  private server: any;
  private wsServer: WebSocket.Server;
  private logger: Logger;
  private metrics: MetricsCollector;
  
  // Core services
  private vault: VaultService;
  private redis: RedisService;
  private database: DatabaseService;
  private dataQuality: DataQualityService;
  private aggregation: AggregationEngine;
  
  // Exchange integrations
  private cexIntegrations: Map<string, any> = new Map();
  private dexIntegrations: Map<string, any> = new Map();
  
  private isShuttingDown: boolean = false;

  constructor() {
    this.logger = new Logger('DataAggregationService');
    this.metrics = new MetricsCollector('main_service');
    
    this.initializeExpress();
    this.initializeServices();
    this.setupGracefulShutdown();
  }

  /**
   * Initialize Express application
   */
  private initializeExpress(): void {
    this.app = express();
    
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
    }));
    
    // Performance middleware
    this.app.use(compression());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Request logging middleware
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        this.metrics.recordLatency('http_request_duration', duration);
        this.metrics.incrementCounter(`http_${res.statusCode}`);
        
        this.logger.info('HTTP Request', {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration,
          userAgent: req.get('User-Agent'),
        });
      });
      
      next();
    });
    
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Initialize core services
   */
  private async initializeServices(): Promise<void> {
    try {
      this.logger.info('Initializing core services');
      
      // Initialize Vault service
      this.vault = new VaultService(serviceConfig.vault);
      
      // Initialize Redis service
      this.redis = new RedisService(serviceConfig.redis);
      await this.redis.connect();
      
      // Initialize Database service
      this.database = new DatabaseService(serviceConfig.database);
      await this.database.connect();
      
      // Initialize Data Quality service
      this.dataQuality = new DataQualityService({
        outlierThreshold: serviceConfig.aggregation.outlierThreshold,
        stalenessThreshold: serviceConfig.aggregation.maxDataAge,
        minimumSources: 3,
        confidenceThreshold: serviceConfig.aggregation.consensusThreshold,
        priceDeviationThreshold: 0.1, // 10%
        volumeThreshold: 1000,
      }, this.redis);
      
      // Initialize Aggregation Engine
      this.aggregation = new AggregationEngine({
        updateInterval: serviceConfig.aggregation.updateInterval,
        consensusThreshold: serviceConfig.aggregation.consensusThreshold,
        outlierThreshold: serviceConfig.aggregation.outlierThreshold,
        maxDataAge: serviceConfig.aggregation.maxDataAge,
        compressionEnabled: true,
        historicalRetention: 30, // 30 days
      }, this.redis, this.database, this.dataQuality);
      
      this.logger.info('Core services initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize core services', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Initialize exchange integrations
   */
  private async initializeExchangeIntegrations(): Promise<void> {
    try {
      this.logger.info('Initializing exchange integrations');
      
      // Initialize CEX integrations
      for (const exchangeConfig of serviceConfig.exchanges) {
        if (exchangeConfig.type === 'CEX' && exchangeConfig.enabled) {
          let integration;
          
          switch (exchangeConfig.name) {
            case 'binance':
              integration = new BinanceIntegration(exchangeConfig, this.vault);
              break;
            // case 'coinbase':
            //   integration = new CoinbaseIntegration(exchangeConfig, this.vault);
            //   break;
            // case 'kraken':
            //   integration = new KrakenIntegration(exchangeConfig, this.vault);
            //   break;
            default:
              this.logger.warn('Unknown CEX integration', { exchange: exchangeConfig.name });
              continue;
          }
          
          await integration.initialize();
          this.cexIntegrations.set(exchangeConfig.name, integration);
          
          // Setup event listeners
          integration.on('data:fee', (feeData: FeeData) => {
            this.handleFeeData(feeData);
          });
          
          integration.on('data:price', (priceData: PriceData) => {
            this.handlePriceData(priceData);
          });
          
          integration.on('error', (error: Error) => {
            this.logger.error('CEX integration error', { 
              exchange: exchangeConfig.name, 
              error: error.message 
            });
          });
        }
        
        // Initialize DEX integrations
        if (exchangeConfig.type === 'DEX' && exchangeConfig.enabled) {
          let integration;
          
          switch (exchangeConfig.name) {
            case 'uniswap_v3':
              integration = new UniswapV3Integration(exchangeConfig);
              break;
            // case 'sushiswap':
            //   integration = new SushiswapIntegration(exchangeConfig);
            //   break;
            default:
              this.logger.warn('Unknown DEX integration', { exchange: exchangeConfig.name });
              continue;
          }
          
          await integration.initialize();
          this.dexIntegrations.set(exchangeConfig.name, integration);
          
          // Setup event listeners
          integration.on('data:fee', (feeData: FeeData) => {
            this.handleFeeData(feeData);
          });
          
          integration.on('data:price', (priceData: PriceData) => {
            this.handlePriceData(priceData);
          });
        }
      }
      
      this.logger.info('Exchange integrations initialized', {
        cexCount: this.cexIntegrations.size,
        dexCount: this.dexIntegrations.size,
      });
    } catch (error) {
      this.logger.error('Failed to initialize exchange integrations', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const healthChecks: HealthCheckResult[] = [];
        
        // Check Redis
        const redisHealth = await this.redis.healthCheck();
        healthChecks.push({
          service: 'redis',
          status: redisHealth.status,
          latency: redisHealth.latency,
          timestamp: Date.now(),
          error: redisHealth.error,
        });
        
        // Check Database
        const dbHealth = await this.database.healthCheck();
        healthChecks.push(dbHealth);
        
        // Check Vault
        const vaultHealth = await this.vault.healthCheck();
        healthChecks.push({
          service: 'vault',
          status: vaultHealth.status,
          latency: vaultHealth.latency,
          timestamp: Date.now(),
          error: vaultHealth.error,
        });
        
        // Check exchange integrations
        for (const [name, integration] of this.cexIntegrations) {
          const health = await integration.healthCheck();
          healthChecks.push(health);
        }
        
        for (const [name, integration] of this.dexIntegrations) {
          const health = await integration.healthCheck();
          healthChecks.push(health);
        }
        
        const overallStatus = healthChecks.every(check => check.status === 'healthy') 
          ? 'healthy' : 'unhealthy';
        
        res.status(overallStatus === 'healthy' ? 200 : 503).json({
          status: overallStatus,
          timestamp: Date.now(),
          checks: healthChecks,
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        });
      }
    });

    // Get latest aggregated data
    this.app.get('/api/v1/data/:symbol', async (req, res) => {
      try {
        const { symbol } = req.params;
        const data = await this.aggregation.getLatestAggregatedData(symbol);
        
        if (!data) {
          return res.status(404).json({
            error: 'No data found for symbol',
            symbol,
          });
        }
        
        res.json({
          success: true,
          data,
          timestamp: Date.now(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Get historical data
    this.app.get('/api/v1/data/:symbol/history', async (req, res) => {
      try {
        const { symbol } = req.params;
        const { from, to } = req.query;
        
        const fromTimestamp = from ? parseInt(from as string) : Date.now() - 24 * 60 * 60 * 1000;
        const toTimestamp = to ? parseInt(to as string) : Date.now();
        
        const data = await this.aggregation.getHistoricalAggregatedData(
          symbol, 
          fromTimestamp, 
          toTimestamp
        );
        
        res.json({
          success: true,
          data,
          count: data.length,
          timestamp: Date.now(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Get service statistics
    this.app.get('/api/v1/stats', (req, res) => {
      try {
        const stats = {
          service: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: '1.0.0',
          },
          integrations: {
            cex: Array.from(this.cexIntegrations.keys()),
            dex: Array.from(this.dexIntegrations.keys()),
          },
          aggregation: this.aggregation.getStatistics(),
        };
        
        res.json({
          success: true,
          data: stats,
          timestamp: Date.now(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Setup error handling middleware
   */
  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path,
      });
    });

    // Global error handler
    this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.logger.error('Unhandled error', { 
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
      });
      
      this.metrics.incrementCounter('unhandled_errors');
      
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        requestId: req.headers['x-request-id'],
      });
    });
  }

  /**
   * Handle incoming fee data
   */
  private async handleFeeData(feeData: FeeData): Promise<void> {
    try {
      // Store in Redis for real-time access
      const key = `fee_data:${feeData.symbol}:${feeData.exchange}`;
      await this.redis.setex(key, 300, JSON.stringify(feeData)); // 5 minutes TTL
      
      // Broadcast to WebSocket clients
      this.broadcastToWebSocketClients('fee_data', feeData);
      
      this.metrics.incrementCounter('fee_data_received');
    } catch (error) {
      this.logger.error('Failed to handle fee data', { 
        exchange: feeData.exchange,
        symbol: feeData.symbol,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Handle incoming price data
   */
  private async handlePriceData(priceData: PriceData): Promise<void> {
    try {
      // Store in Redis for real-time access
      const key = `price_data:${priceData.symbol}:${priceData.exchange}`;
      await this.redis.setex(key, 60, JSON.stringify(priceData)); // 1 minute TTL
      
      // Broadcast to WebSocket clients
      this.broadcastToWebSocketClients('price_data', priceData);
      
      this.metrics.incrementCounter('price_data_received');
    } catch (error) {
      this.logger.error('Failed to handle price data', { 
        exchange: priceData.exchange,
        symbol: priceData.symbol,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Broadcast data to WebSocket clients
   */
  private broadcastToWebSocketClients(type: string, data: any): void {
    if (!this.wsServer) return;
    
    const message = JSON.stringify({
      type,
      data,
      timestamp: Date.now(),
    });
    
    this.wsServer.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /**
   * Setup WebSocket server
   */
  private setupWebSocketServer(): void {
    this.wsServer = new WebSocket.Server({ 
      server: this.server,
      path: '/ws',
    });
    
    this.wsServer.on('connection', (ws, req) => {
      this.logger.info('WebSocket client connected', { 
        ip: req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      });
      
      this.metrics.incrementCounter('websocket_connections');
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          this.logger.error('Invalid WebSocket message', { 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      });
      
      ws.on('close', () => {
        this.logger.debug('WebSocket client disconnected');
        this.metrics.incrementCounter('websocket_disconnections');
      });
      
      ws.on('error', (error) => {
        this.logger.error('WebSocket error', { error: error.message });
        this.metrics.incrementCounter('websocket_errors');
      });
      
      // Send welcome message
      ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Connected to QuantLink Data Aggregation Service',
        timestamp: Date.now(),
      }));
    });
    
    this.logger.info('WebSocket server initialized');
  }

  /**
   * Handle WebSocket messages
   */
  private handleWebSocketMessage(ws: WebSocket, message: any): void {
    switch (message.type) {
      case 'subscribe':
        // Handle subscription to specific data streams
        this.logger.debug('WebSocket subscription', { channels: message.channels });
        break;
      case 'unsubscribe':
        // Handle unsubscription
        this.logger.debug('WebSocket unsubscription', { channels: message.channels });
        break;
      case 'ping':
        // Handle ping
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      default:
        this.logger.warn('Unknown WebSocket message type', { type: message.type });
    }
  }

  /**
   * Setup graceful shutdown
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      
      this.isShuttingDown = true;
      this.logger.info('Received shutdown signal, starting graceful shutdown', { signal });
      
      try {
        // Stop accepting new connections
        this.server?.close();
        
        // Stop aggregation engine
        await this.aggregation?.stop();
        
        // Shutdown exchange integrations
        for (const [name, integration] of this.cexIntegrations) {
          await integration.shutdown();
        }
        
        for (const [name, integration] of this.dexIntegrations) {
          await integration.shutdown();
        }
        
        // Close database connections
        await this.database?.disconnect();
        await this.redis?.disconnect();
        
        this.logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        this.logger.error('Error during shutdown', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        process.exit(1);
      }
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // For nodemon
  }

  /**
   * Start the service
   */
  public async start(): Promise<void> {
    try {
      this.logger.info('Starting QuantLink Data Aggregation Service', {
        version: '1.0.0',
        environment: serviceConfig.environment,
        port: serviceConfig.port,
      });
      
      // Initialize exchange integrations
      await this.initializeExchangeIntegrations();
      
      // Start aggregation engine
      await this.aggregation.start();
      
      // Start HTTP server
      this.server = createServer(this.app);
      this.setupWebSocketServer();
      
      this.server.listen(serviceConfig.port, serviceConfig.host, () => {
        this.logger.info('Service started successfully', {
          host: serviceConfig.host,
          port: serviceConfig.port,
          environment: serviceConfig.environment,
        });
      });
      
      // Start metrics server if enabled
      if (serviceConfig.monitoring.enabled) {
        // Initialize Prometheus metrics endpoint
        this.logger.info('Metrics collection enabled', { 
          port: serviceConfig.monitoring.metricsPort 
        });
      }
      
    } catch (error) {
      this.logger.error('Failed to start service', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }
}

// Start the service if this file is run directly
if (require.main === module) {
  const service = new DataAggregationService();
  service.start().catch((error) => {
    console.error('Failed to start service:', error);
    process.exit(1);
  });
}

export default DataAggregationService;
