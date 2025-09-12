import { ethers } from 'ethers';

// Governance contract addresses for different networks
const GOVERNANCE_CONTRACTS = {
  ethereum: {
    compound: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529', // Compound Governor Bravo
    aave: '0xEC568fffba86c094cf06b22134B23074DFE2252c', // Aave Governance V2
    uniswap: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3', // Uniswap Governor
    ens: '0x323A76393544d5ecca80cd6ef2A560C6a395b7E3' // ENS Governor
  },
  polygon: {
    aave: '0xDf7d0e6454DB638881302729F5ba99936EaAB233', // Aave Polygon Governance
    quickswap: '0x68286607A1d43602d880D349187c3c48c0fD05E6' // QuickSwap Governance
  },
  arbitrum: {
    arbitrum: '0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9', // Arbitrum DAO Governor
    gmx: '0x159854e14A862Df9E39E1D128b8e5F70B4A3cE9B' // GMX Governance
  }
};

// Standard Governor contract ABI
const GOVERNOR_ABI = [
  'function proposalCount() external view returns (uint256)',
  'function proposals(uint256 proposalId) external view returns (uint256 id, address proposer, uint256 eta, uint256 startBlock, uint256 endBlock, uint256 forVotes, uint256 againstVotes, uint256 abstainVotes, bool canceled, bool executed)',
  'function state(uint256 proposalId) external view returns (uint8)',
  'function getActions(uint256 proposalId) external view returns (address[] memory targets, uint256[] memory values, string[] memory signatures, bytes[] memory calldatas)',
  'function getReceipt(uint256 proposalId, address voter) external view returns (bool hasVoted, uint8 support, uint256 votes)',
  'function quorumVotes() external view returns (uint256)',
  'function proposalThreshold() external view returns (uint256)',
  'function votingDelay() external view returns (uint256)',
  'function votingPeriod() external view returns (uint256)',
  'event ProposalCreated(uint256 id, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
  'event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 votes, string reason)'
];

interface GovernanceProposal {
  id: number;
  title: string;
  description: string;
  proposer: string;
  startBlock: number;
  endBlock: number;
  startTime: number;
  endTime: number;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  totalVotes: string;
  quorum: string;
  state: 'pending' | 'active' | 'canceled' | 'defeated' | 'succeeded' | 'queued' | 'expired' | 'executed';
  eta: number;
  executed: boolean;
  canceled: boolean;
  actions: {
    targets: string[];
    values: string[];
    signatures: string[];
    calldatas: string[];
  };
}

interface VoteRecord {
  proposalId: number;
  voter: string;
  support: 'for' | 'against' | 'abstain';
  votes: string;
  reason: string;
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
}

interface GovernanceMetrics {
  totalProposals: number;
  activeProposals: number;
  executedProposals: number;
  defeatedProposals: number;
  totalVoters: number;
  totalVotingPower: string;
  averageParticipation: number;
  quorumThreshold: string;
  proposalThreshold: string;
  votingDelay: number;
  votingPeriod: number;
}

export class GovernanceService {
  private providers: Record<string, ethers.JsonRpcProvider>;
  private contracts: Record<string, Record<string, ethers.Contract>>;

  constructor() {
    this.providers = {
      ethereum: new ethers.JsonRpcProvider('https://ethereum-rpc.publicnode.com'),
      polygon: new ethers.JsonRpcProvider('https://polygon-bor-rpc.publicnode.com'),
      arbitrum: new ethers.JsonRpcProvider('https://arbitrum-one-rpc.publicnode.com')
    };

    this.contracts = {};
    this.initializeContracts();
  }

  private initializeContracts() {
    for (const [network, provider] of Object.entries(this.providers)) {
      this.contracts[network] = {};
      const networkContracts = GOVERNANCE_CONTRACTS[network as keyof typeof GOVERNANCE_CONTRACTS];
      
      if (networkContracts) {
        for (const [protocol, address] of Object.entries(networkContracts)) {
          this.contracts[network][protocol] = new ethers.Contract(
            address,
            GOVERNOR_ABI,
            provider
          );
        }
      }
    }
  }

  async getProposals(network: string, protocol: string, limit: number = 10): Promise<GovernanceProposal[]> {
    try {
      const contract = this.contracts[network]?.[protocol];
      if (!contract) {
        throw new Error(`Contract not found for ${network}/${protocol}`);
      }

      const proposalCount = await contract.proposalCount();
      const proposals: GovernanceProposal[] = [];

      const startId = Math.max(1, Number(proposalCount) - limit + 1);
      
      for (let i = startId; i <= Number(proposalCount); i++) {
        try {
          const [proposalData, state, actions] = await Promise.all([
            contract.proposals(i),
            contract.state(i),
            contract.getActions(i)
          ]);

          // Get proposal creation event for description
          const filter = contract.filters.ProposalCreated(i);
          const events = await contract.queryFilter(filter);
          const description = events.length > 0 ? events[0].args?.description || '' : '';

          // Calculate voting power
          const forVotes = ethers.formatEther(proposalData.forVotes);
          const againstVotes = ethers.formatEther(proposalData.againstVotes);
          const abstainVotes = ethers.formatEther(proposalData.abstainVotes);
          const totalVotes = (
            parseFloat(forVotes) + 
            parseFloat(againstVotes) + 
            parseFloat(abstainVotes)
          ).toString();

          // Get block timestamps
          const [startBlock, endBlock] = await Promise.all([
            this.providers[network].getBlock(Number(proposalData.startBlock)),
            this.providers[network].getBlock(Number(proposalData.endBlock))
          ]);

          proposals.push({
            id: i,
            title: this.extractTitle(description),
            description,
            proposer: proposalData.proposer,
            startBlock: Number(proposalData.startBlock),
            endBlock: Number(proposalData.endBlock),
            startTime: startBlock?.timestamp || 0,
            endTime: endBlock?.timestamp || 0,
            forVotes,
            againstVotes,
            abstainVotes,
            totalVotes,
            quorum: await this.getQuorum(contract),
            state: this.mapProposalState(Number(state)),
            eta: Number(proposalData.eta),
            executed: proposalData.executed,
            canceled: proposalData.canceled,
            actions: {
              targets: actions.targets,
              values: actions.values.map((v: any) => v.toString()),
              signatures: actions.signatures,
              calldatas: actions.calldatas
            }
          });
        } catch (proposalError) {
          console.error(`Error fetching proposal ${i}:`, proposalError);
        }
      }

      return proposals.reverse(); // Return newest first
    } catch (error) {
      console.error(`Error fetching proposals for ${network}/${protocol}:`, error);
      throw error;
    }
  }

  private extractTitle(description: string): string {
    // Extract title from description (usually first line)
    const lines = description.split('\n');
    const title = lines[0]?.replace(/^#+\s*/, '').trim();
    return title || 'Untitled Proposal';
  }

  private mapProposalState(state: number): GovernanceProposal['state'] {
    const states = [
      'pending',
      'active', 
      'canceled',
      'defeated',
      'succeeded',
      'queued',
      'expired',
      'executed'
    ];
    return states[state] as GovernanceProposal['state'] || 'pending';
  }

  private async getQuorum(contract: ethers.Contract): Promise<string> {
    try {
      const quorum = await contract.quorumVotes();
      return ethers.formatEther(quorum);
    } catch (error) {
      return '0';
    }
  }

  async getVoteHistory(network: string, protocol: string, proposalId: number, limit: number = 100): Promise<VoteRecord[]> {
    try {
      const contract = this.contracts[network]?.[protocol];
      if (!contract) {
        throw new Error(`Contract not found for ${network}/${protocol}`);
      }

      const filter = contract.filters.VoteCast(null, proposalId);
      const events = await contract.queryFilter(filter);

      const votes: VoteRecord[] = [];

      for (const event of events.slice(-limit)) {
        try {
          const block = await this.providers[network].getBlock(event.blockNumber);
          const supportMap = ['against', 'for', 'abstain'];
          
          votes.push({
            proposalId,
            voter: event.args?.voter || '',
            support: supportMap[event.args?.support] as 'for' | 'against' | 'abstain',
            votes: ethers.formatEther(event.args?.votes || 0),
            reason: event.args?.reason || '',
            timestamp: block?.timestamp || 0,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash
          });
        } catch (voteError) {
          console.error('Error processing vote event:', voteError);
        }
      }

      return votes.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error(`Error fetching vote history for ${network}/${protocol}/${proposalId}:`, error);
      throw error;
    }
  }

  async getGovernanceMetrics(network: string, protocol: string): Promise<GovernanceMetrics> {
    try {
      const contract = this.contracts[network]?.[protocol];
      if (!contract) {
        throw new Error(`Contract not found for ${network}/${protocol}`);
      }

      const [
        proposalCount,
        quorumThreshold,
        proposalThreshold,
        votingDelay,
        votingPeriod,
        proposals
      ] = await Promise.all([
        contract.proposalCount(),
        this.getQuorum(contract),
        contract.proposalThreshold().catch(() => '0'),
        contract.votingDelay().catch(() => 0),
        contract.votingPeriod().catch(() => 0),
        this.getProposals(network, protocol, 50)
      ]);

      // Calculate metrics from proposals
      const activeProposals = proposals.filter(p => p.state === 'active').length;
      const executedProposals = proposals.filter(p => p.state === 'executed').length;
      const defeatedProposals = proposals.filter(p => p.state === 'defeated').length;

      // Calculate participation metrics
      const totalVotingPower = proposals.reduce((sum, p) => {
        return sum + parseFloat(p.totalVotes);
      }, 0);

      const averageParticipation = proposals.length > 0 ? 
        proposals.reduce((sum, p) => {
          const participation = parseFloat(p.totalVotes) / parseFloat(p.quorum || '1');
          return sum + Math.min(participation, 1);
        }, 0) / proposals.length * 100 : 0;

      // Count unique voters
      const allVoters = new Set<string>();
      for (const proposal of proposals.slice(0, 10)) { // Check last 10 proposals
        try {
          const votes = await this.getVoteHistory(network, protocol, proposal.id, 1000);
          votes.forEach(vote => allVoters.add(vote.voter));
        } catch (error) {
          console.error(`Error counting voters for proposal ${proposal.id}:`, error);
        }
      }

      return {
        totalProposals: Number(proposalCount),
        activeProposals,
        executedProposals,
        defeatedProposals,
        totalVoters: allVoters.size,
        totalVotingPower: totalVotingPower.toString(),
        averageParticipation,
        quorumThreshold,
        proposalThreshold: ethers.formatEther(proposalThreshold.toString()),
        votingDelay: Number(votingDelay),
        votingPeriod: Number(votingPeriod)
      };
    } catch (error) {
      console.error(`Error calculating governance metrics for ${network}/${protocol}:`, error);
      throw error;
    }
  }

  async getActiveProposals(network: string): Promise<GovernanceProposal[]> {
    const allActiveProposals: GovernanceProposal[] = [];
    
    const networkContracts = GOVERNANCE_CONTRACTS[network as keyof typeof GOVERNANCE_CONTRACTS];
    if (!networkContracts) return [];

    for (const protocol of Object.keys(networkContracts)) {
      try {
        const proposals = await this.getProposals(network, protocol, 5);
        const activeProposals = proposals.filter(p => p.state === 'active');
        allActiveProposals.push(...activeProposals);
      } catch (error) {
        console.error(`Error fetching active proposals for ${protocol}:`, error);
      }
    }

    return allActiveProposals.sort((a, b) => b.endTime - a.endTime);
  }

  async getLiveVotingData(network: string): Promise<{
    activeProposals: GovernanceProposal[];
    recentVotes: VoteRecord[];
    totalActiveVotingPower: string;
  }> {
    try {
      const activeProposals = await this.getActiveProposals(network);
      const recentVotes: VoteRecord[] = [];
      let totalActiveVotingPower = 0;

      // Get recent votes from active proposals
      for (const proposal of activeProposals) {
        try {
          const protocol = this.getProtocolFromProposal(network, proposal);
          if (protocol) {
            const votes = await this.getVoteHistory(network, protocol, proposal.id, 20);
            recentVotes.push(...votes);
            totalActiveVotingPower += parseFloat(proposal.totalVotes);
          }
        } catch (error) {
          console.error(`Error fetching votes for proposal ${proposal.id}:`, error);
        }
      }

      // Sort recent votes by timestamp
      recentVotes.sort((a, b) => b.timestamp - a.timestamp);

      return {
        activeProposals,
        recentVotes: recentVotes.slice(0, 50), // Limit to 50 most recent
        totalActiveVotingPower: totalActiveVotingPower.toString()
      };
    } catch (error) {
      console.error(`Error fetching live voting data for ${network}:`, error);
      throw error;
    }
  }

  private getProtocolFromProposal(network: string, proposal: GovernanceProposal): string | null {
    const networkContracts = GOVERNANCE_CONTRACTS[network as keyof typeof GOVERNANCE_CONTRACTS];
    if (!networkContracts) return null;

    // This is a simplified approach - in practice, you'd need to track which contract each proposal came from
    return Object.keys(networkContracts)[0] || null;
  }
}

export const governanceService = new GovernanceService();
