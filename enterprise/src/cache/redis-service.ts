/**
 * @fileoverview Redis Cache Service
 * @author QuantLink Team
 * @version 1.0.0
 */

import Redis from 'ioredis';
import { Logger } from '../utils/logger';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
}

export class RedisService {
  private client: Redis;
  private logger: Logger;
  private config: RedisConfig;

  constructor(config?: RedisConfig) {
    this.config = config || this.getDefaultConfig();
    this.logger = new Logger('RedisService');
    this.initializeClient();
  }

  private getDefaultConfig(): RedisConfig {
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      keyPrefix: process.env.REDIS_PREFIX || 'quantlink:',
    };
  }

  private initializeClient(): void {
    this.client = new Redis({
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db,
      keyPrefix: this.config.keyPrefix,
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      this.logger.info('Redis connected');
    });

    this.client.on('error', (error) => {
      this.logger.error('Redis error', {
        error: error.message,
        stack: error.stack,
      });
    });

    this.client.on('close', () => {
      this.logger.warn('Redis connection closed');
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.info('Redis connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to Redis', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
      this.logger.info('Redis disconnected');
    } catch (error) {
      this.logger.error('Error disconnecting from Redis', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.error('Redis GET error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      this.logger.error('Redis SET error', {
        key,
        ttl,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async setex(key: string, ttl: number, value: string): Promise<void> {
    return this.set(key, value, ttl);
  }

  async del(key: string): Promise<number> {
    try {
      return await this.client.del(key);
    } catch (error) {
      this.logger.error('Redis DEL error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error('Redis EXISTS error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      this.logger.error('Redis INCR error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async incrby(key: string, increment: number): Promise<number> {
    try {
      return await this.client.incrby(key, increment);
    } catch (error) {
      this.logger.error('Redis INCRBY error', {
        key,
        increment,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    try {
      const result = await this.client.expire(key, ttl);
      return result === 1;
    } catch (error) {
      this.logger.error('Redis EXPIRE error', {
        key,
        ttl,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async hget(key: string, field: string): Promise<string | null> {
    try {
      return await this.client.hget(key, field);
    } catch (error) {
      this.logger.error('Redis HGET error', {
        key,
        field,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    try {
      return await this.client.hset(key, field, value);
    } catch (error) {
      this.logger.error('Redis HSET error', {
        key,
        field,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      return await this.client.hgetall(key);
    } catch (error) {
      this.logger.error('Redis HGETALL error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async hdel(key: string, field: string): Promise<number> {
    try {
      return await this.client.hdel(key, field);
    } catch (error) {
      this.logger.error('Redis HDEL error', {
        key,
        field,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    try {
      return await this.client.lpush(key, ...values);
    } catch (error) {
      this.logger.error('Redis LPUSH error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    try {
      return await this.client.rpush(key, ...values);
    } catch (error) {
      this.logger.error('Redis RPUSH error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async lpop(key: string): Promise<string | null> {
    try {
      return await this.client.lpop(key);
    } catch (error) {
      this.logger.error('Redis LPOP error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async rpop(key: string): Promise<string | null> {
    try {
      return await this.client.rpop(key);
    } catch (error) {
      this.logger.error('Redis RPOP error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.client.lrange(key, start, stop);
    } catch (error) {
      this.logger.error('Redis LRANGE error', {
        key,
        start,
        stop,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async llen(key: string): Promise<number> {
    try {
      return await this.client.llen(key);
    } catch (error) {
      this.logger.error('Redis LLEN error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    try {
      return await this.client.sadd(key, ...members);
    } catch (error) {
      this.logger.error('Redis SADD error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    try {
      return await this.client.srem(key, ...members);
    } catch (error) {
      this.logger.error('Redis SREM error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      return await this.client.smembers(key);
    } catch (error) {
      this.logger.error('Redis SMEMBERS error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async sismember(key: string, member: string): Promise<boolean> {
    try {
      const result = await this.client.sismember(key, member);
      return result === 1;
    } catch (error) {
      this.logger.error('Redis SISMEMBER error', {
        key,
        member,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      this.logger.error('Redis KEYS error', {
        pattern,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async flushdb(): Promise<void> {
    try {
      await this.client.flushdb();
    } catch (error) {
      this.logger.error('Redis FLUSHDB error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async ping(): Promise<string> {
    try {
      return await this.client.ping();
    } catch (error) {
      this.logger.error('Redis PING error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getInfo(): Promise<string> {
    try {
      return await this.client.info();
    } catch (error) {
      this.logger.error('Redis INFO error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  getClient(): Redis {
    return this.client;
  }

  // Rate limiting helpers
  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    const rateLimitKey = `rate_limit:${key}:${window}`;

    try {
      const current = await this.incr(rateLimitKey);
      
      if (current === 1) {
        await this.expire(rateLimitKey, Math.ceil(windowMs / 1000));
      }

      const remaining = Math.max(0, limit - current);
      const resetTime = (window + 1) * windowMs;

      return {
        allowed: current <= limit,
        remaining,
        resetTime,
      };
    } catch (error) {
      this.logger.error('Rate limit check error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fail open - allow the request if Redis is down
      return {
        allowed: true,
        remaining: limit,
        resetTime: now + windowMs,
      };
    }
  }

  // Session helpers
  async getSession(sessionId: string): Promise<any> {
    try {
      const sessionData = await this.get(`session:${sessionId}`);
      return sessionData ? JSON.parse(sessionData) : null;
    } catch (error) {
      this.logger.error('Get session error', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async setSession(sessionId: string, data: any, ttl: number = 3600): Promise<void> {
    try {
      await this.setex(`session:${sessionId}`, ttl, JSON.stringify(data));
    } catch (error) {
      this.logger.error('Set session error', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.del(`session:${sessionId}`);
    } catch (error) {
      this.logger.error('Delete session error', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
