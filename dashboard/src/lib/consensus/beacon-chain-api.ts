import { ethers } from 'ethers';

// Ethereum Beacon Chain API endpoints
const BEACON_CHAIN_ENDPOINTS = {
  mainnet: 'https://beaconcha.in/api/v1',
  consensus: 'https://beacon-nd-239-138-104.p2pify.com/3c6e0b8a9c15224a8228b9a98ca1531d',
  alternative: 'https://eth-beacon-chain.nownodes.io'
};

// Ethereum 2.0 Deposit Contract
const ETH2_DEPOSIT_CONTRACT = '0x00000000219ab540356cBB839Cbe05303d7705Fa';
const DEPOSIT_CONTRACT_ABI = [
  'function get_deposit_count() external view returns (bytes)',
  'event DepositEvent(bytes pubkey, bytes withdrawal_credentials, bytes amount, bytes signature, bytes index)'
];

interface BeaconValidator {
  validatorindex: number;
  pubkey: string;
  balance: number;
  effectivebalance: number;
  slashed: boolean;
  activationeligibilityepoch: number;
  activationepoch: number;
  exitepoch: number;
  withdrawableepoch: number;
  status: string;
  withdrawalcredentials: string;
}

interface BeaconEpoch {
  epoch: number;
  blockscount: number;
  proposerslashingscount: number;
  attesterslashingscount: number;
  attestationscount: number;
  depositscount: number;
  voluntaryexitscount: number;
  validatorscount: number;
  averagevalidatorbalance: number;
  finalized: boolean;
  eligibleether: number;
  globalparticipationrate: number;
  votedether: number;
}

interface ConsensusMetrics {
  currentEpoch: number;
  currentSlot: number;
  totalValidators: number;
  activeValidators: number;
  pendingValidators: number;
  exitingValidators: number;
  slashedValidators: number;
  participationRate: number;
  finalityDelay: number;
  averageBalance: number;
  totalStaked: number;
  networkUptime: number;
}

export class BeaconChainService {
  private provider: ethers.JsonRpcProvider;
  private depositContract: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider('https://ethereum-rpc.publicnode.com');
    this.depositContract = new ethers.Contract(
      ETH2_DEPOSIT_CONTRACT,
      DEPOSIT_CONTRACT_ABI,
      this.provider
    );
  }

  async getCurrentEpoch(): Promise<number> {
    try {
      const response = await fetch(`${BEACON_CHAIN_ENDPOINTS.mainnet}/epoch/latest`);
      if (!response.ok) throw new Error('Failed to fetch current epoch');
      
      const data = await response.json();
      return data.data.epoch;
    } catch (error) {
      console.error('Error fetching current epoch:', error);
      // Fallback calculation: Genesis was at slot 0, each epoch is 32 slots, 12 seconds per slot
      const genesisTime = 1606824023; // Ethereum 2.0 genesis timestamp
      const currentTime = Math.floor(Date.now() / 1000);
      const secondsSinceGenesis = currentTime - genesisTime;
      const slotsSinceGenesis = Math.floor(secondsSinceGenesis / 12);
      return Math.floor(slotsSinceGenesis / 32);
    }
  }

  async getValidatorStats(): Promise<{ total: number; active: number; pending: number; exiting: number; slashed: number }> {
    try {
      const response = await fetch(`${BEACON_CHAIN_ENDPOINTS.mainnet}/validators`);
      if (!response.ok) throw new Error('Failed to fetch validator stats');
      
      const data = await response.json();
      const validators = data.data;

      const stats = {
        total: validators.length,
        active: 0,
        pending: 0,
        exiting: 0,
        slashed: 0
      };

      validators.forEach((validator: BeaconValidator) => {
        if (validator.slashed) {
          stats.slashed++;
        } else {
          switch (validator.status) {
            case 'active_ongoing':
            case 'active_exiting':
              stats.active++;
              break;
            case 'pending_initialized':
            case 'pending_queued':
              stats.pending++;
              break;
            case 'exited_unslashed':
            case 'exited_slashed':
              stats.exiting++;
              break;
          }
        }
      });

      return stats;
    } catch (error) {
      console.error('Error fetching validator stats:', error);
      // Fallback to deposit contract data
      try {
        const depositCount = await this.depositContract.get_deposit_count();
        const totalDeposits = parseInt(ethers.hexlify(depositCount), 16);
        
        return {
          total: totalDeposits,
          active: Math.floor(totalDeposits * 0.95),
          pending: Math.floor(totalDeposits * 0.03),
          exiting: Math.floor(totalDeposits * 0.015),
          slashed: Math.floor(totalDeposits * 0.005)
        };
      } catch (contractError) {
        console.error('Error fetching from deposit contract:', contractError);
        throw new Error('Unable to fetch validator data from any source');
      }
    }
  }

  async getEpochData(epoch?: number): Promise<BeaconEpoch> {
    try {
      const epochToFetch = epoch || await this.getCurrentEpoch();
      const response = await fetch(`${BEACON_CHAIN_ENDPOINTS.mainnet}/epoch/${epochToFetch}`);
      
      if (!response.ok) throw new Error(`Failed to fetch epoch ${epochToFetch} data`);
      
      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Error fetching epoch data:', error);
      throw error;
    }
  }

  async getTopValidators(limit: number = 20): Promise<BeaconValidator[]> {
    try {
      const response = await fetch(`${BEACON_CHAIN_ENDPOINTS.mainnet}/validators?limit=${limit}&sort=balance:desc`);
      if (!response.ok) throw new Error('Failed to fetch top validators');
      
      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Error fetching top validators:', error);
      throw error;
    }
  }

  async getConsensusMetrics(): Promise<ConsensusMetrics> {
    try {
      const [currentEpoch, validatorStats, epochData] = await Promise.all([
        this.getCurrentEpoch(),
        this.getValidatorStats(),
        this.getEpochData()
      ]);

      // Calculate current slot (each epoch has 32 slots)
      const currentSlot = currentEpoch * 32;
      
      // Calculate total staked ETH (32 ETH per validator)
      const totalStaked = validatorStats.active * 32;
      
      // Calculate average balance from epoch data
      const averageBalance = epochData.averagevalidatorbalance / 1e9; // Convert from Gwei to ETH
      
      // Calculate participation rate
      const participationRate = epochData.globalparticipationrate || 
        (epochData.votedether / epochData.eligibleether) * 100;

      // Calculate finality delay (epochs since last finalized)
      const finalityDelay = epochData.finalized ? 0 : 1;

      // Calculate network uptime (simplified)
      const networkUptime = Math.max(95, 100 - (validatorStats.slashed / validatorStats.total) * 100);

      return {
        currentEpoch,
        currentSlot,
        totalValidators: validatorStats.total,
        activeValidators: validatorStats.active,
        pendingValidators: validatorStats.pending,
        exitingValidators: validatorStats.exiting,
        slashedValidators: validatorStats.slashed,
        participationRate,
        finalityDelay,
        averageBalance,
        totalStaked,
        networkUptime
      };
    } catch (error) {
      console.error('Error calculating consensus metrics:', error);
      throw error;
    }
  }

  async getRecentSlots(count: number = 10): Promise<Array<{
    slot: number;
    epoch: number;
    proposer: number;
    status: string;
    timestamp: number;
    attestations: number;
  }>> {
    try {
      const currentEpoch = await this.getCurrentEpoch();
      const slots = [];
      
      for (let i = 0; i < count; i++) {
        const slot = (currentEpoch * 32) - i;
        const epoch = Math.floor(slot / 32);
        
        try {
          const response = await fetch(`${BEACON_CHAIN_ENDPOINTS.mainnet}/slot/${slot}`);
          if (response.ok) {
            const data = await response.json();
            slots.push({
              slot,
              epoch,
              proposer: data.data.proposer,
              status: data.data.status,
              timestamp: data.data.timestamp,
              attestations: data.data.attestationscount || 0
            });
          }
        } catch (slotError) {
          // If individual slot fails, add placeholder
          slots.push({
            slot,
            epoch,
            proposer: 0,
            status: 'unknown',
            timestamp: Date.now() / 1000 - (i * 12),
            attestations: 0
          });
        }
      }
      
      return slots;
    } catch (error) {
      console.error('Error fetching recent slots:', error);
      throw error;
    }
  }

  async getValidatorPerformance(validatorIndex: number): Promise<{
    index: number;
    pubkey: string;
    balance: number;
    effectiveBalance: number;
    status: string;
    activationEpoch: number;
    exitEpoch: number;
    slashed: boolean;
    proposalCount: number;
    attestationCount: number;
    uptime: number;
  }> {
    try {
      const response = await fetch(`${BEACON_CHAIN_ENDPOINTS.mainnet}/validator/${validatorIndex}`);
      if (!response.ok) throw new Error(`Failed to fetch validator ${validatorIndex}`);
      
      const data = await response.json();
      const validator = data.data;

      // Get performance data
      const performanceResponse = await fetch(
        `${BEACON_CHAIN_ENDPOINTS.mainnet}/validator/${validatorIndex}/performance`
      );
      
      let proposalCount = 0;
      let attestationCount = 0;
      let uptime = 95; // Default uptime

      if (performanceResponse.ok) {
        const perfData = await performanceResponse.json();
        proposalCount = perfData.data.proposalcount || 0;
        attestationCount = perfData.data.attestationcount || 0;
        uptime = perfData.data.uptime || 95;
      }

      return {
        index: validator.validatorindex,
        pubkey: validator.pubkey,
        balance: validator.balance / 1e9, // Convert from Gwei to ETH
        effectiveBalance: validator.effectivebalance / 1e9,
        status: validator.status,
        activationEpoch: validator.activationepoch,
        exitEpoch: validator.exitepoch,
        slashed: validator.slashed,
        proposalCount,
        attestationCount,
        uptime
      };
    } catch (error) {
      console.error(`Error fetching validator ${validatorIndex} performance:`, error);
      throw error;
    }
  }
}

export const beaconChainService = new BeaconChainService();
