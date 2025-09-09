/**
 * @fileoverview System Performance Metrics component
 * @author QuantLink Team
 * @version 1.0.0
 */

'use client';

import React, { useEffect, useState } from 'react';

interface PerformanceMetrics {
  memoryUsage: number;
  cpuUsage: number;
  networkLatency: number;
  cacheHitRate: number;
}

export default function SystemPerformanceMetrics() {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    memoryUsage: 0,
    cpuUsage: 0,
    networkLatency: 0,
    cacheHitRate: 0,
  });

  useEffect(() => {
    const updateMetrics = () => {
      // Simulate performance metrics
      // In production, these would come from actual monitoring
      setMetrics({
        memoryUsage: Math.random() * 0.8 + 0.1, // 10-90%
        cpuUsage: Math.random() * 0.6 + 0.1, // 10-70%
        networkLatency: Math.random() * 100 + 20, // 20-120ms
        cacheHitRate: Math.random() * 0.3 + 0.7, // 70-100%
      });
    };

    updateMetrics();
    const interval = setInterval(updateMetrics, 5000);

    return () => clearInterval(interval);
  }, []);

  const formatPercentage = (value: number) => `${(value * 100).toFixed(1)}%`;
  const formatLatency = (value: number) => `${value.toFixed(0)}ms`;

  const getColor = (value: number, thresholds: [number, number]) => {
    if (value < thresholds[0]) return 'text-green-600';
    if (value < thresholds[1]) return 'text-yellow-600';
    return 'text-red-600';
  };

  const performanceData = [
    {
      label: 'Memory Usage',
      value: formatPercentage(metrics.memoryUsage),
      color: getColor(metrics.memoryUsage, [0.7, 0.85]),
    },
    {
      label: 'CPU Usage',
      value: formatPercentage(metrics.cpuUsage),
      color: getColor(metrics.cpuUsage, [0.5, 0.8]),
    },
    {
      label: 'Network Latency',
      value: formatLatency(metrics.networkLatency),
      color: getColor(metrics.networkLatency, [50, 100]),
    },
    {
      label: 'Cache Hit Rate',
      value: formatPercentage(metrics.cacheHitRate),
      color: metrics.cacheHitRate > 0.9 ? 'text-green-600' : metrics.cacheHitRate > 0.8 ? 'text-yellow-600' : 'text-red-600',
    },
  ];

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold mb-4">System Performance</h3>
      <div className="space-y-3">
        {performanceData.map((metric, index) => (
          <div key={index} className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">{metric.label}</span>
            <span className={`text-sm font-medium ${metric.color}`}>{metric.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
