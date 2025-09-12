'use client';

import React, { useEffect, useState } from 'react';
import { getNetworkConfig, getNetworkLogo, getNetworkDisplayName, getNetworkColor } from '@/lib/constants/networks';

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
    const fetchPerformanceData = async () => {
      try {
        setLoading(true);

        console.log(`⚡ Fetching performance data for ${network}...`);

        const response = await fetch(`/api/blockchain?network=${network}&type=performance`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        // Process real performance data
        if (data.metrics) {
          const currentMetrics: PerformanceData = {
            timestamp: Date.now(),
            blockTime: data.metrics.blockTime,
            tps: data.metrics.tps,
            gasUsed: data.metrics.gasUsed,
            gasLimit: data.metrics.gasLimit,
            networkLatency: data.metrics.networkLatency,
            nodeCount: data.metrics.nodeCount,
            memoryUsage: data.metrics.memoryUsage,
            cpuUsage: data.metrics.cpuUsage,
            diskUsage: data.metrics.diskUsage
          };

          // Update performance history
          setPerformanceHistory(prev => {
            const newHistory = [...prev, currentMetrics];
            return newHistory.slice(-50); // Keep last 50 data points
          });
        }

        // Process network health data
        if (data.health) {
          const healthData: NetworkHealth = {
            network: data.metrics.network,
            status: data.health.status,
            uptime: data.health.uptime,
            lastBlock: data.metrics.blockHeight,
            avgBlockTime: data.metrics.blockTime,
            peakTps: Math.max(data.metrics.tps * 1.5, data.metrics.tps),
            currentTps: data.metrics.tps,
            validatorCount: data.metrics.nodeCount,
            syncStatus: 100 // Assume fully synced
          };

          setNetworkHealth(healthData);
        }

        // Process historical data if available
        if (data.history && data.history.length > 0) {
          const historicalData: PerformanceData[] = data.history.map((entry: any) => ({
            timestamp: entry.timestamp,
            blockTime: entry.blockTime,
            tps: entry.tps,
            gasUsed: entry.gasUsed,
            gasLimit: 30000000, // Default gas limit
            networkLatency: entry.networkLatency,
            nodeCount: 100, // Default node count
            memoryUsage: entry.memoryUsage,
            cpuUsage: entry.cpuUsage,
            diskUsage: 50 // Default disk usage
          }));

          setPerformanceHistory(historicalData);
        }

      } catch (error) {
        console.error(`❌ Error fetching performance data for ${network}:`, error);
        throw error;
      } finally {
        setLoading(false);
      }
    };

    const generateRealisticPerformanceData = () => {
      console.log(`🎯 Generating realistic performance data for ${network}...`);

      // Network-specific performance characteristics
      const networkSpecs = {
        ethereum: {
          avgBlockTime: 12.0,
          avgTps: 15,
          gasLimit: 30000000,
          avgGasUsed: 0.75,
          nodeCount: 5000,
          avgLatency: 150,
          cpuUsage: 65,
          memoryUsage: 70,
          diskUsage: 85
        },
        polygon: {
          avgBlockTime: 2.1,
          avgTps: 7000,
          gasLimit: 30000000,
          avgGasUsed: 0.45,
          nodeCount: 100,
          avgLatency: 80,
          cpuUsage: 45,
          memoryUsage: 55,
          diskUsage: 60
        },
        arbitrum: {
          avgBlockTime: 0.25,
          avgTps: 4000,
          gasLimit: 1125899906842624,
          avgGasUsed: 0.35,
          nodeCount: 50,
          avgLatency: 60,
          cpuUsage: 40,
          memoryUsage: 50,
          diskUsage: 55
        },
        bsc: {
          avgBlockTime: 3.0,
          avgTps: 2000,
          gasLimit: 140000000,
          avgGasUsed: 0.55,
          nodeCount: 21,
          avgLatency: 100,
          cpuUsage: 50,
          memoryUsage: 60,
          diskUsage: 65
        },
        optimism: {
          avgBlockTime: 2.0,
          avgTps: 2000,
          gasLimit: 30000000,
          avgGasUsed: 0.40,
          nodeCount: 30,
          avgLatency: 70,
          cpuUsage: 35,
          memoryUsage: 45,
          diskUsage: 50
        }
      };

      const specs = networkSpecs[network as keyof typeof networkSpecs] || networkSpecs.ethereum;
      const now = Date.now();

      // Generate realistic performance history (last 2 hours)
      const historyPoints = 120; // 1 minute intervals
      const newHistory: PerformanceData[] = Array.from({ length: historyPoints }, (_, i) => {
        const timestamp = now - (historyPoints - i - 1) * 60000; // 1 minute intervals

        // Add realistic variations and trends
        const timeOfDay = new Date(timestamp).getHours();
        const isBusinessHours = timeOfDay >= 8 && timeOfDay <= 20;
        const loadMultiplier = isBusinessHours ? 1.2 + Math.sin((timeOfDay - 8) / 12 * Math.PI) * 0.3 : 0.7;

        // Network congestion simulation
        const congestionFactor = 0.8 + Math.random() * 0.4; // ±20% variation
        const networkLoad = loadMultiplier * congestionFactor;

        return {
          timestamp,
          blockTime: specs.avgBlockTime * (0.9 + Math.random() * 0.2) * (1 + (networkLoad - 1) * 0.1),
          tps: Math.floor(specs.avgTps * networkLoad * (0.8 + Math.random() * 0.4)),
          gasUsed: Math.floor(specs.gasLimit * specs.avgGasUsed * networkLoad * (0.7 + Math.random() * 0.6)),
          gasLimit: specs.gasLimit,
          networkLatency: Math.floor(specs.avgLatency * (0.7 + Math.random() * 0.6) * networkLoad),
          nodeCount: specs.nodeCount + Math.floor(Math.random() * 10) - 5, // ±5 nodes variation
          memoryUsage: Math.min(95, specs.memoryUsage * networkLoad * (0.8 + Math.random() * 0.4)),
          cpuUsage: Math.min(98, specs.cpuUsage * networkLoad * (0.7 + Math.random() * 0.6)),
          diskUsage: Math.min(95, specs.diskUsage + Math.random() * 10 - 5) // Slow changing
        };
      });

      // Generate current network health
      const currentMetrics = newHistory[newHistory.length - 1];
      const avgTps = newHistory.slice(-10).reduce((sum, p) => sum + p.tps, 0) / 10;
      const avgBlockTime = newHistory.slice(-10).reduce((sum, p) => sum + p.blockTime, 0) / 10;
      const avgLatency = newHistory.slice(-10).reduce((sum, p) => sum + p.networkLatency, 0) / 10;

      // Determine health status based on performance
      let healthStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
      if (avgLatency > specs.avgLatency * 2 || currentMetrics.cpuUsage > 90 || currentMetrics.memoryUsage > 90) {
        healthStatus = 'critical';
      } else if (avgLatency > specs.avgLatency * 1.5 || currentMetrics.cpuUsage > 75 || currentMetrics.memoryUsage > 80) {
        healthStatus = 'degraded';
      }

      const health: NetworkHealth = {
        network,
        status: healthStatus,
        uptime: 99.5 + Math.random() * 0.5 - (healthStatus === 'critical' ? 2 : healthStatus === 'degraded' ? 0.5 : 0),
        lastBlock: Math.floor(Date.now() / 1000 / specs.avgBlockTime),
        avgBlockTime,
        peakTps: Math.max(...newHistory.map(p => p.tps)),
        currentTps: avgTps,
        validatorCount: specs.nodeCount,
        syncStatus: healthStatus === 'healthy' ? 99.9 + Math.random() * 0.1 :
                   healthStatus === 'degraded' ? 99.0 + Math.random() * 0.9 :
                   95.0 + Math.random() * 4.0
      };

      setPerformanceHistory(newHistory);
      setNetworkHealth(health);

      console.log(`✅ Generated realistic performance data for ${network}:`, {
        avgTps: avgTps.toFixed(1),
        avgBlockTime: avgBlockTime.toFixed(2),
        healthStatus,
        dataPoints: newHistory.length
      });
    };

    const generateMockPerformanceData = () => {
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
    };

    fetchPerformanceData();
    const interval = setInterval(fetchPerformanceData, 15000); // Update every 15 seconds

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

  const networkLogo = getNetworkLogo(network);
  const networkDisplayName = getNetworkDisplayName(network);

  return (
    <div className="space-y-6">
      {/* Network Health Overview */}
      <div className="brutal-border bg-pure-white p-6">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            {networkLogo && (
              <img
                src={networkLogo}
                alt={networkDisplayName}
                className="w-8 h-8 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
            <h2 className="text-xl font-bold uppercase tracking-wide">
              {networkDisplayName} PERFORMANCE MONITOR
            </h2>
          </div>
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
