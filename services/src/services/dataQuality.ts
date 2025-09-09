/**
 * @fileoverview Data Quality Validation Service with statistical analysis and ML models
 * @author QuantLink Team
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import * as ss from 'simple-statistics';
import { 
  FeeData, 
  PriceData, 
  DataQualityMetrics, 
  OutlierDetectionResult, 
  DataValidationResult,
  AnomalyDetectionResult,
  MLModelPrediction
} from '@/types';
import { Logger } from '@/utils/logger';
import { MetricsCollector } from '@/monitoring/metrics';
import { RedisService } from './redis';

export interface ValidationConfig {
  outlierThreshold: number; // Z-score threshold
  stalenessThreshold: number; // Max age in milliseconds
  minimumSources: number; // Minimum number of sources required
  confidenceThreshold: number; // Minimum confidence score
  priceDeviationThreshold: number; // Max price deviation percentage
  volumeThreshold: number; // Minimum volume for validation
}

export interface CrossValidationResult {
  isValid: boolean;
  confidence: number;
  deviations: Array<{
    source: string;
    deviation: number;
    severity: 'low' | 'medium' | 'high';
  }>;
  consensus: {
    value: number;
    sources: string[];
    weight: number;
  };
}

export class DataQualityService extends EventEmitter {
  private logger: Logger;
  private metrics: MetricsCollector;
  private redis: RedisService;
  private config: ValidationConfig;
  private historicalData: Map<string, Array<{ value: number; timestamp: number; source: string }>> = new Map();
  private anomalyModel: Map<string, any> = new Map(); // Simplified ML model storage
  private readonly HISTORY_LIMIT = 1000;
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor(config: ValidationConfig, redis: RedisService) {
    super();
    this.config = config;
    this.redis = redis;
    this.logger = new Logger('DataQuality');
    this.metrics = new MetricsCollector('data_quality');
  }

  /**
   * Validate fee data from multiple sources
   */
  public async validateFeeData(feeDataArray: FeeData[]): Promise<DataValidationResult> {
    const startTime = Date.now();
    
    try {
      const errors: string[] = [];
      const warnings: string[] = [];
      let confidence = 1.0;

      // Basic validation checks
      if (feeDataArray.length === 0) {
        errors.push('No fee data provided');
        return this.createValidationResult(false, errors, warnings, 0);
      }

      if (feeDataArray.length < this.config.minimumSources) {
        warnings.push(`Only ${feeDataArray.length} sources available, minimum ${this.config.minimumSources} recommended`);
        confidence *= 0.8;
      }

      // Timestamp validation
      const now = Date.now();
      const staleData = feeDataArray.filter(data => 
        now - data.timestamp > this.config.stalenessThreshold
      );

      if (staleData.length > 0) {
        warnings.push(`${staleData.length} sources have stale data`);
        confidence *= 0.9;
      }

      // Outlier detection
      const outlierResult = this.detectOutliers(feeDataArray);
      if (outlierResult.outliers.length > 0) {
        warnings.push(`${outlierResult.outliers.length} outliers detected`);
        confidence *= Math.max(0.5, 1 - (outlierResult.outliers.length / feeDataArray.length));
      }

      // Cross-source validation
      const crossValidation = await this.performCrossValidation(feeDataArray);
      if (!crossValidation.isValid) {
        errors.push('Cross-source validation failed');
        confidence *= 0.5;
      }

      // Anomaly detection using historical data
      const anomalyResult = await this.detectAnomalies(feeDataArray);
      if (anomalyResult.isAnomaly) {
        warnings.push(`Anomaly detected: ${anomalyResult.explanation}`);
        confidence *= 0.7;
      }

      // Update historical data
      await this.updateHistoricalData(feeDataArray);

      const isValid = errors.length === 0 && confidence >= this.config.confidenceThreshold;
      const result = this.createValidationResult(isValid, errors, warnings, confidence);

      // Record metrics
      const duration = Date.now() - startTime;
      this.metrics.recordLatency('validation_duration', duration);
      this.metrics.incrementCounter(isValid ? 'validations_passed' : 'validations_failed');
      this.metrics.recordGauge('validation_confidence', confidence);

      return result;
    } catch (error) {
      this.logger.error('Fee data validation failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      return this.createValidationResult(false, ['Validation process failed'], [], 0);
    }
  }

  /**
   * Validate price data from multiple sources
   */
  public async validatePriceData(priceDataArray: PriceData[]): Promise<DataValidationResult> {
    const startTime = Date.now();
    
    try {
      const errors: string[] = [];
      const warnings: string[] = [];
      let confidence = 1.0;

      if (priceDataArray.length === 0) {
        errors.push('No price data provided');
        return this.createValidationResult(false, errors, warnings, 0);
      }

      // Price deviation check
      const prices = priceDataArray.map(data => data.price);
      const meanPrice = ss.mean(prices);
      const stdDev = ss.standardDeviation(prices);
      
      const highDeviationCount = prices.filter(price => 
        Math.abs(price - meanPrice) / meanPrice > this.config.priceDeviationThreshold
      ).length;

      if (highDeviationCount > 0) {
        warnings.push(`${highDeviationCount} prices show high deviation from mean`);
        confidence *= 0.8;
      }

      // Volume validation
      const lowVolumeCount = priceDataArray.filter(data => 
        data.volume < this.config.volumeThreshold
      ).length;

      if (lowVolumeCount > priceDataArray.length / 2) {
        warnings.push('More than half of sources have low volume');
        confidence *= 0.7;
      }

      // Spread validation (for exchanges with bid/ask)
      const spreadsData = priceDataArray.filter(data => data.bid && data.ask);
      if (spreadsData.length > 0) {
        const spreads = spreadsData.map(data => 
          ((data.ask! - data.bid!) / data.price) * 100
        );
        const avgSpread = ss.mean(spreads);
        
        if (avgSpread > 1.0) { // 1% spread threshold
          warnings.push(`High average spread detected: ${avgSpread.toFixed(2)}%`);
          confidence *= 0.9;
        }
      }

      const isValid = errors.length === 0 && confidence >= this.config.confidenceThreshold;
      const result = this.createValidationResult(isValid, errors, warnings, confidence);

      // Record metrics
      const duration = Date.now() - startTime;
      this.metrics.recordLatency('price_validation_duration', duration);
      this.metrics.incrementCounter(isValid ? 'price_validations_passed' : 'price_validations_failed');

      return result;
    } catch (error) {
      this.logger.error('Price data validation failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      return this.createValidationResult(false, ['Price validation process failed'], [], 0);
    }
  }

  /**
   * Detect statistical outliers using Z-score and IQR methods
   */
  public detectOutliers(feeDataArray: FeeData[]): OutlierDetectionResult {
    try {
      const makerFees = feeDataArray.map(data => data.makerFee);
      const takerFees = feeDataArray.map(data => data.takerFee);
      
      const outliers: Array<{
        value: number;
        source: string;
        deviation: number;
        zScore: number;
      }> = [];

      // Z-score method for maker fees
      const makerMean = ss.mean(makerFees);
      const makerStdDev = ss.standardDeviation(makerFees);
      
      feeDataArray.forEach((data, index) => {
        const zScore = Math.abs((data.makerFee - makerMean) / makerStdDev);
        if (zScore > this.config.outlierThreshold) {
          outliers.push({
            value: data.makerFee,
            source: data.exchange,
            deviation: Math.abs(data.makerFee - makerMean),
            zScore,
          });
        }
      });

      // IQR method for additional validation
      const sortedMakerFees = [...makerFees].sort((a, b) => a - b);
      const q1 = ss.quantile(sortedMakerFees, 0.25);
      const q3 = ss.quantile(sortedMakerFees, 0.75);
      const iqr = q3 - q1;
      const lowerBound = q1 - 1.5 * iqr;
      const upperBound = q3 + 1.5 * iqr;

      feeDataArray.forEach((data) => {
        if (data.makerFee < lowerBound || data.makerFee > upperBound) {
          const existingOutlier = outliers.find(o => o.source === data.exchange);
          if (!existingOutlier) {
            outliers.push({
              value: data.makerFee,
              source: data.exchange,
              deviation: Math.min(
                Math.abs(data.makerFee - lowerBound),
                Math.abs(data.makerFee - upperBound)
              ),
              zScore: Math.abs((data.makerFee - makerMean) / makerStdDev),
            });
          }
        }
      });

      // Clean data (remove outliers)
      const cleanData = makerFees.filter((fee, index) => 
        !outliers.some(outlier => outlier.source === feeDataArray[index].exchange)
      );

      const statistics = {
        mean: makerMean,
        median: ss.median(makerFees),
        standardDeviation: makerStdDev,
        variance: ss.variance(makerFees),
        min: Math.min(...makerFees),
        max: Math.max(...makerFees),
      };

      this.metrics.recordGauge('outliers_detected', outliers.length);
      this.metrics.recordGauge('clean_data_points', cleanData.length);

      return {
        outliers,
        cleanData,
        statistics,
      };
    } catch (error) {
      this.logger.error('Outlier detection failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      return {
        outliers: [],
        cleanData: feeDataArray.map(data => data.makerFee),
        statistics: {
          mean: 0,
          median: 0,
          standardDeviation: 0,
          variance: 0,
          min: 0,
          max: 0,
        },
      };
    }
  }

  /**
   * Perform cross-source validation
   */
  private async performCrossValidation(feeDataArray: FeeData[]): Promise<CrossValidationResult> {
    try {
      const makerFees = feeDataArray.map(data => data.makerFee);
      const weights = feeDataArray.map(data => data.confidence * this.getSourceWeight(data.exchange));
      
      // Calculate weighted median as consensus
      const weightedValues = makerFees.map((fee, index) => ({
        value: fee,
        weight: weights[index],
        source: feeDataArray[index].exchange,
      })).sort((a, b) => a.value - b.value);

      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      let cumulativeWeight = 0;
      let consensusValue = 0;
      
      for (const item of weightedValues) {
        cumulativeWeight += item.weight;
        if (cumulativeWeight >= totalWeight / 2) {
          consensusValue = item.value;
          break;
        }
      }

      // Calculate deviations from consensus
      const deviations = feeDataArray.map(data => {
        const deviation = Math.abs(data.makerFee - consensusValue) / consensusValue;
        let severity: 'low' | 'medium' | 'high' = 'low';
        
        if (deviation > 0.2) severity = 'high';
        else if (deviation > 0.1) severity = 'medium';
        
        return {
          source: data.exchange,
          deviation,
          severity,
        };
      });

      // Validation passes if most sources are within acceptable deviation
      const highDeviationCount = deviations.filter(d => d.severity === 'high').length;
      const isValid = highDeviationCount <= feeDataArray.length * 0.3; // Allow 30% high deviation

      const confidence = Math.max(0.1, 1 - (highDeviationCount / feeDataArray.length));

      return {
        isValid,
        confidence,
        deviations,
        consensus: {
          value: consensusValue,
          sources: feeDataArray.map(data => data.exchange),
          weight: totalWeight,
        },
      };
    } catch (error) {
      this.logger.error('Cross validation failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      return {
        isValid: false,
        confidence: 0,
        deviations: [],
        consensus: {
          value: 0,
          sources: [],
          weight: 0,
        },
      };
    }
  }

  /**
   * Detect anomalies using historical data and simple ML models
   */
  private async detectAnomalies(feeDataArray: FeeData[]): Promise<AnomalyDetectionResult> {
    try {
      const symbol = feeDataArray[0]?.symbol || 'unknown';
      const currentValues = feeDataArray.map(data => data.makerFee);
      const currentMean = ss.mean(currentValues);
      
      // Get historical data
      const historicalKey = `historical_fees:${symbol}`;
      const historicalData = await this.redis.get(historicalKey);
      
      if (!historicalData) {
        // Not enough historical data for anomaly detection
        return {
          isAnomaly: false,
          anomalyScore: 0,
          threshold: this.config.outlierThreshold,
          features: { currentMean },
          explanation: 'Insufficient historical data',
          timestamp: Date.now(),
        };
      }

      const historical: number[] = JSON.parse(historicalData);
      const historicalMean = ss.mean(historical);
      const historicalStdDev = ss.standardDeviation(historical);
      
      // Simple anomaly detection: check if current mean deviates significantly from historical
      const zScore = Math.abs((currentMean - historicalMean) / historicalStdDev);
      const isAnomaly = zScore > this.config.outlierThreshold;
      
      // Calculate anomaly score (0-1 scale)
      const anomalyScore = Math.min(1, zScore / (this.config.outlierThreshold * 2));
      
      const features = {
        currentMean,
        historicalMean,
        historicalStdDev,
        zScore,
        dataPoints: currentValues.length,
      };

      const explanation = isAnomaly 
        ? `Current fee mean (${currentMean.toFixed(2)}) deviates significantly from historical mean (${historicalMean.toFixed(2)})`
        : 'Fee data within normal historical range';

      this.metrics.recordGauge('anomaly_score', anomalyScore);
      this.metrics.incrementCounter(isAnomaly ? 'anomalies_detected' : 'normal_data_points');

      return {
        isAnomaly,
        anomalyScore,
        threshold: this.config.outlierThreshold,
        features,
        explanation,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error('Anomaly detection failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      return {
        isAnomaly: false,
        anomalyScore: 0,
        threshold: this.config.outlierThreshold,
        features: {},
        explanation: 'Anomaly detection failed',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Update historical data for future anomaly detection
   */
  private async updateHistoricalData(feeDataArray: FeeData[]): Promise<void> {
    try {
      const symbol = feeDataArray[0]?.symbol || 'unknown';
      const currentMean = ss.mean(feeDataArray.map(data => data.makerFee));
      
      const historicalKey = `historical_fees:${symbol}`;
      const existingData = await this.redis.get(historicalKey);
      
      let historical: number[] = existingData ? JSON.parse(existingData) : [];
      historical.push(currentMean);
      
      // Keep only recent history
      if (historical.length > this.HISTORY_LIMIT) {
        historical = historical.slice(-this.HISTORY_LIMIT);
      }
      
      await this.redis.setex(historicalKey, this.CACHE_TTL * 24, JSON.stringify(historical)); // 24 hours TTL
    } catch (error) {
      this.logger.error('Failed to update historical data', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Get source weight based on exchange reliability
   */
  private getSourceWeight(exchange: string): number {
    const weights: Record<string, number> = {
      binance: 1.0,
      coinbase: 0.95,
      kraken: 0.9,
      okx: 0.85,
      bybit: 0.8,
      uniswap_v3: 0.9,
      sushiswap: 0.8,
      curve: 0.85,
    };
    
    return weights[exchange] || 0.5; // Default weight for unknown exchanges
  }

  /**
   * Create validation result object
   */
  private createValidationResult(
    isValid: boolean, 
    errors: string[], 
    warnings: string[], 
    confidence: number
  ): DataValidationResult {
    return {
      isValid,
      errors,
      warnings,
      confidence,
      timestamp: Date.now(),
    };
  }

  /**
   * Calculate data quality metrics
   */
  public calculateQualityMetrics(feeDataArray: FeeData[]): DataQualityMetrics {
    const now = Date.now();
    
    // Completeness: percentage of expected sources that provided data
    const expectedSources = 8; // Total number of configured exchanges
    const completeness = Math.min(1, feeDataArray.length / expectedSources);
    
    // Freshness: based on how recent the data is
    const avgAge = feeDataArray.reduce((sum, data) => sum + (now - data.timestamp), 0) / feeDataArray.length;
    const freshness = Math.max(0, 1 - (avgAge / this.config.stalenessThreshold));
    
    // Consistency: based on standard deviation of values
    const values = feeDataArray.map(data => data.makerFee);
    const stdDev = values.length > 1 ? ss.standardDeviation(values) : 0;
    const mean = ss.mean(values);
    const coefficientOfVariation = mean > 0 ? stdDev / mean : 0;
    const consistency = Math.max(0, 1 - coefficientOfVariation);
    
    // Accuracy: based on confidence scores
    const avgConfidence = feeDataArray.reduce((sum, data) => sum + data.confidence, 0) / feeDataArray.length;
    const accuracy = avgConfidence;
    
    // Outlier count
    const outlierResult = this.detectOutliers(feeDataArray);
    const outlierCount = outlierResult.outliers.length;
    
    return {
      completeness,
      freshness,
      consistency,
      accuracy,
      outlierCount,
      sourceCount: feeDataArray.length,
      timestamp: now,
    };
  }

  /**
   * Get configuration
   */
  public getConfig(): ValidationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<ValidationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Data quality configuration updated', { config: this.config });
  }
}
