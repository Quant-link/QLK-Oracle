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

interface SystemMetrics {
  timestamp: string;
  oracle: {
    currentRound: number;
    submissionsCount: number;
    consensusReached: boolean;
    submissionWindowOpen: boolean;
    updateInterval: number;
  };
  nodes: {
    totalActive: number;
    currentSubmitter: string;
    rotationInterval: number;
    nextRotation: number;
  };
  security: {
    threatLevel: number;
    isUnderAttack: boolean;
    isPaused: boolean;
  };
  performance: {
    gasUsed: string;
    blockNumber: number;
    networkLatency: number;
  };
}

async function loadLatestDeployment(): Promise<DeploymentInfo> {
  const deploymentsDir = path.join(__dirname, "../deployments");
  const files = fs.readdirSync(deploymentsDir)
    .filter(file => file.startsWith(network.name) && file.endsWith('.json'))
    .sort()
    .reverse();

  const latestFile = files[0];
  const filepath = path.join(deploymentsDir, latestFile);
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

async function collectSystemMetrics(deployment: DeploymentInfo): Promise<SystemMetrics> {
  const oracle = await ethers.getContractAt("QuantlinkOracle", deployment.contracts.QuantlinkOracle);
  const nodeManager = await ethers.getContractAt("NodeManager", deployment.contracts.NodeManager);
  const securityManager = await ethers.getContractAt("SecurityManager", deployment.contracts.SecurityManager);

  // Oracle metrics
  const currentRound = await oracle.getCurrentRound();
  const updateInterval = await oracle.getUpdateInterval();
  const isSubmissionOpen = await oracle.isSubmissionWindowOpen();

  // Node metrics
  const totalActiveNodes = await nodeManager.getTotalActiveNodes();
  const currentSubmitter = await nodeManager.getCurrentSubmitter();
  const rotationSchedule = await nodeManager.getRotationSchedule();

  // Security metrics
  const threatLevel = await securityManager.getThreatLevel();
  const isUnderAttack = await securityManager.isUnderAttack();
  const isPaused = await securityManager.paused();

  // Performance metrics
  const blockNumber = await ethers.provider.getBlockNumber();
  const startTime = Date.now();
  await ethers.provider.getBlock(blockNumber);
  const networkLatency = Date.now() - startTime;

  return {
    timestamp: new Date().toISOString(),
    oracle: {
      currentRound: Number(currentRound.roundId),
      submissionsCount: Number(currentRound.submissionsCount),
      consensusReached: currentRound.consensusReached,
      submissionWindowOpen: isSubmissionOpen,
      updateInterval: Number(updateInterval),
    },
    nodes: {
      totalActive: Number(totalActiveNodes),
      currentSubmitter,
      rotationInterval: Number(rotationSchedule.rotationInterval),
      nextRotation: Number(rotationSchedule.rotationTime),
    },
    security: {
      threatLevel: Number(threatLevel),
      isUnderAttack,
      isPaused,
    },
    performance: {
      gasUsed: "0", // Would be calculated from recent transactions
      blockNumber,
      networkLatency,
    },
  };
}

function displayDashboard(metrics: SystemMetrics): void {
  console.clear();

  // Premium Enterprise Dashboard Header
  const headerLine = "─".repeat(88);
  const spacer = " ".repeat(88);

  console.log(headerLine);
  console.log("│" + " ".repeat(86) + "│");
  console.log("│" + centerText("QUANTLINK ORACLE", 86) + "│");
  console.log("│" + centerText("ENTERPRISE MONITORING DASHBOARD", 86) + "│");
  console.log("│" + " ".repeat(86) + "│");
  console.log("│" + centerText(`Last Updated: ${new Date(metrics.timestamp).toLocaleString()}`, 86) + "│");
  console.log("│" + centerText(`Network: ${network.name.toUpperCase()}`, 86) + "│");
  console.log("│" + " ".repeat(86) + "│");
  console.log(headerLine);

  // Main Content Grid
  console.log("│" + " ".repeat(86) + "│");

  // Oracle Status Section
  console.log("│  " + padRight("ORACLE STATUS", 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + "─".repeat(20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Round", metrics.oracle.currentRound.toString(), 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Submissions", metrics.oracle.submissionsCount.toString(), 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Consensus", metrics.oracle.consensusReached ? "REACHED" : "PENDING", 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Window", metrics.oracle.submissionWindowOpen ? "OPEN" : "CLOSED", 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Interval", `${metrics.oracle.updateInterval}s`, 20) + "│" + " ".repeat(63) + "│");
  console.log("│" + " ".repeat(86) + "│");

  // Node Network Section
  console.log("│  " + padRight("NODE NETWORK", 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + "─".repeat(20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Active", `${metrics.nodes.totalActive}/10`, 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Submitter", metrics.nodes.currentSubmitter.slice(0, 12) + "...", 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Rotation", `${metrics.nodes.rotationInterval}s`, 20) + "│" + " ".repeat(63) + "│");

  const nextRotationTime = new Date(metrics.nodes.nextRotation * 1000);
  const timeUntilRotation = Math.max(0, Math.floor((nextRotationTime.getTime() - Date.now()) / 1000));
  console.log("│  " + formatMetric("Next", `${timeUntilRotation}s`, 20) + "│" + " ".repeat(63) + "│");
  console.log("│" + " ".repeat(86) + "│");

  // Security Status Section
  console.log("│  " + padRight("SECURITY", 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + "─".repeat(20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Threat", `${metrics.security.threatLevel}/5`, 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Attack", metrics.security.isUnderAttack ? "YES" : "NO", 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Paused", metrics.security.isPaused ? "YES" : "NO", 20) + "│" + " ".repeat(63) + "│");
  console.log("│" + " ".repeat(86) + "│");

  // Performance Section
  console.log("│  " + padRight("PERFORMANCE", 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + "─".repeat(20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Block", metrics.performance.blockNumber.toString(), 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Latency", `${metrics.performance.networkLatency}ms`, 20) + "│" + " ".repeat(63) + "│");

  const connectionStatus = metrics.performance.networkLatency < 100 ? "EXCELLENT" :
                          metrics.performance.networkLatency < 500 ? "GOOD" : "SLOW";
  console.log("│  " + formatMetric("Status", connectionStatus, 20) + "│" + " ".repeat(63) + "│");
  console.log("│" + " ".repeat(86) + "│");

  // System Health Summary
  const isHealthy = !metrics.security.isUnderAttack &&
                   !metrics.security.isPaused &&
                   metrics.nodes.totalActive >= 6 &&
                   metrics.security.threatLevel <= 2;

  console.log("│  " + padRight("SYSTEM HEALTH", 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + "─".repeat(20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Status", isHealthy ? "HEALTHY" : "ATTENTION", 20) + "│" + " ".repeat(63) + "│");
  console.log("│  " + formatMetric("Ready", isHealthy ? "YES" : "NO", 20) + "│" + " ".repeat(63) + "│");
  console.log("│" + " ".repeat(86) + "│");

  // Footer
  console.log(headerLine);
  console.log("│" + centerText("Press Ctrl+C to stop monitoring", 86) + "│");
  console.log(headerLine);
}

// Utility functions for premium formatting
function centerText(text: string, width: number): string {
  const padding = Math.max(0, width - text.length);
  const leftPad = Math.floor(padding / 2);
  const rightPad = padding - leftPad;
  return " ".repeat(leftPad) + text + " ".repeat(rightPad);
}

function padRight(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length));
}

function formatMetric(label: string, value: string, width: number): string {
  const maxLabelWidth = 8;
  const truncatedLabel = label.length > maxLabelWidth ? label.slice(0, maxLabelWidth) : label;
  const labelPadded = padRight(truncatedLabel, maxLabelWidth);
  const separator = ": ";
  const valueSpace = width - maxLabelWidth - separator.length;
  const truncatedValue = value.length > valueSpace ? value.slice(0, valueSpace) : value;
  return labelPadded + separator + truncatedValue;
}

async function simulateDataFlow(deployment: DeploymentInfo): Promise<void> {
  try {
    const [deployer, ...accounts] = await ethers.getSigners();
    const oracle = await ethers.getContractAt("QuantlinkOracle", deployment.contracts.QuantlinkOracle);
    const nodeManager = await ethers.getContractAt("NodeManager", deployment.contracts.NodeManager);
    
    // Get current submitter
    const currentSubmitter = await nodeManager.getCurrentSubmitter();
    const submitterSigner = accounts.find(account => account.address === currentSubmitter);
    
    if (submitterSigner) {
      // Generate realistic fee data
      const baseTime = Date.now();
      const cexFees = [
        100 + Math.floor(Math.random() * 50), // 100-150 basis points
        120 + Math.floor(Math.random() * 30), // 120-150 basis points
        110 + Math.floor(Math.random() * 40), // 110-150 basis points
        105 + Math.floor(Math.random() * 35), // 105-140 basis points
        115 + Math.floor(Math.random() * 25), // 115-140 basis points
      ];
      
      const dexFees = [
        200 + Math.floor(Math.random() * 100), // 200-300 basis points
        220 + Math.floor(Math.random() * 80),  // 220-300 basis points
        210 + Math.floor(Math.random() * 90),  // 210-300 basis points
        205 + Math.floor(Math.random() * 85),  // 205-290 basis points
        215 + Math.floor(Math.random() * 75),  // 215-290 basis points
      ];
      
      const signature = "0x"; // Empty signature for testing
      
      // Submit data
      await oracle.connect(submitterSigner).submitData(cexFees, dexFees, signature);
      
      console.log(`📊 Data submitted: CEX avg ${Math.round(cexFees.reduce((a,b) => a+b) / cexFees.length)}bp, DEX avg ${Math.round(dexFees.reduce((a,b) => a+b) / dexFees.length)}bp`);
    }
  } catch (error) {
    // Silently handle errors to avoid disrupting the dashboard
  }
}

async function startMonitoring(): Promise<void> {
  console.log("🚀 Starting Quantlink Oracle Monitoring Dashboard...");
  
  const deployment = await loadLatestDeployment();
  let dataSubmissionCounter = 0;
  
  const monitoringInterval = setInterval(async () => {
    try {
      // Collect metrics
      const metrics = await collectSystemMetrics(deployment);
      
      // Display dashboard
      displayDashboard(metrics);
      
      // Simulate data submission every 30 seconds
      dataSubmissionCounter++;
      if (dataSubmissionCounter % 6 === 0) { // Every 30 seconds (5s * 6)
        await simulateDataFlow(deployment);
      }
      
    } catch (error) {
      console.error("❌ Monitoring error:", error.message);
    }
  }, 5000); // Update every 5 seconds
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log("\n🛑 Stopping monitoring dashboard...");
    clearInterval(monitoringInterval);
    process.exit(0);
  });
}

async function main() {
  try {
    await startMonitoring();
  } catch (error) {
    console.error("❌ Failed to start monitoring:", error);
    process.exit(1);
  }
}

// Execute monitoring
if (require.main === module) {
  main();
}

export { main as startMonitoring };
