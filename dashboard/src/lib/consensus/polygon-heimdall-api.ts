import { ethers } from 'ethers';

// Polygon Heimdall API endpoints
const HEIMDALL_ENDPOINTS = {
  mainnet: 'https://heimdall-api.polygon.technology',
  backup: 'https://polygon-rpc.com/heimdall',
  staking: 'https://staking-api.polygon.technology'
};

// Polygon Staking Contract on Ethereum
const STAKING_CONTRACT_ADDRESS = '0x5e3Ef299fDDf15eAa0432E6e66473ace8c13D908';
const STAKING_CONTRACT_ABI = [
  'function currentValidatorSetSize() external view returns (uint256)',
  'function getValidatorId(address user) external view returns (uint256)',
  'function validators(uint256 validatorId) external view returns (uint256 amount, uint256 reward, uint256 activationEpoch, uint256 deactivationEpoch, uint256 jailTime, address signer, address contractAddress, uint8 status)',
  'function validatorThreshold() external view returns (uint256)',
  'function totalStaked() external view returns (uint256)',
  'function epoch() external view returns (uint256)'
];

interface PolygonValidator {
  id: number;
  name: string;
  description: string;
  address: string;
  owner: string;
  signer: string;
  commissionPercent: number;
  signerPublicKey: string;
  selfStake: string;
  delegatedStake: string;
  totalStaked: string;
  status: 'active' | 'inactive' | 'jailed' | 'unstaked';
  jailEndEpoch: number;
  activationEpoch: number;
  deactivationEpoch: number;
  uptimePercent: number;
  missedLatestCheckpoint: boolean;
  missedCheckpointPercent: number;
}

interface HeimdallCheckpoint {
  proposer: string;
  startBlock: number;
  endBlock: number;
  rootHash: string;
  accountRootHash: string;
  timestamp: number;
  checkpointNumber: number;
  reward: string;
  bor_chain_id: string;
}

interface PolygonConsensusMetrics {
  currentEpoch: number;
  currentCheckpoint: number;
  totalValidators: number;
  activeValidators: number;
  jailedValidators: number;
  totalStaked: string;
  averageStake: string;
  checkpointInterval: number;
  lastCheckpointTime: number;
  networkUptime: number;
  participationRate: number;
}

export class PolygonHeimdallService {
  private ethProvider: ethers.JsonRpcProvider;
  private stakingContract: ethers.Contract;

  constructor() {
    this.ethProvider = new ethers.JsonRpcProvider('https://ethereum-rpc.publicnode.com');
    this.stakingContract = new ethers.Contract(
      STAKING_CONTRACT_ADDRESS,
      STAKING_CONTRACT_ABI,
      this.ethProvider
    );
  }

  async getCurrentEpoch(): Promise<number> {
    try {
      const epoch = await this.stakingContract.epoch();
      return Number(epoch);
    } catch (error) {
      console.error('Error fetching current epoch from staking contract:', error);
      
      // Fallback to Heimdall API
      try {
        const response = await fetch(`${HEIMDALL_ENDPOINTS.mainnet}/staking/current-epoch`);
        if (!response.ok) throw new Error('Heimdall API failed');
        
        const data = await response.json();
        return data.result.epoch;
      } catch (heimdallError) {
        console.error('Error fetching epoch from Heimdall:', heimdallError);
        throw new Error('Unable to fetch current epoch');
      }
    }
  }

  async getValidatorSet(): Promise<PolygonValidator[]> {
    try {
      const response = await fetch(`${HEIMDALL_ENDPOINTS.mainnet}/staking/validator-set`);
      if (!response.ok) throw new Error('Failed to fetch validator set');
      
      const data = await response.json();
      const validators: PolygonValidator[] = [];

      for (const validator of data.result.validators) {
        try {
          // Get detailed validator info
          const detailResponse = await fetch(
            `${HEIMDALL_ENDPOINTS.mainnet}/staking/validator/${validator.ID}`
          );
          
          if (detailResponse.ok) {
            const detailData = await detailResponse.json();
            const validatorDetail = detailData.result;

            validators.push({
              id: validator.ID,
              name: validatorDetail.name || `Validator ${validator.ID}`,
              description: validatorDetail.description || '',
              address: validator.signer,
              owner: validatorDetail.owner,
              signer: validator.signer,
              commissionPercent: validatorDetail.commissionPercent || 0,
              signerPublicKey: validator.pubKey,
              selfStake: validatorDetail.selfStake || '0',
              delegatedStake: validatorDetail.delegatedStake || '0',
              totalStaked: validator.power,
              status: this.getValidatorStatus(validator, validatorDetail),
              jailEndEpoch: validatorDetail.jailEndEpoch || 0,
              activationEpoch: validatorDetail.activationEpoch || 0,
              deactivationEpoch: validatorDetail.deactivationEpoch || 0,
              uptimePercent: this.calculateUptime(validatorDetail),
              missedLatestCheckpoint: validatorDetail.missedLatestCheckpoint || false,
              missedCheckpointPercent: validatorDetail.missedCheckpointPercent || 0
            });
          }
        } catch (detailError) {
          console.error(`Error fetching details for validator ${validator.ID}:`, detailError);
          
          // Add basic validator info if detailed fetch fails
          validators.push({
            id: validator.ID,
            name: `Validator ${validator.ID}`,
            description: '',
            address: validator.signer,
            owner: validator.signer,
            signer: validator.signer,
            commissionPercent: 0,
            signerPublicKey: validator.pubKey,
            selfStake: '0',
            delegatedStake: '0',
            totalStaked: validator.power,
            status: 'active',
            jailEndEpoch: 0,
            activationEpoch: 0,
            deactivationEpoch: 0,
            uptimePercent: 95,
            missedLatestCheckpoint: false,
            missedCheckpointPercent: 0
          });
        }
      }

      return validators;
    } catch (error) {
      console.error('Error fetching validator set:', error);
      throw error;
    }
  }

  private getValidatorStatus(validator: any, detail: any): 'active' | 'inactive' | 'jailed' | 'unstaked' {
    if (detail.jailed) return 'jailed';
    if (detail.status === 'Unstaked') return 'unstaked';
    if (validator.power === '0') return 'inactive';
    return 'active';
  }

  private calculateUptime(validatorDetail: any): number {
    if (validatorDetail.missedCheckpointPercent) {
      return Math.max(0, 100 - validatorDetail.missedCheckpointPercent);
    }
    
    // Fallback calculation based on missed checkpoints
    const totalCheckpoints = validatorDetail.totalCheckpoints || 100;
    const missedCheckpoints = validatorDetail.missedCheckpoints || 0;
    return Math.max(0, ((totalCheckpoints - missedCheckpoints) / totalCheckpoints) * 100);
  }

  async getLatestCheckpoint(): Promise<HeimdallCheckpoint> {
    try {
      const response = await fetch(`${HEIMDALL_ENDPOINTS.mainnet}/checkpoint/latest`);
      if (!response.ok) throw new Error('Failed to fetch latest checkpoint');
      
      const data = await response.json();
      return data.result;
    } catch (error) {
      console.error('Error fetching latest checkpoint:', error);
      throw error;
    }
  }

  async getCheckpointHistory(limit: number = 10): Promise<HeimdallCheckpoint[]> {
    try {
      const response = await fetch(`${HEIMDALL_ENDPOINTS.mainnet}/checkpoint/list?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch checkpoint history');
      
      const data = await response.json();
      return data.result;
    } catch (error) {
      console.error('Error fetching checkpoint history:', error);
      throw error;
    }
  }

  async getStakingStats(): Promise<{
    totalStaked: string;
    totalValidators: number;
    activeValidators: number;
    jailedValidators: number;
    averageStake: string;
  }> {
    try {
      const [totalStaked, validatorSetSize, validators] = await Promise.all([
        this.stakingContract.totalStaked(),
        this.stakingContract.currentValidatorSetSize(),
        this.getValidatorSet()
      ]);

      const activeValidators = validators.filter(v => v.status === 'active').length;
      const jailedValidators = validators.filter(v => v.status === 'jailed').length;
      
      const totalStakedEth = ethers.formatEther(totalStaked);
      const averageStake = validators.length > 0 ? 
        (parseFloat(totalStakedEth) / validators.length).toString() : '0';

      return {
        totalStaked: totalStakedEth,
        totalValidators: Number(validatorSetSize),
        activeValidators,
        jailedValidators,
        averageStake
      };
    } catch (error) {
      console.error('Error fetching staking stats:', error);
      throw error;
    }
  }

  async getConsensusMetrics(): Promise<PolygonConsensusMetrics> {
    try {
      const [currentEpoch, latestCheckpoint, stakingStats, validators] = await Promise.all([
        this.getCurrentEpoch(),
        this.getLatestCheckpoint(),
        this.getStakingStats(),
        this.getValidatorSet()
      ]);

      // Calculate participation rate
      const participationRate = stakingStats.totalValidators > 0 ? 
        (stakingStats.activeValidators / stakingStats.totalValidators) * 100 : 0;

      // Calculate network uptime based on validator performance
      const totalUptime = validators.reduce((sum, v) => sum + v.uptimePercent, 0);
      const networkUptime = validators.length > 0 ? totalUptime / validators.length : 100;

      // Checkpoint interval (typically every 256 blocks on Ethereum)
      const checkpointInterval = 256;

      return {
        currentEpoch,
        currentCheckpoint: latestCheckpoint.checkpointNumber,
        totalValidators: stakingStats.totalValidators,
        activeValidators: stakingStats.activeValidators,
        jailedValidators: stakingStats.jailedValidators,
        totalStaked: stakingStats.totalStaked,
        averageStake: stakingStats.averageStake,
        checkpointInterval,
        lastCheckpointTime: latestCheckpoint.timestamp,
        networkUptime,
        participationRate
      };
    } catch (error) {
      console.error('Error calculating Polygon consensus metrics:', error);
      throw error;
    }
  }

  async getValidatorPerformance(validatorId: number): Promise<{
    id: number;
    name: string;
    totalStaked: string;
    selfStake: string;
    delegatedStake: string;
    commissionPercent: number;
    uptimePercent: number;
    checkpointsSigned: number;
    checkpointsMissed: number;
    status: string;
    jailTime: number;
    rewards: string;
  }> {
    try {
      const response = await fetch(`${HEIMDALL_ENDPOINTS.mainnet}/staking/validator/${validatorId}`);
      if (!response.ok) throw new Error(`Failed to fetch validator ${validatorId}`);
      
      const data = await response.json();
      const validator = data.result;

      // Get performance metrics
      const performanceResponse = await fetch(
        `${HEIMDALL_ENDPOINTS.mainnet}/staking/validator/${validatorId}/performance`
      );
      
      let checkpointsSigned = 0;
      let checkpointsMissed = 0;
      let rewards = '0';

      if (performanceResponse.ok) {
        const perfData = await performanceResponse.json();
        checkpointsSigned = perfData.result.checkpointsSigned || 0;
        checkpointsMissed = perfData.result.checkpointsMissed || 0;
        rewards = perfData.result.totalRewards || '0';
      }

      return {
        id: validatorId,
        name: validator.name || `Validator ${validatorId}`,
        totalStaked: validator.totalStaked || '0',
        selfStake: validator.selfStake || '0',
        delegatedStake: validator.delegatedStake || '0',
        commissionPercent: validator.commissionPercent || 0,
        uptimePercent: this.calculateUptime(validator),
        checkpointsSigned,
        checkpointsMissed,
        status: validator.status || 'unknown',
        jailTime: validator.jailTime || 0,
        rewards
      };
    } catch (error) {
      console.error(`Error fetching validator ${validatorId} performance:`, error);
      throw error;
    }
  }
}

export const polygonHeimdallService = new PolygonHeimdallService();
