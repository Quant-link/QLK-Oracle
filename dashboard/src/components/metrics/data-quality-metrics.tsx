/**
 * @fileoverview Data Quality Metrics component
 * @author QuantLink Team
 * @version 1.0.0
 */

'use client';

import React from 'react';
import { useWebSocketStore } from '@/lib/store/websocket-store';
import { formatPercentage } from '@/lib/utils';

export default function DataQualityMetrics() {
  const { oracleData, healthStatuses } = useWebSocketStore();

  // Calculate data quality metrics
  const totalSymbols = oracleData.size;
  const avgConfidence = Array.from(oracleData.values()).reduce(
    (sum, data) => sum + data.confidence, 0
  ) / Math.max(totalSymbols, 1);

  const healthySources = Array.from(healthStatuses.values()).filter(
    status => status.healthState === 'HEALTHY'
  ).length;
  const totalSources = healthStatuses.size;
  const sourceReliability = totalSources > 0 ? healthySources / totalSources : 0;

  const dataFreshness = Array.from(oracleData.values()).reduce((sum, data) => {
    const age = Date.now() - data.timestamp;
    return sum + Math.max(0, 1 - age / (5 * 60 * 1000)); // 5 minutes max age
  }, 0) / Math.max(totalSymbols, 1);

  const metrics = [
    {
      label: 'Average Confidence',
      value: formatPercentage(avgConfidence),
      color: avgConfidence > 0.8 ? 'text-green-600' : avgConfidence > 0.6 ? 'text-yellow-600' : 'text-red-600',
    },
    {
      label: 'Source Reliability',
      value: formatPercentage(sourceReliability),
      color: sourceReliability > 0.9 ? 'text-green-600' : sourceReliability > 0.7 ? 'text-yellow-600' : 'text-red-600',
    },
    {
      label: 'Data Freshness',
      value: formatPercentage(dataFreshness),
      color: dataFreshness > 0.8 ? 'text-green-600' : dataFreshness > 0.6 ? 'text-yellow-600' : 'text-red-600',
    },
    {
      label: 'Active Symbols',
      value: totalSymbols.toString(),
      color: 'text-foreground',
    },
  ];

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold mb-4">Data Quality</h3>
      <div className="space-y-3">
        {metrics.map((metric, index) => (
          <div key={index} className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">{metric.label}</span>
            <span className={`text-sm font-medium ${metric.color}`}>{metric.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
