/**
 * @fileoverview Data Aggregation Engine with weighted median calculation and confidence scoring
 * @author QuantLink Team
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import * as ss from 'simple-statistics';
import zlib from 'zlib';
import { promisify } from 'util';
import { 
  FeeData, 
  PriceData, 
  AggregatedData, 
  DataQualityMetrics,
  CompressionResult
} from '@/types';
import { Logger } from '@/utils/logger';
import { MetricsCollector } from '@/monitoring/metrics';
import { RedisService } from './redis';
import { DatabaseService } from './database';
import { DataQualityService } from './dataQuality';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface AggregationConfig {
  updateInterval: number; // Milliseconds between aggregations
  consensusThreshold: number; // Minimum agreement percentage
  outlierThreshold: number; // Z-score threshold for outlier removal
  maxDataAge: number; // Maximum age of data to include
  compressionEnabled: boolean; // Enable data compression for storage
  historicalRetention: number; // Days to retain historical data
}

export interface WeightedValue {
  value: number;
  weight: number;
  source: string;
  confidence: number;
  timestamp: number;
}

export interface AggregationResult {
  symbol: string;
  aggregatedData: AggregatedData;
  qualityMetrics: DataQualityMetrics;
  processingTime: number;
  dataPoints: number;
  outliers: string[];
}

export class AggregationEngine extends EventEmitter {
  private logger: Logger;
  private metrics: MetricsCollector;
  private redis: RedisService;
  private database: DatabaseService;
  private dataQuality: DataQualityService;
  private config: AggregationConfig;
  private aggregationTimer?: NodeJS.Timeout;
  private isRunning: boolean = false;
  private sourceWeights: Map<string, number> = new Map();

  constructor(
    config: AggregationConfig,
    redis: RedisService,
    database: DatabaseService,
    dataQuality: DataQualityService
  ) {
    super();
    this.config = config;
    this.redis = redis;
    this.database = database;
    this.dataQuality = dataQuality;
    this.logger = new Logger('AggregationEngine');
    this.metrics = new MetricsCollector('aggregation');
    
    this.initializeSourceWeights();
  }

  /**
   * Start the aggregation engine
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Aggregation engine is already running');
      return;
    }

    this.logger.info('Starting aggregation engine', { 
      updateInterval: this.config.updateInterval 
    });

    this.isRunning = true;
    
    // Run initial aggregation
    await this.performAggregation();
    
    // Schedule periodic aggregations
    this.aggregationTimer = setInterval(async () => {
      try {
        await this.performAggregation();
      } catch (error) {
        this.logger.error('Scheduled aggregation failed', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        this.metrics.incrementCounter('aggregation_failures');
      }
    }, this.config.updateInterval);

    this.logger.info('Aggregation engine started successfully');
  }

  /**
   * Stop the aggregation engine
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping aggregation engine');
    
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = undefined;
    }
    
    this.isRunning = false;
    this.logger.info('Aggregation engine stopped');
  }

  /**
   * Aggregate fee data from multiple sources
   */
  public async aggregateFeeData(symbol: string, feeDataArray: FeeData[]): Promise<AggregationResult> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Starting fee data aggregation', { 
        symbol, 
        sourceCount: feeDataArray.length 
      });

      // Filter out stale data
      const now = Date.now();
      const freshData = feeDataArray.filter(data => 
        now - data.timestamp <= this.config.maxDataAge
      );

      if (freshData.length === 0) {
        throw new Error(`No fresh data available for ${symbol}`);
      }

      // Validate data quality
      const validationResult = await this.dataQuality.validateFeeData(freshData);
      if (!validationResult.isValid) {
        this.logger.warn('Data quality validation failed', { 
          symbol, 
          errors: validationResult.errors 
        });
      }

      // Remove outliers
      const outlierResult = this.dataQuality.detectOutliers(freshData);
      const cleanData = freshData.filter(data => 
        !outlierResult.outliers.some(outlier => outlier.source === data.exchange)
      );

      if (cleanData.length === 0) {
        throw new Error(`No valid data after outlier removal for ${symbol}`);
      }

      // Calculate weighted medians
      const cexData = cleanData.filter(data => data.type === 'CEX');
      const dexData = cleanData.filter(data => data.type === 'DEX');

      const weightedMedianCexFee = this.calculateWeightedMedian(
        cexData.map(data => this.createWeightedValue(data, 'makerFee'))
      );

      const weightedMedianDexFee = this.calculateWeightedMedian(
        dexData.map(data => this.createWeightedValue(data, 'makerFee'))
      );

      // Calculate overall confidence
      const totalWeight = cleanData.reduce((sum, data) => 
        sum + this.getSourceWeight(data.exchange) * data.confidence, 0
      );
      const avgWeight = totalWeight / cleanData.length;
      const confidence = Math.min(1, avgWeight * validationResult.confidence);

      // Calculate data quality metrics
      const qualityMetrics = this.dataQuality.calculateQualityMetrics(cleanData);

      // Create aggregated data
      const aggregatedData: AggregatedData = {
        symbol,
        cexFees: cexData.map(data => data.makerFee),
        dexFees: dexData.map(data => data.makerFee),
        weightedMedianCexFee,
        weightedMedianDexFee,
        confidence,
        timestamp: now,
        sources: cleanData.map(data => data.exchange),
        outliers: outlierResult.outliers.map(outlier => outlier.source),
        dataQuality: qualityMetrics,
      };

      // Store aggregated data
      await this.storeAggregatedData(aggregatedData);

      const processingTime = Date.now() - startTime;
      
      // Record metrics
      this.metrics.recordLatency('aggregation_duration', processingTime);
      this.metrics.recordGauge('aggregated_confidence', confidence);
      this.metrics.recordGauge('data_sources_used', cleanData.length);
      this.metrics.recordGauge('outliers_removed', outlierResult.outliers.length);
      this.metrics.incrementCounter('aggregations_completed');

      const result: AggregationResult = {
        symbol,
        aggregatedData,
        qualityMetrics,
        processingTime,
        dataPoints: cleanData.length,
        outliers: outlierResult.outliers.map(outlier => outlier.source),
      };

      // Emit aggregation event
      this.emit('data:aggregated', aggregatedData);

      this.logger.info('Fee data aggregation completed', { 
        symbol, 
        processingTime, 
        confidence,
        dataPoints: cleanData.length,
        outliers: result.outliers.length
      });

      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.metrics.recordLatency('aggregation_duration', processingTime);
      this.metrics.incrementCounter('aggregation_failures');
      
      this.logger.error('Fee data aggregation failed', { 
        symbol, 
        error: error instanceof Error ? error.message : String(error),
        processingTime
      });
      
      throw error;
    }
  }

  /**
   * Calculate weighted median from weighted values
   */
  private calculateWeightedMedian(weightedValues: WeightedValue[]): number {
    if (weightedValues.length === 0) return 0;
    if (weightedValues.length === 1) return weightedValues[0].value;

    // Sort by value
    const sorted = weightedValues.sort((a, b) => a.value - b.value);
    
    // Calculate total weight
    const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);
    const halfWeight = totalWeight / 2;
    
    // Find weighted median
    let cumulativeWeight = 0;
    for (const item of sorted) {
      cumulativeWeight += item.weight;
      if (cumulativeWeight >= halfWeight) {
        return item.value;
      }
    }
    
    return sorted[sorted.length - 1].value;
  }

  /**
   * Create weighted value from fee data
   */
  private createWeightedValue(feeData: FeeData, field: 'makerFee' | 'takerFee'): WeightedValue {
    const sourceWeight = this.getSourceWeight(feeData.exchange);
    const timeWeight = this.calculateTimeWeight(feeData.timestamp);
    const volumeWeight = this.calculateVolumeWeight(feeData.volume24h || 0);
    
    const combinedWeight = sourceWeight * feeData.confidence * timeWeight * volumeWeight;
    
    return {
      value: feeData[field],
      weight: combinedWeight,
      source: feeData.exchange,
      confidence: feeData.confidence,
      timestamp: feeData.timestamp,
    };
  }

  /**
   * Get source weight based on exchange reliability and volume
   */
  private getSourceWeight(exchange: string): number {
    return this.sourceWeights.get(exchange) || 0.5;
  }

  /**
   * Calculate time-based weight (fresher data gets higher weight)
   */
  private calculateTimeWeight(timestamp: number): number {
    const age = Date.now() - timestamp;
    const maxAge = this.config.maxDataAge;
    
    // Linear decay: weight = 1 - (age / maxAge)
    return Math.max(0.1, 1 - (age / maxAge));
  }

  /**
   * Calculate volume-based weight (higher volume gets higher weight)
   */
  private calculateVolumeWeight(volume: number): number {
    if (volume <= 0) return 0.5; // Default weight for unknown volume
    
    // Logarithmic scaling for volume weight
    const logVolume = Math.log10(volume + 1);
    return Math.min(1, logVolume / 10); // Normalize to 0-1 range
  }

  /**
   * Store aggregated data with compression
   */
  private async storeAggregatedData(aggregatedData: AggregatedData): Promise<void> {
    try {
      const dataString = JSON.stringify(aggregatedData);
      
      if (this.config.compressionEnabled) {
        const compressed = await this.compressData(dataString);
        
        // Store compressed data in Redis
        const redisKey = `aggregated:${aggregatedData.symbol}:${aggregatedData.timestamp}`;
        await this.redis.setex(redisKey, 3600, compressed.data.toString('base64')); // 1 hour TTL
        
        // Store metadata
        const metadataKey = `metadata:${aggregatedData.symbol}:${aggregatedData.timestamp}`;
        await this.redis.setex(metadataKey, 3600, JSON.stringify({
          originalSize: compressed.originalSize,
          compressedSize: compressed.compressedSize,
          compressionRatio: compressed.compressionRatio,
          algorithm: compressed.algorithm,
        }));
        
        this.metrics.recordGauge('compression_ratio', compressed.compressionRatio);
      } else {
        // Store uncompressed data
        const redisKey = `aggregated:${aggregatedData.symbol}:${aggregatedData.timestamp}`;
        await this.redis.setex(redisKey, 3600, dataString);
      }

      // Store in database for long-term retention
      await this.database.storeAggregatedData(aggregatedData);
      
      // Update latest data pointer
      const latestKey = `latest:${aggregatedData.symbol}`;
      await this.redis.set(latestKey, JSON.stringify(aggregatedData));
      
    } catch (error) {
      this.logger.error('Failed to store aggregated data', { 
        symbol: aggregatedData.symbol,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Compress data using gzip
   */
  private async compressData(data: string): Promise<CompressionResult> {
    const originalBuffer = Buffer.from(data, 'utf8');
    const compressedBuffer = await gzip(originalBuffer);
    
    return {
      originalSize: originalBuffer.length,
      compressedSize: compressedBuffer.length,
      compressionRatio: compressedBuffer.length / originalBuffer.length,
      algorithm: 'gzip',
      data: compressedBuffer,
    };
  }

  /**
   * Decompress data
   */
  private async decompressData(compressedData: Buffer): Promise<string> {
    const decompressedBuffer = await gunzip(compressedData);
    return decompressedBuffer.toString('utf8');
  }

  /**
   * Get latest aggregated data for a symbol
   */
  public async getLatestAggregatedData(symbol: string): Promise<AggregatedData | null> {
    try {
      const latestKey = `latest:${symbol}`;
      const data = await this.redis.get(latestKey);
      
      if (!data) {
        return null;
      }
      
      return JSON.parse(data);
    } catch (error) {
      this.logger.error('Failed to get latest aggregated data', { 
        symbol,
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
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
    try {
      return await this.database.getHistoricalAggregatedData(symbol, fromTimestamp, toTimestamp);
    } catch (error) {
      this.logger.error('Failed to get historical aggregated data', { 
        symbol,
        fromTimestamp,
        toTimestamp,
        error: error instanceof Error ? error.message : String(error) 
      });
      return [];
    }
  }

  /**
   * Perform scheduled aggregation for all symbols
   */
  private async performAggregation(): Promise<void> {
    try {
      this.logger.debug('Starting scheduled aggregation');
      
      // Get all symbols that need aggregation
      const symbols = await this.getActiveSymbols();
      
      const aggregationPromises = symbols.map(async (symbol) => {
        try {
          // Get latest fee data for symbol from Redis
          const feeData = await this.getLatestFeeDataForSymbol(symbol);
          
          if (feeData.length > 0) {
            await this.aggregateFeeData(symbol, feeData);
          }
        } catch (error) {
          this.logger.error('Failed to aggregate data for symbol', { 
            symbol,
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      });
      
      await Promise.allSettled(aggregationPromises);
      
      this.logger.debug('Scheduled aggregation completed', { symbolCount: symbols.length });
      this.metrics.incrementCounter('scheduled_aggregations');
    } catch (error) {
      this.logger.error('Scheduled aggregation failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      this.metrics.incrementCounter('scheduled_aggregation_failures');
    }
  }

  /**
   * Get active symbols for aggregation
   */
  private async getActiveSymbols(): Promise<string[]> {
    // This would typically come from configuration or database
    return ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'ADA/USDT', 'DOT/USDT'];
  }

  /**
   * Get latest fee data for a symbol from Redis
   */
  private async getLatestFeeDataForSymbol(symbol: string): Promise<FeeData[]> {
    try {
      const pattern = `fee_data:${symbol}:*`;
      const keys = await this.redis.keys(pattern);
      
      const feeDataPromises = keys.map(async (key) => {
        const data = await this.redis.get(key);
        return data ? JSON.parse(data) : null;
      });
      
      const results = await Promise.allSettled(feeDataPromises);
      return results
        .filter((result): result is PromiseFulfilledResult<FeeData> => 
          result.status === 'fulfilled' && result.value !== null
        )
        .map(result => result.value);
    } catch (error) {
      this.logger.error('Failed to get latest fee data for symbol', { 
        symbol,
        error: error instanceof Error ? error.message : String(error) 
      });
      return [];
    }
  }

  /**
   * Initialize source weights based on exchange characteristics
   */
  private initializeSourceWeights(): void {
    // CEX weights (based on volume, reliability, API quality)
    this.sourceWeights.set('binance', 1.0);      // Highest volume, excellent API
    this.sourceWeights.set('coinbase', 0.95);    // High reliability, good API
    this.sourceWeights.set('kraken', 0.9);       // Good reliability, slower API
    this.sourceWeights.set('okx', 0.85);         // Good volume, decent API
    this.sourceWeights.set('bybit', 0.8);        // Growing exchange, good API
    
    // DEX weights (based on TVL, volume, data quality)
    this.sourceWeights.set('uniswap_v3', 0.9);   // Highest DEX volume, good data
    this.sourceWeights.set('sushiswap', 0.8);    // Good volume, reliable data
    this.sourceWeights.set('curve', 0.85);       // Specialized for stablecoins
    
    this.logger.info('Source weights initialized', { 
      weights: Object.fromEntries(this.sourceWeights) 
    });
  }

  /**
   * Update source weight
   */
  public updateSourceWeight(exchange: string, weight: number): void {
    if (weight < 0 || weight > 1) {
      throw new Error('Weight must be between 0 and 1');
    }
    
    this.sourceWeights.set(exchange, weight);
    this.logger.info('Source weight updated', { exchange, weight });
  }

  /**
   * Get current configuration
   */
  public getConfig(): AggregationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<AggregationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Aggregation configuration updated', { config: this.config });
  }

  /**
   * Get aggregation statistics
   */
  public getStatistics(): {
    isRunning: boolean;
    sourceWeights: Record<string, number>;
    config: AggregationConfig;
  } {
    return {
      isRunning: this.isRunning,
      sourceWeights: Object.fromEntries(this.sourceWeights),
      config: this.config,
    };
  }
}
