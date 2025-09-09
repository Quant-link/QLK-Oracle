/**
 * @fileoverview Prometheus Metrics Collector
 * @author QuantLink Team
 * @version 1.0.0
 */

import client from 'prom-client';

export class MetricsCollector {
  private prefix: string;
  private registry: client.Registry;
  
  // Metrics
  private httpRequestsTotal: client.Counter;
  private httpRequestDuration: client.Histogram;
  private activeConnections: client.Gauge;
  private apiKeyUsage: client.Counter;
  private errorRate: client.Counter;
  private customMetrics: Map<string, client.Metric> = new Map();

  constructor(prefix: string = 'quantlink') {
    this.prefix = prefix;
    this.registry = new client.Registry();
    
    // Collect default metrics
    client.collectDefaultMetrics({
      register: this.registry,
      prefix: `${this.prefix}_`,
    });
    
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    // HTTP request counter
    this.httpRequestsTotal = new client.Counter({
      name: `${this.prefix}_http_requests_total`,
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code', 'organization_id'],
      registers: [this.registry],
    });

    // HTTP request duration histogram
    this.httpRequestDuration = new client.Histogram({
      name: `${this.prefix}_http_request_duration_seconds`,
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    // Active connections gauge
    this.activeConnections = new client.Gauge({
      name: `${this.prefix}_active_connections`,
      help: 'Number of active connections',
      labelNames: ['type'],
      registers: [this.registry],
    });

    // API key usage counter
    this.apiKeyUsage = new client.Counter({
      name: `${this.prefix}_api_key_usage_total`,
      help: 'Total API key usage',
      labelNames: ['api_key_id', 'organization_id', 'endpoint'],
      registers: [this.registry],
    });

    // Error rate counter
    this.errorRate = new client.Counter({
      name: `${this.prefix}_errors_total`,
      help: 'Total number of errors',
      labelNames: ['type', 'service', 'severity'],
      registers: [this.registry],
    });
  }

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    organizationId?: string
  ): void {
    const labels = {
      method: method.toUpperCase(),
      route,
      status_code: statusCode.toString(),
    };

    this.httpRequestsTotal.inc({
      ...labels,
      organization_id: organizationId || 'unknown',
    });

    this.httpRequestDuration.observe(labels, duration / 1000);
  }

  /**
   * Record API key usage
   */
  recordAPIKeyUsage(
    apiKeyId: string,
    organizationId: string,
    endpoint: string
  ): void {
    this.apiKeyUsage.inc({
      api_key_id: apiKeyId,
      organization_id: organizationId,
      endpoint,
    });
  }

  /**
   * Record error
   */
  recordError(
    type: string,
    service: string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): void {
    this.errorRate.inc({
      type,
      service,
      severity,
    });
  }

  /**
   * Set active connections
   */
  setActiveConnections(count: number, type: string = 'http'): void {
    this.activeConnections.set({ type }, count);
  }

  /**
   * Increment counter metric
   */
  incrementCounter(
    name: string,
    labels: Record<string, string> = {},
    value: number = 1
  ): void {
    const metricName = `${this.prefix}_${name}`;
    
    if (!this.customMetrics.has(metricName)) {
      const counter = new client.Counter({
        name: metricName,
        help: `Custom counter metric: ${name}`,
        labelNames: Object.keys(labels),
        registers: [this.registry],
      });
      this.customMetrics.set(metricName, counter);
    }

    const metric = this.customMetrics.get(metricName) as client.Counter;
    metric.inc(labels, value);
  }

  /**
   * Record gauge metric
   */
  recordGauge(
    name: string,
    value: number,
    labels: Record<string, string> = {}
  ): void {
    const metricName = `${this.prefix}_${name}`;
    
    if (!this.customMetrics.has(metricName)) {
      const gauge = new client.Gauge({
        name: metricName,
        help: `Custom gauge metric: ${name}`,
        labelNames: Object.keys(labels),
        registers: [this.registry],
      });
      this.customMetrics.set(metricName, gauge);
    }

    const metric = this.customMetrics.get(metricName) as client.Gauge;
    metric.set(labels, value);
  }

  /**
   * Record histogram metric
   */
  recordHistogram(
    name: string,
    value: number,
    labels: Record<string, string> = {},
    buckets?: number[]
  ): void {
    const metricName = `${this.prefix}_${name}`;
    
    if (!this.customMetrics.has(metricName)) {
      const histogram = new client.Histogram({
        name: metricName,
        help: `Custom histogram metric: ${name}`,
        labelNames: Object.keys(labels),
        buckets: buckets || [0.1, 0.5, 1, 2, 5, 10],
        registers: [this.registry],
      });
      this.customMetrics.set(metricName, histogram);
    }

    const metric = this.customMetrics.get(metricName) as client.Histogram;
    metric.observe(labels, value);
  }

  /**
   * Record latency metric
   */
  recordLatency(
    operation: string,
    duration: number,
    labels: Record<string, string> = {}
  ): void {
    this.recordHistogram(
      `${operation}_duration_ms`,
      duration,
      labels,
      [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
    );
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Get metrics as JSON
   */
  async getMetricsAsJSON(): Promise<any[]> {
    return this.registry.getMetricsAsJSON();
  }

  /**
   * Get metrics summary
   */
  async getMetricsSummary(): Promise<any> {
    const metrics = await this.getMetricsAsJSON();
    
    return {
      totalMetrics: metrics.length,
      httpRequests: this.getMetricValue(metrics, `${this.prefix}_http_requests_total`),
      errors: this.getMetricValue(metrics, `${this.prefix}_errors_total`),
      activeConnections: this.getMetricValue(metrics, `${this.prefix}_active_connections`),
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.registry.clear();
    this.customMetrics.clear();
    this.initializeMetrics();
  }

  /**
   * Get registry instance
   */
  getRegistry(): client.Registry {
    return this.registry;
  }

  private getMetricValue(metrics: any[], metricName: string): number {
    const metric = metrics.find(m => m.name === metricName);
    if (!metric || !metric.values) return 0;
    
    return metric.values.reduce((sum: number, value: any) => sum + value.value, 0);
  }
}
