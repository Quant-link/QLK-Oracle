/**
 * @fileoverview API Key Management with quotas and rotation
 * @author QuantLink Team
 * @version 1.0.0
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

import { Logger } from '../utils/logger';
import { MetricsCollector } from '../monitoring/metrics';
import { DatabaseService } from '../database/database-service';
import { RedisService } from '../cache/redis-service';
import { APIKey, APIQuota } from '../types';

export interface QuotaUsage {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  requestsPerMonth: number;
  dataTransferMB: number;
  concurrentConnections: number;
  lastReset: Date;
}

export interface QuotaCheckResult {
  allowed: boolean;
  message?: string;
  remaining: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
    requestsPerMonth: number;
  };
}

export class APIKeyManager {
  public router: Router;
  private logger: Logger;
  private metrics: MetricsCollector;
  private database: DatabaseService;
  private redis: RedisService;

  constructor() {
    this.router = Router();
    this.logger = new Logger('APIKeyManager');
    this.metrics = new MetricsCollector('api_keys');
    this.database = new DatabaseService();
    this.redis = new RedisService();
    
    this.setupRoutes();
  }

  /**
   * Setup API key management routes
   */
  private setupRoutes(): void {
    // Create new API key
    this.router.post('/', this.createAPIKey.bind(this));
    
    // List API keys
    this.router.get('/', this.listAPIKeys.bind(this));
    
    // Get API key details
    this.router.get('/:keyId', this.getAPIKey.bind(this));
    
    // Update API key
    this.router.put('/:keyId', this.updateAPIKey.bind(this));
    
    // Rotate API key
    this.router.post('/:keyId/rotate', this.rotateAPIKey.bind(this));
    
    // Delete API key
    this.router.delete('/:keyId', this.deleteAPIKey.bind(this));
    
    // Get API key usage
    this.router.get('/:keyId/usage', this.getAPIKeyUsage.bind(this));
    
    // Reset API key quotas
    this.router.post('/:keyId/reset-quotas', this.resetQuotas.bind(this));
  }

  /**
   * Generate new API key and secret
   */
  public generateKeyPair(): { key: string; secret: string } {
    const key = `qlk_${crypto.randomBytes(16).toString('hex')}`;
    const secret = crypto.randomBytes(32).toString('hex');
    
    return { key, secret };
  }

  /**
   * Hash API secret
   */
  private async hashSecret(secret: string): Promise<string> {
    return bcrypt.hash(secret, 12);
  }

  /**
   * Verify API secret
   */
  private async verifySecret(secret: string, hashedSecret: string): Promise<boolean> {
    return bcrypt.compare(secret, hashedSecret);
  }

  /**
   * Create new API key
   */
  private async createAPIKey(req: Request, res: Response): Promise<void> {
    try {
      const {
        name,
        description,
        clientId,
        permissions = [],
        quotas,
        ipWhitelist,
        expiresAt,
      } = req.body;

      // Validate required fields
      if (!name || !clientId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Name and clientId are required',
          },
        });
      }

      // Generate key pair
      const { key, secret } = this.generateKeyPair();
      const hashedSecret = await this.hashSecret(secret);

      // Create API key record
      const apiKey: Omit<APIKey, 'id' | 'createdAt' | 'updatedAt'> = {
        key,
        secret: hashedSecret,
        name,
        description,
        clientId,
        permissions,
        quotas: quotas || this.getDefaultQuotas(),
        ipWhitelist,
        isActive: true,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        lastUsedAt: undefined,
      };

      const createdKey = await this.database.createAPIKey(apiKey);

      // Initialize quota tracking in Redis
      await this.initializeQuotaTracking(createdKey.id);

      this.logger.info('API key created', {
        keyId: createdKey.id,
        clientId,
        name,
      });

      this.metrics.incrementCounter('api_keys_created');

      // Return key with plain secret (only time it's shown)
      res.status(201).json({
        success: true,
        data: {
          ...createdKey,
          secret, // Plain secret for initial setup
        },
      });
    } catch (error) {
      this.logger.error('Failed to create API key', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'CREATION_ERROR',
          message: 'Failed to create API key',
        },
      });
    }
  }

  /**
   * List API keys for a client
   */
  private async listAPIKeys(req: Request, res: Response): Promise<void> {
    try {
      const { clientId } = req.query;
      const { page = 1, limit = 20 } = req.query;

      if (!clientId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'clientId is required',
          },
        });
      }

      const result = await this.database.listAPIKeys(
        clientId as string,
        parseInt(page as string),
        parseInt(limit as string)
      );

      // Remove secrets from response
      const sanitizedKeys = result.keys.map(key => ({
        ...key,
        secret: undefined,
      }));

      res.json({
        success: true,
        data: sanitizedKeys,
        pagination: result.pagination,
      });
    } catch (error) {
      this.logger.error('Failed to list API keys', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'LIST_ERROR',
          message: 'Failed to list API keys',
        },
      });
    }
  }

  /**
   * Get API key details
   */
  private async getAPIKey(req: Request, res: Response): Promise<void> {
    try {
      const { keyId } = req.params;
      
      const apiKey = await this.database.getAPIKey(keyId);
      
      if (!apiKey) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'API key not found',
          },
        });
      }

      // Get current usage
      const usage = await this.getQuotaUsage(keyId);

      res.json({
        success: true,
        data: {
          ...apiKey,
          secret: undefined, // Never return secret
          usage,
        },
      });
    } catch (error) {
      this.logger.error('Failed to get API key', {
        keyId: req.params.keyId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'GET_ERROR',
          message: 'Failed to get API key',
        },
      });
    }
  }

  /**
   * Update API key
   */
  private async updateAPIKey(req: Request, res: Response): Promise<void> {
    try {
      const { keyId } = req.params;
      const updates = req.body;

      // Remove fields that shouldn't be updated directly
      delete updates.id;
      delete updates.key;
      delete updates.secret;
      delete updates.createdAt;

      const updatedKey = await this.database.updateAPIKey(keyId, updates);

      if (!updatedKey) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'API key not found',
          },
        });
      }

      this.logger.info('API key updated', { keyId });
      this.metrics.incrementCounter('api_keys_updated');

      res.json({
        success: true,
        data: {
          ...updatedKey,
          secret: undefined,
        },
      });
    } catch (error) {
      this.logger.error('Failed to update API key', {
        keyId: req.params.keyId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'UPDATE_ERROR',
          message: 'Failed to update API key',
        },
      });
    }
  }

  /**
   * Rotate API key (generate new secret)
   */
  private async rotateAPIKey(req: Request, res: Response): Promise<void> {
    try {
      const { keyId } = req.params;
      
      // Generate new secret
      const newSecret = crypto.randomBytes(32).toString('hex');
      const hashedSecret = await this.hashSecret(newSecret);

      const updatedKey = await this.database.updateAPIKey(keyId, {
        secret: hashedSecret,
        updatedAt: new Date(),
      });

      if (!updatedKey) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'API key not found',
          },
        });
      }

      this.logger.info('API key rotated', { keyId });
      this.metrics.incrementCounter('api_keys_rotated');

      res.json({
        success: true,
        data: {
          keyId,
          secret: newSecret, // Return new secret
          rotatedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error('Failed to rotate API key', {
        keyId: req.params.keyId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'ROTATION_ERROR',
          message: 'Failed to rotate API key',
        },
      });
    }
  }

  /**
   * Delete API key
   */
  private async deleteAPIKey(req: Request, res: Response): Promise<void> {
    try {
      const { keyId } = req.params;
      
      const deleted = await this.database.deleteAPIKey(keyId);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'API key not found',
          },
        });
      }

      // Clean up quota tracking
      await this.cleanupQuotaTracking(keyId);

      this.logger.info('API key deleted', { keyId });
      this.metrics.incrementCounter('api_keys_deleted');

      res.json({
        success: true,
        message: 'API key deleted successfully',
      });
    } catch (error) {
      this.logger.error('Failed to delete API key', {
        keyId: req.params.keyId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'DELETE_ERROR',
          message: 'Failed to delete API key',
        },
      });
    }
  }

  /**
   * Get API key usage statistics
   */
  private async getAPIKeyUsage(req: Request, res: Response): Promise<void> {
    try {
      const { keyId } = req.params;
      const { period = '24h' } = req.query;

      const usage = await this.getQuotaUsage(keyId);
      const statistics = await this.getUsageStatistics(keyId, period as string);

      res.json({
        success: true,
        data: {
          current: usage,
          statistics,
        },
      });
    } catch (error) {
      this.logger.error('Failed to get API key usage', {
        keyId: req.params.keyId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'USAGE_ERROR',
          message: 'Failed to get API key usage',
        },
      });
    }
  }

  /**
   * Reset API key quotas
   */
  private async resetQuotas(req: Request, res: Response): Promise<void> {
    try {
      const { keyId } = req.params;
      
      await this.resetQuotaUsage(keyId);

      this.logger.info('API key quotas reset', { keyId });
      this.metrics.incrementCounter('api_key_quotas_reset');

      res.json({
        success: true,
        message: 'Quotas reset successfully',
      });
    } catch (error) {
      this.logger.error('Failed to reset quotas', {
        keyId: req.params.keyId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'RESET_ERROR',
          message: 'Failed to reset quotas',
        },
      });
    }
  }

  /**
   * Validate API key and secret
   */
  public async validateKey(key: string, secret?: string): Promise<APIKey | null> {
    try {
      const apiKey = await this.database.getAPIKeyByKey(key);
      
      if (!apiKey) {
        return null;
      }

      // If secret is provided, verify it
      if (secret) {
        const isValidSecret = await this.verifySecret(secret, apiKey.secret);
        if (!isValidSecret) {
          return null;
        }
      }

      return apiKey;
    } catch (error) {
      this.logger.error('Failed to validate API key', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Check API key quotas
   */
  public async checkQuotas(keyId: string): Promise<QuotaCheckResult> {
    try {
      const apiKey = await this.database.getAPIKey(keyId);
      if (!apiKey) {
        return { allowed: false, message: 'API key not found' };
      }

      const usage = await this.getQuotaUsage(keyId);
      const quotas = apiKey.quotas;

      // Check each quota limit
      if (usage.requestsPerMinute >= quotas.requestsPerMinute) {
        return {
          allowed: false,
          message: 'Requests per minute quota exceeded',
          remaining: this.calculateRemaining(usage, quotas),
        };
      }

      if (usage.requestsPerHour >= quotas.requestsPerHour) {
        return {
          allowed: false,
          message: 'Requests per hour quota exceeded',
          remaining: this.calculateRemaining(usage, quotas),
        };
      }

      if (usage.requestsPerDay >= quotas.requestsPerDay) {
        return {
          allowed: false,
          message: 'Requests per day quota exceeded',
          remaining: this.calculateRemaining(usage, quotas),
        };
      }

      if (usage.requestsPerMonth >= quotas.requestsPerMonth) {
        return {
          allowed: false,
          message: 'Requests per month quota exceeded',
          remaining: this.calculateRemaining(usage, quotas),
        };
      }

      return {
        allowed: true,
        remaining: this.calculateRemaining(usage, quotas),
      };
    } catch (error) {
      this.logger.error('Failed to check quotas', {
        keyId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { allowed: false, message: 'Quota check failed' };
    }
  }

  /**
   * Update last used timestamp
   */
  public async updateLastUsed(keyId: string): Promise<void> {
    try {
      await this.database.updateAPIKey(keyId, {
        lastUsedAt: new Date(),
      });

      // Increment usage counters
      await this.incrementUsage(keyId);
    } catch (error) {
      this.logger.error('Failed to update last used', {
        keyId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get default quotas for new API keys
   */
  private getDefaultQuotas(): APIQuota {
    return {
      requestsPerMinute: 100,
      requestsPerHour: 1000,
      requestsPerDay: 10000,
      requestsPerMonth: 100000,
      dataTransferMB: 1000,
      concurrentConnections: 10,
    };
  }

  /**
   * Initialize quota tracking in Redis
   */
  private async initializeQuotaTracking(keyId: string): Promise<void> {
    const now = new Date();
    const usage: QuotaUsage = {
      requestsPerMinute: 0,
      requestsPerHour: 0,
      requestsPerDay: 0,
      requestsPerMonth: 0,
      dataTransferMB: 0,
      concurrentConnections: 0,
      lastReset: now,
    };

    await this.redis.setex(`quota:${keyId}`, 86400, JSON.stringify(usage));
  }

  /**
   * Get current quota usage
   */
  private async getQuotaUsage(keyId: string): Promise<QuotaUsage> {
    try {
      const data = await this.redis.get(`quota:${keyId}`);
      if (data) {
        return JSON.parse(data);
      }
      
      // Initialize if not found
      await this.initializeQuotaTracking(keyId);
      return await this.getQuotaUsage(keyId);
    } catch (error) {
      this.logger.error('Failed to get quota usage', {
        keyId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Increment usage counters
   */
  private async incrementUsage(keyId: string): Promise<void> {
    try {
      const usage = await this.getQuotaUsage(keyId);
      const now = new Date();

      // Reset counters based on time windows
      const minutesSinceReset = Math.floor((now.getTime() - usage.lastReset.getTime()) / 60000);
      
      if (minutesSinceReset >= 1) {
        usage.requestsPerMinute = 0;
      }
      
      if (minutesSinceReset >= 60) {
        usage.requestsPerHour = 0;
      }
      
      if (minutesSinceReset >= 1440) { // 24 hours
        usage.requestsPerDay = 0;
      }
      
      if (minutesSinceReset >= 43200) { // 30 days
        usage.requestsPerMonth = 0;
        usage.lastReset = now;
      }

      // Increment counters
      usage.requestsPerMinute++;
      usage.requestsPerHour++;
      usage.requestsPerDay++;
      usage.requestsPerMonth++;

      await this.redis.setex(`quota:${keyId}`, 86400, JSON.stringify(usage));
    } catch (error) {
      this.logger.error('Failed to increment usage', {
        keyId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Reset quota usage
   */
  private async resetQuotaUsage(keyId: string): Promise<void> {
    await this.initializeQuotaTracking(keyId);
  }

  /**
   * Clean up quota tracking
   */
  private async cleanupQuotaTracking(keyId: string): Promise<void> {
    await this.redis.del(`quota:${keyId}`);
  }

  /**
   * Calculate remaining quotas
   */
  private calculateRemaining(usage: QuotaUsage, quotas: APIQuota) {
    return {
      requestsPerMinute: Math.max(0, quotas.requestsPerMinute - usage.requestsPerMinute),
      requestsPerHour: Math.max(0, quotas.requestsPerHour - usage.requestsPerHour),
      requestsPerDay: Math.max(0, quotas.requestsPerDay - usage.requestsPerDay),
      requestsPerMonth: Math.max(0, quotas.requestsPerMonth - usage.requestsPerMonth),
    };
  }

  /**
   * Get usage statistics for a period
   */
  private async getUsageStatistics(keyId: string, period: string): Promise<any> {
    // Implementation would fetch historical usage data
    return {
      period,
      totalRequests: 0,
      averageResponseTime: 0,
      errorRate: 0,
    };
  }
}
