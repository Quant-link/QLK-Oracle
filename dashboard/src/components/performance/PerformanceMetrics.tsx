'use client';

import React, { useEffect, useState } from 'react';

interface PerformanceData {
  timestamp: number;
  blockTime: number;
  tps: number;
  gasUsed: number;
  gasLimit: number;
  networkLatency: number;
  nodeCount: number;
  memoryUsage: number;
  cpuUsage: number;
  diskUsage: number;
}

interface NetworkHealth {
  network: string;
  status: 'healthy' | 'degraded' | 'critical';
  uptime: number;
  lastBlock: number;
  avgBlockTime: number;
  peakTps: number;
  currentTps: number;
  validatorCount: number;
  syncStatus: number;
}

interface PerformanceMetricsProps {
  network: string;
}

export default function PerformanceMetrics({ network }: PerformanceMetricsProps) {
  const [performanceHistory, setPerformanceHistory] = useState<PerformanceData[]>([]);
  const [networkHealth, setNetworkHealth] = useState<NetworkHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const generatePerformanceData = () => {
      const now = Date.now();
      
      // Generate realistic performance data based on network
      const baseBlockTime = network === 'ethereum' ? 12 : 
                           network === 'polygon' ? 2 : 
                           network === 'bsc' ? 3 : 6;
      
      const baseTps = network === 'ethereum' ? 15 : 
                     network === 'polygon' ? 7000 : 
                     network === 'bsc' ? 2000 : 1000;

      // Generate 50 data points for the last hour
      const newHistory: PerformanceData[] = Array.from({ length: 50 }, (_, i) => {
        const timestamp = now - (49 - i) * 60000; // 1 minute intervals
        const variation = 0.8 + Math.random() * 0.4; // ±20% variation
        
        return {
          timestamp,
          blockTime: baseBlockTime * variation,
          tps: Math.floor(baseTps * variation),
          gasUsed: Math.floor(15000000 * (0.3 + Math.random() * 0.7)),
          gasLimit: 30000000,
          networkLatency: Math.floor(50 + Math.random() * 200),
          nodeCount: Math.floor(1000 + Math.random() * 500),
          memoryUsage: 40 + Math.random() * 40, // 40-80%
          cpuUsage: 20 + Math.random() * 60, // 20-80%
          diskUsage: 60 + Math.random() * 20, // 60-80%
        };
      });

      // Generate network health data
      const health: NetworkHealth = {
        network,
        status: Math.random() > 0.1 ? 'healthy' : Math.random() > 0.5 ? 'degraded' : 'critical',
        uptime: 99.5 + Math.random() * 0.5,
        lastBlock: Math.floor(Date.now() / 1000 / baseBlockTime),
        avgBlockTime: baseBlockTime * (0.9 + Math.random() * 0.2),
        peakTps: Math.floor(baseTps * 1.5),
        currentTps: Math.floor(baseTps * (0.7 + Math.random() * 0.6)),
        validatorCount: network === 'ethereum' ? 500000 : 
                       network === 'polygon' ? 100 : 21,
        syncStatus: 99.8 + Math.random() * 0.2
      };

      setPerformanceHistory(newHistory);
      setNetworkHealth(health);
      setLoading(false);
    };

    generatePerformanceData();
    const interval = setInterval(generatePerformanceData, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [network]);

  if (loading) {
    return (
      <div className="brutal-border bg-pure-white p-6">
        <div className="space-y-4">
          <div className="loading-skeleton h-6 w-48"></div>
          <div className="loading-skeleton h-32 w-full"></div>
          <div className="loading-skeleton h-4 w-3/4"></div>
        </div>
      </div>
    );
  }

  if (!networkHealth || performanceHistory.length === 0) {
    return (
      <div className="brutal-border bg-pure-white p-6">
        <div className="text-center">
          <h3 className="font-bold text-lg mb-2">PERFORMANCE DATA UNAVAILABLE</h3>
          <p className="text-gray-600">Unable to fetch performance metrics</p>
        </div>
      </div>
    );
  }

  const latestData = performanceHistory[performanceHistory.length - 1];
  const gasUtilization = (latestData.gasUsed / latestData.gasLimit) * 100;

  // Calculate trends
  const blockTimeTrend = performanceHistory.length > 10 ? 
    performanceHistory.slice(-10).reduce((sum, d) => sum + d.blockTime, 0) / 10 : latestData.blockTime;
  const tpsTrend = performanceHistory.length > 10 ? 
    performanceHistory.slice(-10).reduce((sum, d) => sum + d.tps, 0) / 10 : latestData.tps;

  return (
    <div className="space-y-6">
      {/* Network Health Overview */}
      <div className="brutal-border bg-pure-white p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold uppercase tracking-wide">
            {network.toUpperCase()} PERFORMANCE MONITOR
          </h2>
          <div className="flex items-center space-x-4">
            <span className={`px-3 py-1 text-sm font-bold uppercase ${
              networkHealth.status === 'healthy' ? 'bg-green-200 text-green-800' :
              networkHealth.status === 'degraded' ? 'bg-yellow-200 text-yellow-800' :
              'bg-red-200 text-red-800'
            }`}>
              {networkHealth.status}
            </span>
            <span className="font-mono text-sm">
              UPTIME: {networkHealth.uptime.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="metric-card">
            <div className="metric-label">CURRENT TPS</div>
            <div className="metric-value">{networkHealth.currentTps.toLocaleString()}</div>
            <div className="text-xs text-gray-600 mt-1">Peak: {networkHealth.peakTps.toLocaleString()}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">BLOCK TIME</div>
            <div className="metric-value">{networkHealth.avgBlockTime.toFixed(1)}s</div>
            <div className="text-xs text-gray-600 mt-1">Avg: {blockTimeTrend.toFixed(1)}s</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">VALIDATORS</div>
            <div className="metric-value">{networkHealth.validatorCount.toLocaleString()}</div>
            <div className="text-xs text-gray-600 mt-1">Active nodes</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">SYNC STATUS</div>
            <div className="metric-value">{networkHealth.syncStatus.toFixed(1)}%</div>
            <div className="text-xs text-gray-600 mt-1">Network sync</div>
          </div>
        </div>
      </div>

      {/* Real-time Performance Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* TPS Chart */}
        <div className="brutal-border bg-pure-white p-6">
          <h3 className="font-bold mb-4 uppercase tracking-wide">TRANSACTIONS PER SECOND</h3>
          <div className="h-48 relative">
            <div className="absolute inset-0 flex items-end justify-between space-x-1">
              {performanceHistory.slice(-20).map((data, index) => {
                const height = (data.tps / Math.max(...performanceHistory.map(d => d.tps))) * 100;
                return (
                  <div
                    key={index}
                    className="bg-blue-600 transition-all duration-300 min-w-0 flex-1"
                    style={{ height: `${height}%` }}
                    title={`${data.tps} TPS at ${new Date(data.timestamp).toLocaleTimeString()}`}
                  ></div>
                );
              })}
            </div>
            <div className="absolute top-0 left-0 text-xs text-gray-600">
              {Math.max(...performanceHistory.map(d => d.tps)).toLocaleString()}
            </div>
            <div className="absolute bottom-0 left-0 text-xs text-gray-600">0</div>
            <div className="absolute bottom-0 right-0 text-xs text-gray-600">
              Current: {latestData.tps.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Block Time Chart */}
        <div className="brutal-border bg-pure-white p-6">
          <h3 className="font-bold mb-4 uppercase tracking-wide">BLOCK TIME TREND</h3>
          <div className="h-48 relative">
            <div className="absolute inset-0 flex items-end justify-between space-x-1">
              {performanceHistory.slice(-20).map((data, index) => {
                const maxBlockTime = Math.max(...performanceHistory.map(d => d.blockTime));
                const height = (data.blockTime / maxBlockTime) * 100;
                return (
                  <div
                    key={index}
                    className="bg-green-600 transition-all duration-300 min-w-0 flex-1"
                    style={{ height: `${height}%` }}
                    title={`${data.blockTime.toFixed(1)}s at ${new Date(data.timestamp).toLocaleTimeString()}`}
                  ></div>
                );
              })}
            </div>
            <div className="absolute top-0 left-0 text-xs text-gray-600">
              {Math.max(...performanceHistory.map(d => d.blockTime)).toFixed(1)}s
            </div>
            <div className="absolute bottom-0 left-0 text-xs text-gray-600">0s</div>
            <div className="absolute bottom-0 right-0 text-xs text-gray-600">
              Current: {latestData.blockTime.toFixed(1)}s
            </div>
          </div>
        </div>
      </div>

      {/* System Resources */}
      <div className="brutal-border bg-pure-white p-6">
        <h3 className="text-lg font-bold mb-4 uppercase tracking-wide">SYSTEM RESOURCES</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* CPU Usage */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="metric-label">CPU USAGE</span>
              <span className="font-mono text-sm">{latestData.cpuUsage.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-200 h-6 brutal-border">
              <div 
                className={`h-full transition-all duration-500 ${
                  latestData.cpuUsage > 80 ? 'bg-red-600' :
                  latestData.cpuUsage > 60 ? 'bg-yellow-600' : 'bg-green-600'
                }`}
                style={{ width: `${latestData.cpuUsage}%` }}
              ></div>
            </div>
          </div>

          {/* Memory Usage */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="metric-label">MEMORY USAGE</span>
              <span className="font-mono text-sm">{latestData.memoryUsage.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-200 h-6 brutal-border">
              <div 
                className={`h-full transition-all duration-500 ${
                  latestData.memoryUsage > 80 ? 'bg-red-600' :
                  latestData.memoryUsage > 60 ? 'bg-yellow-600' : 'bg-green-600'
                }`}
                style={{ width: `${latestData.memoryUsage}%` }}
              ></div>
            </div>
          </div>

          {/* Disk Usage */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="metric-label">DISK USAGE</span>
              <span className="font-mono text-sm">{latestData.diskUsage.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-200 h-6 brutal-border">
              <div 
                className={`h-full transition-all duration-500 ${
                  latestData.diskUsage > 80 ? 'bg-red-600' :
                  latestData.diskUsage > 60 ? 'bg-yellow-600' : 'bg-green-600'
                }`}
                style={{ width: `${latestData.diskUsage}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      {/* Gas and Network Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gas Utilization */}
        <div className="brutal-border bg-pure-white p-6">
          <h3 className="font-bold mb-4 uppercase tracking-wide">GAS UTILIZATION</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="metric-label">CURRENT USAGE</span>
              <span className="font-mono text-sm">{gasUtilization.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-200 h-8 brutal-border">
              <div 
                className={`h-full transition-all duration-500 ${
                  gasUtilization > 90 ? 'bg-red-600' :
                  gasUtilization > 70 ? 'bg-yellow-600' : 'bg-green-600'
                }`}
                style={{ width: `${gasUtilization}%` }}
              ></div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="metric-card">
                <div className="metric-label">GAS USED</div>
                <div className="metric-value">{(latestData.gasUsed / 1000000).toFixed(1)}M</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">GAS LIMIT</div>
                <div className="metric-value">{(latestData.gasLimit / 1000000).toFixed(1)}M</div>
              </div>
            </div>
          </div>
        </div>

        {/* Network Latency */}
        <div className="brutal-border bg-pure-white p-6">
          <h3 className="font-bold mb-4 uppercase tracking-wide">NETWORK LATENCY</h3>
          <div className="h-32 relative mb-4">
            <div className="absolute inset-0 flex items-end justify-between space-x-1">
              {performanceHistory.slice(-15).map((data, index) => {
                const maxLatency = Math.max(...performanceHistory.map(d => d.networkLatency));
                const height = (data.networkLatency / maxLatency) * 100;
                return (
                  <div
                    key={index}
                    className="bg-purple-600 transition-all duration-300 min-w-0 flex-1"
                    style={{ height: `${height}%` }}
                    title={`${data.networkLatency}ms at ${new Date(data.timestamp).toLocaleTimeString()}`}
                  ></div>
                );
              })}
            </div>
            <div className="absolute top-0 left-0 text-xs text-gray-600">
              {Math.max(...performanceHistory.map(d => d.networkLatency))}ms
            </div>
            <div className="absolute bottom-0 left-0 text-xs text-gray-600">0ms</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="metric-card">
              <div className="metric-label">CURRENT</div>
              <div className="metric-value">{latestData.networkLatency}ms</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">NODES</div>
              <div className="metric-value">{latestData.nodeCount.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
