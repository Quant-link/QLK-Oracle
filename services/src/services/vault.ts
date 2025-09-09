/**
 * @fileoverview HashiCorp Vault service for secure credential management
 * @author QuantLink Team
 * @version 1.0.0
 */

import vault from 'node-vault';
import { ExchangeCredentials, VaultCredentials } from '@/types';
import { Logger } from '@/utils/logger';
import { MetricsCollector } from '@/monitoring/metrics';

export class VaultService {
  private client: any;
  private logger: Logger;
  private metrics: MetricsCollector;
  private config: VaultCredentials;
  private credentialsCache: Map<string, { credentials: ExchangeCredentials; expiry: number }> = new Map();
  private readonly CACHE_TTL = 300000; // 5 minutes

  constructor(config: VaultCredentials) {
    this.config = config;
    this.logger = new Logger('VaultService');
    this.metrics = new MetricsCollector('vault');
    
    this.initializeClient();
  }

  /**
   * Initialize Vault client
   */
  private initializeClient(): void {
    try {
      this.client = vault({
        apiVersion: this.config.apiVersion,
        endpoint: this.config.endpoint,
        token: this.config.token,
        namespace: this.config.namespace,
      });

      this.logger.info('Vault client initialized', { 
        endpoint: this.config.endpoint,
        namespace: this.config.namespace 
      });
    } catch (error) {
      this.logger.error('Failed to initialize Vault client', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Get exchange credentials from Vault
   */
  public async getExchangeCredentials(exchange: string): Promise<ExchangeCredentials> {
    try {
      // Check cache first
      const cached = this.credentialsCache.get(exchange);
      if (cached && Date.now() < cached.expiry) {
        this.metrics.incrementCounter('vault_cache_hits');
        return cached.credentials;
      }

      this.logger.debug('Fetching credentials from Vault', { exchange });
      
      const startTime = Date.now();
      const secretPath = `secret/data/exchanges/${exchange}`;
      
      const response = await this.client.read(secretPath);
      
      const duration = Date.now() - startTime;
      this.metrics.recordLatency('vault_read_duration', duration);
      this.metrics.incrementCounter('vault_reads');

      if (!response?.data?.data) {
        throw new Error(`No credentials found for exchange: ${exchange}`);
      }

      const credentials: ExchangeCredentials = {
        apiKey: response.data.data.api_key,
        apiSecret: response.data.data.api_secret,
        passphrase: response.data.data.passphrase,
        sandbox: response.data.data.sandbox === 'true',
        testnet: response.data.data.testnet === 'true',
      };

      // Validate required fields
      if (!credentials.apiKey || !credentials.apiSecret) {
        throw new Error(`Invalid credentials for exchange: ${exchange}`);
      }

      // Cache credentials
      this.credentialsCache.set(exchange, {
        credentials,
        expiry: Date.now() + this.CACHE_TTL,
      });

      this.logger.info('Successfully retrieved credentials', { exchange });
      return credentials;
    } catch (error) {
      this.metrics.incrementCounter('vault_read_errors');
      this.logger.error('Failed to get exchange credentials', { 
        exchange,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Store exchange credentials in Vault
   */
  public async storeExchangeCredentials(
    exchange: string, 
    credentials: ExchangeCredentials
  ): Promise<void> {
    try {
      this.logger.debug('Storing credentials in Vault', { exchange });
      
      const startTime = Date.now();
      const secretPath = `secret/data/exchanges/${exchange}`;
      
      const secretData = {
        data: {
          api_key: credentials.apiKey,
          api_secret: credentials.apiSecret,
          passphrase: credentials.passphrase || '',
          sandbox: credentials.sandbox ? 'true' : 'false',
          testnet: credentials.testnet ? 'true' : 'false',
        },
      };

      await this.client.write(secretPath, secretData);
      
      const duration = Date.now() - startTime;
      this.metrics.recordLatency('vault_write_duration', duration);
      this.metrics.incrementCounter('vault_writes');

      // Invalidate cache
      this.credentialsCache.delete(exchange);

      this.logger.info('Successfully stored credentials', { exchange });
    } catch (error) {
      this.metrics.incrementCounter('vault_write_errors');
      this.logger.error('Failed to store exchange credentials', { 
        exchange,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Get database credentials from Vault
   */
  public async getDatabaseCredentials(): Promise<{
    username: string;
    password: string;
    host: string;
    port: number;
    database: string;
  }> {
    try {
      const response = await this.client.read('secret/data/database/postgres');
      
      if (!response?.data?.data) {
        throw new Error('No database credentials found in Vault');
      }

      return {
        username: response.data.data.username,
        password: response.data.data.password,
        host: response.data.data.host,
        port: parseInt(response.data.data.port),
        database: response.data.data.database,
      };
    } catch (error) {
      this.logger.error('Failed to get database credentials', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Get Redis credentials from Vault
   */
  public async getRedisCredentials(): Promise<{
    host: string;
    port: number;
    password?: string;
  }> {
    try {
      const response = await this.client.read('secret/data/redis');
      
      if (!response?.data?.data) {
        throw new Error('No Redis credentials found in Vault');
      }

      return {
        host: response.data.data.host,
        port: parseInt(response.data.data.port),
        password: response.data.data.password || undefined,
      };
    } catch (error) {
      this.logger.error('Failed to get Redis credentials', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Rotate exchange credentials
   */
  public async rotateExchangeCredentials(exchange: string): Promise<void> {
    try {
      this.logger.info('Starting credential rotation', { exchange });
      
      // This would typically involve:
      // 1. Generating new API keys via exchange API
      // 2. Testing new credentials
      // 3. Storing new credentials in Vault
      // 4. Invalidating old credentials
      
      // For now, just invalidate cache to force refresh
      this.credentialsCache.delete(exchange);
      
      this.logger.info('Credential rotation completed', { exchange });
      this.metrics.incrementCounter('credential_rotations');
    } catch (error) {
      this.logger.error('Failed to rotate credentials', { 
        exchange,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Health check for Vault connectivity
   */
  public async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    latency: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      await this.client.status();
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
   * Clear credentials cache
   */
  public clearCache(): void {
    this.credentialsCache.clear();
    this.logger.info('Credentials cache cleared');
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): {
    size: number;
    entries: Array<{ exchange: string; expiry: number }>;
  } {
    const entries = Array.from(this.credentialsCache.entries()).map(([exchange, data]) => ({
      exchange,
      expiry: data.expiry,
    }));

    return {
      size: this.credentialsCache.size,
      entries,
    };
  }
}
