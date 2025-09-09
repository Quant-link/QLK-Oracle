/**
 * @fileoverview Redis service for caching and real-time data storage
 * @author QuantLink Team
 * @version 1.0.0
 */

import Redis from 'ioredis';
import { RedisConfig } from '@/types';
import { Logger } from '@/utils/logger';
import { MetricsCollector } from '@/monitoring/metrics';

export class RedisService {
  private client: Redis;
  private logger: Logger;
  private metrics: MetricsCollector;
  private config: RedisConfig;
  private isConnected: boolean = false;

  constructor(config: RedisConfig) {
    this.config = config;
    this.logger = new Logger('RedisService');
    this.metrics = new MetricsCollector('redis');
    
    this.initializeClient();
  }

  /**
   * Initialize Redis client with connection handling
   */
  private initializeClient(): void {
    this.client = new Redis({
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db,
      keyPrefix: this.config.keyPrefix,
      maxRetriesPerRequest: this.config.maxRetries,
      retryDelayOnFailover: this.config.retryDelayOnFailover,
      enableReadyCheck: true,
      lazyConnect: true,
      keepAlive: 30000,
      connectTimeout: 10000,
      commandTimeout: 5000,
    });

    this.setupEventHandlers();
  }

  /**
   * Setup Redis event handlers
   */
  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      this.logger.info('Redis connection established');
      this.isConnected = true;
      this.metrics.incrementCounter('redis_connections');
    });

    this.client.on('ready', () => {
      this.logger.info('Redis client ready');
      this.metrics.incrementCounter('redis_ready');
    });

    this.client.on('error', (error) => {
      this.logger.error('Redis error', { error: error.message });
      this.isConnected = false;
      this.metrics.incrementCounter('redis_errors');
    });

    this.client.on('close', () => {
      this.logger.warn('Redis connection closed');
      this.isConnected = false;
      this.metrics.incrementCounter('redis_disconnections');
    });

    this.client.on('reconnecting', () => {
      this.logger.info('Redis reconnecting');
      this.metrics.incrementCounter('redis_reconnections');
    });
  }

  /**
   * Connect to Redis
   */
  public async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.info('Redis service connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to Redis', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  public async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
      this.logger.info('Redis service disconnected');
    } catch (error) {
      this.logger.error('Error disconnecting from Redis', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Set a key-value pair with optional TTL
   */
  public async set(key: string, value: string, ttl?: number): Promise<void> {
    const startTime = Date.now();
    
    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
      
      const duration = Date.now() - startTime;
      this.metrics.recordLatency('redis_set_duration', duration);
      this.metrics.incrementCounter('redis_sets');
    } catch (error) {
      this.metrics.incrementCounter('redis_set_errors');
      this.logger.error('Redis SET operation failed', { 
        key, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Set a key-value pair with TTL in seconds
   */
  public async setex(key: string, ttl: number, value: string): Promise<void> {
    return this.set(key, value, ttl);
  }

  /**
   * Get a value by key
   */
  public async get(key: string): Promise<string | null> {
    const startTime = Date.now();
    
    try {
      const value = await this.client.get(key);
      
      const duration = Date.now() - startTime;
      this.metrics.recordLatency('redis_get_duration', duration);
      this.metrics.incrementCounter('redis_gets');
      
      if (value !== null) {
        this.metrics.incrementCounter('redis_cache_hits');
      } else {
        this.metrics.incrementCounter('redis_cache_misses');
      }
      
      return value;
    } catch (error) {
      this.metrics.incrementCounter('redis_get_errors');
      this.logger.error('Redis GET operation failed', { 
        key, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Delete a key
   */
  public async del(key: string): Promise<number> {
    const startTime = Date.now();
    
    try {
      const result = await this.client.del(key);
      
      const duration = Date.now() - startTime;
      this.metrics.recordLatency('redis_del_duration', duration);
      this.metrics.incrementCounter('redis_dels');
      
      return result;
    } catch (error) {
      this.metrics.incrementCounter('redis_del_errors');
      this.logger.error('Redis DEL operation failed', { 
        key, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Check if a key exists
   */
  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      this.metrics.incrementCounter('redis_exists');
      return result === 1;
    } catch (error) {
      this.metrics.incrementCounter('redis_exists_errors');
      this.logger.error('Redis EXISTS operation failed', { 
        key, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Set TTL for a key
   */
  public async expire(key: string, ttl: number): Promise<boolean> {
    try {
      const result = await this.client.expire(key, ttl);
      this.metrics.incrementCounter('redis_expires');
      return result === 1;
    } catch (error) {
      this.metrics.incrementCounter('redis_expire_errors');
      this.logger.error('Redis EXPIRE operation failed', { 
        key, 
        ttl,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Get keys matching a pattern
   */
  public async keys(pattern: string): Promise<string[]> {
    try {
      const keys = await this.client.keys(pattern);
      this.metrics.incrementCounter('redis_keys');
      this.metrics.recordGauge('redis_keys_found', keys.length);
      return keys;
    } catch (error) {
      this.metrics.incrementCounter('redis_keys_errors');
      this.logger.error('Redis KEYS operation failed', { 
        pattern, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Add to a hash
   */
  public async hset(key: string, field: string, value: string): Promise<number> {
    try {
      const result = await this.client.hset(key, field, value);
      this.metrics.incrementCounter('redis_hsets');
      return result;
    } catch (error) {
      this.metrics.incrementCounter('redis_hset_errors');
      this.logger.error('Redis HSET operation failed', { 
        key, 
        field,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Get from a hash
   */
  public async hget(key: string, field: string): Promise<string | null> {
    try {
      const value = await this.client.hget(key, field);
      this.metrics.incrementCounter('redis_hgets');
      return value;
    } catch (error) {
      this.metrics.incrementCounter('redis_hget_errors');
      this.logger.error('Redis HGET operation failed', { 
        key, 
        field,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Get all fields and values from a hash
   */
  public async hgetall(key: string): Promise<Record<string, string>> {
    try {
      const result = await this.client.hgetall(key);
      this.metrics.incrementCounter('redis_hgetalls');
      return result;
    } catch (error) {
      this.metrics.incrementCounter('redis_hgetall_errors');
      this.logger.error('Redis HGETALL operation failed', { 
        key,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Add to a list (left push)
   */
  public async lpush(key: string, ...values: string[]): Promise<number> {
    try {
      const result = await this.client.lpush(key, ...values);
      this.metrics.incrementCounter('redis_lpushes');
      return result;
    } catch (error) {
      this.metrics.incrementCounter('redis_lpush_errors');
      this.logger.error('Redis LPUSH operation failed', { 
        key,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Get range from a list
   */
  public async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      const result = await this.client.lrange(key, start, stop);
      this.metrics.incrementCounter('redis_lranges');
      return result;
    } catch (error) {
      this.metrics.incrementCounter('redis_lrange_errors');
      this.logger.error('Redis LRANGE operation failed', { 
        key,
        start,
        stop,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Publish a message to a channel
   */
  public async publish(channel: string, message: string): Promise<number> {
    try {
      const result = await this.client.publish(channel, message);
      this.metrics.incrementCounter('redis_publishes');
      return result;
    } catch (error) {
      this.metrics.incrementCounter('redis_publish_errors');
      this.logger.error('Redis PUBLISH operation failed', { 
        channel,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Subscribe to channels
   */
  public async subscribe(channels: string[], callback: (channel: string, message: string) => void): Promise<void> {
    try {
      const subscriber = this.client.duplicate();
      
      subscriber.on('message', (channel, message) => {
        this.metrics.incrementCounter('redis_messages_received');
        callback(channel, message);
      });
      
      await subscriber.subscribe(...channels);
      this.metrics.incrementCounter('redis_subscriptions');
      
      this.logger.info('Subscribed to Redis channels', { channels });
    } catch (error) {
      this.metrics.incrementCounter('redis_subscribe_errors');
      this.logger.error('Redis SUBSCRIBE operation failed', { 
        channels,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Execute a pipeline of commands
   */
  public async pipeline(commands: Array<[string, ...any[]]>): Promise<any[]> {
    try {
      const pipeline = this.client.pipeline();
      
      for (const [command, ...args] of commands) {
        (pipeline as any)[command](...args);
      }
      
      const results = await pipeline.exec();
      this.metrics.incrementCounter('redis_pipelines');
      this.metrics.recordGauge('redis_pipeline_commands', commands.length);
      
      return results || [];
    } catch (error) {
      this.metrics.incrementCounter('redis_pipeline_errors');
      this.logger.error('Redis pipeline operation failed', { 
        commandCount: commands.length,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    latency: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      await this.client.ping();
      const latency = Date.now() - startTime;
      
      return {
        status: 'healthy',
        latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      return {
        status: 'unhealthy',
        latency,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get Redis info
   */
  public async getInfo(): Promise<string> {
    try {
      return await this.client.info();
    } catch (error) {
      this.logger.error('Failed to get Redis info', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Check if connected
   */
  public isReady(): boolean {
    return this.isConnected && this.client.status === 'ready';
  }

  /**
   * Get client instance (for advanced operations)
   */
  public getClient(): Redis {
    return this.client;
  }
}
