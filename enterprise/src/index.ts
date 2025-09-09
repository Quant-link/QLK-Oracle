/**
 * @fileoverview Enterprise Integration Suite Main Entry Point
 * @author QuantLink Team
 * @version 1.0.0
 */

import 'reflect-metadata';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import session from 'express-session';
import connectRedis from 'connect-redis';
import passport from 'passport';

import { Logger } from './utils/logger';
import { MetricsCollector } from './monitoring/metrics';
import { DatabaseService } from './database/database-service';
import { RedisService } from './cache/redis-service';

// Core modules
import { APIGateway } from './gateway/api-gateway';
import { AuthManager } from './auth/auth-manager';
import { ReportManager } from './reporting/report-manager';
import { SLAManager } from './sla/sla-manager';
import { AdminDashboard } from './admin/admin-dashboard';

// Configuration
import { EnterpriseConfig } from './types';
import { loadConfig } from './config/config-loader';

export class EnterpriseIntegrationSuite {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private logger: Logger;
  private metrics: MetricsCollector;
  private config: EnterpriseConfig;
  
  // Core services
  private database: DatabaseService;
  private redis: RedisService;
  
  // Feature modules
  private apiGateway: APIGateway;
  private authManager: AuthManager;
  private reportManager: ReportManager;
  private slaManager: SLAManager;
  private adminDashboard: AdminDashboard;

  constructor() {
    this.logger = new Logger('EnterpriseIntegrationSuite');
    this.metrics = new MetricsCollector('enterprise');
    
    this.initializeApplication();
  }

  /**
   * Initialize the enterprise application
   */
  private async initializeApplication(): Promise<void> {
    try {
      // Load configuration
      this.config = await loadConfig();
      
      // Initialize core services
      await this.initializeCoreServices();
      
      // Initialize Express app
      this.initializeExpress();
      
      // Initialize feature modules
      await this.initializeFeatureModules();
      
      // Setup routes
      this.setupRoutes();
      
      // Initialize Socket.IO
      this.initializeSocketIO();
      
      this.logger.info('Enterprise Integration Suite initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Enterprise Integration Suite', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Initialize core services
   */
  private async initializeCoreServices(): Promise<void> {
    this.logger.info('Initializing core services');
    
    // Initialize database
    this.database = new DatabaseService(this.config.database);
    await this.database.connect();
    
    // Initialize Redis
    this.redis = new RedisService(this.config.redis);
    await this.redis.connect();
    
    this.logger.info('Core services initialized');
  }

  /**
   * Initialize Express application
   */
  private initializeExpress(): void {
    this.app = express();
    
    // Trust proxy for proper IP detection
    this.app.set('trust proxy', 1);
    
    // Session configuration
    const RedisStore = connectRedis(session);
    
    this.app.use(session({
      store: new RedisStore({ client: this.redis.getClient() }),
      secret: this.config.auth.session.secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: this.config.server.environment === 'production',
        httpOnly: true,
        maxAge: this.config.auth.session.maxAge,
      },
    }));
    
    // Initialize Passport
    this.app.use(passport.initialize());
    this.app.use(passport.session());
    
    // Request ID middleware
    this.app.use((req: any, res, next) => {
      req.requestId = req.headers['x-request-id'] || this.generateRequestId();
      res.setHeader('X-Request-ID', req.requestId);
      next();
    });
    
    // Metrics middleware
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        this.metrics.recordHttpRequest(
          req.method,
          req.route?.path || req.path,
          res.statusCode,
          duration
        );
      });
      
      next();
    });
  }

  /**
   * Initialize feature modules
   */
  private async initializeFeatureModules(): Promise<void> {
    this.logger.info('Initializing feature modules');
    
    // Initialize API Gateway
    this.apiGateway = new APIGateway(
      {
        rateLimiting: {
          global: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 1000,
            message: 'Too many requests from this IP',
            standardHeaders: true,
            legacyHeaders: false,
          },
          perKey: {
            windowMs: 15 * 60 * 1000,
            max: 10000,
            message: 'API key rate limit exceeded',
            standardHeaders: true,
            legacyHeaders: false,
          },
        },
        caching: {
          ttl: 300, // 5 minutes
          maxSize: 1000,
          strategy: 'LRU',
          compression: true,
        },
        cors: {
          origins: ['*'], // Configure based on environment
          credentials: true,
        },
        proxy: {
          timeout: 30000,
          retries: 3,
        },
        versioning: {
          defaultVersion: 'v1',
          supportedVersions: ['v1', 'v2'],
          deprecationNotices: {
            'v1': 'API v1 will be deprecated on 2024-12-31',
          },
        },
      },
      this.config
    );
    
    // Initialize Authentication Manager
    this.authManager = new AuthManager({
      jwt: this.config.auth,
      oauth2: this.config.auth.oauth2,
      saml: this.config.auth.saml,
      mfa: this.config.auth.mfa,
      session: this.config.auth.session,
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
      },
    });
    
    // Initialize Report Manager
    this.reportManager = new ReportManager({
      kafka: this.config.kafka,
      storage: {
        path: '/tmp/reports',
        maxFileSize: 100 * 1024 * 1024, // 100MB
        retentionDays: 30,
      },
      email: {
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        },
      },
      limits: {
        maxRowsPerExport: 1000000,
        maxConcurrentExports: 10,
        exportTimeoutMs: 300000, // 5 minutes
      },
    });
    
    // Initialize SLA Manager
    this.slaManager = new SLAManager({
      monitoring: {
        intervalMs: 30000, // 30 seconds
        healthCheckTimeoutMs: 5000,
        retryAttempts: 3,
      },
      thresholds: {
        uptimeTarget: 99.9,
        responseTimeTarget: 200,
        errorRateTarget: 0.1,
        availabilityTarget: 99.95,
      },
      alerting: {
        enabled: true,
        channels: ['email', 'slack', 'webhook'],
        escalationDelayMs: 300000, // 5 minutes
      },
      reporting: {
        retentionDays: 365,
        aggregationIntervals: ['1h', '1d', '1w', '1M'],
      },
    });
    
    // Initialize Admin Dashboard
    this.adminDashboard = new AdminDashboard({
      features: this.config.features,
      limits: {
        maxOrganizations: 1000,
        maxUsersPerOrg: 10000,
        maxAPIKeysPerOrg: 100,
      },
      billing: {
        enabled: true,
        currency: 'USD',
        taxRate: 0.08,
      },
    });
    
    this.logger.info('Feature modules initialized');
  }

  /**
   * Setup application routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        environment: this.config.server.environment,
      });
    });
    
    // API Gateway routes
    this.app.use('/', this.apiGateway.getApp());
    
    // Authentication routes
    this.app.use('/auth', this.authManager.router);
    
    // Reporting routes
    this.app.use('/api/v1/reports', 
      this.authManager.requireAuth,
      this.reportManager.router
    );
    
    // SLA management routes
    this.app.use('/api/v1/sla', 
      this.authManager.requireAuth,
      this.authManager.requirePermission('sla', 'read'),
      this.slaManager.router
    );
    
    // Admin dashboard routes
    this.app.use('/api/v1/admin', 
      this.authManager.requireAuth,
      this.authManager.requirePermission('admin', 'read'),
      this.adminDashboard.router
    );
    
    // Metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = await this.metrics.getMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metrics);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to retrieve metrics',
        });
      }
    });
    
    // API documentation
    this.app.use('/docs', express.static('docs'));
    
    // SDK downloads
    this.app.use('/sdks', express.static('sdks'));
  }

  /**
   * Initialize Socket.IO for real-time features
   */
  private initializeSocketIO(): void {
    this.server = createServer(this.app);
    
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: "*", // Configure based on environment
        methods: ["GET", "POST"],
      },
      transports: ['websocket', 'polling'],
    });
    
    // Authentication middleware for Socket.IO
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }
        
        // Verify token and attach user to socket
        const user = await this.verifySocketToken(token);
        socket.data.user = user;
        
        next();
      } catch (error) {
        next(new Error('Authentication failed'));
      }
    });
    
    // Handle connections
    this.io.on('connection', (socket) => {
      this.logger.info('Socket.IO client connected', {
        socketId: socket.id,
        userId: socket.data.user?.id,
      });
      
      this.metrics.incrementCounter('websocket_connections');
      
      // Join organization room
      if (socket.data.user?.organizationId) {
        socket.join(`org:${socket.data.user.organizationId}`);
      }
      
      // Handle real-time data subscriptions
      socket.on('subscribe', (channels) => {
        this.handleSocketSubscription(socket, channels);
      });
      
      socket.on('unsubscribe', (channels) => {
        this.handleSocketUnsubscription(socket, channels);
      });
      
      socket.on('disconnect', () => {
        this.logger.debug('Socket.IO client disconnected', {
          socketId: socket.id,
          userId: socket.data.user?.id,
        });
        
        this.metrics.incrementCounter('websocket_disconnections');
      });
    });
  }

  /**
   * Start the enterprise integration suite
   */
  public async start(): Promise<void> {
    try {
      const port = this.config.server.port;
      const host = this.config.server.host;
      
      this.server.listen(port, host, () => {
        this.logger.info('Enterprise Integration Suite started', {
          port,
          host,
          environment: this.config.server.environment,
          features: Object.keys(this.config.features).filter(
            key => this.config.features[key as keyof typeof this.config.features]
          ),
        });
      });
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
    } catch (error) {
      this.logger.error('Failed to start Enterprise Integration Suite', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Setup graceful shutdown
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      this.logger.info('Received shutdown signal, starting graceful shutdown', { signal });
      
      try {
        // Close server
        if (this.server) {
          this.server.close();
        }
        
        // Close Socket.IO
        if (this.io) {
          this.io.close();
        }
        
        // Close database connections
        await this.database?.disconnect();
        await this.redis?.disconnect();
        
        this.logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        this.logger.error('Error during shutdown', {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      }
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // For nodemon
  }

  // Helper methods
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async verifySocketToken(token: string): Promise<any> {
    // Implementation would verify JWT token and return user
    return { id: 'user123', organizationId: 'org123' };
  }

  private handleSocketSubscription(socket: any, channels: string[]): void {
    for (const channel of channels) {
      socket.join(channel);
      this.logger.debug('Socket subscribed to channel', {
        socketId: socket.id,
        channel,
      });
    }
  }

  private handleSocketUnsubscription(socket: any, channels: string[]): void {
    for (const channel of channels) {
      socket.leave(channel);
      this.logger.debug('Socket unsubscribed from channel', {
        socketId: socket.id,
        channel,
      });
    }
  }

  /**
   * Broadcast message to organization
   */
  public broadcastToOrganization(organizationId: string, event: string, data: any): void {
    this.io.to(`org:${organizationId}`).emit(event, data);
  }

  /**
   * Get Socket.IO instance
   */
  public getSocketIO(): SocketIOServer {
    return this.io;
  }

  /**
   * Get Express app instance
   */
  public getApp(): express.Application {
    return this.app;
  }
}

// Start the application if this file is run directly
if (require.main === module) {
  const suite = new EnterpriseIntegrationSuite();
  suite.start().catch((error) => {
    console.error('Failed to start Enterprise Integration Suite:', error);
    process.exit(1);
  });
}

export default EnterpriseIntegrationSuite;
