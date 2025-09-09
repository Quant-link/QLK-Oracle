/**
 * @fileoverview Enterprise API Gateway with REST and GraphQL support
 * @author QuantLink Team
 * @version 1.0.0
 */

import express, { Request, Response, NextFunction } from 'express';
import { ApolloServer } from 'apollo-server-express';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { Logger } from '../utils/logger';
import { MetricsCollector } from '../monitoring/metrics';
import { CacheManager } from '../cache/cache-manager';
import { APIKeyManager } from './api-key-manager';
import { WebhookManager } from './webhook-manager';
import { VersionManager } from './version-manager';
import { 
  APIKey, 
  RateLimitConfig, 
  CacheConfig, 
  EnterpriseConfig,
  APIResponse 
} from '../types';

export interface APIGatewayConfig {
  rateLimiting: {
    global: RateLimitConfig;
    perKey: RateLimitConfig;
  };
  caching: CacheConfig;
  cors: {
    origins: string[];
    credentials: boolean;
  };
  proxy: {
    timeout: number;
    retries: number;
  };
  versioning: {
    defaultVersion: string;
    supportedVersions: string[];
    deprecationNotices: Record<string, string>;
  };
}

export class APIGateway {
  private app: express.Application;
  private apolloServer: ApolloServer;
  private logger: Logger;
  private metrics: MetricsCollector;
  private cache: CacheManager;
  private apiKeyManager: APIKeyManager;
  private webhookManager: WebhookManager;
  private versionManager: VersionManager;
  private config: APIGatewayConfig;

  constructor(
    config: APIGatewayConfig,
    enterpriseConfig: EnterpriseConfig
  ) {
    this.config = config;
    this.logger = new Logger('APIGateway');
    this.metrics = new MetricsCollector('api_gateway');
    this.cache = new CacheManager(config.caching);
    this.apiKeyManager = new APIKeyManager();
    this.webhookManager = new WebhookManager();
    this.versionManager = new VersionManager(config.versioning);
    
    this.initializeExpress();
    this.initializeGraphQL();
  }

  /**
   * Initialize Express application with middleware
   */
  private initializeExpress(): void {
    this.app = express();

    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: this.config.cors.origins,
      credentials: this.config.cors.credentials,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-API-Version',
        'X-Request-ID',
        'X-Client-Version',
      ],
      exposedHeaders: [
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'X-Response-Time',
      ],
    }));

    // Compression
    this.app.use(compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
    }));

    // Body parsing
    this.app.use(express.json({ 
      limit: '10mb',
      verify: (req: any, res, buf) => {
        req.rawBody = buf;
      },
    }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request ID and timing
    this.app.use(this.requestIdMiddleware);
    this.app.use(this.timingMiddleware);

    // API versioning
    this.app.use(this.versionManager.middleware());

    // Rate limiting
    this.app.use(this.createRateLimitMiddleware());

    // API key authentication
    this.app.use('/api', this.apiKeyAuthMiddleware);

    // Request logging
    this.app.use(this.requestLoggingMiddleware);

    // Cache middleware
    this.app.use(this.cacheMiddleware);

    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Initialize GraphQL server
   */
  private async initializeGraphQL(): Promise<void> {
    const { typeDefs, resolvers } = await import('../graphql/schema');
    
    this.apolloServer = new ApolloServer({
      typeDefs,
      resolvers,
      context: ({ req }) => ({
        user: req.user,
        organization: req.organization,
        apiKey: req.apiKey,
        requestId: req.requestId,
        startTime: req.startTime,
      }),
      plugins: [
        {
          requestDidStart() {
            return {
              willSendResponse(requestContext) {
                const { request, response } = requestContext;
                const duration = Date.now() - requestContext.context.startTime;
                
                // Add performance headers
                response.http?.setHeader('X-Response-Time', `${duration}ms`);
                
                // Log GraphQL operations
                this.logger.info('GraphQL operation completed', {
                  operationName: request.operationName,
                  duration,
                  requestId: requestContext.context.requestId,
                });
              },
            };
          },
        },
      ],
      introspection: process.env.NODE_ENV !== 'production',
      playground: process.env.NODE_ENV !== 'production',
    });

    await this.apolloServer.start();
    this.apolloServer.applyMiddleware({ 
      app: this.app, 
      path: '/graphql',
      cors: false, // Already handled by express cors
    });
  }

  /**
   * Request ID middleware
   */
  private requestIdMiddleware = (req: any, res: Response, next: NextFunction): void => {
    req.requestId = req.headers['x-request-id'] || this.generateRequestId();
    req.startTime = Date.now();
    res.setHeader('X-Request-ID', req.requestId);
    next();
  };

  /**
   * Timing middleware
   */
  private timingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      res.setHeader('X-Response-Time', `${duration}ms`);
      
      this.metrics.recordLatency('request_duration', duration, {
        method: req.method,
        route: req.route?.path || req.path,
        status_code: res.statusCode.toString(),
      });
    });
    
    next();
  };

  /**
   * Create rate limiting middleware
   */
  private createRateLimitMiddleware(): express.RequestHandler[] {
    const globalRateLimit = rateLimit({
      ...this.config.rateLimiting.global,
      keyGenerator: (req) => {
        return req.ip || 'unknown';
      },
      onLimitReached: (req, res) => {
        this.logger.warn('Global rate limit exceeded', {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        });
        this.metrics.incrementCounter('rate_limit_exceeded', { type: 'global' });
      },
    });

    const apiKeyRateLimit = rateLimit({
      ...this.config.rateLimiting.perKey,
      keyGenerator: (req: any) => {
        return req.apiKey?.id || req.ip || 'unknown';
      },
      skip: (req: any) => !req.apiKey,
      onLimitReached: (req: any, res) => {
        this.logger.warn('API key rate limit exceeded', {
          apiKeyId: req.apiKey?.id,
          clientId: req.apiKey?.clientId,
        });
        this.metrics.incrementCounter('rate_limit_exceeded', { type: 'api_key' });
      },
    });

    const speedLimiter = slowDown({
      windowMs: 15 * 60 * 1000, // 15 minutes
      delayAfter: 100, // Allow 100 requests per windowMs without delay
      delayMs: 500, // Add 500ms delay per request after delayAfter
      maxDelayMs: 20000, // Maximum delay of 20 seconds
    });

    return [globalRateLimit, apiKeyRateLimit, speedLimiter];
  }

  /**
   * API key authentication middleware
   */
  private apiKeyAuthMiddleware = async (req: any, res: Response, next: NextFunction): Promise<void> => {
    try {
      const apiKey = req.headers['x-api-key'] as string;
      const apiSecret = req.headers['x-api-secret'] as string;

      if (!apiKey) {
        return this.sendError(res, 401, 'API_KEY_REQUIRED', 'API key is required');
      }

      const keyData = await this.apiKeyManager.validateKey(apiKey, apiSecret);
      
      if (!keyData) {
        return this.sendError(res, 401, 'INVALID_API_KEY', 'Invalid API key or secret');
      }

      if (!keyData.isActive) {
        return this.sendError(res, 401, 'API_KEY_INACTIVE', 'API key is inactive');
      }

      if (keyData.expiresAt && keyData.expiresAt < new Date()) {
        return this.sendError(res, 401, 'API_KEY_EXPIRED', 'API key has expired');
      }

      // Check IP whitelist
      if (keyData.ipWhitelist && keyData.ipWhitelist.length > 0) {
        const clientIP = req.ip || req.connection.remoteAddress;
        if (!keyData.ipWhitelist.includes(clientIP)) {
          return this.sendError(res, 403, 'IP_NOT_WHITELISTED', 'IP address not whitelisted');
        }
      }

      // Check quotas
      const quotaCheck = await this.apiKeyManager.checkQuotas(keyData.id);
      if (!quotaCheck.allowed) {
        return this.sendError(res, 429, 'QUOTA_EXCEEDED', quotaCheck.message);
      }

      req.apiKey = keyData;
      req.organization = await this.getOrganizationByClientId(keyData.clientId);

      // Update last used timestamp
      await this.apiKeyManager.updateLastUsed(keyData.id);

      next();
    } catch (error) {
      this.logger.error('API key authentication error', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return this.sendError(res, 500, 'AUTH_ERROR', 'Authentication error');
    }
  };

  /**
   * Request logging middleware
   */
  private requestLoggingMiddleware = (req: any, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      
      this.logger.info('API request completed', {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        requestId: req.requestId,
        apiKeyId: req.apiKey?.id,
        clientId: req.apiKey?.clientId,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        contentLength: res.get('Content-Length'),
      });

      // Record metrics
      this.metrics.incrementCounter('api_requests_total', {
        method: req.method,
        status_code: res.statusCode.toString(),
        endpoint: req.route?.path || 'unknown',
      });

      this.metrics.recordLatency('api_request_duration', duration, {
        method: req.method,
        endpoint: req.route?.path || 'unknown',
      });
    });

    next();
  };

  /**
   * Cache middleware
   */
  private cacheMiddleware = async (req: any, res: Response, next: NextFunction): Promise<void> => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip caching for certain endpoints
    if (req.path.includes('/health') || req.path.includes('/metrics')) {
      return next();
    }

    try {
      const cacheKey = this.generateCacheKey(req);
      const cachedResponse = await this.cache.get(cacheKey);

      if (cachedResponse) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Key', cacheKey);
        this.metrics.incrementCounter('cache_hits');
        return res.json(cachedResponse);
      }

      // Store original json method
      const originalJson = res.json;
      
      res.json = function(data: any) {
        // Cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          this.cache.set(cacheKey, data).catch((error) => {
            this.logger.error('Cache set error', { error: error.message });
          });
        }
        
        res.setHeader('X-Cache', 'MISS');
        res.setHeader('X-Cache-Key', cacheKey);
        this.metrics.incrementCounter('cache_misses');
        
        return originalJson.call(this, data);
      }.bind(this);

      next();
    } catch (error) {
      this.logger.error('Cache middleware error', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      next();
    }
  };

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
      });
    });

    // API documentation
    this.app.use('/docs', express.static('docs'));

    // Webhook endpoints
    this.app.use('/webhooks', this.webhookManager.router);

    // Proxy to data aggregation service
    this.app.use('/api/v1/data', createProxyMiddleware({
      target: process.env.DATA_SERVICE_URL || 'http://localhost:3001',
      changeOrigin: true,
      timeout: this.config.proxy.timeout,
      retries: this.config.proxy.retries,
      onError: (err, req, res) => {
        this.logger.error('Proxy error', { error: err.message });
        this.sendError(res as Response, 502, 'PROXY_ERROR', 'Service temporarily unavailable');
      },
      onProxyReq: (proxyReq, req: any) => {
        // Add authentication headers for internal service
        proxyReq.setHeader('X-Internal-Request', 'true');
        proxyReq.setHeader('X-Request-ID', req.requestId);
        proxyReq.setHeader('X-Client-ID', req.apiKey?.clientId || 'unknown');
      },
    }));

    // API key management endpoints
    this.app.use('/api/v1/keys', this.apiKeyManager.router);

    // Metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = await this.metrics.getMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metrics);
      } catch (error) {
        this.sendError(res, 500, 'METRICS_ERROR', 'Failed to retrieve metrics');
      }
    });
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req, res) => {
      this.sendError(res, 404, 'NOT_FOUND', 'Endpoint not found');
    });

    // Global error handler
    this.app.use((error: Error, req: any, res: Response, next: NextFunction) => {
      this.logger.error('Unhandled error', {
        error: error.message,
        stack: error.stack,
        requestId: req.requestId,
        url: req.url,
        method: req.method,
      });

      this.metrics.incrementCounter('unhandled_errors');
      this.sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    });
  }

  /**
   * Send standardized error response
   */
  private sendError(res: Response, statusCode: number, code: string, message: string): void {
    const response: APIResponse = {
      success: false,
      error: {
        code,
        message,
      },
      metadata: {
        requestId: res.get('X-Request-ID') || 'unknown',
        timestamp: new Date(),
      },
    };

    res.status(statusCode).json(response);
  }

  /**
   * Generate request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(req: any): string {
    const parts = [
      req.method,
      req.path,
      JSON.stringify(req.query),
      req.apiKey?.id || 'anonymous',
    ];
    
    return `api:${Buffer.from(parts.join('|')).toString('base64')}`;
  }

  /**
   * Get organization by client ID
   */
  private async getOrganizationByClientId(clientId: string): Promise<any> {
    // Implementation would fetch from database
    return { id: clientId, name: 'Example Organization' };
  }

  /**
   * Get Express app instance
   */
  public getApp(): express.Application {
    return this.app;
  }

  /**
   * Start the API gateway
   */
  public async start(port: number, host: string = '0.0.0.0'): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.app.listen(port, host, () => {
          this.logger.info('API Gateway started', { port, host });
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}
