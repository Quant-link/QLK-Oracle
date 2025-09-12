/**
 * @fileoverview Network Constants and Configuration
 * @author QuantLink Team
 * @version 1.0.0
 */

export interface NetworkConfig {
  id: string;
  name: string;
  displayName: string;
  logo: string;
  color: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  consensusType: 'pos' | 'poa' | 'pow';
  blockTime: number; // in seconds
  finalityTime: number; // in seconds
}

/**
 * Network configurations with logos and metadata
 */
export const NETWORKS: Record<string, NetworkConfig> = {
  ethereum: {
    id: 'ethereum',
    name: 'ethereum',
    displayName: 'Ethereum',
    logo: 'https://cryptologos.cc/logos/ethereum-eth-logo.png',
    color: '#627EEA',
    chainId: 1,
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/demo',
    explorerUrl: 'https://etherscan.io',
    consensusType: 'pos',
    blockTime: 12,
    finalityTime: 384 // 2 epochs
  },
  polygon: {
    id: 'polygon',
    name: 'polygon',
    displayName: 'Polygon',
    logo: 'https://cryptologos.cc/logos/polygon-matic-logo.png',
    color: '#8247E5',
    chainId: 137,
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    consensusType: 'pos',
    blockTime: 2,
    finalityTime: 2048 // checkpoint time
  },
  bsc: {
    id: 'bsc',
    name: 'bsc',
    displayName: 'BNB Smart Chain',
    logo: 'https://cryptologos.cc/logos/bnb-bnb-logo.png',
    color: '#F3BA2F',
    chainId: 56,
    rpcUrl: 'https://bsc-dataseed.binance.org',
    explorerUrl: 'https://bscscan.com',
    consensusType: 'poa',
    blockTime: 3,
    finalityTime: 3 // instant finality
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'arbitrum',
    displayName: 'Arbitrum One',
    logo: 'https://cryptologos.cc/logos/arbitrum-arb-logo.png',
    color: '#28A0F0',
    chainId: 42161,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    consensusType: 'pos',
    blockTime: 0.25,
    finalityTime: 12 // inherits from Ethereum
  },
  optimism: {
    id: 'optimism',
    name: 'optimism',
    displayName: 'Optimism',
    logo: 'https://cryptologos.cc/logos/optimism-ethereum-op-logo.png',
    color: '#FF0420',
    chainId: 10,
    rpcUrl: 'https://mainnet.optimism.io',
    explorerUrl: 'https://optimistic.etherscan.io',
    consensusType: 'pos',
    blockTime: 2,
    finalityTime: 12 // inherits from Ethereum
  }
};

/**
 * Get network configuration by ID
 */
export function getNetworkConfig(networkId: string): NetworkConfig | null {
  return NETWORKS[networkId] || null;
}

/**
 * Get all available networks
 */
export function getAllNetworks(): NetworkConfig[] {
  return Object.values(NETWORKS);
}

/**
 * Get network display name
 */
export function getNetworkDisplayName(networkId: string): string {
  const config = getNetworkConfig(networkId);
  return config?.displayName || networkId.toUpperCase();
}

/**
 * Get network logo URL
 */
export function getNetworkLogo(networkId: string): string {
  const config = getNetworkConfig(networkId);
  return config?.logo || '';
}

/**
 * Get network color
 */
export function getNetworkColor(networkId: string): string {
  const config = getNetworkConfig(networkId);
  return config?.color || '#000000';
}

/**
 * Check if network is supported
 */
export function isNetworkSupported(networkId: string): boolean {
  return networkId in NETWORKS;
}

/**
 * Network status indicators
 */
export const NETWORK_STATUS = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  DEGRADED: 'degraded',
  MAINTENANCE: 'maintenance'
} as const;

export type NetworkStatus = typeof NETWORK_STATUS[keyof typeof NETWORK_STATUS];

/**
 * Consensus mechanism types
 */
export const CONSENSUS_TYPES = {
  PROOF_OF_STAKE: 'pos',
  PROOF_OF_AUTHORITY: 'poa',
  PROOF_OF_WORK: 'pow'
} as const;

export type ConsensusType = typeof CONSENSUS_TYPES[keyof typeof CONSENSUS_TYPES];
