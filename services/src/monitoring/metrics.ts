/**
 * @fileoverview Prometheus metrics collector for monitoring and observability
 * @author QuantLink Team
 * @version 1.0.0
 */

import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { Logger } from '@/utils/logger';

export class MetricsCollector {
  private logger: Logger;
  private prefix: string;
  private counters: Map<string, Counter> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private gauges: Map<string, Gauge> = new Map();

  constructor(prefix: string = 'quantlink') {
    this.prefix = prefix;
    this.logger = new Logger(`Metrics:${prefix}`);
    
    // Collect default Node.js metrics
    collectDefaultMetrics({ prefix: `${this.prefix}_` });
    
    this.initializeCommonMetrics();
  }

  /**
   * Initialize common metrics used across the application
   */
  private initializeCommonMetrics(): void {
    // HTTP request metrics
    this.createCounter('http_requests_total', 'Total number of HTTP requests', ['method', 'status_code', 'endpoint']);
    this.createHistogram('http_request_duration_seconds', 'HTTP request duration in seconds', ['method', 'endpoint']);
    
    // WebSocket metrics
    this.createCounter('websocket_connections_total', 'Total number of WebSocket connections');
    this.createCounter('websocket_messages_total', 'Total number of WebSocket messages', ['type']);
    this.createGauge('websocket_active_connections', 'Number of active WebSocket connections');
    
    // Exchange integration metrics
    this.createCounter('exchange_requests_total', 'Total number of exchange API requests', ['exchange', 'endpoint']);
    this.createCounter('exchange_errors_total', 'Total number of exchange API errors', ['exchange', 'error_type']);
    this.createHistogram('exchange_request_duration_seconds', 'Exchange API request duration', ['exchange']);
    this.createGauge('exchange_rate_limit_remaining', 'Remaining rate limit tokens', ['exchange']);
    
    // Data quality metrics
    this.createCounter('data_validations_total', 'Total number of data validations', ['result']);
    this.createGauge('data_confidence_score', 'Current data confidence score', ['symbol']);
    this.createCounter('outliers_detected_total', 'Total number of outliers detected', ['exchange']);
    this.createGauge('data_sources_active', 'Number of active data sources', ['type']);
    
    // Aggregation metrics
    this.createCounter('aggregations_total', 'Total number of data aggregations', ['symbol']);
    this.createHistogram('aggregation_duration_seconds', 'Data aggregation duration', ['symbol']);
    this.createGauge('aggregation_lag_seconds', 'Time since last successful aggregation', ['symbol']);
    
    // Database metrics
    this.createCounter('database_queries_total', 'Total number of database queries', ['operation']);
    this.createHistogram('database_query_duration_seconds', 'Database query duration', ['operation']);
    this.createGauge('database_connections_active', 'Number of active database connections');
    
    // Redis metrics
    this.createCounter('redis_operations_total', 'Total number of Redis operations', ['operation']);
    this.createHistogram('redis_operation_duration_seconds', 'Redis operation duration', ['operation']);
    this.createCounter('redis_cache_hits_total', 'Total number of Redis cache hits');
    this.createCounter('redis_cache_misses_total', 'Total number of Redis cache misses');
    
    // Circuit breaker metrics
    this.createGauge('circuit_breaker_state', 'Circuit breaker state (0=closed, 1=open, 2=half-open)', ['service']);
    this.createCounter('circuit_breaker_trips_total', 'Total number of circuit breaker trips', ['service']);
    
    // Health check metrics
    this.createGauge('service_health_status', 'Service health status (1=healthy, 0=unhealthy)', ['service']);
    this.createHistogram('health_check_duration_seconds', 'Health check duration', ['service']);
    
    this.logger.info('Common metrics initialized');
  }

  /**
   * Create a counter metric
   */
  public createCounter(name: string, help: string, labelNames: string[] = []): Counter {
    const fullName = `${this.prefix}_${name}`;
    
    if (this.counters.has(fullName)) {
      return this.counters.get(fullName)!;
    }
    
    const counter = new Counter({
      name: fullName,
      help,
      labelNames,
    });
    
    this.counters.set(fullName, counter);
    return counter;
  }

  /**
   * Create a histogram metric
   */
  public createHistogram(name: string, help: string, labelNames: string[] = [], buckets?: number[]): Histogram {
    const fullName = `${this.prefix}_${name}`;
    
    if (this.histograms.has(fullName)) {
      return this.histograms.get(fullName)!;
    }
    
    const histogram = new Histogram({
      name: fullName,
      help,
      labelNames,
      buckets: buckets || [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
    });
    
    this.histograms.set(fullName, histogram);
    return histogram;
  }

  /**
   * Create a gauge metric
   */
  public createGauge(name: string, help: string, labelNames: string[] = []): Gauge {
    const fullName = `${this.prefix}_${name}`;
    
    if (this.gauges.has(fullName)) {
      return this.gauges.get(fullName)!;
    }
    
    const gauge = new Gauge({
      name: fullName,
      help,
      labelNames,
    });
    
    this.gauges.set(fullName, gauge);
    return gauge;
  }

  /**
   * Increment a counter
   */
  public incrementCounter(name: string, labels?: Record<string, string | number>, value: number = 1): void {
    try {
      const fullName = `${this.prefix}_${name}`;
      const counter = this.counters.get(fullName);
      
      if (counter) {
        if (labels) {
          counter.inc(labels, value);
        } else {
          counter.inc(value);
        }
      } else {
        this.logger.warn('Counter not found', { name: fullName });
      }
    } catch (error) {
      this.logger.error('Failed to increment counter', { 
        name, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Record a value in a histogram
   */
  public recordLatency(name: string, value: number, labels?: Record<string, string | number>): void {
    try {
      const fullName = `${this.prefix}_${name}`;
      const histogram = this.histograms.get(fullName);
      
      if (histogram) {
        // Convert milliseconds to seconds for Prometheus convention
        const valueInSeconds = value / 1000;
        
        if (labels) {
          histogram.observe(labels, valueInSeconds);
        } else {
          histogram.observe(valueInSeconds);
        }
      } else {
        this.logger.warn('Histogram not found', { name: fullName });
      }
    } catch (error) {
      this.logger.error('Failed to record latency', { 
        name, 
        value,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Set a gauge value
   */
  public recordGauge(name: string, value: number, labels?: Record<string, string | number>): void {
    try {
      const fullName = `${this.prefix}_${name}`;
      const gauge = this.gauges.get(fullName);
      
      if (gauge) {
        if (labels) {
          gauge.set(labels, value);
        } else {
          gauge.set(value);
        }
      } else {
        this.logger.warn('Gauge not found', { name: fullName });
      }
    } catch (error) {
      this.logger.error('Failed to record gauge', { 
        name, 
        value,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Increment a gauge value
   */
  public incrementGauge(name: string, labels?: Record<string, string | number>, value: number = 1): void {
    try {
      const fullName = `${this.prefix}_${name}`;
      const gauge = this.gauges.get(fullName);
      
      if (gauge) {
        if (labels) {
          gauge.inc(labels, value);
        } else {
          gauge.inc(value);
        }
      } else {
        this.logger.warn('Gauge not found', { name: fullName });
      }
    } catch (error) {
      this.logger.error('Failed to increment gauge', { 
        name, 
        value,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Decrement a gauge value
   */
  public decrementGauge(name: string, labels?: Record<string, string | number>, value: number = 1): void {
    try {
      const fullName = `${this.prefix}_${name}`;
      const gauge = this.gauges.get(fullName);
      
      if (gauge) {
        if (labels) {
          gauge.dec(labels, value);
        } else {
          gauge.dec(value);
        }
      } else {
        this.logger.warn('Gauge not found', { name: fullName });
      }
    } catch (error) {
      this.logger.error('Failed to decrement gauge', { 
        name, 
        value,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Start a timer for measuring duration
   */
  public startTimer(name: string, labels?: Record<string, string | number>): () => void {
    const startTime = Date.now();
    
    return () => {
      const duration = Date.now() - startTime;
      this.recordLatency(name, duration, labels);
    };
  }

  /**
   * Record HTTP request metrics
   */
  public recordHttpRequest(method: string, endpoint: string, statusCode: number, duration: number): void {
    this.incrementCounter('http_requests_total', { 
      method: method.toUpperCase(), 
      status_code: statusCode.toString(),
      endpoint 
    });
    
    this.recordLatency('http_request_duration_seconds', duration, { 
      method: method.toUpperCase(), 
      endpoint 
    });
  }

  /**
   * Record exchange API metrics
   */
  public recordExchangeRequest(exchange: string, endpoint: string, duration: number, success: boolean): void {
    this.incrementCounter('exchange_requests_total', { exchange, endpoint });
    this.recordLatency('exchange_request_duration_seconds', duration, { exchange });
    
    if (!success) {
      this.incrementCounter('exchange_errors_total', { exchange, error_type: 'api_error' });
    }
  }

  /**
   * Record data validation metrics
   */
  public recordDataValidation(result: 'passed' | 'failed', confidence?: number): void {
    this.incrementCounter('data_validations_total', { result });
    
    if (confidence !== undefined) {
      this.recordGauge('data_confidence_score', confidence);
    }
  }

  /**
   * Record circuit breaker state
   */
  public recordCircuitBreakerState(service: string, state: 'closed' | 'open' | 'half-open'): void {
    const stateValue = state === 'closed' ? 0 : state === 'open' ? 1 : 2;
    this.recordGauge('circuit_breaker_state', stateValue, { service });
    
    if (state === 'open') {
      this.incrementCounter('circuit_breaker_trips_total', { service });
    }
  }

  /**
   * Record service health status
   */
  public recordServiceHealth(service: string, healthy: boolean, duration: number): void {
    this.recordGauge('service_health_status', healthy ? 1 : 0, { service });
    this.recordLatency('health_check_duration_seconds', duration, { service });
  }

  /**
   * Get metrics in Prometheus format
   */
  public async getMetrics(): Promise<string> {
    try {
      return await register.metrics();
    } catch (error) {
      this.logger.error('Failed to get metrics', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return '';
    }
  }

  /**
   * Get metrics as JSON
   */
  public async getMetricsAsJSON(): Promise<any> {
    try {
      return await register.getMetricsAsJSON();
    } catch (error) {
      this.logger.error('Failed to get metrics as JSON', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return {};
    }
  }

  /**
   * Clear all metrics
   */
  public clearMetrics(): void {
    register.clear();
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
    
    this.logger.info('All metrics cleared');
  }

  /**
   * Get metric by name
   */
  public getMetric(name: string): Counter | Histogram | Gauge | undefined {
    const fullName = `${this.prefix}_${name}`;
    
    return this.counters.get(fullName) || 
           this.histograms.get(fullName) || 
           this.gauges.get(fullName);
  }

  /**
   * Check if metric exists
   */
  public hasMetric(name: string): boolean {
    const fullName = `${this.prefix}_${name}`;
    
    return this.counters.has(fullName) || 
           this.histograms.has(fullName) || 
           this.gauges.has(fullName);
  }

  /**
   * Get all metric names
   */
  public getMetricNames(): string[] {
    const names = new Set<string>();
    
    this.counters.forEach((_, name) => names.add(name));
    this.histograms.forEach((_, name) => names.add(name));
    this.gauges.forEach((_, name) => names.add(name));
    
    return Array.from(names);
  }

  /**
   * Get metrics summary
   */
  public getMetricsSummary(): {
    counters: number;
    histograms: number;
    gauges: number;
    total: number;
  } {
    return {
      counters: this.counters.size,
      histograms: this.histograms.size,
      gauges: this.gauges.size,
      total: this.counters.size + this.histograms.size + this.gauges.size,
    };
  }
}
