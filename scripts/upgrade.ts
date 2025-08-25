import { ethers, upgrades, network } from "hardhat";
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

interface UpgradeConfig {
  contracts: string[]; // Contract names to upgrade
  skipValidation?: boolean;
  emergencyUpgrade?: boolean;
  newImplementationOnly?: boolean;
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

async function validateUpgradeCompatibility(
  contractName: string,
  proxyAddress: string
): Promise<boolean> {
  try {
    console.log(`🔍 Validating upgrade compatibility for ${contractName}...`);
    
    const ContractFactory = await ethers.getContractFactory(contractName);
    
    // Validate upgrade compatibility
    await upgrades.validateUpgrade(proxyAddress, ContractFactory);
    
    console.log(`✅ ${contractName} upgrade validation passed`);
    return true;
  } catch (error: any) {
    console.error(`❌ ${contractName} upgrade validation failed:`, error.message);
    return false;
  }
}

async function performUpgrade(
  contractName: string,
  proxyAddress: string,
  config: UpgradeConfig
): Promise<string> {
  try {
    console.log(`🚀 Upgrading ${contractName} at ${proxyAddress}...`);
    
    const ContractFactory = await ethers.getContractFactory(contractName);
    
    const upgradeOptions: any = {};
    
    if (config.skipValidation) {
      upgradeOptions.unsafeSkipStorageCheck = true;
      upgradeOptions.unsafeAllowRenames = true;
    }

    if (config.newImplementationOnly) {
      // Deploy new implementation without upgrading proxy
      const newImplementation = await upgrades.prepareUpgrade(proxyAddress, ContractFactory, upgradeOptions);
      console.log(`✅ New implementation deployed for ${contractName}: ${newImplementation}`);
      return newImplementation as string;
    } else {
      // Perform full upgrade
      const upgradedContract = await upgrades.upgradeProxy(proxyAddress, ContractFactory, upgradeOptions);
      await upgradedContract.waitForDeployment();
      
      console.log(`✅ ${contractName} upgraded successfully`);
      return await upgradedContract.getAddress();
    }
  } catch (error: any) {
    console.error(`❌ Failed to upgrade ${contractName}:`, error.message);
    throw error;
  }
}

async function pauseSystemForUpgrade(deployment: DeploymentInfo): Promise<void> {
  console.log("⏸️ Pausing system for upgrade...");
  
  try {
    const quantlinkOracle = await ethers.getContractAt("QuantlinkOracle", deployment.contracts.QuantlinkOracle);
    const securityManager = await ethers.getContractAt("SecurityManager", deployment.contracts.SecurityManager);
    
    // Check if already paused
    const isOraclePaused = await quantlinkOracle.paused();
    const isSecurityPaused = await securityManager.paused();
    
    if (!isOraclePaused) {
      await quantlinkOracle.emergencyPause();
      console.log("✅ Oracle paused");
    }
    
    if (!isSecurityPaused) {
      await securityManager.pause();
      console.log("✅ Security manager paused");
    }
    
    console.log("✅ System paused for upgrade");
  } catch (error) {
    console.error("❌ Failed to pause system:", error);
    throw error;
  }
}

async function resumeSystemAfterUpgrade(deployment: DeploymentInfo): Promise<void> {
  console.log("▶️ Resuming system after upgrade...");
  
  try {
    const quantlinkOracle = await ethers.getContractAt("QuantlinkOracle", deployment.contracts.QuantlinkOracle);
    const securityManager = await ethers.getContractAt("SecurityManager", deployment.contracts.SecurityManager);
    
    // Check if paused
    const isOraclePaused = await quantlinkOracle.paused();
    const isSecurityPaused = await securityManager.paused();
    
    if (isOraclePaused) {
      await quantlinkOracle.emergencyUnpause();
      console.log("✅ Oracle unpaused");
    }
    
    if (isSecurityPaused) {
      await securityManager.unpause();
      console.log("✅ Security manager unpaused");
    }
    
    console.log("✅ System resumed after upgrade");
  } catch (error) {
    console.error("❌ Failed to resume system:", error);
    throw error;
  }
}

async function validatePostUpgrade(deployment: DeploymentInfo, upgradedContracts: string[]): Promise<void> {
  console.log("🔍 Validating post-upgrade state...");
  
  try {
    // Test basic functionality of upgraded contracts
    for (const contractName of upgradedContracts) {
      const contractAddress = deployment.contracts[contractName as keyof typeof deployment.contracts];
      
      if (contractName === "QuantlinkOracle") {
        const oracle = await ethers.getContractAt("QuantlinkOracle", contractAddress);
        const version = await oracle.version();
        const threshold = await oracle.getConsensusThreshold();
        console.log(`✅ QuantlinkOracle - Version: ${version}, Threshold: ${threshold}`);
      }
      
      if (contractName === "NodeManager") {
        const nodeManager = await ethers.getContractAt("NodeManager", contractAddress);
        const version = await nodeManager.version();
        const activeNodes = await nodeManager.getTotalActiveNodes();
        console.log(`✅ NodeManager - Version: ${version}, Active Nodes: ${activeNodes}`);
      }
      
      if (contractName === "SecurityManager") {
        const securityManager = await ethers.getContractAt("SecurityManager", contractAddress);
        const threatLevel = await securityManager.getThreatLevel();
        console.log(`✅ SecurityManager - Threat Level: ${threatLevel}`);
      }
    }
    
    console.log("✅ Post-upgrade validation completed");
  } catch (error) {
    console.error("❌ Post-upgrade validation failed:", error);
    throw error;
  }
}

async function saveUpgradeInfo(
  deployment: DeploymentInfo,
  upgradedContracts: string[],
  newImplementations: Record<string, string>
): Promise<void> {
  const upgradeInfo = {
    network: network.name,
    timestamp: new Date().toISOString(),
    originalDeployment: deployment.timestamp,
    upgradedContracts,
    newImplementations,
    proxyAddresses: deployment.contracts,
  };

  const upgradesDir = path.join(__dirname, "../upgrades");
  if (!fs.existsSync(upgradesDir)) {
    fs.mkdirSync(upgradesDir, { recursive: true });
  }

  const filename = `upgrade-${network.name}-${Date.now()}.json`;
  const filepath = path.join(upgradesDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(upgradeInfo, null, 2));
  console.log(`📄 Upgrade info saved to: ${filepath}`);
}

async function getUpgradeConfig(): Promise<UpgradeConfig> {
  // This could be loaded from environment variables or config file
  const config: UpgradeConfig = {
    contracts: process.env.UPGRADE_CONTRACTS?.split(",") || ["QuantlinkOracle"],
    skipValidation: process.env.SKIP_VALIDATION === "true",
    emergencyUpgrade: process.env.EMERGENCY_UPGRADE === "true",
    newImplementationOnly: process.env.NEW_IMPLEMENTATION_ONLY === "true",
  };

  console.log("⚙️ Upgrade Configuration:");
  console.log(`  Contracts: ${config.contracts.join(", ")}`);
  console.log(`  Skip Validation: ${config.skipValidation}`);
  console.log(`  Emergency Upgrade: ${config.emergencyUpgrade}`);
  console.log(`  New Implementation Only: ${config.newImplementationOnly}`);

  return config;
}

async function main() {
  try {
    console.log("🔄 Starting contract upgrade process...");
    console.log(`Network: ${network.name}`);

    // Load configuration
    const config = await getUpgradeConfig();
    const deployment = await loadLatestDeployment();

    // Validate upgrade compatibility
    const validationResults: Record<string, boolean> = {};
    
    if (!config.skipValidation) {
      for (const contractName of config.contracts) {
        const contractAddress = deployment.contracts[contractName as keyof typeof deployment.contracts];
        if (contractAddress) {
          validationResults[contractName] = await validateUpgradeCompatibility(contractName, contractAddress);
        }
      }

      // Check if any validations failed
      const failedValidations = Object.entries(validationResults).filter(([, passed]) => !passed);
      if (failedValidations.length > 0 && !config.emergencyUpgrade) {
        throw new Error(`Upgrade validation failed for: ${failedValidations.map(([name]) => name).join(", ")}`);
      }
    }

    // Pause system if not emergency upgrade
    if (!config.emergencyUpgrade && !config.newImplementationOnly) {
      await pauseSystemForUpgrade(deployment);
    }

    // Perform upgrades
    const newImplementations: Record<string, string> = {};
    const upgradedContracts: string[] = [];

    for (const contractName of config.contracts) {
      const contractAddress = deployment.contracts[contractName as keyof typeof deployment.contracts];
      if (contractAddress) {
        try {
          const newAddress = await performUpgrade(contractName, contractAddress, config);
          newImplementations[contractName] = newAddress;
          upgradedContracts.push(contractName);
        } catch (error) {
          console.error(`❌ Failed to upgrade ${contractName}, continuing with others...`);
          if (config.emergencyUpgrade) {
            // In emergency, continue with other contracts
            continue;
          } else {
            throw error;
          }
        }
      }
    }

    // Resume system if it was paused
    if (!config.emergencyUpgrade && !config.newImplementationOnly) {
      await resumeSystemAfterUpgrade(deployment);
    }

    // Validate post-upgrade state
    if (!config.newImplementationOnly) {
      await validatePostUpgrade(deployment, upgradedContracts);
    }

    // Save upgrade information
    await saveUpgradeInfo(deployment, upgradedContracts, newImplementations);

    console.log("\n🎉 Contract upgrade completed successfully!");
    console.log("\n📋 Upgrade Summary:");
    console.log(`Network: ${network.name}`);
    console.log(`Upgraded Contracts: ${upgradedContracts.join(", ")}`);
    console.log(`New Implementations:`);
    for (const [contract, address] of Object.entries(newImplementations)) {
      console.log(`  ${contract}: ${address}`);
    }

  } catch (error) {
    console.error("❌ Upgrade failed:", error);
    
    // Attempt to resume system if it was paused
    try {
      const deployment = await loadLatestDeployment();
      await resumeSystemAfterUpgrade(deployment);
      console.log("✅ System resumed after failed upgrade");
    } catch (resumeError) {
      console.error("❌ Failed to resume system after upgrade failure:", resumeError);
    }
    
    process.exit(1);
  }
}

// Execute upgrade
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { main as upgrade };
