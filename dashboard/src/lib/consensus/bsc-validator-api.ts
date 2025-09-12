import { ethers } from 'ethers';

// BSC Validator Set Contract
const BSC_VALIDATOR_SET_ADDRESS = '0x0000000000000000000000000000000000001000';
const BSC_VALIDATOR_SET_ABI = [
  'function getValidators() external view returns (address[])',
  'function getCurrentValidatorSet() external view returns (address[])',
  'function isCurrentValidator(address validator) external view returns (bool)',
  'function getIncoming() external view returns (address[])',
  'function numOfJailed() external view returns (uint256)',
  'function totalInComing() external view returns (uint256)',
  'function misdemeanorThreshold() external view returns (uint256)',
  'function felonyThreshold() external view returns (uint256)'
];

// BSC Staking Contract
const BSC_STAKING_ADDRESS = '0x0000000000000000000000000000000000002001';
const BSC_STAKING_ABI = [
  'function getValidatorDescription(address validator) external view returns (string memory moniker, string memory identity, string memory website, string memory details)',
  'function getValidatorCommission(address validator) external view returns (uint64)',
  'function getTotalStakedByValidator(address validator) external view returns (uint256)',
  'function getValidatorJailUntilBlock(address validator) external view returns (uint256)',
  'function isValidatorJailed(address validator) external view returns (bool)'
];

// BSC System Reward Contract
const BSC_SYSTEM_REWARD_ADDRESS = '0x0000000000000000000000000000000000001002';

interface BSCValidator {
  address: string;
  moniker: string;
  identity: string;
  website: string;
  details: string;
  commission: number;
  totalStaked: string;
  isActive: boolean;
  isJailed: boolean;
  jailUntilBlock: number;
  votingPower: number;
  uptime: number;
  missedBlocks: number;
  producedBlocks: number;
}

interface BSCConsensusMetrics {
  totalValidators: number;
  activeValidators: number;
  jailedValidators: number;
  incomingValidators: number;
  currentEpoch: number;
  blockHeight: number;
  averageBlockTime: number;
  networkHashrate: string;
  totalStaked: string;
  participationRate: number;
  networkUptime: number;
}

export class BSCValidatorService {
  private provider: ethers.JsonRpcProvider;
  private validatorSetContract: ethers.Contract;
  private stakingContract: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider('https://bsc-rpc.publicnode.com');
    this.validatorSetContract = new ethers.Contract(
      BSC_VALIDATOR_SET_ADDRESS,
      BSC_VALIDATOR_SET_ABI,
      this.provider
    );
    this.stakingContract = new ethers.Contract(
      BSC_STAKING_ADDRESS,
      BSC_STAKING_ABI,
      this.provider
    );
  }

  async getCurrentValidators(): Promise<string[]> {
    try {
      const validators = await this.validatorSetContract.getCurrentValidatorSet();
      return validators;
    } catch (error) {
      console.error('Error fetching current validators:', error);
      throw error;
    }
  }

  async getAllValidators(): Promise<string[]> {
    try {
      const validators = await this.validatorSetContract.getValidators();
      return validators;
    } catch (error) {
      console.error('Error fetching all validators:', error);
      throw error;
    }
  }

  async getValidatorDetails(validatorAddress: string): Promise<BSCValidator> {
    try {
      const [
        description,
        commission,
        totalStaked,
        isActive,
        isJailed,
        jailUntilBlock,
        currentBlock
      ] = await Promise.all([
        this.stakingContract.getValidatorDescription(validatorAddress).catch(() => ({
          moniker: `Validator ${validatorAddress.slice(0, 8)}`,
          identity: '',
          website: '',
          details: ''
        })),
        this.stakingContract.getValidatorCommission(validatorAddress).catch(() => 0),
        this.stakingContract.getTotalStakedByValidator(validatorAddress).catch(() => '0'),
        this.validatorSetContract.isCurrentValidator(validatorAddress).catch(() => false),
        this.stakingContract.isValidatorJailed(validatorAddress).catch(() => false),
        this.stakingContract.getValidatorJailUntilBlock(validatorAddress).catch(() => 0),
        this.provider.getBlockNumber()
      ]);

      // Calculate voting power based on stake (simplified)
      const stakeInBNB = parseFloat(ethers.formatEther(totalStaked.toString()));
      const votingPower = Math.floor(stakeInBNB / 1000); // Simplified calculation

      // Get block production stats
      const blockStats = await this.getValidatorBlockStats(validatorAddress);

      return {
        address: validatorAddress,
        moniker: description.moniker || `Validator ${validatorAddress.slice(0, 8)}`,
        identity: description.identity || '',
        website: description.website || '',
        details: description.details || '',
        commission: Number(commission) / 100, // Convert from basis points
        totalStaked: ethers.formatEther(totalStaked.toString()),
        isActive,
        isJailed,
        jailUntilBlock: Number(jailUntilBlock),
        votingPower,
        uptime: blockStats.uptime,
        missedBlocks: blockStats.missedBlocks,
        producedBlocks: blockStats.producedBlocks
      };
    } catch (error) {
      console.error(`Error fetching validator details for ${validatorAddress}:`, error);
      throw error;
    }
  }

  async getValidatorBlockStats(validatorAddress: string): Promise<{
    uptime: number;
    missedBlocks: number;
    producedBlocks: number;
  }> {
    try {
      // Get recent blocks to calculate stats
      const currentBlock = await this.provider.getBlockNumber();
      const blocksToCheck = 1000; // Check last 1000 blocks
      const startBlock = Math.max(0, currentBlock - blocksToCheck);
      
      let producedBlocks = 0;
      let totalBlocks = 0;

      // Sample every 10th block for performance
      for (let i = startBlock; i <= currentBlock; i += 10) {
        try {
          const block = await this.provider.getBlock(i);
          if (block && block.miner) {
            totalBlocks++;
            if (block.miner.toLowerCase() === validatorAddress.toLowerCase()) {
              producedBlocks++;
            }
          }
        } catch (blockError) {
          // Skip failed block fetches
          continue;
        }
      }

      const missedBlocks = totalBlocks - producedBlocks;
      const uptime = totalBlocks > 0 ? (producedBlocks / totalBlocks) * 100 : 100;

      return {
        uptime: Math.max(0, Math.min(100, uptime)),
        missedBlocks,
        producedBlocks
      };
    } catch (error) {
      console.error(`Error calculating block stats for ${validatorAddress}:`, error);
      
      // Return default values if calculation fails
      return {
        uptime: 95,
        missedBlocks: 5,
        producedBlocks: 95
      };
    }
  }

  async getValidatorSet(): Promise<BSCValidator[]> {
    try {
      const [currentValidators, allValidators] = await Promise.all([
        this.getCurrentValidators(),
        this.getAllValidators()
      ]);

      const validators: BSCValidator[] = [];

      // Process current validators first
      for (const validatorAddress of currentValidators) {
        try {
          const validatorDetails = await this.getValidatorDetails(validatorAddress);
          validators.push(validatorDetails);
        } catch (error) {
          console.error(`Error processing validator ${validatorAddress}:`, error);
        }
      }

      // Add any additional validators that aren't current
      for (const validatorAddress of allValidators) {
        if (!currentValidators.includes(validatorAddress)) {
          try {
            const validatorDetails = await this.getValidatorDetails(validatorAddress);
            validators.push(validatorDetails);
          } catch (error) {
            console.error(`Error processing additional validator ${validatorAddress}:`, error);
          }
        }
      }

      return validators;
    } catch (error) {
      console.error('Error fetching validator set:', error);
      throw error;
    }
  }

  async getConsensusMetrics(): Promise<BSCConsensusMetrics> {
    try {
      const [
        validators,
        currentBlock,
        jailedCount,
        incomingCount
      ] = await Promise.all([
        this.getValidatorSet(),
        this.provider.getBlockNumber(),
        this.validatorSetContract.numOfJailed().catch(() => 0),
        this.validatorSetContract.totalInComing().catch(() => 0)
      ]);

      const activeValidators = validators.filter(v => v.isActive && !v.isJailed).length;
      const jailedValidators = Number(jailedCount);
      const totalValidators = validators.length;

      // Calculate total staked
      const totalStaked = validators.reduce((sum, v) => {
        return sum + parseFloat(v.totalStaked);
      }, 0);

      // Calculate participation rate
      const participationRate = totalValidators > 0 ? 
        (activeValidators / totalValidators) * 100 : 0;

      // Calculate network uptime
      const totalUptime = validators.reduce((sum, v) => sum + v.uptime, 0);
      const networkUptime = validators.length > 0 ? totalUptime / validators.length : 100;

      // Calculate average block time (BSC targets 3 seconds)
      const averageBlockTime = await this.calculateAverageBlockTime();

      // Get network hashrate (simplified)
      const networkHashrate = await this.estimateNetworkHashrate();

      // Calculate current epoch (BSC doesn't have epochs like Ethereum 2.0, use block-based)
      const currentEpoch = Math.floor(currentBlock / 200); // 200 blocks per "epoch"

      return {
        totalValidators,
        activeValidators,
        jailedValidators,
        incomingValidators: Number(incomingCount),
        currentEpoch,
        blockHeight: currentBlock,
        averageBlockTime,
        networkHashrate,
        totalStaked: totalStaked.toString(),
        participationRate,
        networkUptime
      };
    } catch (error) {
      console.error('Error calculating BSC consensus metrics:', error);
      throw error;
    }
  }

  private async calculateAverageBlockTime(): Promise<number> {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      const blocksToCheck = 100;
      const startBlockNum = currentBlock - blocksToCheck;

      const [startBlock, endBlock] = await Promise.all([
        this.provider.getBlock(startBlockNum),
        this.provider.getBlock(currentBlock)
      ]);

      if (startBlock && endBlock) {
        const timeDiff = endBlock.timestamp - startBlock.timestamp;
        return timeDiff / blocksToCheck;
      }

      return 3; // Default BSC block time
    } catch (error) {
      console.error('Error calculating average block time:', error);
      return 3;
    }
  }

  private async estimateNetworkHashrate(): Promise<string> {
    try {
      const currentBlock = await this.provider.getBlock('latest');
      if (currentBlock && currentBlock.difficulty) {
        // Simplified hashrate calculation
        const difficulty = BigInt(currentBlock.difficulty);
        const blockTime = 3; // BSC block time
        const hashrate = difficulty / BigInt(blockTime);
        
        // Convert to human readable format
        const hashrateNum = Number(hashrate);
        if (hashrateNum > 1e12) {
          return `${(hashrateNum / 1e12).toFixed(2)} TH/s`;
        } else if (hashrateNum > 1e9) {
          return `${(hashrateNum / 1e9).toFixed(2)} GH/s`;
        } else {
          return `${(hashrateNum / 1e6).toFixed(2)} MH/s`;
        }
      }

      return 'N/A';
    } catch (error) {
      console.error('Error estimating network hashrate:', error);
      return 'N/A';
    }
  }

  async getTopValidatorsByStake(limit: number = 21): Promise<BSCValidator[]> {
    try {
      const validators = await this.getValidatorSet();
      
      return validators
        .sort((a, b) => parseFloat(b.totalStaked) - parseFloat(a.totalStaked))
        .slice(0, limit);
    } catch (error) {
      console.error('Error fetching top validators by stake:', error);
      throw error;
    }
  }
}

export const bscValidatorService = new BSCValidatorService();
