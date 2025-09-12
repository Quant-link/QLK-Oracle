'use client';

import React, { useEffect, useState } from 'react';
import { getNetworkConfig, getNetworkLogo, getNetworkDisplayName, getNetworkColor } from '@/lib/constants/networks';

interface VoteData {
  roundId: number;
  validator: string;
  vote: 'yes' | 'no' | 'abstain';
  timestamp: number;
  votingPower: number;
  blockHeight: number;
}

interface VotingRound {
  roundId: number;
  startTime: number;
  endTime: number;
  totalVotes: number;
  yesVotes: number;
  noVotes: number;
  abstainVotes: number;
  threshold: number;
  status: 'active' | 'passed' | 'failed' | 'pending';
  proposal: string;
  votingPowerUsed: number;
  totalVotingPower: number;
}

interface VotingVisualizationProps {
  network: string;
}

export default function VotingVisualization({ network }: VotingVisualizationProps) {
  const [currentRound, setCurrentRound] = useState<VotingRound | null>(null);
  const [recentVotes, setRecentVotes] = useState<VoteData[]>([]);
  const [votingHistory, setVotingHistory] = useState<VotingRound[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGovernanceData = async () => {
      try {
        setLoading(true);

        console.log(`🗳️ Fetching governance data for ${network}...`);

        const response = await fetch(`/api/blockchain?network=${network}&type=governance`, {
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

        // Process active proposals into voting rounds
        if (data.activeProposals && data.activeProposals.length > 0) {
          const activeProposal = data.activeProposals[0];
          const now = Date.now() / 1000;

          const currentVotingRound: VotingRound = {
            roundId: activeProposal.id,
            startTime: activeProposal.startTime,
            endTime: activeProposal.endTime,
            totalVotes: parseInt(activeProposal.totalVotes) || 0,
            yesVotes: parseInt(activeProposal.forVotes) || 0,
            noVotes: parseInt(activeProposal.againstVotes) || 0,
            abstainVotes: parseInt(activeProposal.abstainVotes) || 0,
            threshold: parseInt(activeProposal.quorum) || 0,
            status: activeProposal.state === 'active' ? 'active' :
                   activeProposal.state === 'succeeded' ? 'passed' :
                   activeProposal.state === 'defeated' ? 'failed' : 'pending',
            proposal: activeProposal.title || `Proposal ${activeProposal.id}`,
            votingPowerUsed: parseInt(activeProposal.totalVotes) || 0,
            totalVotingPower: parseInt(data.totalActiveVotingPower) || 10000000
          };

          setCurrentRound(currentVotingRound);
        }

        // Process recent votes
        if (data.recentVotes && data.recentVotes.length > 0) {
          const processedVotes: VoteData[] = data.recentVotes.map((vote: any) => ({
            roundId: vote.proposalId,
            validator: vote.voter,
            vote: vote.support === 'for' ? 'yes' : vote.support === 'against' ? 'no' : 'abstain',
            timestamp: vote.timestamp,
            votingPower: parseInt(vote.votes) || 0,
            blockHeight: vote.blockNumber || 0
          }));

          setRecentVotes(processedVotes);
        }

        // Generate voting history from proposals
        if (data.activeProposals) {
          const history: VotingRound[] = data.activeProposals.map((proposal: any) => ({
            roundId: proposal.id,
            startTime: proposal.startTime,
            endTime: proposal.endTime,
            totalVotes: parseInt(proposal.totalVotes) || 0,
            yesVotes: parseInt(proposal.forVotes) || 0,
            noVotes: parseInt(proposal.againstVotes) || 0,
            abstainVotes: parseInt(proposal.abstainVotes) || 0,
            threshold: parseInt(proposal.quorum) || 0,
            status: proposal.state === 'active' ? 'active' :
                   proposal.state === 'succeeded' ? 'passed' :
                   proposal.state === 'defeated' ? 'failed' : 'pending',
            proposal: proposal.title || `Proposal ${proposal.id}`,
            votingPowerUsed: parseInt(proposal.totalVotes) || 0,
            totalVotingPower: parseInt(data.totalActiveVotingPower) || 10000000
          }));

          setVotingHistory(history);
        }

      } catch (error) {
        console.error(`❌ Error fetching governance data for ${network}:`, error);
        throw error;
      } finally {
        setLoading(false);
      }
    };

    const generateRealisticGovernanceData = () => {
      console.log(`🎭 Generating realistic governance data for ${network}...`);

      // Network-specific governance parameters
      const governanceConfig = {
        ethereum: {
          protocols: ['Compound', 'Aave', 'Uniswap', 'ENS'],
          avgProposals: 15,
          avgVotingPower: 50000000,
          participationRate: 0.12
        },
        polygon: {
          protocols: ['Aave', 'QuickSwap', 'Polygon DAO'],
          avgProposals: 8,
          avgVotingPower: 25000000,
          participationRate: 0.18
        },
        arbitrum: {
          protocols: ['Arbitrum DAO', 'GMX', 'Camelot'],
          avgProposals: 6,
          avgVotingPower: 15000000,
          participationRate: 0.15
        },
        bsc: {
          protocols: ['PancakeSwap', 'Venus', 'BNB Chain'],
          avgProposals: 10,
          avgVotingPower: 30000000,
          participationRate: 0.20
        },
        optimism: {
          protocols: ['Optimism Collective', 'Synthetix', 'Velodrome'],
          avgProposals: 7,
          avgVotingPower: 20000000,
          participationRate: 0.14
        }
      };

      const config = governanceConfig[network as keyof typeof governanceConfig] || governanceConfig.ethereum;
      const now = Date.now() / 1000;

      // Generate active proposal
      const proposalId = Math.floor(now / 86400); // Daily proposal ID
      const protocol = config.protocols[Math.floor(Math.random() * config.protocols.length)];

      const totalVotingPower = config.avgVotingPower * (0.8 + Math.random() * 0.4);
      const votingPowerUsed = totalVotingPower * config.participationRate * (0.7 + Math.random() * 0.6);

      // Realistic voting distribution
      const yesVoteRatio = 0.65 + Math.random() * 0.25; // 65-90% yes votes typically
      const yesVotes = Math.floor(votingPowerUsed * yesVoteRatio);
      const noVotes = Math.floor(votingPowerUsed * (1 - yesVoteRatio) * 0.8);
      const abstainVotes = Math.floor(votingPowerUsed - yesVotes - noVotes);

      const currentVotingRound: VotingRound = {
        roundId: proposalId,
        startTime: now - 86400 * 3, // Started 3 days ago
        endTime: now + 86400 * 4,   // Ends in 4 days
        totalVotes: Math.floor(votingPowerUsed / 1000000), // Convert to millions for display
        yesVotes,
        noVotes,
        abstainVotes,
        threshold: Math.floor(totalVotingPower * 0.04), // 4% quorum typical
        status: 'active',
        proposal: `${protocol} Governance Proposal #${proposalId}: ${getRealisticProposalTitle(network)}`,
        votingPowerUsed: Math.floor(votingPowerUsed),
        totalVotingPower: Math.floor(totalVotingPower)
      };

      // Generate recent votes with realistic validator addresses
      const recentVotes: VoteData[] = Array.from({ length: 25 }, (_, i) => {
        const voteTime = now - (i * 1800) - Math.random() * 1800; // Every 30 minutes with variance
        const validatorAddress = generateRealisticAddress(network, i);
        const voteChoice = Math.random() < 0.7 ? 'yes' : Math.random() < 0.85 ? 'no' : 'abstain';

        return {
          roundId: proposalId - Math.floor(i / 8), // Spread across recent proposals
          validator: validatorAddress,
          vote: voteChoice,
          timestamp: voteTime,
          votingPower: Math.floor(Math.random() * 500000) + 50000, // 50K - 550K voting power
          blockHeight: Math.floor(voteTime / 12) // Approximate block height
        };
      });

      // Generate voting history
      const votingHistory: VotingRound[] = Array.from({ length: 12 }, (_, i) => {
        const historyProposalId = proposalId - i - 1;
        const historyVotingPowerUsed = totalVotingPower * config.participationRate * (0.6 + Math.random() * 0.4);
        const historyYesRatio = 0.55 + Math.random() * 0.35;
        const historyYesVotes = Math.floor(historyVotingPowerUsed * historyYesRatio);
        const historyNoVotes = Math.floor(historyVotingPowerUsed * (1 - historyYesRatio) * 0.85);
        const historyAbstainVotes = Math.floor(historyVotingPowerUsed - historyYesVotes - historyNoVotes);

        const passed = historyYesVotes > Math.floor(totalVotingPower * 0.04);

        return {
          roundId: historyProposalId,
          startTime: now - 86400 * (7 * (i + 1)), // Weekly proposals
          endTime: now - 86400 * (7 * (i + 1) - 7),
          totalVotes: Math.floor(historyVotingPowerUsed / 1000000),
          yesVotes: historyYesVotes,
          noVotes: historyNoVotes,
          abstainVotes: historyAbstainVotes,
          threshold: Math.floor(totalVotingPower * 0.04),
          status: passed ? 'passed' : 'failed',
          proposal: `${protocol} Proposal #${historyProposalId}: ${getRealisticProposalTitle(network)}`,
          votingPowerUsed: Math.floor(historyVotingPowerUsed),
          totalVotingPower: Math.floor(totalVotingPower)
        };
      });

      setCurrentRound(currentVotingRound);
      setRecentVotes(recentVotes);
      setVotingHistory(votingHistory);

      console.log(`✅ Generated realistic governance data for ${network}:`, {
        activeProposal: currentVotingRound.proposal,
        recentVotes: recentVotes.length,
        votingHistory: votingHistory.length,
        participationRate: `${(config.participationRate * 100).toFixed(1)}%`
      });
    };

    const getRealisticProposalTitle = (network: string): string => {
      const proposals = {
        ethereum: [
          'Increase COMP Rewards Distribution',
          'Update Liquidation Parameters',
          'Add New Collateral Asset Support',
          'Governance Token Emission Adjustment',
          'Protocol Fee Structure Update'
        ],
        polygon: [
          'Validator Commission Rate Adjustment',
          'Bridge Security Enhancement',
          'Staking Rewards Optimization',
          'Network Upgrade Proposal',
          'Cross-chain Integration'
        ],
        arbitrum: [
          'ARB Token Distribution Plan',
          'Sequencer Decentralization',
          'Gas Fee Optimization',
          'Developer Grant Program',
          'Security Council Election'
        ],
        bsc: [
          'Validator Set Expansion',
          'Cross-chain Bridge Upgrade',
          'BNB Burn Mechanism Update',
          'DeFi Integration Enhancement',
          'Network Performance Improvement'
        ],
        optimism: [
          'Retroactive Public Goods Funding',
          'Sequencer Revenue Sharing',
          'OP Token Allocation',
          'Fraud Proof System Update',
          'Ecosystem Development Fund'
        ]
      };

      const networkProposals = proposals[network as keyof typeof proposals] || proposals.ethereum;
      return networkProposals[Math.floor(Math.random() * networkProposals.length)];
    };

    const generateRealisticAddress = (network: string, index: number): string => {
      // Generate realistic-looking addresses based on known patterns
      const prefixes = {
        ethereum: '0x',
        polygon: '0x',
        arbitrum: '0x',
        bsc: '0x',
        optimism: '0x'
      };

      const prefix = prefixes[network as keyof typeof prefixes] || '0x';
      const randomHex = Math.random().toString(16).substring(2, 42).padEnd(40, '0');
      return prefix + randomHex;
    };

    const generateMockVotingData = () => {
      const now = Date.now() / 1000;
      const roundId = Math.floor(now / 300); // New round every 5 minutes

      // Generate current active round
      const totalVotingPower = 10000000;
      const votingPowerUsed = Math.floor(totalVotingPower * (0.6 + Math.random() * 0.3));
      const yesVotes = Math.floor(votingPowerUsed * (0.7 + Math.random() * 0.2));
      const noVotes = Math.floor((votingPowerUsed - yesVotes) * (0.8 + Math.random() * 0.2));
      const abstainVotes = votingPowerUsed - yesVotes - noVotes;
      
      const currentRoundData: VotingRound = {
        roundId,
        startTime: Math.floor(now / 300) * 300,
        endTime: Math.floor(now / 300) * 300 + 300,
        totalVotes: Math.floor(votingPowerUsed / 10000),
        yesVotes,
        noVotes,
        abstainVotes,
        threshold: Math.floor(totalVotingPower * 0.67),
        status: now < (Math.floor(now / 300) * 300 + 300) ? 'active' : 
                yesVotes > Math.floor(totalVotingPower * 0.67) ? 'passed' : 'failed',
        proposal: `Block Validation Round ${roundId}`,
        votingPowerUsed,
        totalVotingPower
      };

      // Generate recent votes
      const votes: VoteData[] = Array.from({ length: 20 }, (_, i) => ({
        roundId: roundId - Math.floor(i / 5),
        validator: `0x${Math.random().toString(16).substr(2, 40)}`,
        vote: Math.random() > 0.8 ? 'no' : Math.random() > 0.05 ? 'yes' : 'abstain',
        timestamp: now - (i * 15) - Math.random() * 15,
        votingPower: Math.floor(Math.random() * 100000) + 10000,
        blockHeight: Math.floor(now / 12) - i
      }));

      // Generate voting history
      const history: VotingRound[] = Array.from({ length: 10 }, (_, i) => {
        const historyRoundId = roundId - i - 1;
        const historyVotingPowerUsed = Math.floor(totalVotingPower * (0.7 + Math.random() * 0.2));
        const historyYesVotes = Math.floor(historyVotingPowerUsed * (0.6 + Math.random() * 0.3));
        const historyNoVotes = Math.floor((historyVotingPowerUsed - historyYesVotes) * (0.7 + Math.random() * 0.3));
        
        return {
          roundId: historyRoundId,
          startTime: historyRoundId * 300,
          endTime: historyRoundId * 300 + 300,
          totalVotes: Math.floor(historyVotingPowerUsed / 10000),
          yesVotes: historyYesVotes,
          noVotes: historyNoVotes,
          abstainVotes: historyVotingPowerUsed - historyYesVotes - historyNoVotes,
          threshold: Math.floor(totalVotingPower * 0.67),
          status: historyYesVotes > Math.floor(totalVotingPower * 0.67) ? 'passed' : 'failed',
          proposal: `Block Validation Round ${historyRoundId}`,
          votingPowerUsed: historyVotingPowerUsed,
          totalVotingPower
        };
      });

      setCurrentRound(currentRoundData);
      setRecentVotes(votes);
      setVotingHistory(history);
    };

    fetchGovernanceData();
    const interval = setInterval(fetchGovernanceData, 30000); // Update every 30 seconds

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

  if (!currentRound) {
    return (
      <div className="brutal-border bg-pure-white p-6">
        <div className="text-center">
          <h3 className="font-bold text-lg mb-2">VOTING DATA UNAVAILABLE</h3>
          <p className="text-gray-600">No active voting rounds found</p>
        </div>
      </div>
    );
  }

  const yesPercentage = (currentRound.yesVotes / currentRound.totalVotingPower) * 100;
  const noPercentage = (currentRound.noVotes / currentRound.totalVotingPower) * 100;
  const abstainPercentage = (currentRound.abstainVotes / currentRound.totalVotingPower) * 100;
  const thresholdPercentage = (currentRound.threshold / currentRound.totalVotingPower) * 100;
  const participationPercentage = (currentRound.votingPowerUsed / currentRound.totalVotingPower) * 100;

  const timeRemaining = Math.max(0, currentRound.endTime - Date.now() / 1000);
  const totalDuration = currentRound.endTime - currentRound.startTime;
  const progressPercentage = ((totalDuration - timeRemaining) / totalDuration) * 100;

  const networkLogo = getNetworkLogo(network);
  const networkDisplayName = getNetworkDisplayName(network);

  return (
    <div className="space-y-6">
      {/* Current Voting Round */}
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
              {networkDisplayName} VOTING ROUND #{currentRound.roundId}
            </h2>
          </div>
          <div className="flex items-center space-x-4">
            <span className={`px-3 py-1 text-sm font-bold uppercase ${
              currentRound.status === 'active' ? 'bg-blue-200 text-blue-800' :
              currentRound.status === 'passed' ? 'bg-green-200 text-green-800' :
              'bg-red-200 text-red-800'
            }`}>
              {currentRound.status}
            </span>
            <span className="font-mono text-sm">
              {Math.floor(timeRemaining / 60)}:{(Math.floor(timeRemaining) % 60).toString().padStart(2, '0')} remaining
            </span>
          </div>
        </div>

        {/* Proposal */}
        <div className="mb-6">
          <div className="metric-label mb-2">PROPOSAL</div>
          <div className="font-mono text-sm bg-gray-100 p-3 brutal-border">
            {currentRound.proposal}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="metric-label">ROUND PROGRESS</span>
            <span className="font-mono text-sm">{progressPercentage.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-200 h-3 brutal-border">
            <div 
              className="h-full bg-blue-600 transition-all duration-1000"
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
        </div>

        {/* Voting Results Visualization */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Vote Distribution */}
          <div>
            <h3 className="font-bold mb-4 uppercase tracking-wide">VOTE DISTRIBUTION</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium">YES VOTES</span>
                  <span className="font-mono text-sm">{yesPercentage.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-200 h-4 brutal-border">
                  <div 
                    className="h-full bg-green-600 transition-all duration-500"
                    style={{ width: `${yesPercentage}%` }}
                  ></div>
                </div>
              </div>
              
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium">NO VOTES</span>
                  <span className="font-mono text-sm">{noPercentage.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-200 h-4 brutal-border">
                  <div 
                    className="h-full bg-red-600 transition-all duration-500"
                    style={{ width: `${noPercentage}%` }}
                  ></div>
                </div>
              </div>
              
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium">ABSTAIN</span>
                  <span className="font-mono text-sm">{abstainPercentage.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-200 h-4 brutal-border">
                  <div 
                    className="h-full bg-gray-600 transition-all duration-500"
                    style={{ width: `${abstainPercentage}%` }}
                  ></div>
                </div>
              </div>

              {/* Threshold Line */}
              <div className="relative mt-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium">CONSENSUS THRESHOLD</span>
                  <span className="font-mono text-sm">{thresholdPercentage.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-200 h-2 brutal-border relative">
                  <div 
                    className="absolute top-0 h-full w-1 bg-pure-black"
                    style={{ left: `${thresholdPercentage}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          {/* Voting Statistics */}
          <div>
            <h3 className="font-bold mb-4 uppercase tracking-wide">VOTING STATISTICS</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="metric-card">
                <div className="metric-label">TOTAL VOTES</div>
                <div className="metric-value">{currentRound.totalVotes.toLocaleString()}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">PARTICIPATION</div>
                <div className="metric-value">{participationPercentage.toFixed(1)}%</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">VOTING POWER</div>
                <div className="metric-value">{(currentRound.votingPowerUsed / 1000000).toFixed(1)}M</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">THRESHOLD</div>
                <div className="metric-value">{(currentRound.threshold / 1000000).toFixed(1)}M</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Votes Stream */}
      <div className="brutal-border bg-pure-white p-6">
        <h3 className="text-lg font-bold mb-4 uppercase tracking-wide">LIVE VOTE STREAM</h3>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-pure-black">
                <th className="data-grid-header">VALIDATOR</th>
                <th className="data-grid-header">VOTE</th>
                <th className="data-grid-header">POWER</th>
                <th className="data-grid-header">ROUND</th>
                <th className="data-grid-header">TIME</th>
              </tr>
            </thead>
            <tbody>
              {recentVotes.slice(0, 15).map((vote, index) => (
                <tr key={`${vote.validator}-${vote.timestamp}`} className="border-b border-gray-300">
                  <td className="data-grid-cell font-mono text-xs">
                    {vote.validator.slice(0, 8)}...{vote.validator.slice(-6)}
                  </td>
                  <td className="data-grid-cell">
                    <span className={`px-2 py-1 text-xs font-bold uppercase ${
                      vote.vote === 'yes' ? 'bg-green-200 text-green-800' :
                      vote.vote === 'no' ? 'bg-red-200 text-red-800' :
                      'bg-gray-200 text-gray-800'
                    }`}>
                      {vote.vote}
                    </span>
                  </td>
                  <td className="data-grid-cell font-mono">{(vote.votingPower / 1000).toFixed(0)}K</td>
                  <td className="data-grid-cell font-mono">#{vote.roundId}</td>
                  <td className="data-grid-cell font-mono text-xs">
                    {Math.floor((Date.now() / 1000 - vote.timestamp) / 60)}m ago
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Voting History */}
      <div className="brutal-border bg-pure-white p-6">
        <h3 className="text-lg font-bold mb-4 uppercase tracking-wide">RECENT VOTING HISTORY</h3>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-pure-black">
                <th className="data-grid-header">ROUND</th>
                <th className="data-grid-header">STATUS</th>
                <th className="data-grid-header">YES %</th>
                <th className="data-grid-header">NO %</th>
                <th className="data-grid-header">PARTICIPATION</th>
                <th className="data-grid-header">DURATION</th>
              </tr>
            </thead>
            <tbody>
              {votingHistory.map((round) => {
                const roundYesPercentage = (round.yesVotes / round.totalVotingPower) * 100;
                const roundNoPercentage = (round.noVotes / round.totalVotingPower) * 100;
                const roundParticipation = (round.votingPowerUsed / round.totalVotingPower) * 100;
                const duration = round.endTime - round.startTime;
                
                return (
                  <tr key={round.roundId} className="border-b border-gray-300">
                    <td className="data-grid-cell font-mono">#{round.roundId}</td>
                    <td className="data-grid-cell">
                      <span className={`px-2 py-1 text-xs font-bold uppercase ${
                        round.status === 'passed' ? 'bg-green-200 text-green-800' :
                        'bg-red-200 text-red-800'
                      }`}>
                        {round.status}
                      </span>
                    </td>
                    <td className="data-grid-cell font-mono">{roundYesPercentage.toFixed(1)}%</td>
                    <td className="data-grid-cell font-mono">{roundNoPercentage.toFixed(1)}%</td>
                    <td className="data-grid-cell font-mono">{roundParticipation.toFixed(1)}%</td>
                    <td className="data-grid-cell font-mono">{duration}s</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
