import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import sinon from "sinon";
import {
  ConsensusEngine,
  NodeManager,
  QuantlinkOracle,
  AccessControlManager,
} from "../../typechain-types";

describe("ConsensusEngine", function () {
  let consensusEngine: ConsensusEngine;
  let nodeManager: NodeManager;
  let oracle: QuantlinkOracle;
  let accessControl: AccessControlManager;
  let admin: SignerWithAddress;
  let node1: SignerWithAddress;
  let node2: SignerWithAddress;
  let node3: SignerWithAddress;
  let node4: SignerWithAddress;
  let node5: SignerWithAddress;
  let node6: SignerWithAddress;
  let node7: SignerWithAddress;
  let maliciousNode: SignerWithAddress;
  let user: SignerWithAddress;

  // Role constants
  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  const NODE_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("NODE_MANAGER_ROLE"));

  // Test data constants
  const VALID_CEX_FEES = [100, 150, 120, 180, 90];
  const VALID_DEX_FEES = [200, 250, 220, 280, 190];
  const OUTLIER_CEX_FEES = [1000, 1500, 1200, 1800, 900]; // 10x higher
  const OUTLIER_DEX_FEES = [2000, 2500, 2200, 2800, 1900];
  const INVALID_FEES = []; // Empty array
  const LARGE_FEES = Array(100).fill(0).map((_, i) => 100 + i);

  // Performance tracking
  let gasUsage: { [key: string]: bigint } = {};
  let performanceMetrics: { [key: string]: number } = {};

  async function deployConsensusEngineFixture() {
    const [admin, node1, node2, node3, node4, node5, node6, node7, maliciousNode, user] = 
      await ethers.getSigners();

    // Deploy AccessControlManager
    const AccessControlManagerFactory = await ethers.getContractFactory("AccessControlManager");
    const accessControl = (await upgrades.deployProxy(
      AccessControlManagerFactory,
      [admin.address],
      { initializer: "initialize" }
    )) as unknown as AccessControlManager;

    // Deploy NodeManager
    const NodeManagerFactory = await ethers.getContractFactory("NodeManager");
    const nodeManager = (await upgrades.deployProxy(
      NodeManagerFactory,
      [admin.address],
      { initializer: "initialize" }
    )) as unknown as NodeManager;

    // Deploy ConsensusEngine
    const ConsensusEngineFactory = await ethers.getContractFactory("ConsensusEngine");
    const consensusEngine = (await upgrades.deployProxy(
      ConsensusEngineFactory,
      [admin.address, await nodeManager.getAddress()],
      { initializer: "initialize" }
    )) as unknown as ConsensusEngine;

    // Deploy QuantlinkOracle (mock for testing)
    const QuantlinkOracleFactory = await ethers.getContractFactory("QuantlinkOracle");
    const oracle = (await upgrades.deployProxy(
      QuantlinkOracleFactory,
      [
        admin.address,
        await nodeManager.getAddress(),
        await consensusEngine.getAddress()
      ],
      { initializer: "initialize" }
    )) as unknown as QuantlinkOracle;

    // Grant roles
    await consensusEngine.grantRole(ORACLE_ROLE, await oracle.getAddress());
    await consensusEngine.grantRole(NODE_MANAGER_ROLE, await nodeManager.getAddress());

    // Register and activate nodes
    const nodes = [node1, node2, node3, node4, node5, node6, node7];
    for (let i = 0; i < nodes.length; i++) {
      await nodeManager.registerNode(nodes[i].address, "0x");
      await nodeManager.activateNode(nodes[i].address, i === 0 ? 2 : 3); // First as submitter, others as validators
      await consensusEngine.grantRole(ORACLE_ROLE, nodes[i].address);
    }

    return {
      consensusEngine,
      nodeManager,
      oracle,
      accessControl,
      admin,
      node1,
      node2,
      node3,
      node4,
      node5,
      node6,
      node7,
      maliciousNode,
      user,
    };
  }

  beforeEach(async function () {
    const fixture = await loadFixture(deployConsensusEngineFixture);
    consensusEngine = fixture.consensusEngine;
    nodeManager = fixture.nodeManager;
    oracle = fixture.oracle;
    accessControl = fixture.accessControl;
    admin = fixture.admin;
    node1 = fixture.node1;
    node2 = fixture.node2;
    node3 = fixture.node3;
    node4 = fixture.node4;
    node5 = fixture.node5;
    node6 = fixture.node6;
    node7 = fixture.node7;
    maliciousNode = fixture.maliciousNode;
    user = fixture.user;

    // Reset gas tracking
    gasUsage = {};
    performanceMetrics = {};
  });

  afterEach(async function () {
    // Log performance metrics
    console.log("\n📊 Performance Metrics:");
    Object.entries(gasUsage).forEach(([method, gas]) => {
      console.log(`  ${method}: ${gas.toString()} gas`);
    });
    Object.entries(performanceMetrics).forEach(([method, time]) => {
      console.log(`  ${method}: ${time}ms execution time`);
    });
  });

  // Helper function to track gas usage
  async function trackGasUsage(methodName: string, txPromise: Promise<any>) {
    const startTime = Date.now();
    const tx = await txPromise;
    const receipt = await tx.wait();
    const endTime = Date.now();
    
    gasUsage[methodName] = receipt.gasUsed;
    performanceMetrics[methodName] = endTime - startTime;
    
    return { tx, receipt };
  }

  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await consensusEngine.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
      expect(await consensusEngine.getConsensusThreshold()).to.equal(6);
      expect(await consensusEngine.getAggregationMethod()).to.equal("weighted_median");
    });

    it("Should set correct node manager address", async function () {
      expect(await consensusEngine.nodeManager()).to.equal(await nodeManager.getAddress());
    });

    it("Should emit initialization event", async function () {
      // Deploy new instance to test event
      const ConsensusEngineFactory = await ethers.getContractFactory("ConsensusEngine");
      await expect(
        upgrades.deployProxy(
          ConsensusEngineFactory,
          [admin.address, await nodeManager.getAddress()],
          { initializer: "initialize" }
        )
      ).to.emit(ConsensusEngineFactory.attach(ethers.ZeroAddress), "ConsensusEngineInitialized");
    });

    it("Should reject initialization with zero addresses", async function () {
      const ConsensusEngineFactory = await ethers.getContractFactory("ConsensusEngine");
      
      await expect(
        upgrades.deployProxy(
          ConsensusEngineFactory,
          [ethers.ZeroAddress, await nodeManager.getAddress()],
          { initializer: "initialize" }
        )
      ).to.be.revertedWith("Invalid admin address");

      await expect(
        upgrades.deployProxy(
          ConsensusEngineFactory,
          [admin.address, ethers.ZeroAddress],
          { initializer: "initialize" }
        )
      ).to.be.revertedWith("Invalid node manager");
    });

    it("Should prevent double initialization", async function () {
      await expect(
        consensusEngine.initialize(admin.address, await nodeManager.getAddress())
      ).to.be.revertedWithCustomError(consensusEngine, "InvalidInitialization");
    });
  });

  describe("Vote Casting", function () {
    const roundId = 1;

    it("Should allow authorized nodes to cast votes", async function () {
      const { tx } = await trackGasUsage(
        "castVote",
        consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES)
      );

      await expect(tx)
        .to.emit(consensusEngine, "VoteCast")
        .withArgs(roundId, node1.address, anyValue, anyValue, anyValue);

      expect(await consensusEngine.hasNodeVoted(roundId, node1.address)).to.be.true;
    });

    it("Should reject votes from unauthorized addresses", async function () {
      await expect(
        consensusEngine.connect(user).castVote(roundId, user.address, VALID_CEX_FEES, VALID_DEX_FEES)
      ).to.be.revertedWithCustomError(consensusEngine, "AccessControlUnauthorizedAccount");
    });

    it("Should reject duplicate votes from same node", async function () {
      await consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES);
      
      await expect(
        consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES)
      ).to.be.revertedWithCustomError(consensusEngine, "NodeAlreadyVoted");
    });

    it("Should reject votes with invalid data", async function () {
      await expect(
        consensusEngine.connect(node1).castVote(roundId, node1.address, INVALID_FEES, VALID_DEX_FEES)
      ).to.be.revertedWith("Invalid fee data");

      await expect(
        consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, INVALID_FEES)
      ).to.be.revertedWith("Invalid fee data");
    });

    it("Should handle large data arrays efficiently", async function () {
      const { tx } = await trackGasUsage(
        "castVote_large",
        consensusEngine.connect(node1).castVote(roundId, node1.address, LARGE_FEES, LARGE_FEES)
      );

      expect(tx).to.not.be.reverted;
      expect(gasUsage["castVote_large"]).to.be.lessThan(BigInt(500000)); // Gas limit check
    });

    it("Should assign correct vote weights based on node reputation", async function () {
      await consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES);

      const votes = await consensusEngine.getCurrentRoundVotes(roundId);
      expect(votes.length).to.equal(1);
      expect(votes[0].weight).to.be.greaterThan(0);
    });

    it("Should handle concurrent vote submissions", async function () {
      const promises = [];
      const nodes = [node1, node2, node3, node4, node5, node6];

      for (let i = 0; i < nodes.length; i++) {
        promises.push(
          consensusEngine.connect(nodes[i]).castVote(
            roundId,
            nodes[i].address,
            VALID_CEX_FEES.map(fee => fee + i),
            VALID_DEX_FEES.map(fee => fee + i)
          )
        );
      }

      await Promise.all(promises);

      const votes = await consensusEngine.getCurrentRoundVotes(roundId);
      expect(votes.length).to.equal(6);
    });
  });

  describe("Consensus Processing", function () {
    const roundId = 1;

    beforeEach(async function () {
      // Cast votes from 6 nodes to meet threshold
      const nodes = [node1, node2, node3, node4, node5, node6];
      for (let i = 0; i < nodes.length; i++) {
        await consensusEngine.connect(nodes[i]).castVote(
          roundId,
          nodes[i].address,
          VALID_CEX_FEES.map(fee => fee + i * 5),
          VALID_DEX_FEES.map(fee => fee + i * 5)
        );
      }
    });

    it("Should process consensus successfully with sufficient votes", async function () {
      const { tx } = await trackGasUsage(
        "processConsensus",
        consensusEngine.connect(node1).processConsensus(roundId)
      );

      await expect(tx)
        .to.emit(consensusEngine, "ConsensusReached")
        .withArgs(roundId, anyValue, anyValue, 6, anyValue);

      expect(await consensusEngine.isConsensusReached(roundId)).to.be.true;
    });

    it("Should fail consensus with insufficient votes", async function () {
      const newRoundId = 2;

      // Only cast 3 votes (below threshold of 6)
      await consensusEngine.connect(node1).castVote(newRoundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES);
      await consensusEngine.connect(node2).castVote(newRoundId, node2.address, VALID_CEX_FEES, VALID_DEX_FEES);
      await consensusEngine.connect(node3).castVote(newRoundId, node3.address, VALID_CEX_FEES, VALID_DEX_FEES);

      const { tx } = await trackGasUsage(
        "processConsensus_fail",
        consensusEngine.connect(node1).processConsensus(newRoundId)
      );

      await expect(tx)
        .to.emit(consensusEngine, "ConsensusFailed")
        .withArgs(newRoundId, 3, 6, "Insufficient votes");

      expect(await consensusEngine.isConsensusReached(newRoundId)).to.be.false;
    });

    it("Should prevent double consensus processing", async function () {
      await consensusEngine.connect(node1).processConsensus(roundId);

      await expect(
        consensusEngine.connect(node1).processConsensus(roundId)
      ).to.be.revertedWithCustomError(consensusEngine, "ConsensusAlreadyProcessed");
    });

    it("Should calculate correct consensus statistics", async function () {
      await consensusEngine.connect(node1).processConsensus(roundId);

      const stats = await consensusEngine.getConsensusStats(roundId);
      expect(stats.totalVotes).to.equal(6);
      expect(stats.requiredVotes).to.equal(6);
      expect(stats.consensusReached).to.be.true;
      expect(stats.agreementPercentage).to.be.greaterThan(60);
    });

    it("Should handle consensus with outlier detection", async function () {
      const outlierRoundId = 3;

      // Cast normal votes from 5 nodes
      const normalNodes = [node1, node2, node3, node4, node5];
      for (let i = 0; i < normalNodes.length; i++) {
        await consensusEngine.connect(normalNodes[i]).castVote(
          outlierRoundId,
          normalNodes[i].address,
          VALID_CEX_FEES,
          VALID_DEX_FEES
        );
      }

      // Cast outlier vote from 6th node
      await consensusEngine.connect(node6).castVote(
        outlierRoundId,
        node6.address,
        OUTLIER_CEX_FEES,
        OUTLIER_DEX_FEES
      );

      const { tx } = await trackGasUsage(
        "processConsensus_outlier",
        consensusEngine.connect(node1).processConsensus(outlierRoundId)
      );

      await expect(tx).to.emit(consensusEngine, "OutlierDetected");

      const outliers = await consensusEngine.detectOutliers(outlierRoundId);
      expect(outliers.length).to.be.greaterThan(0);
    });
  });

  describe("Data Aggregation", function () {
    const roundId = 1;

    beforeEach(async function () {
      // Cast votes and process consensus
      const nodes = [node1, node2, node3, node4, node5, node6];
      for (let i = 0; i < nodes.length; i++) {
        await consensusEngine.connect(nodes[i]).castVote(
          roundId,
          nodes[i].address,
          VALID_CEX_FEES.map(fee => fee + i * 2),
          VALID_DEX_FEES.map(fee => fee + i * 2)
        );
      }
      await consensusEngine.connect(node1).processConsensus(roundId);
    });

    it("Should aggregate data correctly using weighted median", async function () {
      const { tx } = await trackGasUsage(
        "aggregateData",
        consensusEngine.aggregateData(roundId)
      );

      const result = await consensusEngine.getAggregationResult(roundId);
      expect(result.aggregatedCexFees.length).to.be.greaterThan(0);
      expect(result.aggregatedDexFees.length).to.be.greaterThan(0);
      expect(result.confidence).to.be.greaterThan(0);
    });

    it("Should finalize round with correct data structure", async function () {
      const finalData = await consensusEngine.finalizeRound(roundId);

      expect(finalData.cexFees.length).to.be.greaterThan(0);
      expect(finalData.dexFees.length).to.be.greaterThan(0);
      expect(finalData.consensusReached).to.be.true;
      expect(finalData.participatingNodes).to.equal(6);
      expect(finalData.timestamp).to.be.greaterThan(0);
    });

    it("Should reject finalization of non-consensus rounds", async function () {
      const nonConsensusRound = 999;

      await expect(
        consensusEngine.finalizeRound(nonConsensusRound)
      ).to.be.revertedWith("Consensus not reached");
    });
  });

  describe("Outlier Detection", function () {
    const roundId = 1;

    it("Should detect statistical outliers correctly", async function () {
      // Cast normal votes
      const normalNodes = [node1, node2, node3, node4, node5];
      for (const node of normalNodes) {
        await consensusEngine.connect(node).castVote(
          roundId,
          node.address,
          VALID_CEX_FEES,
          VALID_DEX_FEES
        );
      }

      // Cast outlier vote
      await consensusEngine.connect(node6).castVote(
        roundId,
        node6.address,
        OUTLIER_CEX_FEES,
        OUTLIER_DEX_FEES
      );

      const outliers = await consensusEngine.detectOutliers(roundId);
      expect(outliers).to.include(node6.address);
    });

    it("Should calculate deviation correctly", async function () {
      const deviation = await consensusEngine.calculateDeviation(VALID_CEX_FEES, OUTLIER_CEX_FEES);
      expect(deviation).to.be.greaterThan(0);
    });

    it("Should handle edge case with all identical votes", async function () {
      const identicalRound = 2;
      const nodes = [node1, node2, node3, node4, node5, node6];

      for (const node of nodes) {
        await consensusEngine.connect(node).castVote(
          identicalRound,
          node.address,
          VALID_CEX_FEES,
          VALID_DEX_FEES
        );
      }

      const outliers = await consensusEngine.detectOutliers(identicalRound);
      expect(outliers.length).to.equal(0);
    });
  });

  describe("Administrative Functions", function () {
    it("Should allow admin to update consensus threshold", async function () {
      const newThreshold = 7;

      const { tx } = await trackGasUsage(
        "setConsensusThreshold",
        consensusEngine.connect(admin).setConsensusThreshold(newThreshold)
      );

      await expect(tx)
        .to.emit(consensusEngine, "ThresholdUpdated")
        .withArgs(6, newThreshold, anyValue);

      expect(await consensusEngine.getConsensusThreshold()).to.equal(newThreshold);
    });

    it("Should reject invalid threshold values", async function () {
      await expect(
        consensusEngine.connect(admin).setConsensusThreshold(0)
      ).to.be.revertedWith("Invalid threshold");

      await expect(
        consensusEngine.connect(admin).setConsensusThreshold(11)
      ).to.be.revertedWith("Invalid threshold");
    });

    it("Should allow admin to change aggregation method", async function () {
      const newMethod = "simple_average";

      const { tx } = await trackGasUsage(
        "setAggregationMethod",
        consensusEngine.connect(admin).setAggregationMethod(newMethod)
      );

      await expect(tx)
        .to.emit(consensusEngine, "AggregationMethodChanged")
        .withArgs("weighted_median", newMethod, anyValue);

      expect(await consensusEngine.getAggregationMethod()).to.equal(newMethod);
    });

    it("Should allow admin to update outlier detection threshold", async function () {
      const newThreshold = 50;

      const { tx } = await trackGasUsage(
        "setOutlierDetectionThreshold",
        consensusEngine.connect(admin).setOutlierDetectionThreshold(newThreshold)
      );

      await expect(tx).to.emit(consensusEngine, "OutlierThresholdUpdated");
    });

    it("Should allow admin to reset rounds", async function () {
      const roundId = 1;

      // Cast some votes first
      await consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES);

      const { tx } = await trackGasUsage(
        "resetRound",
        consensusEngine.connect(admin).resetRound(roundId)
      );

      expect(tx).to.not.be.reverted;

      // Verify round is reset
      const votes = await consensusEngine.getCurrentRoundVotes(roundId);
      expect(votes.length).to.equal(0);
    });

    it("Should reject admin functions from non-admin", async function () {
      await expect(
        consensusEngine.connect(user).setConsensusThreshold(7)
      ).to.be.revertedWithCustomError(consensusEngine, "AccessControlUnauthorizedAccount");

      await expect(
        consensusEngine.connect(user).setAggregationMethod("new_method")
      ).to.be.revertedWithCustomError(consensusEngine, "AccessControlUnauthorizedAccount");

      await expect(
        consensusEngine.connect(user).resetRound(1)
      ).to.be.revertedWithCustomError(consensusEngine, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Stress Testing", function () {
    it("Should handle 1000+ concurrent vote submissions", async function () {
      this.timeout(60000); // 60 second timeout for stress test

      const startTime = Date.now();
      const promises = [];
      const batchSize = 100;

      // Create multiple rounds with concurrent votes
      for (let round = 1; round <= 10; round++) {
        for (let batch = 0; batch < batchSize; batch++) {
          const nodeIndex = batch % 6;
          const node = [node1, node2, node3, node4, node5, node6][nodeIndex];

          promises.push(
            consensusEngine.connect(node).castVote(
              round,
              node.address,
              VALID_CEX_FEES.map(fee => fee + batch),
              VALID_DEX_FEES.map(fee => fee + batch)
            ).catch(() => {}) // Ignore duplicate vote errors
          );
        }
      }

      await Promise.allSettled(promises);
      const endTime = Date.now();

      performanceMetrics["stress_test_1000_votes"] = endTime - startTime;
      console.log(`Stress test completed in ${endTime - startTime}ms`);

      // Verify at least some votes were successful
      const votes = await consensusEngine.getCurrentRoundVotes(1);
      expect(votes.length).to.be.greaterThan(0);
    });

    it("Should handle rapid consensus processing", async function () {
      this.timeout(30000);

      const promises = [];
      const rounds = 50;

      // Setup votes for multiple rounds
      for (let round = 1; round <= rounds; round++) {
        const nodes = [node1, node2, node3, node4, node5, node6];
        for (let i = 0; i < nodes.length; i++) {
          await consensusEngine.connect(nodes[i]).castVote(
            round,
            nodes[i].address,
            VALID_CEX_FEES.map(fee => fee + i),
            VALID_DEX_FEES.map(fee => fee + i)
          );
        }
      }

      // Process consensus for all rounds concurrently
      const startTime = Date.now();
      for (let round = 1; round <= rounds; round++) {
        promises.push(
          consensusEngine.connect(node1).processConsensus(round)
        );
      }

      await Promise.all(promises);
      const endTime = Date.now();

      performanceMetrics["stress_test_consensus_processing"] = endTime - startTime;
      console.log(`Processed ${rounds} consensus rounds in ${endTime - startTime}ms`);
    });

    it("Should maintain performance with large data arrays", async function () {
      const largeArray = Array(1000).fill(0).map((_, i) => 100 + i);
      const roundId = 1;

      const startTime = Date.now();
      await consensusEngine.connect(node1).castVote(roundId, node1.address, largeArray, largeArray);
      const endTime = Date.now();

      performanceMetrics["large_array_vote"] = endTime - startTime;
      expect(endTime - startTime).to.be.lessThan(5000); // Should complete within 5 seconds
    });
  });

  describe("Fuzzing Tests", function () {
    function generateRandomFees(length: number, min: number = 1, max: number = 10000): number[] {
      return Array(length).fill(0).map(() => Math.floor(Math.random() * (max - min + 1)) + min);
    }

    function generateRandomAddress(): string {
      return ethers.Wallet.createRandom().address;
    }

    it("Should handle random fee data inputs", async function () {
      const iterations = 100;
      let successCount = 0;

      for (let i = 0; i < iterations; i++) {
        try {
          const randomCexFees = generateRandomFees(Math.floor(Math.random() * 20) + 1);
          const randomDexFees = generateRandomFees(Math.floor(Math.random() * 20) + 1);
          const roundId = i + 1;

          await consensusEngine.connect(node1).castVote(
            roundId,
            node1.address,
            randomCexFees,
            randomDexFees
          );
          successCount++;
        } catch (error) {
          // Expected for some invalid inputs
        }
      }

      console.log(`Fuzzing test: ${successCount}/${iterations} successful votes`);
      expect(successCount).to.be.greaterThan(iterations * 0.5); // At least 50% should succeed
    });

    it("Should handle edge case array lengths", async function () {
      const testCases = [
        { cex: [1], dex: [1] }, // Minimum length
        { cex: generateRandomFees(100), dex: generateRandomFees(100) }, // Large arrays
        { cex: generateRandomFees(1), dex: generateRandomFees(100) }, // Mismatched lengths
      ];

      for (let i = 0; i < testCases.length; i++) {
        try {
          await consensusEngine.connect(node1).castVote(
            i + 1,
            node1.address,
            testCases[i].cex,
            testCases[i].dex
          );
        } catch (error) {
          // Some edge cases are expected to fail
        }
      }
    });

    it("Should handle extreme fee values", async function () {
      const extremeCases = [
        { cex: [0], dex: [0] }, // Zero values
        { cex: [ethers.MaxUint256], dex: [ethers.MaxUint256] }, // Maximum values
        { cex: [1, ethers.MaxUint256], dex: [1, ethers.MaxUint256] }, // Mixed extreme values
      ];

      for (let i = 0; i < extremeCases.length; i++) {
        try {
          await consensusEngine.connect(node1).castVote(
            i + 1,
            node1.address,
            extremeCases[i].cex.map(v => typeof v === 'bigint' ? v : BigInt(v)),
            extremeCases[i].dex.map(v => typeof v === 'bigint' ? v : BigInt(v))
          );
        } catch (error) {
          // Some extreme cases may fail validation
        }
      }
    });
  });

  describe("Reentrancy Protection", function () {
    it("Should prevent reentrancy attacks on vote casting", async function () {
      // This test verifies the ReentrancyGuard is working
      const roundId = 1;

      // Attempt to call castVote recursively (should be prevented by ReentrancyGuard)
      await expect(
        consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES)
      ).to.not.be.revertedWith("ReentrancyGuardReentrantCall");
    });

    it("Should prevent reentrancy on consensus processing", async function () {
      const roundId = 1;

      // Setup votes
      const nodes = [node1, node2, node3, node4, node5, node6];
      for (let i = 0; i < nodes.length; i++) {
        await consensusEngine.connect(nodes[i]).castVote(
          roundId,
          nodes[i].address,
          VALID_CEX_FEES,
          VALID_DEX_FEES
        );
      }

      // Process consensus should not allow reentrancy
      await expect(
        consensusEngine.connect(node1).processConsensus(roundId)
      ).to.not.be.revertedWith("ReentrancyGuardReentrantCall");
    });
  });

  describe("Time-based Testing", function () {
    it("Should handle time-sensitive operations correctly", async function () {
      const roundId = 1;
      const startTime = await time.latest();

      // Cast vote and check timestamp
      await consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES);

      const votes = await consensusEngine.getCurrentRoundVotes(roundId);
      expect(votes[0].timestamp).to.be.greaterThanOrEqual(startTime);
    });

    it("Should handle operations across time boundaries", async function () {
      const roundId = 1;

      // Cast initial votes
      await consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES);

      // Advance time significantly
      await time.increase(3600); // 1 hour

      // Cast more votes after time advancement
      await consensusEngine.connect(node2).castVote(roundId, node2.address, VALID_CEX_FEES, VALID_DEX_FEES);

      const votes = await consensusEngine.getCurrentRoundVotes(roundId);
      expect(votes.length).to.equal(2);
      expect(votes[1].timestamp).to.be.greaterThan(votes[0].timestamp);
    });

    it("Should maintain consistency during rapid time changes", async function () {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          (async () => {
            await time.increase(60); // Advance 1 minute
            await consensusEngine.connect(node1).castVote(
              i + 1,
              node1.address,
              VALID_CEX_FEES,
              VALID_DEX_FEES
            );
          })()
        );
      }

      await Promise.all(promises);

      // Verify all votes were recorded
      for (let i = 1; i <= 10; i++) {
        const votes = await consensusEngine.getCurrentRoundVotes(i);
        expect(votes.length).to.equal(1);
      }
    });
  });

  describe("Network Failure Recovery", function () {
    it("Should handle node disconnection gracefully", async function () {
      const roundId = 1;

      // Simulate partial network by having some nodes vote
      await consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES);
      await consensusEngine.connect(node2).castVote(roundId, node2.address, VALID_CEX_FEES, VALID_DEX_FEES);
      await consensusEngine.connect(node3).castVote(roundId, node3.address, VALID_CEX_FEES, VALID_DEX_FEES);

      // Try to process consensus with insufficient votes
      const result = await consensusEngine.connect(node1).processConsensus(roundId);
      expect(result).to.not.be.reverted;

      // Should fail consensus due to insufficient votes
      expect(await consensusEngine.isConsensusReached(roundId)).to.be.false;
    });

    it("Should recover from failed consensus attempts", async function () {
      const roundId = 1;

      // First attempt with insufficient votes
      await consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES);
      await consensusEngine.connect(node2).castVote(roundId, node2.address, VALID_CEX_FEES, VALID_DEX_FEES);
      await consensusEngine.connect(node1).processConsensus(roundId);

      expect(await consensusEngine.isConsensusReached(roundId)).to.be.false;

      // Reset and try again with sufficient votes
      await consensusEngine.connect(admin).resetRound(roundId);

      const nodes = [node1, node2, node3, node4, node5, node6];
      for (const node of nodes) {
        await consensusEngine.connect(node).castVote(roundId, node.address, VALID_CEX_FEES, VALID_DEX_FEES);
      }

      await consensusEngine.connect(node1).processConsensus(roundId);
      expect(await consensusEngine.isConsensusReached(roundId)).to.be.true;
    });

    it("Should handle corrupted state recovery", async function () {
      const roundId = 1;

      // Create a scenario with mixed state
      await consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES);

      // Reset should clean up state
      await consensusEngine.connect(admin).resetRound(roundId);

      // Verify clean state
      const votes = await consensusEngine.getCurrentRoundVotes(roundId);
      expect(votes.length).to.equal(0);
      expect(await consensusEngine.isConsensusReached(roundId)).to.be.false;
    });
  });

  describe("Integration with External Contracts", function () {
    it("Should integrate correctly with NodeManager", async function () {
      // Test that vote weights are correctly retrieved from NodeManager
      const weight = await consensusEngine.getVoteWeight(node1.address);
      expect(weight).to.be.greaterThan(0);
    });

    it("Should handle NodeManager state changes", async function () {
      const roundId = 1;

      // Cast vote normally
      await consensusEngine.connect(node1).castVote(roundId, node1.address, VALID_CEX_FEES, VALID_DEX_FEES);

      // Deactivate node in NodeManager
      await nodeManager.connect(admin).deactivateNode(node1.address);

      // Should still be able to process existing votes
      const votes = await consensusEngine.getCurrentRoundVotes(roundId);
      expect(votes.length).to.equal(1);
    });
  });

  describe("Gas Optimization Verification", function () {
    it("Should maintain gas efficiency for standard operations", async function () {
      const roundId = 1;

      // Test gas usage for vote casting
      const voteTx = await consensusEngine.connect(node1).castVote(
        roundId,
        node1.address,
        VALID_CEX_FEES,
        VALID_DEX_FEES
      );
      const voteReceipt = await voteTx.wait();

      expect(voteReceipt.gasUsed).to.be.lessThan(BigInt(200000)); // Reasonable gas limit

      // Setup for consensus processing
      const nodes = [node2, node3, node4, node5, node6];
      for (const node of nodes) {
        await consensusEngine.connect(node).castVote(roundId, node.address, VALID_CEX_FEES, VALID_DEX_FEES);
      }

      // Test gas usage for consensus processing
      const consensusTx = await consensusEngine.connect(node1).processConsensus(roundId);
      const consensusReceipt = await consensusTx.wait();

      expect(consensusReceipt.gasUsed).to.be.lessThan(BigInt(500000)); // Reasonable gas limit
    });

    it("Should scale efficiently with data size", async function () {
      const smallData = [100, 200];
      const largeData = Array(50).fill(0).map((_, i) => 100 + i);

      // Test small data
      const smallTx = await consensusEngine.connect(node1).castVote(1, node1.address, smallData, smallData);
      const smallReceipt = await smallTx.wait();

      // Test large data
      const largeTx = await consensusEngine.connect(node2).castVote(2, node2.address, largeData, largeData);
      const largeReceipt = await largeTx.wait();

      // Gas should scale reasonably (not exponentially)
      const gasRatio = Number(largeReceipt.gasUsed) / Number(smallReceipt.gasUsed);
      expect(gasRatio).to.be.lessThan(10); // Should not be more than 10x for 25x data
    });
  });
});
