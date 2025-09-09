/**
 * @fileoverview Database service for persistent data storage with time-series optimization
 * @author QuantLink Team
 * @version 1.0.0
 */

import { Pool, PoolClient } from 'pg';
import { DatabaseConfig, AggregatedData, HealthCheckResult } from '@/types';
import { Logger } from '@/utils/logger';
import { MetricsCollector } from '@/monitoring/metrics';

export class DatabaseService {
  private pool: Pool;
  private logger: Logger;
  private metrics: MetricsCollector;
  private config: DatabaseConfig;
  private isConnected: boolean = false;

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.logger = new Logger('DatabaseService');
    this.metrics = new MetricsCollector('database');
    
    this.initializePool();
  }

  /**
   * Initialize connection pool
   */
  private initializePool(): void {
    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      ssl: this.config.ssl,
      max: this.config.poolSize,
      connectionTimeoutMillis: this.config.connectionTimeout,
      query_timeout: this.config.queryTimeout,
      idleTimeoutMillis: 30000,
      allowExitOnIdle: false,
    });

    this.setupEventHandlers();
  }

  /**
   * Setup pool event handlers
   */
  private setupEventHandlers(): void {
    this.pool.on('connect', (client) => {
      this.logger.debug('Database client connected');
      this.metrics.incrementCounter('db_connections');
    });

    this.pool.on('acquire', (client) => {
      this.metrics.incrementCounter('db_acquisitions');
    });

    this.pool.on('error', (error, client) => {
      this.logger.error('Database pool error', { error: error.message });
      this.metrics.incrementCounter('db_errors');
    });

    this.pool.on('remove', (client) => {
      this.logger.debug('Database client removed');
      this.metrics.incrementCounter('db_removals');
    });
  }

  /**
   * Connect and initialize database schema
   */
  public async connect(): Promise<void> {
    try {
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      // Initialize schema
      await this.initializeSchema();
      
      this.isConnected = true;
      this.logger.info('Database service connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Disconnect from database
   */
  public async disconnect(): Promise<void> {
    try {
      await this.pool.end();
      this.isConnected = false;
      this.logger.info('Database service disconnected');
    } catch (error) {
      this.logger.error('Error disconnecting from database', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Initialize database schema
   */
  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Create aggregated_data table with time-series optimization
      await client.query(`
        CREATE TABLE IF NOT EXISTS aggregated_data (
          id BIGSERIAL PRIMARY KEY,
          symbol VARCHAR(20) NOT NULL,
          cex_fees DECIMAL[] NOT NULL,
          dex_fees DECIMAL[] NOT NULL,
          weighted_median_cex_fee DECIMAL NOT NULL,
          weighted_median_dex_fee DECIMAL NOT NULL,
          confidence DECIMAL NOT NULL,
          timestamp BIGINT NOT NULL,
          sources TEXT[] NOT NULL,
          outliers TEXT[] NOT NULL,
          data_quality JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Create indexes for time-series queries
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_aggregated_data_symbol_timestamp 
        ON aggregated_data (symbol, timestamp DESC)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_aggregated_data_timestamp 
        ON aggregated_data (timestamp DESC)
      `);
      
      // Create fee_data table for raw data storage
      await client.query(`
        CREATE TABLE IF NOT EXISTS fee_data (
          id BIGSERIAL PRIMARY KEY,
          exchange VARCHAR(50) NOT NULL,
          type VARCHAR(10) NOT NULL CHECK (type IN ('CEX', 'DEX')),
          symbol VARCHAR(20) NOT NULL,
          maker_fee DECIMAL NOT NULL,
          taker_fee DECIMAL NOT NULL,
          timestamp BIGINT NOT NULL,
          volume_24h DECIMAL,
          confidence DECIMAL NOT NULL,
          source VARCHAR(100) NOT NULL,
          metadata JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Create indexes for fee_data
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_fee_data_exchange_symbol_timestamp 
        ON fee_data (exchange, symbol, timestamp DESC)
      `);
      
      // Create price_data table
      await client.query(`
        CREATE TABLE IF NOT EXISTS price_data (
          id BIGSERIAL PRIMARY KEY,
          exchange VARCHAR(50) NOT NULL,
          symbol VARCHAR(20) NOT NULL,
          price DECIMAL NOT NULL,
          timestamp BIGINT NOT NULL,
          volume DECIMAL NOT NULL,
          bid DECIMAL,
          ask DECIMAL,
          spread DECIMAL,
          confidence DECIMAL NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Create health_checks table
      await client.query(`
        CREATE TABLE IF NOT EXISTS health_checks (
          id BIGSERIAL PRIMARY KEY,
          service VARCHAR(100) NOT NULL,
          status VARCHAR(20) NOT NULL,
          latency INTEGER NOT NULL,
          timestamp BIGINT NOT NULL,
          error TEXT,
          details JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Create partitioning for time-series data (monthly partitions)
      await this.createPartitions(client);
      
      await client.query('COMMIT');
      
      this.logger.info('Database schema initialized successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to initialize database schema', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create monthly partitions for time-series data
   */
  private async createPartitions(client: PoolClient): Promise<void> {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;
    
    // Create partitions for current and next 3 months
    for (let i = 0; i < 4; i++) {
      const date = new Date(currentYear, currentMonth - 1 + i, 1);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      
      const partitionName = `aggregated_data_${year}_${month.toString().padStart(2, '0')}`;
      const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
      const endDate = `${nextYear}-${nextMonth.toString().padStart(2, '0')}-01`;
      
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${partitionName} 
          PARTITION OF aggregated_data 
          FOR VALUES FROM ('${startDate}') TO ('${endDate}')
        `);
      } catch (error) {
        // Partition might already exist, continue
        this.logger.debug('Partition creation skipped', { partition: partitionName });
      }
    }
  }

  /**
   * Store aggregated data
   */
  public async storeAggregatedData(data: AggregatedData): Promise<void> {
    const startTime = Date.now();
    
    try {
      const query = `
        INSERT INTO aggregated_data (
          symbol, cex_fees, dex_fees, weighted_median_cex_fee, 
          weighted_median_dex_fee, confidence, timestamp, 
          sources, outliers, data_quality
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `;
      
      const values = [
        data.symbol,
        data.cexFees,
        data.dexFees,
        data.weightedMedianCexFee,
        data.weightedMedianDexFee,
        data.confidence,
        data.timestamp,
        data.sources,
        data.outliers,
        JSON.stringify(data.dataQuality),
      ];
      
      await this.pool.query(query, values);
      
      const duration = Date.now() - startTime;
      this.metrics.recordLatency('db_insert_duration', duration);
      this.metrics.incrementCounter('db_inserts');
      
      this.logger.debug('Aggregated data stored successfully', { 
        symbol: data.symbol,
        timestamp: data.timestamp 
      });
    } catch (error) {
      this.metrics.incrementCounter('db_insert_errors');
      this.logger.error('Failed to store aggregated data', { 
        symbol: data.symbol,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Get historical aggregated data
   */
  public async getHistoricalAggregatedData(
    symbol: string, 
    fromTimestamp: number, 
    toTimestamp: number
  ): Promise<AggregatedData[]> {
    const startTime = Date.now();
    
    try {
      const query = `
        SELECT 
          symbol, cex_fees, dex_fees, weighted_median_cex_fee,
          weighted_median_dex_fee, confidence, timestamp,
          sources, outliers, data_quality
        FROM aggregated_data 
        WHERE symbol = $1 
          AND timestamp >= $2 
          AND timestamp <= $3
        ORDER BY timestamp DESC
        LIMIT 1000
      `;
      
      const result = await this.pool.query(query, [symbol, fromTimestamp, toTimestamp]);
      
      const duration = Date.now() - startTime;
      this.metrics.recordLatency('db_select_duration', duration);
      this.metrics.incrementCounter('db_selects');
      
      return result.rows.map(row => ({
        symbol: row.symbol,
        cexFees: row.cex_fees,
        dexFees: row.dex_fees,
        weightedMedianCexFee: parseFloat(row.weighted_median_cex_fee),
        weightedMedianDexFee: parseFloat(row.weighted_median_dex_fee),
        confidence: parseFloat(row.confidence),
        timestamp: parseInt(row.timestamp),
        sources: row.sources,
        outliers: row.outliers,
        dataQuality: row.data_quality,
      }));
    } catch (error) {
      this.metrics.incrementCounter('db_select_errors');
      this.logger.error('Failed to get historical aggregated data', { 
        symbol,
        fromTimestamp,
        toTimestamp,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Store health check result
   */
  public async storeHealthCheck(healthCheck: HealthCheckResult): Promise<void> {
    try {
      const query = `
        INSERT INTO health_checks (service, status, latency, timestamp, error, details)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;
      
      const values = [
        healthCheck.service,
        healthCheck.status,
        healthCheck.latency,
        healthCheck.timestamp,
        healthCheck.error || null,
        healthCheck.details ? JSON.stringify(healthCheck.details) : null,
      ];
      
      await this.pool.query(query, values);
      this.metrics.incrementCounter('health_checks_stored');
    } catch (error) {
      this.logger.error('Failed to store health check', { 
        service: healthCheck.service,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Clean up old data based on retention policy
   */
  public async cleanupOldData(retentionDays: number = 30): Promise<void> {
    const cutoffTimestamp = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    
    try {
      // Clean up old aggregated data
      const aggregatedResult = await this.pool.query(
        'DELETE FROM aggregated_data WHERE timestamp < $1',
        [cutoffTimestamp]
      );
      
      // Clean up old fee data
      const feeResult = await this.pool.query(
        'DELETE FROM fee_data WHERE timestamp < $1',
        [cutoffTimestamp]
      );
      
      // Clean up old price data
      const priceResult = await this.pool.query(
        'DELETE FROM price_data WHERE timestamp < $1',
        [cutoffTimestamp]
      );
      
      // Clean up old health checks
      const healthResult = await this.pool.query(
        'DELETE FROM health_checks WHERE timestamp < $1',
        [cutoffTimestamp]
      );
      
      this.logger.info('Data cleanup completed', {
        retentionDays,
        deletedRows: {
          aggregated: aggregatedResult.rowCount,
          fee: feeResult.rowCount,
          price: priceResult.rowCount,
          health: healthResult.rowCount,
        },
      });
      
      this.metrics.incrementCounter('data_cleanup_runs');
    } catch (error) {
      this.logger.error('Failed to cleanup old data', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  public async getStatistics(): Promise<{
    tableStats: Array<{
      tableName: string;
      rowCount: number;
      sizeBytes: number;
    }>;
    connectionStats: {
      total: number;
      active: number;
      idle: number;
    };
  }> {
    try {
      // Get table statistics
      const tableStatsQuery = `
        SELECT 
          schemaname,
          tablename,
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes,
          n_live_tup as live_rows,
          pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
        FROM pg_stat_user_tables 
        WHERE schemaname = 'public'
      `;
      
      const tableResult = await this.pool.query(tableStatsQuery);
      
      // Get connection statistics
      const connectionStatsQuery = `
        SELECT 
          count(*) as total,
          count(*) FILTER (WHERE state = 'active') as active,
          count(*) FILTER (WHERE state = 'idle') as idle
        FROM pg_stat_activity 
        WHERE datname = current_database()
      `;
      
      const connectionResult = await this.pool.query(connectionStatsQuery);
      
      return {
        tableStats: tableResult.rows.map(row => ({
          tableName: row.tablename,
          rowCount: parseInt(row.live_rows),
          sizeBytes: parseInt(row.size_bytes),
        })),
        connectionStats: {
          total: parseInt(connectionResult.rows[0].total),
          active: parseInt(connectionResult.rows[0].active),
          idle: parseInt(connectionResult.rows[0].idle),
        },
      };
    } catch (error) {
      this.logger.error('Failed to get database statistics', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const result = await this.pool.query('SELECT NOW() as current_time, version() as version');
      const latency = Date.now() - startTime;
      
      return {
        service: 'database',
        status: 'healthy',
        latency,
        timestamp: Date.now(),
        details: {
          version: result.rows[0].version,
          currentTime: result.rows[0].current_time,
          poolSize: this.pool.totalCount,
          idleConnections: this.pool.idleCount,
          waitingClients: this.pool.waitingCount,
        },
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      return {
        service: 'database',
        status: 'unhealthy',
        latency,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute raw query (for advanced operations)
   */
  public async query(text: string, params?: any[]): Promise<any> {
    const startTime = Date.now();
    
    try {
      const result = await this.pool.query(text, params);
      
      const duration = Date.now() - startTime;
      this.metrics.recordLatency('db_query_duration', duration);
      this.metrics.incrementCounter('db_queries');
      
      return result;
    } catch (error) {
      this.metrics.incrementCounter('db_query_errors');
      this.logger.error('Database query failed', { 
        query: text.substring(0, 100),
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Check if connected
   */
  public isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Get pool instance (for advanced operations)
   */
  public getPool(): Pool {
    return this.pool;
  }
}
