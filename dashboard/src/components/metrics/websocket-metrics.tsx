/**
 * @fileoverview WebSocket Metrics component
 * @author QuantLink Team
 * @version 1.0.0
 */

'use client';

import React from 'react';
import { useWebSocketStore } from '@/lib/store/websocket-store';
import { formatDuration } from '@/lib/utils';

export default function WebSocketMetrics() {
  const {
    isConnected,
    messagesReceived,
    messagesSent,
    averageLatency,
    connectionState,
  } = useWebSocketStore();

  const metrics = [
    {
      label: 'Connection Status',
      value: isConnected ? 'Connected' : 'Disconnected',
      color: isConnected ? 'text-green-600' : 'text-red-600',
    },
    {
      label: 'Messages Received',
      value: messagesReceived.toLocaleString(),
      color: 'text-foreground',
    },
    {
      label: 'Messages Sent',
      value: messagesSent.toLocaleString(),
      color: 'text-foreground',
    },
    {
      label: 'Average Latency',
      value: formatDuration(averageLatency),
      color: averageLatency < 100 ? 'text-green-600' : averageLatency < 500 ? 'text-yellow-600' : 'text-red-600',
    },
  ];

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold mb-4">WebSocket Metrics</h3>
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
