import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  QuantlinkOracle,
  NodeManager,
  ConsensusEngine,
  SecurityManager,
} from "../../typechain-types";

describe("QuantlinkOracle", function () {
  let oracle: QuantlinkOracle;
  let nodeManager: NodeManager;
  let consensusEngine: ConsensusEngine;
  let securityManager: SecurityManager;
  
  let admin: SignerWithAddress;
  let node1: SignerWithAddress;
  let node2: SignerWithAddress;
  let node3: SignerWithAddress;
  let node4: SignerWithAddress;
  let node5: SignerWithAddress;
  let node6: SignerWithAddress;
  let user: SignerWithAddress;

  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const NODE_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("NODE_MANAGER_ROLE"));
  const CONSENSUS_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CONSENSUS_ROLE"));

  beforeEach(async function () {
    [admin, node1, node2, node3, node4, node5, node6, user] = await ethers.getSigners();

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

    // Deploy SecurityManager
    const SecurityManagerFactory = await ethers.getContractFactory("SecurityManager");
    securityManager = (await upgrades.deployProxy(SecurityManagerFactory, [admin.address], {
      initializer: "initialize",
    })) as unknown as SecurityManager;

    // Deploy QuantlinkOracle
    const OracleFactory = await ethers.getContractFactory("QuantlinkOracle");
    oracle = (await upgrades.deployProxy(
      OracleFactory,
      [admin.address, await nodeManager.getAddress(), await consensusEngine.getAddress()],
      { initializer: "initialize" }
    )) as unknown as QuantlinkOracle;

    // Grant necessary roles
    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
    await nodeManager.grantRole(ORACLE_ROLE, await oracle.getAddress());
    await consensusEngine.grantRole(ADMIN_ROLE, await oracle.getAddress());
    await oracle.grantRole(CONSENSUS_ROLE, await consensusEngine.getAddress());

    // Register and activate nodes
    const nodes = [node1, node2, node3, node4, node5, node6];
    for (let i = 0; i < nodes.length; i++) {
      await nodeManager.registerNode(nodes[i].address, "0x");
      await nodeManager.activateNode(nodes[i].address, i === 0 ? 2 : 3); // First node as submitter, others as validators
      await oracle.addNode(nodes[i].address);
    }
  });

  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await oracle.getConsensusThreshold()).to.equal(6);
      expect(await oracle.getTotalNodes()).to.equal(10);
      expect(await oracle.getUpdateInterval()).to.equal(300);
    });

    it("Should have correct role assignments", async function () {
      expect(await oracle.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
      expect(await oracle.hasRole(NODE_MANAGER_ROLE, node1.address)).to.be.true;
    });

    it("Should start first consensus round", async function () {
      const currentRound = await oracle.getCurrentRound();
      expect(currentRound.roundId).to.equal(1);
      expect(currentRound.consensusReached).to.be.false;
    });
  });

  describe("Data Submission", function () {
    it("Should allow authorized nodes to submit data", async function () {
      const cexFees = [100, 150, 120]; // basis points
      const dexFees = [200, 250, 220];
      const signature = "0x" + "00".repeat(65); // Mock signature

      await expect(
        oracle.connect(node1).submitData(cexFees, dexFees, signature)
      ).to.emit(oracle, "DataSubmitted");
    });

    it("Should reject submissions from unauthorized addresses", async function () {
      const cexFees = [100, 150, 120];
      const dexFees = [200, 250, 220];
      const signature = "0x" + "00".repeat(65);

      await expect(
        oracle.connect(user).submitData(cexFees, dexFees, signature)
      ).to.be.revertedWithCustomError(oracle, "NodeNotAuthorized");
    });

    it("Should reject duplicate submissions from same node", async function () {
      const cexFees = [100, 150, 120];
      const dexFees = [200, 250, 220];
      const signature = "0x" + "00".repeat(65);

      await oracle.connect(node1).submitData(cexFees, dexFees, signature);

      await expect(
        oracle.connect(node1).submitData(cexFees, dexFees, signature)
      ).to.be.revertedWithCustomError(oracle, "DuplicateSubmission");
    });

    it("Should validate fee data ranges", async function () {
      const invalidCexFees = [10001]; // > 100%
      const dexFees = [200];
      const signature = "0x" + "00".repeat(65);

      await expect(
        oracle.connect(node1).submitData(invalidCexFees, dexFees, signature)
      ).to.be.revertedWithCustomError(oracle, "InvalidDataSubmission");
    });

    it("Should reject submissions outside submission window", async function () {
      // Fast forward past submission window
      await ethers.provider.send("evm_increaseTime", [200]); // 200 seconds
      await ethers.provider.send("evm_mine", []);

      const cexFees = [100, 150, 120];
      const dexFees = [200, 250, 220];
      const signature = "0x" + "00".repeat(65);

      await expect(
        oracle.connect(node1).submitData(cexFees, dexFees, signature)
      ).to.be.revertedWithCustomError(oracle, "SubmissionWindowClosed");
    });
  });

  describe("Consensus Processing", function () {
    beforeEach(async function () {
      // Submit data from multiple nodes
      const nodes = [node1, node2, node3, node4, node5, node6];
      const signature = "0x" + "00".repeat(65);

      for (let i = 0; i < 6; i++) {
        const cexFees = [100 + i * 10, 150 + i * 5, 120 + i * 8];
        const dexFees = [200 + i * 15, 250 + i * 12, 220 + i * 10];
        await oracle.connect(nodes[i]).submitData(cexFees, dexFees, signature);
      }
    });

    it("Should process consensus when threshold is met", async function () {
      // Fast forward to consensus processing time
      await ethers.provider.send("evm_increaseTime", [190]);
      await ethers.provider.send("evm_mine", []);

      await expect(oracle.processConsensus()).to.emit(oracle, "ConsensusReached");
    });

    it("Should update latest fee data after consensus", async function () {
      await ethers.provider.send("evm_increaseTime", [190]);
      await ethers.provider.send("evm_mine", []);

      await oracle.processConsensus();

      const latestData = await oracle.getLatestFeeData();
      expect(latestData.consensusReached).to.be.true;
      expect(latestData.participatingNodes).to.equal(6);
    });

    it("Should start new round after consensus", async function () {
      const initialRoundId = (await oracle.getCurrentRound()).roundId;

      await ethers.provider.send("evm_increaseTime", [190]);
      await ethers.provider.send("evm_mine", []);

      await oracle.processConsensus();

      const newRoundId = (await oracle.getCurrentRound()).roundId;
      expect(newRoundId).to.equal(initialRoundId + 1n);
    });
  });

  describe("Node Management", function () {
    it("Should allow admin to add nodes", async function () {
      const newNode = await ethers.Wallet.createRandom();
      
      await expect(oracle.addNode(newNode.address))
        .to.emit(nodeManager, "NodeRegistered")
        .withArgs(newNode.address, "0x", await ethers.provider.getBlockNumber() + 1);
    });

    it("Should allow admin to remove nodes", async function () {
      await expect(oracle.removeNode(node1.address))
        .to.emit(nodeManager, "NodeDeactivated");
    });

    it("Should reject node management from non-admin", async function () {
      const newNode = await ethers.Wallet.createRandom();
      
      await expect(
        oracle.connect(user).addNode(newNode.address)
      ).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Configuration Management", function () {
    it("Should allow admin to update consensus threshold", async function () {
      const newThreshold = 7;
      
      await expect(oracle.updateConsensusThreshold(newThreshold))
        .to.emit(oracle, "ConfigurationUpdated")
        .withArgs("consensusThreshold", 6, newThreshold, admin.address);
      
      expect(await oracle.getConsensusThreshold()).to.equal(newThreshold);
    });

    it("Should reject invalid consensus threshold", async function () {
      await expect(
        oracle.updateConsensusThreshold(0)
      ).to.be.revertedWith("Invalid threshold");

      await expect(
        oracle.updateConsensusThreshold(11)
      ).to.be.revertedWith("Invalid threshold");
    });

    it("Should reject update interval changes", async function () {
      await expect(
        oracle.updateUpdateInterval(600)
      ).to.be.revertedWithCustomError(oracle, "InvalidConfiguration");
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow emergency pause", async function () {
      await expect(oracle.emergencyPause())
        .to.emit(oracle, "EmergencyPaused")
        .withArgs(admin.address, await ethers.provider.getBlockNumber() + 1);
      
      expect(await oracle.paused()).to.be.true;
    });

    it("Should allow emergency unpause", async function () {
      await oracle.emergencyPause();
      
      await expect(oracle.emergencyUnpause())
        .to.emit(oracle, "EmergencyUnpaused");
      
      expect(await oracle.paused()).to.be.false;
    });

    it("Should reject emergency functions from unauthorized users", async function () {
      await expect(
        oracle.connect(user).emergencyPause()
      ).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
    });
  });

  describe("View Functions", function () {
    it("Should return correct current round information", async function () {
      const round = await oracle.getCurrentRound();
      expect(round.roundId).to.equal(1);
      expect(round.submissionsCount).to.equal(0);
      expect(round.consensusReached).to.be.false;
    });

    it("Should return submission window status", async function () {
      expect(await oracle.isSubmissionWindowOpen()).to.be.true;
      
      await ethers.provider.send("evm_increaseTime", [200]);
      await ethers.provider.send("evm_mine", []);
      
      expect(await oracle.isSubmissionWindowOpen()).to.be.false;
    });

    it("Should return node nonces", async function () {
      const initialNonce = await oracle.getNodeNonce(node1.address);
      expect(initialNonce).to.equal(0);
    });
  });

  describe("Integration", function () {
    it("Should work with NodeManager for node rotation", async function () {
      const currentSubmitter = await oracle.getCurrentSubmitter();
      expect(currentSubmitter).to.equal(node1.address);
      
      await oracle.rotateSubmitter();
      
      const newSubmitter = await oracle.getCurrentSubmitter();
      expect(newSubmitter).to.not.equal(currentSubmitter);
    });

    it("Should integrate with ConsensusEngine for data processing", async function () {
      // This is tested implicitly in consensus processing tests
      expect(await consensusEngine.getConsensusThreshold()).to.equal(6);
    });
  });
});
