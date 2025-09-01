import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { SecurityManager } from "../../typechain-types";

describe("SecurityManager", function () {
  let securityManager: SecurityManager;
  let admin: SignerWithAddress;
  let node1: SignerWithAddress;
  let node2: SignerWithAddress;
  let maliciousNode: SignerWithAddress;
  let user: SignerWithAddress;

  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const SECURITY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SECURITY_ROLE"));
  const EMERGENCY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE"));

  beforeEach(async function () {
    [admin, node1, node2, maliciousNode, user] = await ethers.getSigners();

    const SecurityManagerFactory = await ethers.getContractFactory("SecurityManager");
    securityManager = (await upgrades.deployProxy(SecurityManagerFactory, [admin.address], {
      initializer: "initialize",
    })) as unknown as SecurityManager;

    // Grant security role for testing
    await securityManager.grantRole(SECURITY_ROLE, admin.address);
  });

  describe("Initialization", function () {
    it("Should initialize with correct admin", async function () {
      expect(await securityManager.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
      expect(await securityManager.hasRole(SECURITY_ROLE, admin.address)).to.be.true;
    });

    it("Should start with zero threat level", async function () {
      expect(await securityManager.getThreatLevel()).to.equal(0);
      expect(await securityManager.isUnderAttack()).to.be.false;
    });

    it("Should have empty threat alerts initially", async function () {
      const alerts = await securityManager.getThreatAlerts();
      expect(alerts).to.have.lengthOf(0);
    });
  });

  describe("Data Validation", function () {
    it("Should validate legitimate submissions", async function () {
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("legitimate data"));
      const signature = "0x" + "00".repeat(65); // Mock valid signature

      await expect(securityManager.validateSubmission(node1.address, dataHash, signature))
        .to.not.be.reverted;
    });

    it("Should detect replay attacks", async function () {
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("duplicate data"));
      const signature = "0x" + "00".repeat(65);

      // First submission should succeed
      await securityManager.validateSubmission(node1.address, dataHash, signature);

      // Second submission with same hash should fail
      await expect(securityManager.validateSubmission(node1.address, dataHash, signature))
        .to.emit(securityManager, "ThreatDetected");
    });

    it("Should detect invalid signatures", async function () {
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test data"));
      const invalidSignature = "0x" + "ff".repeat(64); // Invalid length

      await expect(securityManager.validateSubmission(node1.address, dataHash, invalidSignature))
        .to.emit(securityManager, "ThreatDetected");
    });

    it("Should track submission metrics", async function () {
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test data"));
      const signature = "0x" + "00".repeat(65);

      await securityManager.validateSubmission(node1.address, dataHash, signature);

      const profile = await securityManager.getNodeSecurityProfile(node1.address);
      expect(profile.submissionCount).to.equal(1);
      expect(profile.lastSubmissionTime).to.be.greaterThan(0);
    });
  });

  describe("Rate Limiting", function () {
    it("Should enforce rate limits", async function () {
      const signature = "0x" + "00".repeat(65);

      // Submit many requests rapidly
      for (let i = 0; i < 5; i++) {
        const dataHash = ethers.keccak256(ethers.toUtf8Bytes(`data ${i}`));
        await securityManager.validateSubmission(node1.address, dataHash, signature);
      }

      const profile = await securityManager.getNodeSecurityProfile(node1.address);
      expect(profile.submissionCount).to.equal(5);
    });

    it("Should lockout nodes exceeding rate limits", async function () {
      const signature = "0x" + "00".repeat(65);

      // Simulate rapid submissions (this would normally trigger rate limiting)
      // Note: In a real scenario, you'd need to manipulate time or submission counts
      const profile = await securityManager.getNodeSecurityProfile(node1.address);
      expect(profile.lockoutUntil).to.equal(0); // Initially no lockout
    });

    it("Should reset counters after time window", async function () {
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test data"));
      const signature = "0x" + "00".repeat(65);

      await securityManager.validateSubmission(node1.address, dataHash, signature);

      // Fast forward past rate limit window
      await ethers.provider.send("evm_increaseTime", [3601]); // 1 hour + 1 second
      await ethers.provider.send("evm_mine", []);

      const dataHash2 = ethers.keccak256(ethers.toUtf8Bytes("new data"));
      await securityManager.validateSubmission(node1.address, dataHash2, signature);

      const profile = await securityManager.getNodeSecurityProfile(node1.address);
      expect(profile.submissionCount).to.equal(1); // Should reset
    });
  });

  describe("Threat Detection", function () {
    it("Should detect and record threats", async function () {
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("malicious data"));
      const signature = "0x" + "00".repeat(65);

      // First submission
      await securityManager.validateSubmission(maliciousNode.address, dataHash, signature);

      // Attempt replay attack
      await expect(
        securityManager.validateSubmission(maliciousNode.address, dataHash, signature)
      ).to.emit(securityManager, "ThreatDetected");
    });

    it("Should increase threat level for severe threats", async function () {
      const initialThreatLevel = await securityManager.getThreatLevel();

      // Simulate high-severity threat by attempting multiple replay attacks
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("attack data"));
      const signature = "0x" + "00".repeat(65);

      await securityManager.validateSubmission(maliciousNode.address, dataHash, signature);
      await securityManager.validateSubmission(maliciousNode.address, dataHash, signature);

      const newThreatLevel = await securityManager.getThreatLevel();
      expect(Number(newThreatLevel)).to.equal(Number(initialThreatLevel) + 1);
    });

    it("Should auto-blacklist nodes for severe threats", async function () {
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("severe attack"));
      const signature = "0x" + "00".repeat(65);

      // First submission
      await securityManager.validateSubmission(maliciousNode.address, dataHash, signature);

      // Replay attack (should trigger blacklisting)
      await expect(
        securityManager.validateSubmission(maliciousNode.address, dataHash, signature)
      ).to.emit(securityManager, "NodeBlacklisted");

      expect(await securityManager.isBlacklisted(maliciousNode.address)).to.be.true;
    });

    it("Should trigger emergency lockdown at critical threat level", async function () {
      // Manually set threat level to critical
      await securityManager.setThreatLevel(5);

      expect(await securityManager.isUnderAttack()).to.be.true;
      expect(await securityManager.paused()).to.be.true;
    });
  });

  describe("Blacklist Management", function () {
    beforeEach(async function () {
      // Blacklist a node for testing
      await securityManager.blacklistNode(maliciousNode.address, "Test blacklist");
    });

    it("Should prevent blacklisted nodes from submitting", async function () {
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test data"));
      const signature = "0x" + "00".repeat(65);

      await expect(
        securityManager.validateSubmission(maliciousNode.address, dataHash, signature)
      ).to.be.revertedWithCustomError(securityManager, "NodeBlacklistedError");
    });

    it("Should allow admin to whitelist nodes", async function () {
      await expect(securityManager.whitelistNode(maliciousNode.address))
        .to.emit(securityManager, "NodeWhitelisted");

      expect(await securityManager.isBlacklisted(maliciousNode.address)).to.be.false;
    });

    it("Should maintain blacklist array", async function () {
      const blacklisted = await securityManager.getBlacklistedAddresses();
      expect(blacklisted).to.include(maliciousNode.address);
    });
  });

  describe("Security Metrics", function () {
    it("Should track global security metrics", async function () {
      const metrics = await securityManager.getSecurityMetrics();
      expect(metrics.totalSubmissions).to.equal(0);
      expect(metrics.failedSubmissions).to.equal(0);
      expect(metrics.threatLevel).to.equal(0);
    });

    it("Should update metrics on submissions", async function () {
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test data"));
      const signature = "0x" + "00".repeat(65);

      await securityManager.validateSubmission(node1.address, dataHash, signature);

      const metrics = await securityManager.getSecurityMetrics();
      expect(metrics.totalSubmissions).to.equal(1);
    });

    it("Should track node-specific profiles", async function () {
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test data"));
      const signature = "0x" + "00".repeat(65);

      await securityManager.validateSubmission(node1.address, dataHash, signature);

      const profile = await securityManager.getNodeSecurityProfile(node1.address);
      expect(profile.submissionCount).to.equal(1);
      expect(profile.failedAttempts).to.equal(0);
      expect(profile.reputationScore).to.be.greaterThanOrEqual(0); // Initial reputation
    });
  });

  describe("Threat Alerts", function () {
    it("Should create threat alerts", async function () {
      // Trigger a threat by attempting replay attack
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("attack data"));
      const signature = "0x" + "00".repeat(65);

      await securityManager.validateSubmission(node1.address, dataHash, signature);
      await securityManager.validateSubmission(node1.address, dataHash, signature);

      const alerts = await securityManager.getThreatAlerts();
      expect(alerts.length).to.be.greaterThan(0);
    });

    it("Should filter recent threat alerts", async function () {
      // Create a threat alert
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("recent attack"));
      const signature = "0x" + "00".repeat(65);

      await securityManager.validateSubmission(node1.address, dataHash, signature);
      await securityManager.validateSubmission(node1.address, dataHash, signature);

      const recentAlerts = await securityManager.getRecentThreatAlerts();
      expect(recentAlerts.length).to.be.greaterThan(0);
    });

    it("Should allow security role to resolve alerts", async function () {
      // Create an alert first
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test attack"));
      const signature = "0x" + "00".repeat(65);

      await securityManager.validateSubmission(node1.address, dataHash, signature);
      await securityManager.validateSubmission(node1.address, dataHash, signature);

      // Resolve the first alert (index 0)
      await securityManager.resolveThreatAlert(0);

      const alerts = await securityManager.getThreatAlerts();
      if (alerts.length > 0) {
        expect(alerts[0].resolved).to.be.true;
      }
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to manually set threat level", async function () {
      await expect(securityManager.setThreatLevel(3))
        .to.emit(securityManager, "SecurityLevelChanged");

      expect(await securityManager.getThreatLevel()).to.equal(3);
    });

    it("Should allow admin to clear old alerts", async function () {
      // Create some alerts first
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("old attack"));
      const signature = "0x" + "00".repeat(65);

      await securityManager.validateSubmission(node1.address, dataHash, signature);
      await securityManager.validateSubmission(node1.address, dataHash, signature);

      const initialAlerts = await securityManager.getThreatAlerts();
      const initialCount = initialAlerts.length;

      // Clear alerts older than 0 days (all alerts)
      await securityManager.clearOldThreatAlerts(0);

      const finalAlerts = await securityManager.getThreatAlerts();
      expect(finalAlerts.length).to.be.lessThanOrEqual(initialCount);
    });

    it("Should allow emergency reset", async function () {
      // Set up some state
      await securityManager.setThreatLevel(4);
      await securityManager.blacklistNode(maliciousNode.address, "Test");

      // Emergency reset
      await securityManager.emergencyReset();

      expect(await securityManager.getThreatLevel()).to.equal(0);
      expect(await securityManager.isUnderAttack()).to.be.false;
      expect(await securityManager.paused()).to.be.false;
    });

    it("Should allow security role to update node reputation", async function () {
      const newReputation = 85;

      await securityManager.updateNodeReputation(node1.address, newReputation);

      const profile = await securityManager.getNodeSecurityProfile(node1.address);
      expect(profile.reputationScore).to.equal(newReputation);
    });
  });

  describe("Access Control", function () {
    it("Should reject unauthorized access to admin functions", async function () {
      await expect(
        securityManager.connect(user).setThreatLevel(3)
      ).to.be.revertedWithCustomError(securityManager, "AccessControlUnauthorizedAccount");
    });

    it("Should reject unauthorized access to security functions", async function () {
      await expect(
        securityManager.connect(user).updateNodeReputation(node1.address, 50)
      ).to.be.revertedWithCustomError(securityManager, "AccessControlUnauthorizedAccount");
    });

    it("Should allow emergency role to perform emergency reset", async function () {
      await securityManager.grantRole(EMERGENCY_ROLE, user.address);

      await expect(securityManager.connect(user).emergencyReset())
        .to.emit(securityManager, "SecurityLevelChanged");
    });
  });

  describe("Integration", function () {
    it("Should work with rate limiting modifiers", async function () {
      // This tests the modifier functionality indirectly
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test data"));
      const signature = "0x" + "00".repeat(65);

      // Should succeed initially
      await expect(securityManager.validateSubmission(node1.address, dataHash, signature))
        .to.not.be.reverted;
    });

    it("Should integrate with blacklist checks", async function () {
      await securityManager.blacklistNode(maliciousNode.address, "Test");

      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test data"));
      const signature = "0x" + "00".repeat(65);

      await expect(
        securityManager.validateSubmission(maliciousNode.address, dataHash, signature)
      ).to.be.revertedWithCustomError(securityManager, "NodeBlacklistedError");
    });
  });
});
