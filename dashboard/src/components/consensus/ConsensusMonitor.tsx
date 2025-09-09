'use client';

import React, { useEffect, useState } from 'react';

interface ConsensusData {
  network: string;
  totalNodes: number;
  activeNodes: number;
  consensusThreshold: number;
  currentRound: number;
  votingPower: number;
  participationRate: number;
  finalityTime: number;
  blockHeight: number;
  validators: Array<{
    address: string;
    votingPower: number;
    uptime: number;
    lastVote: number;
    status: 'active' | 'inactive' | 'jailed';
  }>;
  rounds: Array<{
    roundId: number;
    startTime: number;
    endTime: number;
    votes: number;
    threshold: number;
    status: 'pending' | 'completed' | 'failed';
    participants: string[];
  }>;
}

interface ConsensusMonitorProps {
  network: string;
}

export default function ConsensusMonitor({ network }: ConsensusMonitorProps) {
  const [consensusData, setConsensusData] = useState<ConsensusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchConsensusData = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/blockchain?network=${network}&type=consensus`);
        if (!response.ok) {
          throw new Error(`Failed to fetch consensus data: ${response.statusText}`);
        }
        const data = await response.json();
        setConsensusData(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        console.error('Consensus data fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchConsensusData();
    const interval = setInterval(fetchConsensusData, 10000); // Update every 10 seconds

    return () => clearInterval(interval);
  }, [network]);

  if (loading) {
    return (
      <div className="brutal-border bg-pure-white p-6">
        <div className="space-y-4">
          <div className="loading-skeleton h-6 w-48"></div>
          <div className="loading-skeleton h-4 w-full"></div>
          <div className="loading-skeleton h-4 w-3/4"></div>
        </div>
      </div>
    );
  }

  if (error || !consensusData) {
    return (
      <div className="brutal-border bg-pure-white p-6">
        <div className="text-center">
          <h3 className="font-bold text-lg mb-2">CONSENSUS ERROR</h3>
          <p className="text-gray-600">{error || 'No consensus data available'}</p>
        </div>
      </div>
    );
  }

  const participationPercentage = (consensusData.activeNodes / consensusData.totalNodes) * 100;
  const consensusPercentage = (consensusData.activeNodes / consensusData.consensusThreshold) * 100;

  return (
    <div className="space-y-6">
      {/* Network Overview */}
      <div className="brutal-border bg-pure-white p-6">
        <h2 className="text-xl font-bold mb-6 uppercase tracking-wide">
          {consensusData.network} CONSENSUS MONITOR
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="metric-card">
            <div className="metric-label">TOTAL NODES</div>
            <div className="metric-value">{consensusData.totalNodes.toLocaleString()}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">ACTIVE NODES</div>
            <div className="metric-value">{consensusData.activeNodes.toLocaleString()}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">CONSENSUS THRESHOLD</div>
            <div className="metric-value">{consensusData.consensusThreshold.toLocaleString()}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">CURRENT ROUND</div>
            <div className="metric-value">{consensusData.currentRound.toLocaleString()}</div>
          </div>
        </div>

        {/* Participation Rate Visualization */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="metric-label">NETWORK PARTICIPATION</span>
            <span className="font-mono text-sm">{participationPercentage.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-200 h-4 brutal-border">
            <div 
              className="h-full bg-pure-black transition-all duration-500"
              style={{ width: `${Math.min(participationPercentage, 100)}%` }}
            ></div>
          </div>
        </div>

        {/* Consensus Strength */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="metric-label">CONSENSUS STRENGTH</span>
            <span className="font-mono text-sm">{Math.min(consensusPercentage, 100).toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-200 h-4 brutal-border">
            <div 
              className={`h-full transition-all duration-500 ${
                consensusPercentage >= 100 ? 'bg-green-600' : 
                consensusPercentage >= 80 ? 'bg-yellow-600' : 'bg-red-600'
              }`}
              style={{ width: `${Math.min(consensusPercentage, 100)}%` }}
            ></div>
          </div>
        </div>

        {/* Real-time Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="metric-card">
            <div className="metric-label">VOTING POWER</div>
            <div className="metric-value">{(consensusData.votingPower / 1000000).toFixed(1)}M</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">FINALITY TIME</div>
            <div className="metric-value">{consensusData.finalityTime}S</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">BLOCK HEIGHT</div>
            <div className="metric-value">{consensusData.blockHeight.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Recent Rounds */}
      <div className="brutal-border bg-pure-white p-6">
        <h3 className="text-lg font-bold mb-4 uppercase tracking-wide">RECENT CONSENSUS ROUNDS</h3>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-pure-black">
                <th className="data-grid-header">ROUND</th>
                <th className="data-grid-header">STATUS</th>
                <th className="data-grid-header">VOTES</th>
                <th className="data-grid-header">THRESHOLD</th>
                <th className="data-grid-header">PARTICIPATION</th>
                <th className="data-grid-header">DURATION</th>
                <th className="data-grid-header">TIME</th>
              </tr>
            </thead>
            <tbody>
              {consensusData.rounds.map((round) => {
                const participationRate = (round.votes / consensusData.activeNodes) * 100;
                const duration = round.endTime - round.startTime;
                
                return (
                  <tr key={round.roundId} className="border-b border-gray-300">
                    <td className="data-grid-cell font-mono">{round.roundId}</td>
                    <td className="data-grid-cell">
                      <span className={`px-2 py-1 text-xs font-bold uppercase ${
                        round.status === 'completed' ? 'bg-green-200 text-green-800' :
                        round.status === 'pending' ? 'bg-yellow-200 text-yellow-800' :
                        'bg-red-200 text-red-800'
                      }`}>
                        {round.status}
                      </span>
                    </td>
                    <td className="data-grid-cell font-mono">{round.votes.toLocaleString()}</td>
                    <td className="data-grid-cell font-mono">{round.threshold.toLocaleString()}</td>
                    <td className="data-grid-cell font-mono">{participationRate.toFixed(1)}%</td>
                    <td className="data-grid-cell font-mono">{duration}s</td>
                    <td className="data-grid-cell font-mono text-xs">
                      {new Date(round.startTime * 1000).toLocaleTimeString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active Validators */}
      <div className="brutal-border bg-pure-white p-6">
        <h3 className="text-lg font-bold mb-4 uppercase tracking-wide">TOP VALIDATORS</h3>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-pure-black">
                <th className="data-grid-header">VALIDATOR</th>
                <th className="data-grid-header">STATUS</th>
                <th className="data-grid-header">VOTING POWER</th>
                <th className="data-grid-header">UPTIME</th>
                <th className="data-grid-header">LAST VOTE</th>
              </tr>
            </thead>
            <tbody>
              {consensusData.validators.slice(0, 10).map((validator, index) => (
                <tr key={validator.address} className="border-b border-gray-300">
                  <td className="data-grid-cell">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs">#{index + 1}</span>
                      <span className="font-mono text-xs">
                        {validator.address.slice(0, 8)}...{validator.address.slice(-6)}
                      </span>
                    </div>
                  </td>
                  <td className="data-grid-cell">
                    <span className={`px-2 py-1 text-xs font-bold uppercase ${
                      validator.status === 'active' ? 'bg-green-200 text-green-800' :
                      validator.status === 'inactive' ? 'bg-gray-200 text-gray-800' :
                      'bg-red-200 text-red-800'
                    }`}>
                      {validator.status}
                    </span>
                  </td>
                  <td className="data-grid-cell font-mono">
                    {(validator.votingPower / 1000).toFixed(0)}K
                  </td>
                  <td className="data-grid-cell font-mono">{validator.uptime.toFixed(1)}%</td>
                  <td className="data-grid-cell font-mono text-xs">
                    {Math.floor((Date.now() / 1000 - validator.lastVote) / 60)}m ago
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
