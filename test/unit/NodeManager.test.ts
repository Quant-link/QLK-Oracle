import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { NodeManager } from "../../typechain-types";

describe("NodeManager", function () {
  let nodeManager: NodeManager;
  let admin: SignerWithAddress;
  let node1: SignerWithAddress;
  let node2: SignerWithAddress;
  let node3: SignerWithAddress;
  let user: SignerWithAddress;

  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));

  beforeEach(async function () {
    [admin, node1, node2, node3, user] = await ethers.getSigners();

    const NodeManagerFactory = await ethers.getContractFactory("NodeManager");
    nodeManager = (await upgrades.deployProxy(NodeManagerFactory, [admin.address], {
      initializer: "initialize",
    })) as unknown as NodeManager;
  });

  describe("Initialization", function () {
    it("Should initialize with correct admin", async function () {
      expect(await nodeManager.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("Should have default rotation interval", async function () {
      const schedule = await nodeManager.getRotationSchedule();
      expect(schedule.rotationInterval).to.equal(300); // 5 minutes
    });

    it("Should start with no active nodes", async function () {
      expect(await nodeManager.getTotalActiveNodes()).to.equal(0);
    });
  });

  describe("Node Registration", function () {
    it("Should allow admin to register nodes", async function () {
      const publicKey = "0x" + "04".repeat(32); // Mock public key

      await expect(nodeManager.registerNode(node1.address, publicKey))
        .to.emit(nodeManager, "NodeRegistered");
    });

    it("Should reject duplicate node registration", async function () {
      await nodeManager.registerNode(node1.address, "0x");
      
      await expect(
        nodeManager.registerNode(node1.address, "0x")
      ).to.be.revertedWithCustomError(nodeManager, "NodeAlreadyRegistered");
    });

    it("Should reject registration from non-admin", async function () {
      await expect(
        nodeManager.connect(user).registerNode(node1.address, "0x")
      ).to.be.revertedWithCustomError(nodeManager, "AccessControlUnauthorizedAccount");
    });

    it("Should enforce maximum node limit", async function () {
      // Register maximum nodes (10)
      for (let i = 0; i < 10; i++) {
        const wallet = ethers.Wallet.createRandom();
        await nodeManager.registerNode(wallet.address, "0x");
      }

      // Try to register 11th node
      const extraNode = ethers.Wallet.createRandom();
      await expect(
        nodeManager.registerNode(extraNode.address, "0x")
      ).to.be.revertedWithCustomError(nodeManager, "MaxNodesReached");
    });
  });

  describe("Node Activation", function () {
    beforeEach(async function () {
      await nodeManager.registerNode(node1.address, "0x");
      await nodeManager.registerNode(node2.address, "0x");
      await nodeManager.registerNode(node3.address, "0x");
    });

    it("Should activate node as submitter", async function () {
      await expect(nodeManager.activateNode(node1.address, 2)) // NodeState.Submitter
        .to.emit(nodeManager, "NodeActivated");

      expect(await nodeManager.isNodeSubmitter(node1.address)).to.be.true;
      expect(await nodeManager.getCurrentSubmitter()).to.equal(node1.address);
    });

    it("Should activate node as validator", async function () {
      await expect(nodeManager.activateNode(node1.address, 3)) // NodeState.Validator
        .to.emit(nodeManager, "NodeActivated");

      expect(await nodeManager.isNodeValidator(node1.address)).to.be.true;
    });

    it("Should activate node as backup", async function () {
      await expect(nodeManager.activateNode(node1.address, 4)) // NodeState.Backup
        .to.emit(nodeManager, "NodeActivated");

      const backupNodes = await nodeManager.getBackupNodes();
      expect(backupNodes).to.include(node1.address);
    });

    it("Should update active node count", async function () {
      await nodeManager.activateNode(node1.address, 2); // Submitter
      await nodeManager.activateNode(node2.address, 3); // Validator

      expect(await nodeManager.getTotalActiveNodes()).to.equal(2);
    });

    it("Should reject activation of non-existent node", async function () {
      await expect(
        nodeManager.activateNode(user.address, 2)
      ).to.be.revertedWithCustomError(nodeManager, "NodeNotFound");
    });
  });

  describe("Node Deactivation", function () {
    beforeEach(async function () {
      // Register and activate multiple nodes
      const nodes = [node1, node2, node3];
      for (let i = 0; i < nodes.length; i++) {
        await nodeManager.registerNode(nodes[i].address, "0x");
        await nodeManager.activateNode(nodes[i].address, i === 0 ? 2 : 3); // First as submitter, others as validators
      }
    });

    it("Should deactivate node", async function () {
      await expect(nodeManager.deactivateNode(node2.address))
        .to.emit(nodeManager, "NodeDeactivated");

      expect(await nodeManager.isNodeActive(node2.address)).to.be.false;
    });

    it("Should handle submitter deactivation with rotation", async function () {
      const initialSubmitter = await nodeManager.getCurrentSubmitter();
      expect(initialSubmitter).to.equal(node1.address);

      await nodeManager.deactivateNode(node1.address);

      const newSubmitter = await nodeManager.getCurrentSubmitter();
      expect(newSubmitter).to.not.equal(node1.address);
      expect(newSubmitter).to.not.equal(ethers.ZeroAddress);
    });

    it("Should reject deactivation if insufficient active nodes", async function () {
      // Deactivate nodes until we're at minimum
      await nodeManager.deactivateNode(node2.address);
      await nodeManager.deactivateNode(node3.address);

      // Try to deactivate last node (should fail due to minimum requirement)
      await expect(
        nodeManager.deactivateNode(node1.address)
      ).to.be.revertedWithCustomError(nodeManager, "InsufficientActiveNodes");
    });
  });

  describe("Node Suspension", function () {
    beforeEach(async function () {
      await nodeManager.registerNode(node1.address, "0x");
      await nodeManager.activateNode(node1.address, 2); // Submitter
    });

    it("Should suspend node with reason", async function () {
      const reason = "Malicious behavior detected";

      await expect(nodeManager.suspendNode(node1.address, reason))
        .to.emit(nodeManager, "NodeSuspended");

      const nodeInfo = await nodeManager.getNode(node1.address);
      expect(nodeInfo.state).to.equal(5); // NodeState.Suspended
    });

    it("Should reduce reputation on suspension", async function () {
      const initialNode = await nodeManager.getNode(node1.address);
      const initialReputation = initialNode.reputation;

      await nodeManager.suspendNode(node1.address, "Test suspension");

      const suspendedNode = await nodeManager.getNode(node1.address);
      expect(suspendedNode.reputation).to.be.lessThan(initialReputation);
    });

    it("Should handle submitter suspension with rotation", async function () {
      // Add another node to rotate to
      await nodeManager.registerNode(node2.address, "0x");
      await nodeManager.activateNode(node2.address, 3); // Validator

      const initialSubmitter = await nodeManager.getCurrentSubmitter();
      await nodeManager.suspendNode(initialSubmitter, "Test");

      const newSubmitter = await nodeManager.getCurrentSubmitter();
      expect(newSubmitter).to.not.equal(initialSubmitter);
    });
  });

  describe("Submitter Rotation", function () {
    beforeEach(async function () {
      // Set up multiple nodes
      const nodes = [node1, node2, node3];
      for (let i = 0; i < nodes.length; i++) {
        await nodeManager.registerNode(nodes[i].address, "0x");
        await nodeManager.activateNode(nodes[i].address, i === 0 ? 2 : 3);
      }

      // Grant Oracle role for rotation testing
      await nodeManager.grantRole(ORACLE_ROLE, admin.address);
    });

    it("Should rotate submitter after interval", async function () {
      const initialSubmitter = await nodeManager.getCurrentSubmitter();

      // Fast forward past rotation time
      await ethers.provider.send("evm_increaseTime", [301]);
      await ethers.provider.send("evm_mine", []);

      await expect(nodeManager.rotateSubmitter())
        .to.emit(nodeManager, "SubmitterRotated");

      const newSubmitter = await nodeManager.getCurrentSubmitter();
      expect(newSubmitter).to.not.equal(initialSubmitter);
    });

    it("Should reject early rotation", async function () {
      await expect(
        nodeManager.rotateSubmitter()
      ).to.be.revertedWithCustomError(nodeManager, "RotationTooEarly");
    });

    it("Should update node states during rotation", async function () {
      const initialSubmitter = await nodeManager.getCurrentSubmitter();

      await ethers.provider.send("evm_increaseTime", [301]);
      await ethers.provider.send("evm_mine", []);

      await nodeManager.rotateSubmitter();

      // Previous submitter should become validator
      expect(await nodeManager.isNodeValidator(initialSubmitter)).to.be.true;
      expect(await nodeManager.isNodeSubmitter(initialSubmitter)).to.be.false;
    });
  });

  describe("Backup Node Management", function () {
    beforeEach(async function () {
      await nodeManager.registerNode(node1.address, "0x");
      await nodeManager.registerNode(node2.address, "0x");
      await nodeManager.activateNode(node1.address, 3); // Validator
      await nodeManager.activateNode(node2.address, 4); // Backup

      await nodeManager.grantRole(ORACLE_ROLE, admin.address);
    });

    it("Should activate backup node when primary fails", async function () {
      await expect(nodeManager.activateBackupNode(node1.address))
        .to.emit(nodeManager, "BackupNodeActivated");

      expect(await nodeManager.isNodeValidator(node2.address)).to.be.true;
    });

    it("Should handle failed node suspension", async function () {
      await nodeManager.activateBackupNode(node1.address);

      const failedNode = await nodeManager.getNode(node1.address);
      expect(failedNode.state).to.equal(5); // Suspended
    });
  });

  describe("Reputation Management", function () {
    beforeEach(async function () {
      await nodeManager.registerNode(node1.address, "0x");
      await nodeManager.grantRole(ORACLE_ROLE, admin.address);
    });

    it("Should update node reputation", async function () {
      const newReputation = 90;

      await expect(nodeManager.updateNodeReputation(node1.address, newReputation))
        .to.emit(nodeManager, "NodeReputationUpdated")
        .withArgs(node1.address, 75, newReputation); // Initial reputation is 75

      expect(await nodeManager.getNodeReputation(node1.address)).to.equal(newReputation);
    });

    it("Should record node activity", async function () {
      await nodeManager.recordNodeActivity(node1.address);

      const nodeInfo = await nodeManager.getNode(node1.address);
      expect(nodeInfo.submissionCount).to.equal(1);
      expect(nodeInfo.lastActiveTime).to.be.greaterThan(0);
    });

    it("Should record consensus participation", async function () {
      await nodeManager.recordConsensusParticipation(node1.address);

      const nodeInfo = await nodeManager.getNode(node1.address);
      expect(nodeInfo.consensusParticipation).to.equal(1);
    });

    it("Should increase reputation for activity", async function () {
      const initialReputation = (await nodeManager.getNode(node1.address)).reputation;

      await nodeManager.recordNodeActivity(node1.address);

      const newReputation = (await nodeManager.getNode(node1.address)).reputation;
      expect(newReputation).to.be.greaterThan(initialReputation);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await nodeManager.registerNode(node1.address, "0x");
      await nodeManager.registerNode(node2.address, "0x");
      await nodeManager.activateNode(node1.address, 2); // Submitter
      await nodeManager.activateNode(node2.address, 3); // Validator
    });

    it("Should return correct node information", async function () {
      const nodeInfo = await nodeManager.getNode(node1.address);
      expect(nodeInfo.nodeAddress).to.equal(node1.address);
      expect(nodeInfo.state).to.equal(2); // Submitter
      expect(nodeInfo.reputation).to.equal(75);
    });

    it("Should return active nodes list", async function () {
      const activeNodes = await nodeManager.getAllActiveNodes();
      expect(activeNodes).to.have.lengthOf(2);
      expect(activeNodes).to.include(node1.address);
      expect(activeNodes).to.include(node2.address);
    });

    it("Should return submitter nodes", async function () {
      const submitters = await nodeManager.getSubmitterNodes();
      expect(submitters).to.have.lengthOf(1);
      expect(submitters[0]).to.equal(node1.address);
    });

    it("Should return validator nodes", async function () {
      const validators = await nodeManager.getValidatorNodes();
      expect(validators).to.have.lengthOf(1);
      expect(validators[0]).to.equal(node2.address);
    });

    it("Should check node submission capability", async function () {
      expect(await nodeManager.canNodeSubmit(node1.address)).to.be.true;
      expect(await nodeManager.canNodeSubmit(node2.address)).to.be.true;
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to set rotation interval", async function () {
      const newInterval = 600; // 10 minutes

      await expect(nodeManager.setRotationInterval(newInterval))
        .to.emit(nodeManager, "RotationIntervalUpdated")
        .withArgs(300, newInterval, admin.address);

      const schedule = await nodeManager.getRotationSchedule();
      expect(schedule.rotationInterval).to.equal(newInterval);
    });

    it("Should reject invalid rotation intervals", async function () {
      await expect(
        nodeManager.setRotationInterval(30) // Too short
      ).to.be.revertedWithCustomError(nodeManager, "InvalidRotationInterval");

      await expect(
        nodeManager.setRotationInterval(7200) // Too long
      ).to.be.revertedWithCustomError(nodeManager, "InvalidRotationInterval");
    });

    it("Should allow emergency role to force rotation", async function () {
      await nodeManager.registerNode(node1.address, "0x");
      await nodeManager.registerNode(node2.address, "0x");
      await nodeManager.activateNode(node1.address, 2); // Submitter
      await nodeManager.activateNode(node2.address, 3); // Validator

      const EMERGENCY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE"));
      await nodeManager.grantRole(EMERGENCY_ROLE, admin.address);

      await expect(nodeManager.forceRotation(node2.address))
        .to.emit(nodeManager, "SubmitterRotated");
    });
  });
});
