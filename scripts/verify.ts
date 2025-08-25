import { ethers, run, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface DeploymentInfo {
  network: string;
  timestamp: string;
  contracts: {
    AccessControlManager: string;
    SecurityManager: string;
    NodeManager: string;
    ConsensusEngine: string;
    QuantlinkOracle: string;
    PriceFeedAdapter: string;
    ProtocolIntegration: string;
  };
}

async function loadLatestDeployment(): Promise<DeploymentInfo> {
  const deploymentsDir = path.join(__dirname, "../deployments");
  
  if (!fs.existsSync(deploymentsDir)) {
    throw new Error("No deployments directory found");
  }

  const files = fs.readdirSync(deploymentsDir)
    .filter(file => file.startsWith(network.name) && file.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error(`No deployment files found for network: ${network.name}`);
  }

  const latestFile = files[0];
  const filepath = path.join(deploymentsDir, latestFile);
  const deploymentData = JSON.parse(fs.readFileSync(filepath, 'utf8'));

  console.log(`📄 Loading deployment from: ${latestFile}`);
  return deploymentData;
}

async function verifyContract(
  contractName: string,
  contractAddress: string,
  constructorArgs: any[] = []
): Promise<void> {
  try {
    console.log(`🔍 Verifying ${contractName} at ${contractAddress}...`);
    
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: constructorArgs,
    });
    
    console.log(`✅ ${contractName} verified successfully`);
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log(`✅ ${contractName} already verified`);
    } else {
      console.error(`❌ Failed to verify ${contractName}:`, error.message);
    }
  }
}

async function verifyImplementationContracts(deployment: DeploymentInfo): Promise<void> {
  console.log("\n🔍 Verifying implementation contracts...");

  // Get implementation addresses for proxy contracts
  const contracts = [
    { name: "AccessControlManager", address: deployment.contracts.AccessControlManager },
    { name: "SecurityManager", address: deployment.contracts.SecurityManager },
    { name: "NodeManager", address: deployment.contracts.NodeManager },
    { name: "ConsensusEngine", address: deployment.contracts.ConsensusEngine },
    { name: "QuantlinkOracle", address: deployment.contracts.QuantlinkOracle },
    { name: "PriceFeedAdapter", address: deployment.contracts.PriceFeedAdapter },
    { name: "ProtocolIntegration", address: deployment.contracts.ProtocolIntegration },
  ];

  for (const contract of contracts) {
    try {
      // Get implementation address from proxy
      const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
      const implementationAddress = await ethers.provider.getStorage(contract.address, implementationSlot);
      const cleanAddress = "0x" + implementationAddress.slice(-40);

      if (cleanAddress !== "0x0000000000000000000000000000000000000000") {
        await verifyContract(`${contract.name} Implementation`, cleanAddress);
      }
    } catch (error) {
      console.error(`❌ Failed to get implementation for ${contract.name}:`, error);
    }
  }
}

async function verifyProxyContracts(deployment: DeploymentInfo): Promise<void> {
  console.log("\n🔍 Verifying proxy contracts...");

  const contracts = [
    { name: "AccessControlManager Proxy", address: deployment.contracts.AccessControlManager },
    { name: "SecurityManager Proxy", address: deployment.contracts.SecurityManager },
    { name: "NodeManager Proxy", address: deployment.contracts.NodeManager },
    { name: "ConsensusEngine Proxy", address: deployment.contracts.ConsensusEngine },
    { name: "QuantlinkOracle Proxy", address: deployment.contracts.QuantlinkOracle },
    { name: "PriceFeedAdapter Proxy", address: deployment.contracts.PriceFeedAdapter },
    { name: "ProtocolIntegration Proxy", address: deployment.contracts.ProtocolIntegration },
  ];

  for (const contract of contracts) {
    await verifyContract(contract.name, contract.address);
  }
}

async function validateDeployment(deployment: DeploymentInfo): Promise<void> {
  console.log("\n✅ Validating deployment...");

  try {
    // Connect to contracts
    const quantlinkOracle = await ethers.getContractAt("QuantlinkOracle", deployment.contracts.QuantlinkOracle);
    const nodeManager = await ethers.getContractAt("NodeManager", deployment.contracts.NodeManager);
    const consensusEngine = await ethers.getContractAt("ConsensusEngine", deployment.contracts.ConsensusEngine);
    const securityManager = await ethers.getContractAt("SecurityManager", deployment.contracts.SecurityManager);
    const priceFeedAdapter = await ethers.getContractAt("PriceFeedAdapter", deployment.contracts.PriceFeedAdapter);

    // Validate Oracle configuration
    const consensusThreshold = await quantlinkOracle.getConsensusThreshold();
    const updateInterval = await quantlinkOracle.getUpdateInterval();
    const totalNodes = await quantlinkOracle.getTotalNodes();

    console.log(`📊 Oracle Configuration:`);
    console.log(`  Consensus Threshold: ${consensusThreshold}`);
    console.log(`  Update Interval: ${updateInterval} seconds`);
    console.log(`  Total Nodes: ${totalNodes}`);

    // Validate NodeManager
    const activeNodes = await nodeManager.getTotalActiveNodes();
    const currentSubmitter = await nodeManager.getCurrentSubmitter();
    const rotationSchedule = await nodeManager.getRotationSchedule();

    console.log(`👥 Node Management:`);
    console.log(`  Active Nodes: ${activeNodes}`);
    console.log(`  Current Submitter: ${currentSubmitter}`);
    console.log(`  Rotation Interval: ${rotationSchedule.rotationInterval} seconds`);

    // Validate Security
    const threatLevel = await securityManager.getThreatLevel();
    const isUnderAttack = await securityManager.isUnderAttack();

    console.log(`🔒 Security Status:`);
    console.log(`  Threat Level: ${threatLevel}`);
    console.log(`  Under Attack: ${isUnderAttack}`);

    // Validate PriceFeed
    const decimals = await priceFeedAdapter.decimals();
    const description = await priceFeedAdapter.description();
    const version = await priceFeedAdapter.version();

    console.log(`💰 Price Feed:`);
    console.log(`  Decimals: ${decimals}`);
    console.log(`  Description: ${description}`);
    console.log(`  Version: ${version}`);

    // Check contract versions
    const oracleVersion = await quantlinkOracle.version();
    const nodeManagerVersion = await nodeManager.version();

    console.log(`📦 Contract Versions:`);
    console.log(`  Oracle: ${oracleVersion}`);
    console.log(`  NodeManager: ${nodeManagerVersion}`);

    console.log("✅ Deployment validation completed successfully");

  } catch (error) {
    console.error("❌ Deployment validation failed:", error);
    throw error;
  }
}

async function generateIntegrationGuide(deployment: DeploymentInfo): Promise<void> {
  console.log("\n📚 Generating integration guide...");

  const guide = `# Quantlink Oracle Integration Guide

## Network: ${deployment.network}
## Deployed: ${deployment.timestamp}

## Contract Addresses

### Core Contracts
- **QuantlinkOracle**: \`${deployment.contracts.QuantlinkOracle}\`
- **PriceFeedAdapter**: \`${deployment.contracts.PriceFeedAdapter}\`
- **NodeManager**: \`${deployment.contracts.NodeManager}\`
- **ConsensusEngine**: \`${deployment.contracts.ConsensusEngine}\`

### Supporting Contracts
- **SecurityManager**: \`${deployment.contracts.SecurityManager}\`
- **AccessControlManager**: \`${deployment.contracts.AccessControlManager}\`
- **ProtocolIntegration**: \`${deployment.contracts.ProtocolIntegration}\`

## Quick Integration

### For Chainlink-Compatible Integration
\`\`\`solidity
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract YourContract {
    AggregatorV3Interface internal priceFeed;
    
    constructor() {
        priceFeed = AggregatorV3Interface(${deployment.contracts.PriceFeedAdapter});
    }
    
    function getLatestPrice() public view returns (int) {
        (,int price,,,) = priceFeed.latestRoundData();
        return price;
    }
}
\`\`\`

### For Native Quantlink Integration
\`\`\`solidity
import "./interfaces/IQuantlinkOracle.sol";

contract YourContract {
    IQuantlinkOracle internal oracle;
    
    constructor() {
        oracle = IQuantlinkOracle(${deployment.contracts.QuantlinkOracle});
    }
    
    function getLatestFeeData() public view returns (IQuantlinkOracle.FeeData memory) {
        return oracle.getLatestFeeData();
    }
}
\`\`\`

## Protocol Integration Helper

For advanced integration features, use the ProtocolIntegration contract:

\`\`\`solidity
IProtocolIntegration integration = IProtocolIntegration(${deployment.contracts.ProtocolIntegration});

// Register your protocol
integration.registerProtocol(
    address(this),
    IntegrationType.FeeCalculation,
    ${deployment.contracts.PriceFeedAdapter},
    300, // 5 minute updates
    "0x" // custom config
);

// Calculate fees
(uint256 fee, uint256 oracleFee) = integration.calculateFee(
    address(this),
    amount,
    2 // combined fee type
);
\`\`\`

## Support

For technical support and documentation, visit: https://docs.quantlink.io
`;

  const guidePath = path.join(__dirname, "../deployments", `integration-guide-${network.name}.md`);
  fs.writeFileSync(guidePath, guide);
  console.log(`📄 Integration guide saved to: ${guidePath}`);
}

async function main() {
  try {
    console.log("🔍 Starting contract verification process...");
    console.log(`Network: ${network.name}`);

    // Load latest deployment
    const deployment = await loadLatestDeployment();

    // Verify implementation contracts
    await verifyImplementationContracts(deployment);

    // Verify proxy contracts
    await verifyProxyContracts(deployment);

    // Validate deployment
    await validateDeployment(deployment);

    // Generate integration guide
    await generateIntegrationGuide(deployment);

    console.log("\n🎉 Contract verification completed successfully!");

  } catch (error) {
    console.error("❌ Verification failed:", error);
    process.exit(1);
  }
}

// Execute verification
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { main as verify };
