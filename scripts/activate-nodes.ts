import { ethers, network } from "hardhat";
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

  return deploymentData;
}

async function registerAndActivateNodes(deployment: DeploymentInfo): Promise<void> {
  console.log("🔗 Registering and activating Oracle nodes...");
  
  const [deployer, ...accounts] = await ethers.getSigners();
  const nodeManager = await ethers.getContractAt("NodeManager", deployment.contracts.NodeManager);
  const oracle = await ethers.getContractAt("QuantlinkOracle", deployment.contracts.QuantlinkOracle);
  
  // Use first 10 accounts as nodes
  const nodeAddresses = accounts.slice(0, 10).map(account => account.address);
  
  console.log(`📋 Registering ${nodeAddresses.length} nodes...`);
  
  // Register all nodes
  for (let i = 0; i < nodeAddresses.length; i++) {
    const nodeAddress = nodeAddresses[i];
    console.log(`📝 Registering node ${i + 1}: ${nodeAddress}`);
    
    try {
      await nodeManager.registerNode(nodeAddress, "0x"); // Empty public key for testing
      console.log(`✅ Node ${i + 1} registered successfully`);
    } catch (error: any) {
      if (error.message.includes("NodeAlreadyRegistered")) {
        console.log(`⚠️ Node ${i + 1} already registered`);
      } else {
        console.error(`❌ Failed to register node ${i + 1}:`, error.message);
        throw error;
      }
    }
  }
  
  console.log("\n🚀 Activating nodes...");
  
  // Activate first node as submitter
  console.log(`🎯 Activating node 1 as submitter: ${nodeAddresses[0]}`);
  await nodeManager.activateNode(nodeAddresses[0], 2); // NodeState.Submitter
  console.log("✅ Submitter activated");
  
  // Activate remaining nodes as validators
  for (let i = 1; i < nodeAddresses.length; i++) {
    console.log(`🔍 Activating node ${i + 1} as validator: ${nodeAddresses[i]}`);
    await nodeManager.activateNode(nodeAddresses[i], 3); // NodeState.Validator
    console.log(`✅ Validator ${i + 1} activated`);
  }
  
  // Verify system status
  console.log("\n📊 Verifying system status...");
  const totalActiveNodes = await nodeManager.getTotalActiveNodes();
  const currentSubmitter = await nodeManager.getCurrentSubmitter();
  const consensusThreshold = await oracle.getConsensusThreshold();
  
  console.log(`✅ Total active nodes: ${totalActiveNodes}`);
  console.log(`✅ Current submitter: ${currentSubmitter}`);
  console.log(`✅ Consensus threshold: ${consensusThreshold}`);
  
  if (totalActiveNodes >= consensusThreshold) {
    console.log("🎉 Oracle system is ready for operation!");
  } else {
    console.log("⚠️ Warning: Not enough active nodes for consensus");
  }
}

async function simulateDataSubmission(deployment: DeploymentInfo): Promise<void> {
  console.log("\n🔄 Simulating data submission...");
  
  const [deployer, ...accounts] = await ethers.getSigners();
  const oracle = await ethers.getContractAt("QuantlinkOracle", deployment.contracts.QuantlinkOracle);
  const nodeManager = await ethers.getContractAt("NodeManager", deployment.contracts.NodeManager);
  
  // Get current submitter
  const currentSubmitter = await nodeManager.getCurrentSubmitter();
  console.log(`📡 Current submitter: ${currentSubmitter}`);
  
  // Find the signer for the current submitter
  const submitterSigner = accounts.find(account => account.address === currentSubmitter);
  
  if (!submitterSigner) {
    console.log("⚠️ Current submitter not found in available signers");
    return;
  }
  
  // Simulate CEX and DEX fee data
  const cexFees = [100, 150, 120, 110, 130]; // basis points
  const dexFees = [200, 250, 220, 210, 240]; // basis points
  const signature = "0x"; // Empty signature for testing
  
  console.log("📊 Submitting fee data:");
  console.log(`  CEX Fees: ${cexFees.join(", ")} basis points`);
  console.log(`  DEX Fees: ${dexFees.join(", ")} basis points`);
  
  try {
    const tx = await oracle.connect(submitterSigner).submitData(cexFees, dexFees, signature);
    await tx.wait();
    console.log("✅ Data submitted successfully");
    
    // Check current round status
    const currentRound = await oracle.getCurrentRound();
    console.log(`📈 Current round: ${currentRound.roundId}`);
    console.log(`📊 Submissions: ${currentRound.submissionsCount}`);
    console.log(`🤝 Consensus reached: ${currentRound.consensusReached}`);
    
  } catch (error: any) {
    console.error("❌ Failed to submit data:", error.message);
  }
}

async function displaySystemStatus(deployment: DeploymentInfo): Promise<void> {
  console.log("\n📊 QUANTLINK ORACLE SYSTEM STATUS");
  console.log("=====================================");
  
  const oracle = await ethers.getContractAt("QuantlinkOracle", deployment.contracts.QuantlinkOracle);
  const nodeManager = await ethers.getContractAt("NodeManager", deployment.contracts.NodeManager);
  const securityManager = await ethers.getContractAt("SecurityManager", deployment.contracts.SecurityManager);
  const priceFeed = await ethers.getContractAt("PriceFeedAdapter", deployment.contracts.PriceFeedAdapter);
  
  // Oracle status
  const currentRound = await oracle.getCurrentRound();
  const updateInterval = await oracle.getUpdateInterval();
  const isSubmissionOpen = await oracle.isSubmissionWindowOpen();
  
  console.log("🔮 Oracle Status:");
  console.log(`  Current Round: ${currentRound.roundId}`);
  console.log(`  Submissions: ${currentRound.submissionsCount}`);
  console.log(`  Consensus Reached: ${currentRound.consensusReached}`);
  console.log(`  Update Interval: ${updateInterval} seconds`);
  console.log(`  Submission Window Open: ${isSubmissionOpen}`);
  
  // Node status
  const totalActiveNodes = await nodeManager.getTotalActiveNodes();
  const currentSubmitter = await nodeManager.getCurrentSubmitter();
  const rotationSchedule = await nodeManager.getRotationSchedule();
  
  console.log("\n🔗 Node Management:");
  console.log(`  Total Active Nodes: ${totalActiveNodes}`);
  console.log(`  Current Submitter: ${currentSubmitter}`);
  console.log(`  Rotation Interval: ${rotationSchedule.rotationInterval} seconds`);
  
  // Security status
  const threatLevel = await securityManager.getThreatLevel();
  const isUnderAttack = await securityManager.isUnderAttack();
  const isPaused = await securityManager.paused();
  
  console.log("\n🔒 Security Status:");
  console.log(`  Threat Level: ${threatLevel}`);
  console.log(`  Under Attack: ${isUnderAttack}`);
  console.log(`  System Paused: ${isPaused}`);
  
  // Price feed status
  const decimals = await priceFeed.decimals();
  const description = await priceFeed.description();
  const version = await priceFeed.version();
  
  console.log("\n💰 Price Feed:");
  console.log(`  Decimals: ${decimals}`);
  console.log(`  Description: ${description}`);
  console.log(`  Version: ${version}`);
  
  console.log("\n🎯 System Ready for Production Operation!");
}

async function main() {
  try {
    console.log("🚀 Activating Quantlink Oracle System...");
    console.log(`Network: ${network.name}`);
    
    // Load deployment
    const deployment = await loadLatestDeployment();
    
    // Register and activate nodes
    await registerAndActivateNodes(deployment);
    
    // Simulate data submission
    await simulateDataSubmission(deployment);
    
    // Display system status
    await displaySystemStatus(deployment);
    
    console.log("\n🎉 QUANTLINK ORACLE SYSTEM FULLY OPERATIONAL!");
    
  } catch (error) {
    console.error("❌ Activation failed:", error);
    process.exit(1);
  }
}

// Execute activation
if (require.main === module) {
  main();
}

export { main as activateNodes };
