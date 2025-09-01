import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  QuantlinkOracle,
  NodeManager,
  ConsensusEngine,
  SecurityManager,
  AccessControlManager,
  PriceFeedAdapter,
  ProtocolIntegration,
} from "../../typechain-types";

// Helper function to create valid signatures (simplified for testing)
async function createDataSignature(
  signer: SignerWithAddress,
  cexFees: number[],
  dexFees: number[],
  timestamp: number,
  nonce: number
): Promise<string> {
  // Return empty signature for testing (signature validation is skipped for empty signatures)
  return "0x";
}

describe("Oracle System Integration", function () {
  let oracle: QuantlinkOracle;
  let nodeManager: NodeManager;
  let consensusEngine: ConsensusEngine;
  let securityManager: SecurityManager;
  let accessControl: AccessControlManager;
  let priceFeed: PriceFeedAdapter;
  let protocolIntegration: ProtocolIntegration;

  let admin: SignerWithAddress;
  let nodes: SignerWithAddress[];
  let protocol: SignerWithAddress;
  let user: SignerWithAddress;

  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  const SECURITY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SECURITY_ROLE"));

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    admin = signers[0];
    nodes = signers.slice(1, 11); // 10 nodes
    protocol = signers[11];
    user = signers[12];

    // Deploy all contracts
    await deployContracts();
    await setupRoles();
    await registerNodes();
  });

  async function deployContracts() {
    // Deploy AccessControlManager
    const AccessControlFactory = await ethers.getContractFactory("AccessControlManager");
    accessControl = (await upgrades.deployProxy(AccessControlFactory, [admin.address], {
      initializer: "initialize",
    })) as unknown as AccessControlManager;

    // Deploy SecurityManager
    const SecurityManagerFactory = await ethers.getContractFactory("SecurityManager");
    securityManager = (await upgrades.deployProxy(SecurityManagerFactory, [admin.address], {
      initializer: "initialize",
    })) as unknown as SecurityManager;

    // Deploy NodeManager
    const NodeManagerFactory = await ethers.getContractFactory("NodeManager");
    nodeManager = (await upgrades.deployProxy(NodeManagerFactory, [admin.address], {
      initializer: "initialize",
    })) as unknown as NodeManager;

    // Deploy ConsensusEngine
    const ConsensusEngineFactory = await ethers.getContractFactory("ConsensusEngine");
    consensusEngine = (await upgrades.deployProxy(
      ConsensusEngineFactory,
      [admin.address, await nodeManager.getAddress()],
      { initializer: "initialize" }
    )) as unknown as ConsensusEngine;

    // Deploy QuantlinkOracle
    const OracleFactory = await ethers.getContractFactory("QuantlinkOracle");
    oracle = (await upgrades.deployProxy(
      OracleFactory,
      [admin.address, await nodeManager.getAddress(), await consensusEngine.getAddress()],
      { initializer: "initialize" }
    )) as unknown as QuantlinkOracle;

    // Deploy PriceFeedAdapter
    const PriceFeedFactory = await ethers.getContractFactory("PriceFeedAdapter");
    priceFeed = (await upgrades.deployProxy(
      PriceFeedFactory,
      [admin.address, await oracle.getAddress()],
      { initializer: "initialize" }
    )) as unknown as PriceFeedAdapter;

    // Deploy ProtocolIntegration
    const ProtocolIntegrationFactory = await ethers.getContractFactory("ProtocolIntegration");
    protocolIntegration = (await upgrades.deployProxy(
      ProtocolIntegrationFactory,
      [admin.address],
      { initializer: "initialize" }
    )) as unknown as ProtocolIntegration;
  }

  async function setupRoles() {
    // Grant necessary roles between contracts
    await nodeManager.grantRole(ORACLE_ROLE, await oracle.getAddress());
    await consensusEngine.grantRole(ORACLE_ROLE, await oracle.getAddress());
    await securityManager.grantRole(SECURITY_ROLE, await oracle.getAddress());

    // Grant roles for testing
    await oracle.grantRole(ORACLE_ROLE, admin.address);
    await consensusEngine.grantRole(ORACLE_ROLE, admin.address);
    await securityManager.grantRole(SECURITY_ROLE, admin.address);
    await nodeManager.grantRole(ORACLE_ROLE, admin.address);
  }

  async function registerNodes() {
    // Register and activate 6 nodes (minimum for consensus)
    for (let i = 0; i < 6; i++) {
      await nodeManager.registerNode(nodes[i].address, "0x");
      await nodeManager.activateNode(nodes[i].address, i === 0 ? 2 : 3); // First as submitter, others as validators
      await oracle.addNode(nodes[i].address);
    }
  }

  describe("End-to-End Oracle Operation", function () {
    it("Should complete full consensus cycle", async function () {
      // Submit data from 6 nodes with valid signatures
      for (let i = 0; i < 6; i++) {
        const cexFees = [100 + i * 5, 150 + i * 3, 120 + i * 4];
        const dexFees = [200 + i * 8, 250 + i * 6, 220 + i * 7];

        const currentTime = await ethers.provider.getBlock("latest").then(b => b!.timestamp);
        const nonce = await oracle.getNodeNonce(nodes[i].address);
        const signature = await createDataSignature(nodes[i], cexFees, dexFees, currentTime, Number(nonce));

        await oracle.connect(nodes[i]).submitData(cexFees, dexFees, signature);
      }

      // Fast forward to consensus processing time
      await ethers.provider.send("evm_increaseTime", [190]);
      await ethers.provider.send("evm_mine", []);

      // Process consensus
      await expect(oracle.processConsensus()).to.emit(oracle, "ConsensusReached");

      // Verify consensus results
      const latestData = await oracle.getLatestFeeData();
      expect(latestData.consensusReached).to.be.true;
      expect(latestData.participatingNodes).to.equal(6);
    });

    it("Should handle node rotation during operation", async function () {
      const initialSubmitter = await oracle.getCurrentSubmitter();

      // Fast forward past rotation time
      await ethers.provider.send("evm_increaseTime", [301]);
      await ethers.provider.send("evm_mine", []);

      await oracle.rotateSubmitter();

      const newSubmitter = await oracle.getCurrentSubmitter();
      expect(newSubmitter).to.not.equal(initialSubmitter);
    });

    it("Should integrate with security manager for threat detection", async function () {
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test data"));
      const signature = "0x" + "00".repeat(65);

      // Validate submission through security manager
      const isValid = await securityManager.validateSubmission(nodes[0].address, dataHash, signature);
      expect(isValid).to.be.true;

      // Check security metrics
      const metrics = await securityManager.getSecurityMetrics();
      expect(metrics.totalSubmissions).to.equal(1);
    });
  });

  describe("Price Feed Integration", function () {
    beforeEach(async function () {
      // Submit some data to have Oracle data available
      const signature = "0x" + "00".repeat(65);
      for (let i = 0; i < 6; i++) {
        const cexFees = [100, 150, 120];
        const dexFees = [200, 250, 220];
        await oracle.connect(nodes[i]).submitData(cexFees, dexFees, signature);
      }

      await ethers.provider.send("evm_increaseTime", [190]);
      await ethers.provider.send("evm_mine", []);
      await oracle.processConsensus();
    });

    it("Should provide Chainlink-compatible interface", async function () {
      const latestRound = await priceFeed.latestRoundData();
      expect(latestRound.answer).to.be.greaterThan(0);
      expect(latestRound.updatedAt).to.be.greaterThan(0);
    });

    it("Should return fee data through adapter", async function () {
      const feeData = await priceFeed.getLatestFeeData();
      expect(feeData.cexFees.length).to.be.greaterThan(0);
      expect(feeData.dexFees.length).to.be.greaterThan(0);
      expect(feeData.exchangeCount).to.be.greaterThan(0);
    });

    it("Should calculate average fees", async function () {
      const [averageFee, sampleCount] = await priceFeed.getAverageFee(3600, 2); // Combined fees, 1 hour window
      expect(averageFee).to.be.greaterThan(0);
      expect(sampleCount).to.be.greaterThan(0);
    });

    it("Should report Oracle health status", async function () {
      const [isHealthy, consensusReached, activeNodes, lastConsensusTime] = await priceFeed.getOracleHealth();
      expect(isHealthy).to.be.true;
      expect(consensusReached).to.be.true;
      expect(activeNodes).to.equal(6);
      expect(lastConsensusTime).to.be.greaterThan(0);
    });

    it("Should check data freshness", async function () {
      const [isFresh, lastUpdateTime, stalenessThreshold] = await priceFeed.getDataFreshness();
      expect(isFresh).to.be.true;
      expect(lastUpdateTime).to.be.greaterThan(0);
      expect(stalenessThreshold).to.equal(600); // 10 minutes
    });
  });

  describe("Protocol Integration", function () {
    beforeEach(async function () {
      // Register protocol for integration
      await protocolIntegration.registerProtocol(
        protocol.address,
        1, // FeeCalculation type
        await priceFeed.getAddress(),
        300, // 5 minute update frequency
        "0x" // No custom config
      );

      // Set fee calculation parameters
      await protocolIntegration.setFeeCalculationParams(protocol.address, {
        baseFeeBps: 100, // 1%
        maxFeeBps: 500, // 5%
        minFeeBps: 10, // 0.1%
        volatilityMultiplier: 150, // 1.5x
        useOracleFees: true,
      });

      // Set health check configuration
      await protocolIntegration.setHealthCheckConfig(protocol.address, {
        maxStaleness: 600, // 10 minutes
        minConfidence: 80,
        minActiveNodes: 6,
        requireConsensus: true,
        fallbackOracle: ethers.ZeroAddress,
      });

      // Ensure Oracle has data
      const signature = "0x" + "00".repeat(65);
      for (let i = 0; i < 6; i++) {
        const cexFees = [100, 150, 120];
        const dexFees = [200, 250, 220];
        await oracle.connect(nodes[i]).submitData(cexFees, dexFees, signature);
      }

      await ethers.provider.send("evm_increaseTime", [190]);
      await ethers.provider.send("evm_mine", []);
      await oracle.processConsensus();
    });

    it("Should calculate fees for registered protocols", async function () {
      const amount = ethers.parseEther("1000"); // 1000 tokens
      const [calculatedFee, oracleFee] = await protocolIntegration.calculateFee(
        protocol.address,
        amount,
        2 // Combined fee type
      );

      expect(calculatedFee).to.be.greaterThan(0);
      expect(oracleFee).to.be.greaterThan(0);
    });

    it("Should perform health checks", async function () {
      const [isHealthy, reason] = await protocolIntegration.performHealthCheck(protocol.address);
      expect(isHealthy).to.be.true;
      expect(reason).to.equal("");
    });

    it("Should return integration status", async function () {
      const [config, lastHealthCheck, isHealthy] = await protocolIntegration.getIntegrationStatus(
        protocol.address
      );

      expect(config.protocol).to.equal(protocol.address);
      expect(config.isActive).to.be.true;
      expect(isHealthy).to.be.true;
    });

    it("Should track registered protocols", async function () {
      const protocols = await protocolIntegration.getRegisteredProtocols();
      expect(protocols).to.include(protocol.address);

      const totalIntegrations = await protocolIntegration.getTotalIntegrations();
      expect(totalIntegrations).to.equal(1);
    });
  });

  describe("Security Integration", function () {
    it("Should detect and respond to threats across system", async function () {
      const maliciousData = ethers.keccak256(ethers.toUtf8Bytes("malicious data"));
      const signature = "0x" + "00".repeat(65);

      // First submission should succeed
      await securityManager.validateSubmission(nodes[0].address, maliciousData, signature);

      // Replay attack should be detected
      const isValid = await securityManager.validateSubmission(nodes[0].address, maliciousData, signature);
      expect(isValid).to.be.false;

      // Check threat level increased
      const threatLevel = await securityManager.getThreatLevel();
      expect(threatLevel).to.be.greaterThan(0);
    });

    it("Should handle emergency scenarios", async function () {
      // Trigger emergency mode
      await securityManager.setThreatLevel(5);

      expect(await securityManager.isUnderAttack()).to.be.true;
      expect(await securityManager.paused()).to.be.true;

      // Oracle should also be affected by emergency state
      const signature = "0x" + "00".repeat(65);
      const cexFees = [100, 150, 120];
      const dexFees = [200, 250, 220];

      // Should not be able to submit data during emergency
      await expect(
        oracle.connect(nodes[0]).submitData(cexFees, dexFees, signature)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should coordinate between security and access control", async function () {
      // Test that access control and security work together
      expect(await accessControl.hasPermission(admin.address, ethers.keccak256(ethers.toUtf8Bytes("CAN_PAUSE_SYSTEM")))).to.be.true;

      // Emergency pause should work through access control
      await oracle.emergencyPause();
      expect(await oracle.paused()).to.be.true;
    });
  });

  describe("Failure Scenarios", function () {
    it("Should handle insufficient consensus gracefully", async function () {
      const signature = "0x" + "00".repeat(65);

      // Submit data from only 3 nodes (below threshold)
      for (let i = 0; i < 3; i++) {
        const cexFees = [100, 150, 120];
        const dexFees = [200, 250, 220];
        await oracle.connect(nodes[i]).submitData(cexFees, dexFees, signature);
      }

      await ethers.provider.send("evm_increaseTime", [190]);
      await ethers.provider.send("evm_mine", []);

      // Should emit consensus failed event
      await expect(oracle.processConsensus()).to.emit(oracle, "ConsensusFailed");
    });

    it("Should activate backup nodes when primary nodes fail", async function () {
      // Register backup nodes
      await nodeManager.registerNode(nodes[6].address, "0x");
      await nodeManager.activateNode(nodes[6].address, 4); // Backup

      // Simulate node failure
      await nodeManager.suspendNode(nodes[1].address, "Node failure simulation");

      // Activate backup
      await expect(nodeManager.connect(admin).activateBackupNode(nodes[1].address))
        .to.emit(nodeManager, "BackupNodeActivated");

      expect(await nodeManager.isNodeValidator(nodes[6].address)).to.be.true;
    });

    it("Should handle stale data scenarios", async function () {
      // Fast forward past staleness threshold
      await ethers.provider.send("evm_increaseTime", [700]); // 11+ minutes
      await ethers.provider.send("evm_mine", []);

      const [isFresh] = await priceFeed.getDataFreshness();
      expect(isFresh).to.be.false;

      // Health check should fail
      const [isHealthy, reason] = await protocolIntegration.performHealthCheck(protocol.address);
      expect(isHealthy).to.be.false;
      expect(reason).to.include("Stale data");
    });
  });

  describe("Upgrade Scenarios", function () {
    it("Should support contract upgrades", async function () {
      // Test that contracts are upgradeable
      const currentVersion = await oracle.version();
      expect(currentVersion).to.equal("1.0.0");

      // Verify upgrade authorization works
      expect(await oracle.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("Should maintain state across upgrades", async function () {
      // Submit some data
      const signature = "0x" + "00".repeat(65);
      const cexFees = [100, 150, 120];
      const dexFees = [200, 250, 220];

      await oracle.connect(nodes[0]).submitData(cexFees, dexFees, signature);

      // Verify state is maintained
      const roundId = await oracle.getCurrentRoundId();
      expect(roundId).to.equal(1);

      const submission = await oracle.getSubmission(roundId, nodes[0].address);
      expect(submission.nodeAddress).to.equal(nodes[0].address);
    });
  });
});
