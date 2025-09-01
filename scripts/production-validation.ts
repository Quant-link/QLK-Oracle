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

interface ValidationResult {
  component: string;
  status: "PASS" | "FAIL" | "WARNING";
  message: string;
  details?: any;
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

async function validateContractDeployment(deployment: DeploymentInfo): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  for (const [contractName, address] of Object.entries(deployment.contracts)) {
    try {
      const code = await ethers.provider.getCode(address);
      if (code === "0x") {
        results.push({
          component: contractName,
          status: "FAIL",
          message: "Contract not deployed - no bytecode found",
          details: { address }
        });
      } else {
        results.push({
          component: contractName,
          status: "PASS",
          message: "Contract successfully deployed",
          details: { address, codeSize: code.length }
        });
      }
    } catch (error) {
      results.push({
        component: contractName,
        status: "FAIL",
        message: "Failed to verify contract deployment",
        details: { address, error: error.message }
      });
    }
  }

  return results;
}

async function validateOracleConfiguration(deployment: DeploymentInfo): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  try {
    const oracle = await ethers.getContractAt("QuantlinkOracle", deployment.contracts.QuantlinkOracle);
    
    // Check consensus threshold
    const threshold = await oracle.getConsensusThreshold();
    results.push({
      component: "Oracle Configuration",
      status: threshold >= 6 && threshold <= 10 ? "PASS" : "WARNING",
      message: `Consensus threshold: ${threshold}`,
      details: { threshold: Number(threshold) }
    });

    // Check update interval
    const updateInterval = await oracle.getUpdateInterval();
    results.push({
      component: "Oracle Configuration",
      status: updateInterval === 300n ? "PASS" : "WARNING",
      message: `Update interval: ${updateInterval} seconds`,
      details: { updateInterval: Number(updateInterval) }
    });

    // Check current round
    const currentRound = await oracle.getCurrentRound();
    results.push({
      component: "Oracle State",
      status: currentRound.roundId > 0 ? "PASS" : "FAIL",
      message: `Current round: ${currentRound.roundId}`,
      details: { 
        roundId: Number(currentRound.roundId),
        submissionsCount: Number(currentRound.submissionsCount),
        consensusReached: currentRound.consensusReached
      }
    });

  } catch (error) {
    results.push({
      component: "Oracle Configuration",
      status: "FAIL",
      message: "Failed to validate Oracle configuration",
      details: { error: error.message }
    });
  }

  return results;
}

async function validateNodeManagement(deployment: DeploymentInfo): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  try {
    const nodeManager = await ethers.getContractAt("NodeManager", deployment.contracts.NodeManager);
    
    // Check active nodes
    const activeNodes = await nodeManager.getTotalActiveNodes();
    results.push({
      component: "Node Management",
      status: activeNodes >= 6 ? "PASS" : "WARNING",
      message: `Active nodes: ${activeNodes}`,
      details: { activeNodes: Number(activeNodes) }
    });

    // Check current submitter
    const currentSubmitter = await nodeManager.getCurrentSubmitter();
    results.push({
      component: "Node Management",
      status: currentSubmitter !== ethers.ZeroAddress ? "PASS" : "FAIL",
      message: `Current submitter: ${currentSubmitter}`,
      details: { currentSubmitter }
    });

    // Check rotation schedule
    const rotationSchedule = await nodeManager.getRotationSchedule();
    results.push({
      component: "Node Management",
      status: "PASS",
      message: `Rotation interval: ${rotationSchedule.rotationInterval} seconds`,
      details: { 
        rotationInterval: Number(rotationSchedule.rotationInterval),
        nextRotation: Number(rotationSchedule.rotationTime)
      }
    });

  } catch (error) {
    results.push({
      component: "Node Management",
      status: "FAIL",
      message: "Failed to validate Node Management",
      details: { error: error.message }
    });
  }

  return results;
}

async function validateSecurity(deployment: DeploymentInfo): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  try {
    const securityManager = await ethers.getContractAt("SecurityManager", deployment.contracts.SecurityManager);
    
    // Check threat level
    const threatLevel = await securityManager.getThreatLevel();
    results.push({
      component: "Security",
      status: threatLevel <= 2 ? "PASS" : "WARNING",
      message: `Threat level: ${threatLevel}`,
      details: { threatLevel: Number(threatLevel) }
    });

    // Check if under attack
    const isUnderAttack = await securityManager.isUnderAttack();
    results.push({
      component: "Security",
      status: !isUnderAttack ? "PASS" : "FAIL",
      message: `Under attack: ${isUnderAttack}`,
      details: { isUnderAttack }
    });

    // Check if paused
    const isPaused = await securityManager.paused();
    results.push({
      component: "Security",
      status: !isPaused ? "PASS" : "WARNING",
      message: `System paused: ${isPaused}`,
      details: { isPaused }
    });

  } catch (error) {
    results.push({
      component: "Security",
      status: "FAIL",
      message: "Failed to validate Security",
      details: { error: error.message }
    });
  }

  return results;
}

async function validateIntegrations(deployment: DeploymentInfo): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  try {
    const priceFeed = await ethers.getContractAt("PriceFeedAdapter", deployment.contracts.PriceFeedAdapter);
    
    // Check Chainlink compatibility
    const decimals = await priceFeed.decimals();
    const description = await priceFeed.description();
    const version = await priceFeed.version();

    results.push({
      component: "Price Feed Integration",
      status: "PASS",
      message: "Chainlink compatibility verified",
      details: { 
        decimals: Number(decimals),
        description,
        version
      }
    });

    // Check Oracle connection
    const oracleAddress = await priceFeed.oracle();
    results.push({
      component: "Price Feed Integration",
      status: oracleAddress === deployment.contracts.QuantlinkOracle ? "PASS" : "FAIL",
      message: `Oracle connection: ${oracleAddress}`,
      details: { 
        connectedOracle: oracleAddress,
        expectedOracle: deployment.contracts.QuantlinkOracle
      }
    });

  } catch (error) {
    results.push({
      component: "Price Feed Integration",
      status: "FAIL",
      message: "Failed to validate integrations",
      details: { error: error.message }
    });
  }

  return results;
}

async function generateValidationReport(results: ValidationResult[]): Promise<void> {
  const timestamp = new Date().toISOString();
  const passCount = results.filter(r => r.status === "PASS").length;
  const warningCount = results.filter(r => r.status === "WARNING").length;
  const failCount = results.filter(r => r.status === "FAIL").length;

  const report = {
    network: network.name,
    timestamp,
    summary: {
      total: results.length,
      passed: passCount,
      warnings: warningCount,
      failed: failCount,
      overallStatus: failCount === 0 ? (warningCount === 0 ? "HEALTHY" : "STABLE") : "CRITICAL"
    },
    results
  };

  // Save report
  const reportsDir = path.join(__dirname, "../validation-reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const filename = `validation-${network.name}-${Date.now()}.json`;
  const filepath = path.join(reportsDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(report, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value, 2));

  // Console output
  console.log("\n🔍 PRODUCTION VALIDATION REPORT");
  console.log("================================");
  console.log(`Network: ${network.name}`);
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Overall Status: ${report.summary.overallStatus}`);
  console.log(`\nSummary: ${passCount} PASS, ${warningCount} WARNING, ${failCount} FAIL`);
  
  console.log("\nDetailed Results:");
  for (const result of results) {
    const icon = result.status === "PASS" ? "✅" : result.status === "WARNING" ? "⚠️" : "❌";
    console.log(`${icon} ${result.component}: ${result.message}`);
  }

  console.log(`\n📄 Full report saved to: ${filepath}`);
}

async function main() {
  try {
    console.log("🚀 Starting production validation...");
    console.log(`Network: ${network.name}`);

    // Load deployment
    const deployment = await loadLatestDeployment();

    // Run all validations
    const allResults: ValidationResult[] = [];
    
    allResults.push(...await validateContractDeployment(deployment));
    allResults.push(...await validateOracleConfiguration(deployment));
    allResults.push(...await validateNodeManagement(deployment));
    allResults.push(...await validateSecurity(deployment));
    allResults.push(...await validateIntegrations(deployment));

    // Generate report
    await generateValidationReport(allResults);

    // Exit with appropriate code
    const hasFailures = allResults.some(r => r.status === "FAIL");
    process.exit(hasFailures ? 1 : 0);

  } catch (error) {
    console.error("❌ Validation failed:", error);
    process.exit(1);
  }
}

// Execute validation
if (require.main === module) {
  main();
}

export { main as validateProduction };
