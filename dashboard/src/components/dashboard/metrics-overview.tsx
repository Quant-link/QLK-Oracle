/**
 * @fileoverview Metrics Overview component with real-time data
 * @author QuantLink Team
 * @version 1.0.0
 */

'use client';

import React from 'react';
import { useWebSocketStore } from '@/lib/store/websocket-store';
import { formatPercentage, formatDuration } from '@/lib/utils';

export function MetricsOverview() {
  const {
    oracleData,
    healthStatuses,
    messagesReceived,
    averageLatency,
    isConnected,
  } = useWebSocketStore();

  // Calculate metrics
  const totalSymbols = oracleData.size;
  const healthySources = Array.from(healthStatuses.values()).filter(
    status => status.healthState === 'HEALTHY'
  ).length;
  const totalSources = healthStatuses.size;
  const systemHealth = totalSources > 0 ? healthySources / totalSources : 0;

  // Calculate average confidence
  const avgConfidence = Array.from(oracleData.values()).reduce(
    (sum, data) => sum + data.confidence, 0
  ) / Math.max(totalSymbols, 1);

  const metrics = [
    {
      title: 'Active Symbols',
      value: totalSymbols.toString(),
      description: 'Trading pairs being monitored',
      status: totalSymbols > 0 ? 'positive' : 'neutral',
    },
    {
      title: 'System Health',
      value: formatPercentage(systemHealth),
      description: `${healthySources}/${totalSources} sources healthy`,
      status: systemHealth > 0.9 ? 'positive' : systemHealth > 0.7 ? 'warning' : 'negative',
    },
    {
      title: 'Data Confidence',
      value: formatPercentage(avgConfidence),
      description: 'Average confidence score',
      status: avgConfidence > 0.8 ? 'positive' : avgConfidence > 0.6 ? 'warning' : 'negative',
    },
    {
      title: 'Connection Latency',
      value: formatDuration(averageLatency),
      description: 'Average response time',
      status: averageLatency < 100 ? 'positive' : averageLatency < 500 ? 'warning' : 'negative',
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric, index) => (
        <MetricCard key={index} {...metric} />
      ))}
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  description: string;
  status: 'positive' | 'warning' | 'negative' | 'neutral';
}

function MetricCard({ title, value, description, status }: MetricCardProps) {
  const statusColors = {
    positive: 'text-green-600 dark:text-green-400',
    warning: 'text-yellow-600 dark:text-yellow-400',
    negative: 'text-red-600 dark:text-red-400',
    neutral: 'text-muted-foreground',
  };

  const statusBorders = {
    positive: 'border-green-200 dark:border-green-800',
    warning: 'border-yellow-200 dark:border-yellow-800',
    negative: 'border-red-200 dark:border-red-800',
    neutral: 'border-border',
  };

  return (
    <div className={`card p-6 border ${statusBorders[status]}`}>
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className={`text-2xl font-bold ${statusColors[status]}`}>{value}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
