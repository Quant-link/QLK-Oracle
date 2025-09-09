'use client';

import { useEffect, useState } from 'react';
import { useOracleData, useOracleActions } from '@/store/oracle-store';
import { realTimeService } from '@/lib/services/real-time-service';
import ConsensusMonitor from '@/components/consensus/ConsensusMonitor';
import VotingVisualization from '@/components/consensus/VotingVisualization';
import PerformanceMetrics from '@/components/performance/PerformanceMetrics';

export default function Dashboard() {
  const [isClient, setIsClient] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'consensus' | 'voting' | 'performance'>('overview');
  const [selectedNetwork, setSelectedNetwork] = useState('ethereum');
  const [backendOracleData, setBackendOracleData] = useState<any[]>([]);
  const [backendLoading, setBackendLoading] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);

  const {
    oracleData,
    marketData,
    exchangeHealth,
    connectionStatus,
    isLoading,
    error,
    metrics
  } = useOracleData();

  const { setError } = useOracleActions();

  // Ensure client-side only rendering for dynamic content
  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    // Initialize real-time service only on client
    if (!isClient) return;

    const initializeServices = async () => {
      try {
        if (!realTimeService.isServiceRunning()) {
          await realTimeService.start();
        }
      } catch (error) {
        console.error('Failed to initialize services:', error);
        setError('Failed to initialize real-time services');
      }
    };

    initializeServices();

    // Cleanup on unmount
    return () => {
      // Don't stop services on component unmount as they should persist
      // realTimeService.stop();
    };
  }, [isClient, setError]);

  // Fetch oracle data from backend API
  useEffect(() => {
    if (!isClient) return;

    const fetchOracleData = async () => {
      try {
        setBackendLoading(true);
        const networks = ['ethereum', 'arbitrum', 'optimism', 'polygon', 'bsc'];
        const promises = networks.map(network =>
          fetch(`/api/blockchain?network=${network}&type=oracle`)
            .then(res => res.ok ? res.json() : [])
            .catch(() => [])
        );

        const results = await Promise.all(promises);
        const allOracleData = results.flat();
        setBackendOracleData(allOracleData);
        setBackendError(null);
      } catch (err) {
        setBackendError('Failed to fetch oracle data');
        console.error('Oracle data fetch error:', err);
      } finally {
        setBackendLoading(false);
      }
    };

    fetchOracleData();
    const interval = setInterval(fetchOracleData, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [isClient]);

  // Show loading state during hydration
  if (!isClient) {
    return (
      <div className="min-h-screen bg-pure-white flex items-center justify-center">
        <div className="brutal-border bg-pure-white p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold mb-4">QUANTLINK ORACLE</h1>
          <div className="space-y-4">
            <div className="loading-skeleton h-4 w-full"></div>
            <div className="loading-skeleton h-4 w-3/4"></div>
            <div className="loading-skeleton h-4 w-1/2"></div>
          </div>
          <p className="text-gray-700 mt-6 text-center">INITIALIZING SYSTEM...</p>
        </div>
      </div>
    );
  }

  if (error || backendError) {
    return (
      <div className="min-h-screen bg-pure-white flex items-center justify-center">
        <div className="brutal-border bg-pure-white p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold mb-4">SYSTEM ERROR</h1>
          <p className="text-gray-700 mb-6">{error || backendError}</p>
          <button
            onClick={() => window.location.reload()}
            className="brutal-button w-full"
          >
            RELOAD SYSTEM
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-pure-white">
      {/* Dashboard Header */}
      <header className="brutal-border border-b-2 bg-pure-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight uppercase">
              QUANTLINK ORACLE DASHBOARD
            </h1>
            <p className="text-gray-700 mt-2 font-medium">
              Developed by Quantlink Team
            </p>
          </div>
          <div className="flex items-center space-x-6">
            <div className="text-right">
              <div className="text-sm font-medium text-gray-600 uppercase">SYSTEM STATUS</div>
              <div className="flex items-center space-x-2 mt-1">
                <div className={`status-indicator ${isLoading ? 'status-degraded' : 'status-healthy'}`}></div>
                <span className="font-mono text-sm">
                  {isLoading ? 'LOADING' : 'OPERATIONAL'}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-gray-600 uppercase">UPTIME</div>
              <div className="font-mono text-lg font-bold">
                {(metrics?.uptimePercentage || 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="brutal-border border-b-2 bg-pure-white p-2">
        <div className="flex space-x-2">
          {[
            { id: 'overview', label: 'SYSTEM OVERVIEW' },
            { id: 'consensus', label: 'CONSENSUS MONITOR' },
            { id: 'voting', label: 'VOTING SYSTEM' },
            { id: 'performance', label: 'PERFORMANCE METRICS' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-6 py-3 font-bold uppercase text-sm tracking-wide transition-all ${
                activeTab === tab.id
                  ? 'bg-pure-black text-pure-white'
                  : 'bg-pure-white text-pure-black hover:bg-gray-100'
              } brutal-border`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Network Selector for Consensus/Voting/Performance tabs */}
      {activeTab !== 'overview' && (
        <div className="brutal-border border-b bg-pure-white p-4">
          <div className="flex items-center space-x-4">
            <span className="font-bold uppercase text-sm tracking-wide">NETWORK:</span>
            <div className="flex space-x-2">
              {['ethereum', 'arbitrum', 'optimism', 'polygon', 'bsc'].map((network) => (
                <button
                  key={network}
                  onClick={() => setSelectedNetwork(network)}
                  className={`px-4 py-2 font-bold uppercase text-xs tracking-wide transition-all ${
                    selectedNetwork === network
                      ? 'bg-pure-black text-pure-white'
                      : 'bg-pure-white text-pure-black hover:bg-gray-100'
                  } brutal-border`}
                >
                  {network}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="p-6 space-y-8">
        {/* Conditional Content Based on Active Tab */}
        {activeTab === 'overview' && (
          <>
            {/* Connection Status Grid */}
            <section>
          <h2 className="text-2xl font-bold mb-6 uppercase tracking-wide">
            NETWORK CONNECTION STATUS
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {(connectionStatus || []).map((status) => (
              <div key={status.network} className="metric-card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold uppercase text-sm tracking-wide">
                    {status.network}
                  </h3>
                  <div className={`status-indicator ${status.connected ? 'status-healthy' : 'status-offline'}`}></div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="metric-label">BLOCK</span>
                    <span className="font-mono text-sm">{status.blockNumber.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="metric-label">LATENCY</span>
                    <span className="font-mono text-sm">{status.latency}MS</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="metric-label">UPDATED</span>
                    <span className="font-mono text-xs">{new Date(status.lastUpdate).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            ))}
            {(!connectionStatus || connectionStatus.length === 0) && (
              <div className="col-span-full text-center py-12">
                <div className="loading-skeleton h-4 w-48 mx-auto mb-2"></div>
                <div className="loading-skeleton h-4 w-32 mx-auto"></div>
              </div>
            )}
          </div>
        </section>

        {/* Real-time Oracle Data */}
        <section>
          <h2 className="text-2xl font-bold mb-6 uppercase tracking-wide">
            REAL-TIME ORACLE DATA
          </h2>
          <div className="data-grid">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="data-grid-header">SYMBOL</th>
                    <th className="data-grid-header">PRICE USD</th>
                    <th className="data-grid-header">NETWORK</th>
                    <th className="data-grid-header">DECIMALS</th>
                    <th className="data-grid-header">ROUND ID</th>
                    <th className="data-grid-header">UPDATED</th>
                  </tr>
                </thead>
                <tbody>
                  {(oracleData || []).map((data, index) => (
                    <tr key={`${data.network}-${index}`} className="border-b border-gray-300">
                      <td className="data-grid-cell font-bold">{data.description}</td>
                      <td className="data-grid-cell font-mono">${data.priceUSD.toFixed(2)}</td>
                      <td className="data-grid-cell uppercase">{data.network}</td>
                      <td className="data-grid-cell font-mono">{data.decimals}</td>
                      <td className="data-grid-cell font-mono">{data.roundId}</td>
                      <td className="data-grid-cell font-mono text-xs">
                        {new Date(data.updatedAt * 1000).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!oracleData || oracleData.length === 0) && (
                <div className="text-center py-12">
                  <div className="loading-skeleton h-4 w-48 mx-auto mb-2"></div>
                  <div className="loading-skeleton h-4 w-32 mx-auto"></div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Exchange Health Status */}
        <section>
          <h2 className="text-2xl font-bold mb-6 uppercase tracking-wide">
            EXCHANGE HEALTH STATUS
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {(exchangeHealth || []).map((health) => (
              <div key={health.exchange} className="metric-card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold uppercase text-sm tracking-wide">
                    {health.exchange}
                  </h3>
                  <div className={`status-indicator ${
                    health.status === 'HEALTHY' ? 'status-healthy' :
                    health.status === 'DEGRADED' ? 'status-degraded' :
                    health.status === 'UNHEALTHY' ? 'status-unhealthy' : 'status-offline'
                  }`}></div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="metric-label">STATUS</span>
                    <span className="font-mono text-sm">{health.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="metric-label">LATENCY</span>
                    <span className="font-mono text-sm">{health.latency}MS</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="metric-label">UPTIME</span>
                    <span className="font-mono text-sm">{health.uptimePercentage.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="metric-label">ERRORS</span>
                    <span className="font-mono text-sm">{health.errorCount}</span>
                  </div>
                </div>
              </div>
            ))}
            {(!exchangeHealth || exchangeHealth.length === 0) && (
              <div className="col-span-full text-center py-12">
                <div className="loading-skeleton h-4 w-48 mx-auto mb-2"></div>
                <div className="loading-skeleton h-4 w-32 mx-auto"></div>
              </div>
            )}
          </div>
        </section>

        {/* System Metrics */}
        <section>
          <h2 className="text-2xl font-bold mb-6 uppercase tracking-wide">
            SYSTEM METRICS
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="metric-card">
              <div className="metric-label">TOTAL UPDATES</div>
              <div className="metric-value">{(metrics?.totalUpdates || 0).toLocaleString()}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">AVG LATENCY</div>
              <div className="metric-value">{(metrics?.averageLatency || 0).toFixed(0)}MS</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">ERROR RATE</div>
              <div className="metric-value">{(metrics?.errorRate || 0).toFixed(2)}%</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">UPTIME</div>
              <div className="metric-value">{(metrics?.uptimePercentage || 100).toFixed(1)}%</div>
            </div>
          </div>
        </section>

        {/* Market Data Summary */}
        <section>
          <h2 className="text-2xl font-bold mb-6 uppercase tracking-wide">
            MARKET DATA SUMMARY
          </h2>
          <div className="data-grid">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="data-grid-header">EXCHANGE</th>
                    <th className="data-grid-header">SYMBOL</th>
                    <th className="data-grid-header">PRICE</th>
                    <th className="data-grid-header">VOLUME 24H</th>
                    <th className="data-grid-header">SPREAD</th>
                    <th className="data-grid-header">UPDATED</th>
                  </tr>
                </thead>
                <tbody>
                  {(marketData || []).slice(0, 10).map((data, index) => (
                    <tr key={`${data.exchange}-${data.symbol}-${index}`} className="border-b border-gray-300">
                      <td className="data-grid-cell font-bold uppercase">{data.exchange}</td>
                      <td className="data-grid-cell font-mono">{data.symbol}</td>
                      <td className="data-grid-cell font-mono">${data.price.toFixed(2)}</td>
                      <td className="data-grid-cell font-mono">{data.volume24h.toLocaleString()}</td>
                      <td className="data-grid-cell font-mono">{data.spreadPercent.toFixed(3)}%</td>
                      <td className="data-grid-cell font-mono text-xs">
                        {new Date(data.timestamp).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!marketData || marketData.length === 0) && (
                <div className="text-center py-12">
                  <div className="loading-skeleton h-4 w-48 mx-auto mb-2"></div>
                  <div className="loading-skeleton h-4 w-32 mx-auto"></div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* System Operations */}
        <section>
          <h2 className="text-2xl font-bold mb-6 uppercase tracking-wide">
            SYSTEM OPERATIONS
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              onClick={() => realTimeService.forceUpdate()}
              className="brutal-button"
              disabled={isLoading}
            >
              FORCE UPDATE
            </button>
            <button
              onClick={() => window.open('http://localhost:3001/health', '_blank')}
              className="brutal-button"
            >
              DATA SERVICE
            </button>
            <button
              onClick={() => window.open('http://localhost:8080/health', '_blank')}
              className="brutal-button"
            >
              ENTERPRISE API
            </button>
            <button
              onClick={() => window.location.reload()}
              className="brutal-button"
            >
              RELOAD SYSTEM
            </button>
          </div>
        </section>
          </>
        )}

        {/* Consensus Monitor Tab */}
        {activeTab === 'consensus' && (
          <ConsensusMonitor network={selectedNetwork} />
        )}

        {/* Voting Visualization Tab */}
        {activeTab === 'voting' && (
          <VotingVisualization network={selectedNetwork} />
        )}

        {/* Performance Metrics Tab */}
        {activeTab === 'performance' && (
          <PerformanceMetrics network={selectedNetwork} />
        )}

        {/* Real-time Oracle Data Section - Show backend data when available */}
        {activeTab === 'overview' && (
          <section>
            <h2 className="text-2xl font-bold mb-6 uppercase tracking-wide">
              REAL-TIME ORACLE DATA
            </h2>
            <div className="brutal-border bg-pure-white p-6">
              {backendLoading ? (
                <div className="text-center py-12">
                  <div className="loading-skeleton h-4 w-48 mx-auto mb-2"></div>
                  <div className="loading-skeleton h-4 w-32 mx-auto"></div>
                  <p className="text-gray-600 mt-4">FETCHING BLOCKCHAIN DATA...</p>
                </div>
              ) : backendOracleData.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b-2 border-pure-black">
                        <th className="data-grid-header">ASSET</th>
                        <th className="data-grid-header">PRICE USD</th>
                        <th className="data-grid-header">NETWORK</th>
                        <th className="data-grid-header">DECIMALS</th>
                        <th className="data-grid-header">ROUND ID</th>
                        <th className="data-grid-header">UPDATED</th>
                        <th className="data-grid-header">CONTRACT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backendOracleData.map((data, index) => (
                        <tr key={`${data.network}-${data.symbol}-${index}`} className="border-b border-gray-300">
                          <td className="data-grid-cell font-bold">{data.symbol}</td>
                          <td className="data-grid-cell font-mono">${data.priceUSD.toFixed(2)}</td>
                          <td className="data-grid-cell uppercase">{data.network}</td>
                          <td className="data-grid-cell font-mono">{data.decimals}</td>
                          <td className="data-grid-cell font-mono">{data.roundId}</td>
                          <td className="data-grid-cell font-mono text-xs">
                            {new Date(data.updatedAt * 1000).toLocaleTimeString()}
                          </td>
                          <td className="data-grid-cell font-mono text-xs">
                            {data.contractAddress.slice(0, 8)}...{data.contractAddress.slice(-6)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <h3 className="font-bold text-lg mb-2">NO ORACLE DATA</h3>
                  <p className="text-gray-600">Unable to fetch real-time oracle data</p>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
