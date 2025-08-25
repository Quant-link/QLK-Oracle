import { ethers, upgrades, network } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  QuantlinkOracle,
  NodeManager,
  ConsensusEngine,
  SecurityManager,
  AccessControlManager,
  PriceFeedAdapter,
  ProtocolIntegration,
} from "../typechain-types";

interface DeploymentConfig {
  admin: string;
  nodes: string[];
  consensusThreshold: number;
  updateInterval: number;
  rotationInterval: number;
  emergencyMultisig?: string;
}

interface DeployedContracts {
  accessControlManager: AccessControlManager;
  securityManager: SecurityManager;
  nodeManager: NodeManager;
  consensusEngine: ConsensusEngine;
  quantlinkOracle: QuantlinkOracle;
  priceFeedAdapter: PriceFeedAdapter;
  protocolIntegration: ProtocolIntegration;
}

async function getDeploymentConfig(): Promise<DeploymentConfig> {
  const [deployer] = await ethers.getSigners();
  
  // Network-specific configurations
  const configs: Record<string, DeploymentConfig> = {
    localhost: {
      admin: deployer.address,
      nodes: [], // Will be populated with test accounts
      consensusThreshold: 6,
      updateInterval: 300, // 5 minutes
      rotationInterval: 300, // 5 minutes
    },
    sepolia: {
      admin: process.env.ADMIN_ADDRESS || deployer.address,
      nodes: process.env.NODE_ADDRESSES?.split(",") || [],
      consensusThreshold: 6,
      updateInterval: 300,
      rotationInterval: 300,
      emergencyMultisig: process.env.EMERGENCY_MULTISIG,
    },
    mainnet: {
      admin: process.env.ADMIN_ADDRESS || "",
      nodes: process.env.NODE_ADDRESSES?.split(",") || [],
      consensusThreshold: 6,
      updateInterval: 300,
      rotationInterval: 300,
      emergencyMultisig: process.env.EMERGENCY_MULTISIG || "",
    },
  };

  const config = configs[network.name];
  if (!config) {
    throw new Error(`No configuration found for network: ${network.name}`);
  }

  // Validate configuration
  if (!config.admin) {
    throw new Error("Admin address is required");
  }

  if (network.name === "mainnet" && config.nodes.length < 10) {
    throw new Error("Mainnet deployment requires at least 10 node addresses");
  }

  return config;
}

async function deployContracts(config: DeploymentConfig): Promise<DeployedContracts> {
  console.log("🚀 Starting Quantlink Oracle deployment...");
  console.log(`Network: ${network.name}`);
  console.log(`Admin: ${config.admin}`);
  console.log(`Nodes: ${config.nodes.length}`);

  // Deploy AccessControlManager
  console.log("\n📋 Deploying AccessControlManager...");
  const AccessControlManagerFactory = await ethers.getContractFactory("AccessControlManager");
  const accessControlManager = (await upgrades.deployProxy(
    AccessControlManagerFactory,
    [config.admin],
    { initializer: "initialize" }
  )) as unknown as AccessControlManager;
  await accessControlManager.waitForDeployment();
  console.log(`✅ AccessControlManager deployed at: ${await accessControlManager.getAddress()}`);

  // Deploy SecurityManager
  console.log("\n🔒 Deploying SecurityManager...");
  const SecurityManagerFactory = await ethers.getContractFactory("SecurityManager");
  const securityManager = (await upgrades.deployProxy(
    SecurityManagerFactory,
    [config.admin],
    { initializer: "initialize" }
  )) as unknown as SecurityManager;
  await securityManager.waitForDeployment();
  console.log(`✅ SecurityManager deployed at: ${await securityManager.getAddress()}`);

  // Deploy NodeManager
  console.log("\n🔗 Deploying NodeManager...");
  const NodeManagerFactory = await ethers.getContractFactory("NodeManager");
  const nodeManager = (await upgrades.deployProxy(
    NodeManagerFactory,
    [config.admin],
    { initializer: "initialize" }
  )) as unknown as NodeManager;
  await nodeManager.waitForDeployment();
  console.log(`✅ NodeManager deployed at: ${await nodeManager.getAddress()}`);

  // Deploy ConsensusEngine
  console.log("\n🤝 Deploying ConsensusEngine...");
  const ConsensusEngineFactory = await ethers.getContractFactory("ConsensusEngine");
  const consensusEngine = (await upgrades.deployProxy(
    ConsensusEngineFactory,
    [config.admin, await nodeManager.getAddress()],
    { initializer: "initialize" }
  )) as unknown as ConsensusEngine;
  await consensusEngine.waitForDeployment();
  console.log(`✅ ConsensusEngine deployed at: ${await consensusEngine.getAddress()}`);

  // Deploy QuantlinkOracle
  console.log("\n🔮 Deploying QuantlinkOracle...");
  const QuantlinkOracleFactory = await ethers.getContractFactory("QuantlinkOracle");
  const quantlinkOracle = (await upgrades.deployProxy(
    QuantlinkOracleFactory,
    [config.admin, await nodeManager.getAddress(), await consensusEngine.getAddress()],
    { initializer: "initialize" }
  )) as unknown as QuantlinkOracle;
  await quantlinkOracle.waitForDeployment();
  console.log(`✅ QuantlinkOracle deployed at: ${await quantlinkOracle.getAddress()}`);

  // Deploy PriceFeedAdapter
  console.log("\n💰 Deploying PriceFeedAdapter...");
  const PriceFeedAdapterFactory = await ethers.getContractFactory("PriceFeedAdapter");
  const priceFeedAdapter = (await upgrades.deployProxy(
    PriceFeedAdapterFactory,
    [config.admin, await quantlinkOracle.getAddress()],
    { initializer: "initialize" }
  )) as unknown as PriceFeedAdapter;
  await priceFeedAdapter.waitForDeployment();
  console.log(`✅ PriceFeedAdapter deployed at: ${await priceFeedAdapter.getAddress()}`);

  // Deploy ProtocolIntegration
  console.log("\n🔌 Deploying ProtocolIntegration...");
  const ProtocolIntegrationFactory = await ethers.getContractFactory("ProtocolIntegration");
  const protocolIntegration = (await upgrades.deployProxy(
    ProtocolIntegrationFactory,
    [config.admin],
    { initializer: "initialize" }
  )) as unknown as ProtocolIntegration;
  await protocolIntegration.waitForDeployment();
  console.log(`✅ ProtocolIntegration deployed at: ${await protocolIntegration.getAddress()}`);

  return {
    accessControlManager,
    securityManager,
    nodeManager,
    consensusEngine,
    quantlinkOracle,
    priceFeedAdapter,
    protocolIntegration,
  };
}

async function configureContracts(
  contracts: DeployedContracts,
  config: DeploymentConfig
): Promise<void> {
  console.log("\n⚙️ Configuring contracts...");

  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  const SECURITY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SECURITY_ROLE"));
  const EMERGENCY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE"));

  // Grant cross-contract permissions
  console.log("🔐 Setting up cross-contract permissions...");
  
  // NodeManager permissions
  await contracts.nodeManager.grantRole(ORACLE_ROLE, await contracts.quantlinkOracle.getAddress());
  console.log("✅ Granted Oracle role to QuantlinkOracle on NodeManager");

  // ConsensusEngine permissions
  await contracts.consensusEngine.grantRole(ORACLE_ROLE, await contracts.quantlinkOracle.getAddress());
  console.log("✅ Granted Oracle role to QuantlinkOracle on ConsensusEngine");

  // SecurityManager permissions
  await contracts.securityManager.grantRole(SECURITY_ROLE, await contracts.quantlinkOracle.getAddress());
  console.log("✅ Granted Security role to QuantlinkOracle on SecurityManager");

  // Configure emergency multisig if provided
  if (config.emergencyMultisig) {
    await contracts.quantlinkOracle.grantRole(EMERGENCY_ROLE, config.emergencyMultisig);
    await contracts.securityManager.grantRole(EMERGENCY_ROLE, config.emergencyMultisig);
    console.log(`✅ Granted Emergency role to multisig: ${config.emergencyMultisig}`);
  }

  // Configure NodeManager rotation interval
  if (config.rotationInterval !== 300) {
    await contracts.nodeManager.setRotationInterval(config.rotationInterval);
    console.log(`✅ Set rotation interval to ${config.rotationInterval} seconds`);
  }

  // Configure consensus threshold if different from default
  if (config.consensusThreshold !== 6) {
    await contracts.quantlinkOracle.updateConsensusThreshold(config.consensusThreshold);
    console.log(`✅ Set consensus threshold to ${config.consensusThreshold}`);
  }

  console.log("✅ Contract configuration completed");
}

async function registerNodes(
  contracts: DeployedContracts,
  config: DeploymentConfig
): Promise<void> {
  if (config.nodes.length === 0) {
    console.log("⚠️ No nodes to register");
    return;
  }

  console.log(`\n👥 Registering ${config.nodes.length} nodes...`);

  for (let i = 0; i < config.nodes.length; i++) {
    const nodeAddress = config.nodes[i];
    
    try {
      // Register node
      await contracts.nodeManager.registerNode(nodeAddress, "0x");
      console.log(`✅ Registered node ${i + 1}: ${nodeAddress}`);

      // Activate first 6 nodes (minimum for consensus)
      if (i < 6) {
        const nodeState = i === 0 ? 2 : 3; // First node as submitter, others as validators
        await contracts.nodeManager.activateNode(nodeAddress, nodeState);
        await contracts.quantlinkOracle.addNode(nodeAddress);
        console.log(`✅ Activated node ${i + 1} as ${nodeState === 2 ? 'submitter' : 'validator'}`);
      } else {
        // Remaining nodes as backup
        await contracts.nodeManager.activateNode(nodeAddress, 4); // Backup state
        console.log(`✅ Activated node ${i + 1} as backup`);
      }
    } catch (error) {
      console.error(`❌ Failed to register node ${i + 1}: ${nodeAddress}`, error);
    }
  }

  console.log("✅ Node registration completed");
}

async function saveDeploymentInfo(contracts: DeployedContracts): Promise<void> {
  const deploymentInfo = {
    network: network.name,
    timestamp: new Date().toISOString(),
    contracts: {
      AccessControlManager: await contracts.accessControlManager.getAddress(),
      SecurityManager: await contracts.securityManager.getAddress(),
      NodeManager: await contracts.nodeManager.getAddress(),
      ConsensusEngine: await contracts.consensusEngine.getAddress(),
      QuantlinkOracle: await contracts.quantlinkOracle.getAddress(),
      PriceFeedAdapter: await contracts.priceFeedAdapter.getAddress(),
      ProtocolIntegration: await contracts.protocolIntegration.getAddress(),
    },
  };

  const fs = await import("fs");
  const path = await import("path");
  
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `${network.name}-${Date.now()}.json`;
  const filepath = path.join(deploymentsDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`📄 Deployment info saved to: ${filepath}`);
}

async function main() {
  try {
    // Get deployment configuration
    const config = await getDeploymentConfig();

    // Deploy all contracts
    const contracts = await deployContracts(config);

    // Configure contracts
    await configureContracts(contracts, config);

    // Register nodes
    await registerNodes(contracts, config);

    // Save deployment information
    await saveDeploymentInfo(contracts);

    console.log("\n🎉 Quantlink Oracle deployment completed successfully!");
    console.log("\n📋 Deployment Summary:");
    console.log(`Network: ${network.name}`);
    console.log(`QuantlinkOracle: ${await contracts.quantlinkOracle.getAddress()}`);
    console.log(`PriceFeedAdapter: ${await contracts.priceFeedAdapter.getAddress()}`);
    console.log(`Nodes registered: ${config.nodes.length}`);
    console.log(`Consensus threshold: ${config.consensusThreshold}`);

  } catch (error) {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }
}

// Execute deployment
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { main as deploy, DeploymentConfig, DeployedContracts };
