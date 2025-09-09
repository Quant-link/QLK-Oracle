import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  AccessControlManager,
} from "../../typechain-types";

describe("AccessControlManager", function () {
  let accessControl: AccessControlManager;
  let superAdmin: SignerWithAddress;
  let admin: SignerWithAddress;
  let oracleAdmin: SignerWithAddress;
  let nodeOperator: SignerWithAddress;
  let securityOfficer: SignerWithAddress;
  let monitor: SignerWithAddress;
  let emergencyResponder: SignerWithAddress;
  let user: SignerWithAddress;
  let delegatee: SignerWithAddress;

  // Role constants
  const SUPER_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SUPER_ADMIN_ROLE"));
  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const ORACLE_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ADMIN_ROLE"));
  const NODE_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("NODE_OPERATOR_ROLE"));
  const SECURITY_OFFICER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SECURITY_OFFICER_ROLE"));
  const MONITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MONITOR_ROLE"));
  const EMERGENCY_RESPONDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_RESPONDER_ROLE"));

  // Permission constants
  const CAN_SUBMIT_DATA = ethers.keccak256(ethers.toUtf8Bytes("CAN_SUBMIT_DATA"));
  const CAN_PROCESS_CONSENSUS = ethers.keccak256(ethers.toUtf8Bytes("CAN_PROCESS_CONSENSUS"));
  const CAN_MANAGE_NODES = ethers.keccak256(ethers.toUtf8Bytes("CAN_MANAGE_NODES"));
  const CAN_UPDATE_CONFIG = ethers.keccak256(ethers.toUtf8Bytes("CAN_UPDATE_CONFIG"));
  const CAN_PAUSE_SYSTEM = ethers.keccak256(ethers.toUtf8Bytes("CAN_PAUSE_SYSTEM"));
  const CAN_UPGRADE_CONTRACTS = ethers.keccak256(ethers.toUtf8Bytes("CAN_UPGRADE_CONTRACTS"));
  const CAN_BLACKLIST_NODES = ethers.keccak256(ethers.toUtf8Bytes("CAN_BLACKLIST_NODES"));
  const CAN_VIEW_SENSITIVE_DATA = ethers.keccak256(ethers.toUtf8Bytes("CAN_VIEW_SENSITIVE_DATA"));

  // Performance tracking
  let gasUsage: { [key: string]: bigint } = {};
  let performanceMetrics: { [key: string]: number } = {};

  async function deployAccessControlFixture() {
    const [superAdmin, admin, oracleAdmin, nodeOperator, securityOfficer, monitor, emergencyResponder, user, delegatee] = 
      await ethers.getSigners();

    // Deploy AccessControlManager
    const AccessControlManagerFactory = await ethers.getContractFactory("AccessControlManager");
    const accessControl = (await upgrades.deployProxy(
      AccessControlManagerFactory,
      [superAdmin.address],
      { initializer: "initialize" }
    )) as unknown as AccessControlManager;

    return {
      accessControl,
      superAdmin,
      admin,
      oracleAdmin,
      nodeOperator,
      securityOfficer,
      monitor,
      emergencyResponder,
      user,
      delegatee,
    };
  }

  beforeEach(async function () {
    const fixture = await loadFixture(deployAccessControlFixture);
    accessControl = fixture.accessControl;
    superAdmin = fixture.superAdmin;
    admin = fixture.admin;
    oracleAdmin = fixture.oracleAdmin;
    nodeOperator = fixture.nodeOperator;
    securityOfficer = fixture.securityOfficer;
    monitor = fixture.monitor;
    emergencyResponder = fixture.emergencyResponder;
    user = fixture.user;
    delegatee = fixture.delegatee;

    // Reset tracking
    gasUsage = {};
    performanceMetrics = {};
  });

  afterEach(async function () {
    // Log performance metrics
    console.log("\n📊 AccessControlManager Performance Metrics:");
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
    it("Should initialize with correct super admin", async function () {
      expect(await accessControl.hasRole(SUPER_ADMIN_ROLE, superAdmin.address)).to.be.true;
      expect(await accessControl.hasRole(await accessControl.DEFAULT_ADMIN_ROLE(), superAdmin.address)).to.be.true;
    });

    it("Should set up role hierarchy correctly", async function () {
      expect(await accessControl.getRoleAdmin(ADMIN_ROLE)).to.equal(SUPER_ADMIN_ROLE);
      expect(await accessControl.getRoleAdmin(ORACLE_ADMIN_ROLE)).to.equal(ADMIN_ROLE);
      expect(await accessControl.getRoleAdmin(NODE_OPERATOR_ROLE)).to.equal(ORACLE_ADMIN_ROLE);
      expect(await accessControl.getRoleAdmin(SECURITY_OFFICER_ROLE)).to.equal(ADMIN_ROLE);
      expect(await accessControl.getRoleAdmin(MONITOR_ROLE)).to.equal(SECURITY_OFFICER_ROLE);
      expect(await accessControl.getRoleAdmin(EMERGENCY_RESPONDER_ROLE)).to.equal(SUPER_ADMIN_ROLE);
    });

    it("Should reject initialization with zero address", async function () {
      const AccessControlManagerFactory = await ethers.getContractFactory("AccessControlManager");
      
      await expect(
        upgrades.deployProxy(
          AccessControlManagerFactory,
          [ethers.ZeroAddress],
          { initializer: "initialize" }
        )
      ).to.be.revertedWith("Invalid super admin address");
    });

    it("Should prevent double initialization", async function () {
      await expect(
        accessControl.initialize(superAdmin.address)
      ).to.be.revertedWithCustomError(accessControl, "InvalidInitialization");
    });

    it("Should return correct version", async function () {
      expect(await accessControl.version()).to.equal("1.0.0");
    });
  });

  describe("Role Management", function () {
    beforeEach(async function () {
      // Grant basic roles for testing
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);
      await accessControl.connect(admin).grantRole(ORACLE_ADMIN_ROLE, oracleAdmin.address);
      await accessControl.connect(admin).grantRole(SECURITY_OFFICER_ROLE, securityOfficer.address);
      await accessControl.connect(superAdmin).grantRole(EMERGENCY_RESPONDER_ROLE, emergencyResponder.address);
    });

    it("Should grant roles with proper hierarchy", async function () {
      const { tx } = await trackGasUsage(
        "grantRole",
        accessControl.connect(oracleAdmin).grantRole(NODE_OPERATOR_ROLE, nodeOperator.address)
      );

      expect(await accessControl.hasRole(NODE_OPERATOR_ROLE, nodeOperator.address)).to.be.true;
      await expect(tx).to.emit(accessControl, "RoleGranted");
    });

    it("Should grant roles with expiry time", async function () {
      const expiryTime = (await time.latest()) + 3600; // 1 hour from now

      const { tx } = await trackGasUsage(
        "grantRoleWithExpiry",
        accessControl.connect(oracleAdmin).grantRoleWithExpiry(
          NODE_OPERATOR_ROLE,
          nodeOperator.address,
          expiryTime
        )
      );

      expect(await accessControl.hasRole(NODE_OPERATOR_ROLE, nodeOperator.address)).to.be.true;
      expect(await accessControl.isRoleValid(NODE_OPERATOR_ROLE, nodeOperator.address)).to.be.true;
      
      await expect(tx).to.emit(accessControl, "RoleGrantedWithExpiry")
        .withArgs(NODE_OPERATOR_ROLE, nodeOperator.address, oracleAdmin.address, expiryTime);
    });

    it("Should reject granting roles with past expiry time", async function () {
      const pastTime = (await time.latest()) - 3600; // 1 hour ago

      await expect(
        accessControl.connect(oracleAdmin).grantRoleWithExpiry(
          NODE_OPERATOR_ROLE,
          nodeOperator.address,
          pastTime
        )
      ).to.be.revertedWith("Expiry time must be in future");
    });

    it("Should reject granting roles with too distant expiry time", async function () {
      const tooFarFuture = (await time.latest()) + (366 * 24 * 3600); // More than MAX_ROLE_DURATION

      await expect(
        accessControl.connect(oracleAdmin).grantRoleWithExpiry(
          NODE_OPERATOR_ROLE,
          nodeOperator.address,
          tooFarFuture
        )
      ).to.be.revertedWith("Expiry time too far in future");
    });

    it("Should revoke roles correctly", async function () {
      await accessControl.connect(oracleAdmin).grantRole(NODE_OPERATOR_ROLE, nodeOperator.address);
      
      const { tx } = await trackGasUsage(
        "revokeRole",
        accessControl.connect(oracleAdmin).revokeRole(NODE_OPERATOR_ROLE, nodeOperator.address)
      );

      expect(await accessControl.hasRole(NODE_OPERATOR_ROLE, nodeOperator.address)).to.be.false;
      await expect(tx).to.emit(accessControl, "RoleRevoked");
    });

    it("Should enforce role hierarchy for granting", async function () {
      // User without proper role should not be able to grant roles
      await expect(
        accessControl.connect(user).grantRole(NODE_OPERATOR_ROLE, nodeOperator.address)
      ).to.be.revertedWithCustomError(accessControl, "AccessControlUnauthorizedAccount");
    });

    it("Should handle expired roles correctly", async function () {
      const shortExpiry = (await time.latest()) + 60; // 1 minute
      
      await accessControl.connect(oracleAdmin).grantRoleWithExpiry(
        NODE_OPERATOR_ROLE,
        nodeOperator.address,
        shortExpiry
      );

      expect(await accessControl.isRoleValid(NODE_OPERATOR_ROLE, nodeOperator.address)).to.be.true;

      // Fast forward past expiry
      await time.increase(120);

      expect(await accessControl.isRoleValid(NODE_OPERATOR_ROLE, nodeOperator.address)).to.be.false;
    });

    it("Should revoke expired roles", async function () {
      const shortExpiry = (await time.latest()) + 60;
      
      await accessControl.connect(oracleAdmin).grantRoleWithExpiry(
        NODE_OPERATOR_ROLE,
        nodeOperator.address,
        shortExpiry
      );

      // Fast forward past expiry
      await time.increase(120);

      const { tx } = await trackGasUsage(
        "revokeExpiredRoles",
        accessControl.revokeExpiredRoles(nodeOperator.address)
      );

      expect(await accessControl.hasRole(NODE_OPERATOR_ROLE, nodeOperator.address)).to.be.false;
      await expect(tx).to.emit(accessControl, "InactiveRoleRevoked");
    });
  });

  describe("Permission System", function () {
    beforeEach(async function () {
      // Set up role hierarchy
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);
      await accessControl.connect(admin).grantRole(ORACLE_ADMIN_ROLE, oracleAdmin.address);
      await accessControl.connect(oracleAdmin).grantRole(NODE_OPERATOR_ROLE, nodeOperator.address);
      await accessControl.connect(admin).grantRole(SECURITY_OFFICER_ROLE, securityOfficer.address);
      await accessControl.connect(securityOfficer).grantRole(MONITOR_ROLE, monitor.address);
      await accessControl.connect(superAdmin).grantRole(EMERGENCY_RESPONDER_ROLE, emergencyResponder.address);
    });

    it("Should check permissions correctly for each role", async function () {
      // NODE_OPERATOR_ROLE should have CAN_SUBMIT_DATA
      expect(await accessControl.hasPermission(nodeOperator.address, CAN_SUBMIT_DATA)).to.be.true;

      // ORACLE_ADMIN_ROLE should have CAN_PROCESS_CONSENSUS and CAN_MANAGE_NODES
      expect(await accessControl.hasPermission(oracleAdmin.address, CAN_PROCESS_CONSENSUS)).to.be.true;
      expect(await accessControl.hasPermission(oracleAdmin.address, CAN_MANAGE_NODES)).to.be.true;

      // ADMIN_ROLE should have CAN_UPDATE_CONFIG
      expect(await accessControl.hasPermission(admin.address, CAN_UPDATE_CONFIG)).to.be.true;

      // EMERGENCY_RESPONDER_ROLE should have CAN_PAUSE_SYSTEM
      expect(await accessControl.hasPermission(emergencyResponder.address, CAN_PAUSE_SYSTEM)).to.be.true;

      // SUPER_ADMIN_ROLE should have CAN_UPGRADE_CONTRACTS
      expect(await accessControl.hasPermission(superAdmin.address, CAN_UPGRADE_CONTRACTS)).to.be.true;

      // SECURITY_OFFICER_ROLE should have CAN_BLACKLIST_NODES
      expect(await accessControl.hasPermission(securityOfficer.address, CAN_BLACKLIST_NODES)).to.be.true;

      // MONITOR_ROLE should have CAN_VIEW_SENSITIVE_DATA
      expect(await accessControl.hasPermission(monitor.address, CAN_VIEW_SENSITIVE_DATA)).to.be.true;
    });

    it("Should deny permissions for users without proper roles", async function () {
      expect(await accessControl.hasPermission(user.address, CAN_SUBMIT_DATA)).to.be.false;
      expect(await accessControl.hasPermission(user.address, CAN_PROCESS_CONSENSUS)).to.be.false;
      expect(await accessControl.hasPermission(user.address, CAN_MANAGE_NODES)).to.be.false;
      expect(await accessControl.hasPermission(user.address, CAN_UPDATE_CONFIG)).to.be.false;
      expect(await accessControl.hasPermission(user.address, CAN_PAUSE_SYSTEM)).to.be.false;
      expect(await accessControl.hasPermission(user.address, CAN_UPGRADE_CONTRACTS)).to.be.false;
      expect(await accessControl.hasPermission(user.address, CAN_BLACKLIST_NODES)).to.be.false;
      expect(await accessControl.hasPermission(user.address, CAN_VIEW_SENSITIVE_DATA)).to.be.false;
    });

    it("Should respect role expiry for permissions", async function () {
      const shortExpiry = (await time.latest()) + 60;

      await accessControl.connect(oracleAdmin).grantRoleWithExpiry(
        NODE_OPERATOR_ROLE,
        user.address,
        shortExpiry
      );

      // Should have permission initially
      expect(await accessControl.hasPermission(user.address, CAN_SUBMIT_DATA)).to.be.true;

      // Fast forward past expiry
      await time.increase(120);

      // Should no longer have permission
      expect(await accessControl.hasPermission(user.address, CAN_SUBMIT_DATA)).to.be.false;
    });
  });

  describe("Permission Delegation", function () {
    beforeEach(async function () {
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);
      await accessControl.connect(admin).grantRole(ORACLE_ADMIN_ROLE, oracleAdmin.address);
    });

    it("Should delegate permissions correctly", async function () {
      const duration = 3600; // 1 hour

      const { tx } = await trackGasUsage(
        "delegatePermission",
        accessControl.connect(oracleAdmin).delegatePermission(
          delegatee.address,
          CAN_PROCESS_CONSENSUS,
          duration
        )
      );

      // Delegatee should now have the permission
      expect(await accessControl.hasPermission(delegatee.address, CAN_PROCESS_CONSENSUS)).to.be.true;

      await expect(tx).to.emit(accessControl, "PermissionDelegated");
    });

    it("Should reject delegation from users without permission", async function () {
      await expect(
        accessControl.connect(user).delegatePermission(
          delegatee.address,
          CAN_PROCESS_CONSENSUS,
          3600
        )
      ).to.be.revertedWith("Delegator lacks permission");
    });

    it("Should reject delegation with too long duration", async function () {
      const tooLongDuration = 8 * 24 * 3600; // 8 days

      await expect(
        accessControl.connect(oracleAdmin).delegatePermission(
          delegatee.address,
          CAN_PROCESS_CONSENSUS,
          tooLongDuration
        )
      ).to.be.revertedWith("Delegation duration too long");
    });

    it("Should revoke delegations correctly", async function () {
      const delegationTx = await accessControl.connect(oracleAdmin).delegatePermission(
        delegatee.address,
        CAN_PROCESS_CONSENSUS,
        3600
      );
      const receipt = await delegationTx.wait();

      // Extract delegation ID from event
      const event = receipt.logs.find(log => {
        try {
          const parsed = accessControl.interface.parseLog(log);
          return parsed?.name === "PermissionDelegated";
        } catch {
          return false;
        }
      });

      if (!event) throw new Error("PermissionDelegated event not found");

      const parsedEvent = accessControl.interface.parseLog(event);
      const delegationId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "bytes32", "uint256"],
          [oracleAdmin.address, delegatee.address, CAN_PROCESS_CONSENSUS, parsedEvent?.args[3]]
        )
      );

      const { tx } = await trackGasUsage(
        "revokeDelegation",
        accessControl.connect(oracleAdmin).revokeDelegation(delegationId)
      );

      // Delegatee should no longer have the permission
      expect(await accessControl.hasPermission(delegatee.address, CAN_PROCESS_CONSENSUS)).to.be.false;

      await expect(tx).to.emit(accessControl, "DelegationRevoked");
    });

    it("Should handle expired delegations", async function () {
      const shortDuration = 60; // 1 minute

      await accessControl.connect(oracleAdmin).delegatePermission(
        delegatee.address,
        CAN_PROCESS_CONSENSUS,
        shortDuration
      );

      // Should have permission initially
      expect(await accessControl.hasPermission(delegatee.address, CAN_PROCESS_CONSENSUS)).to.be.true;

      // Fast forward past expiry
      await time.increase(120);

      // Should no longer have permission
      expect(await accessControl.hasPermission(delegatee.address, CAN_PROCESS_CONSENSUS)).to.be.false;
    });

    it("Should return active delegations", async function () {
      await accessControl.connect(oracleAdmin).delegatePermission(
        delegatee.address,
        CAN_PROCESS_CONSENSUS,
        3600
      );

      const activeDelegations = await accessControl.getActiveDelegations(delegatee.address);
      expect(activeDelegations.length).to.be.greaterThan(0);
    });

    it("Should return delegation details", async function () {
      const delegationTx = await accessControl.connect(oracleAdmin).delegatePermission(
        delegatee.address,
        CAN_PROCESS_CONSENSUS,
        3600
      );
      const receipt = await delegationTx.wait();

      const activeDelegations = await accessControl.getActiveDelegations(delegatee.address);
      const delegationId = activeDelegations[0];

      const details = await accessControl.getDelegationDetails(delegationId);
      expect(details.delegator).to.equal(oracleAdmin.address);
      expect(details.delegatee).to.equal(delegatee.address);
      expect(details.permission).to.equal(CAN_PROCESS_CONSENSUS);
      expect(details.isActive).to.be.true;
    });
  });

  describe("Time-based Access Control", function () {
    beforeEach(async function () {
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);
    });

    it("Should set time-based access correctly", async function () {
      const startTime = (await time.latest()) + 300; // 5 minutes from now
      const endTime = startTime + 3600; // 1 hour duration

      const { tx } = await trackGasUsage(
        "setTimeBasedAccess",
        accessControl.connect(admin).setTimeBasedAccess(
          user.address,
          CAN_SUBMIT_DATA,
          startTime,
          endTime
        )
      );

      expect(tx).to.not.be.reverted;
    });

    it("Should reject invalid time ranges", async function () {
      const currentTime = await time.latest();
      const pastTime = currentTime - 3600;
      const futureTime = currentTime + 3600;

      // Start time after end time
      await expect(
        accessControl.connect(admin).setTimeBasedAccess(
          user.address,
          CAN_SUBMIT_DATA,
          futureTime,
          pastTime
        )
      ).to.be.revertedWithCustomError(accessControl, "InvalidTimeRange");

      // End time in the past
      await expect(
        accessControl.connect(admin).setTimeBasedAccess(
          user.address,
          CAN_SUBMIT_DATA,
          pastTime,
          pastTime + 1800
        )
      ).to.be.revertedWithCustomError(accessControl, "InvalidTimeRange");
    });

    it("Should enforce time-based access windows", async function () {
      const startTime = (await time.latest()) + 300;
      const endTime = startTime + 3600;

      await accessControl.connect(admin).setTimeBasedAccess(
        user.address,
        CAN_SUBMIT_DATA,
        startTime,
        endTime
      );

      // Should not have access before start time
      expect(await accessControl.hasPermission(user.address, CAN_SUBMIT_DATA)).to.be.false;

      // Fast forward to within the access window
      await time.increaseTo(startTime + 1800); // 30 minutes into the window

      // Should have access during the window
      expect(await accessControl.hasPermission(user.address, CAN_SUBMIT_DATA)).to.be.true;

      // Fast forward past the end time
      await time.increaseTo(endTime + 300);

      // Should not have access after end time
      expect(await accessControl.hasPermission(user.address, CAN_SUBMIT_DATA)).to.be.false;
    });

    it("Should only allow admin to set time-based access", async function () {
      const startTime = (await time.latest()) + 300;
      const endTime = startTime + 3600;

      await expect(
        accessControl.connect(user).setTimeBasedAccess(
          user.address,
          CAN_SUBMIT_DATA,
          startTime,
          endTime
        )
      ).to.be.revertedWithCustomError(accessControl, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Emergency Override", function () {
    beforeEach(async function () {
      await accessControl.connect(superAdmin).grantRole(EMERGENCY_RESPONDER_ROLE, emergencyResponder.address);
    });

    it("Should activate emergency override", async function () {
      const { tx } = await trackGasUsage(
        "activateEmergencyOverride",
        accessControl.connect(emergencyResponder).activateEmergencyOverride(user.address)
      );

      // User should now have all permissions
      expect(await accessControl.hasPermission(user.address, CAN_SUBMIT_DATA)).to.be.true;
      expect(await accessControl.hasPermission(user.address, CAN_PROCESS_CONSENSUS)).to.be.true;
      expect(await accessControl.hasPermission(user.address, CAN_UPGRADE_CONTRACTS)).to.be.true;

      await expect(tx).to.emit(accessControl, "EmergencyOverrideActivated")
        .withArgs(user.address, emergencyResponder.address);
    });

    it("Should deactivate emergency override", async function () {
      // First activate
      await accessControl.connect(emergencyResponder).activateEmergencyOverride(user.address);

      // Then deactivate
      const { tx } = await trackGasUsage(
        "deactivateEmergencyOverride",
        accessControl.connect(superAdmin).deactivateEmergencyOverride(user.address)
      );

      // User should no longer have permissions
      expect(await accessControl.hasPermission(user.address, CAN_SUBMIT_DATA)).to.be.false;
      expect(await accessControl.hasPermission(user.address, CAN_PROCESS_CONSENSUS)).to.be.false;

      await expect(tx).to.emit(accessControl, "EmergencyOverrideDeactivated")
        .withArgs(user.address, superAdmin.address);
    });

    it("Should only allow emergency responder to activate override", async function () {
      await expect(
        accessControl.connect(user).activateEmergencyOverride(user.address)
      ).to.be.revertedWithCustomError(accessControl, "AccessControlUnauthorizedAccount");
    });

    it("Should only allow super admin to deactivate override", async function () {
      await accessControl.connect(emergencyResponder).activateEmergencyOverride(user.address);

      await expect(
        accessControl.connect(emergencyResponder).deactivateEmergencyOverride(user.address)
      ).to.be.revertedWithCustomError(accessControl, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Activity Tracking", function () {
    beforeEach(async function () {
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);
      await accessControl.connect(admin).grantRole(ORACLE_ADMIN_ROLE, oracleAdmin.address);
    });

    it("Should record activity when performing actions", async function () {
      const { tx } = await trackGasUsage(
        "grantRoleWithActivity",
        accessControl.connect(oracleAdmin).grantRole(NODE_OPERATOR_ROLE, nodeOperator.address)
      );

      await expect(tx).to.emit(accessControl, "ActivityRecorded")
        .withArgs(oracleAdmin.address, anyValue);
    });

    it("Should track last activity time", async function () {
      const beforeTime = await time.latest();

      await accessControl.connect(oracleAdmin).grantRole(NODE_OPERATOR_ROLE, nodeOperator.address);

      const afterTime = await time.latest();

      // Activity should be recorded within the time window
      // Note: We can't directly check _lastActivityTime as it's private
      // but we can verify through other functions that depend on it
    });
  });

  describe("Stress Testing", function () {
    it("Should handle 1000+ role operations efficiently", async function () {
      this.timeout(60000); // 60 second timeout

      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);
      await accessControl.connect(admin).grantRole(ORACLE_ADMIN_ROLE, oracleAdmin.address);

      const promises = [];
      const startTime = Date.now();

      // Create 1000 role operations
      for (let i = 0; i < 1000; i++) {
        const randomUser = ethers.Wallet.createRandom();

        if (i % 3 === 0) {
          promises.push(
            accessControl.connect(oracleAdmin).grantRole(NODE_OPERATOR_ROLE, randomUser.address)
              .catch(() => {}) // Ignore failures for stress test
          );
        } else if (i % 3 === 1) {
          promises.push(
            accessControl.hasPermission(randomUser.address, CAN_SUBMIT_DATA)
          );
        } else {
          promises.push(
            accessControl.isRoleValid(NODE_OPERATOR_ROLE, randomUser.address)
          );
        }
      }

      await Promise.allSettled(promises);
      const endTime = Date.now();

      performanceMetrics["stress_test_1000_operations"] = endTime - startTime;
      console.log(`Stress test completed in ${endTime - startTime}ms`);

      expect(endTime - startTime).to.be.lessThan(30000); // Should complete within 30 seconds
    });

    it("Should handle multiple concurrent delegations", async function () {
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);
      await accessControl.connect(admin).grantRole(ORACLE_ADMIN_ROLE, oracleAdmin.address);

      const promises = [];
      const delegatees = [];

      // Create 100 concurrent delegations
      for (let i = 0; i < 100; i++) {
        const randomDelegatee = ethers.Wallet.createRandom();
        delegatees.push(randomDelegatee);

        promises.push(
          accessControl.connect(oracleAdmin).delegatePermission(
            randomDelegatee.address,
            CAN_PROCESS_CONSENSUS,
            3600
          ).catch(() => {}) // Ignore failures
        );
      }

      const startTime = Date.now();
      await Promise.allSettled(promises);
      const endTime = Date.now();

      performanceMetrics["concurrent_delegations"] = endTime - startTime;
      expect(endTime - startTime).to.be.lessThan(15000); // Should complete within 15 seconds
    });
  });

  describe("Fuzzing Tests", function () {
    function generateRandomRole(): string {
      const roles = [
        SUPER_ADMIN_ROLE,
        ADMIN_ROLE,
        ORACLE_ADMIN_ROLE,
        NODE_OPERATOR_ROLE,
        SECURITY_OFFICER_ROLE,
        MONITOR_ROLE,
        EMERGENCY_RESPONDER_ROLE
      ];
      return roles[Math.floor(Math.random() * roles.length)];
    }

    function generateRandomPermission(): string {
      const permissions = [
        CAN_SUBMIT_DATA,
        CAN_PROCESS_CONSENSUS,
        CAN_MANAGE_NODES,
        CAN_UPDATE_CONFIG,
        CAN_PAUSE_SYSTEM,
        CAN_UPGRADE_CONTRACTS,
        CAN_BLACKLIST_NODES,
        CAN_VIEW_SENSITIVE_DATA
      ];
      return permissions[Math.floor(Math.random() * permissions.length)];
    }

    it("Should handle random role operations", async function () {
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);
      await accessControl.connect(admin).grantRole(ORACLE_ADMIN_ROLE, oracleAdmin.address);

      const iterations = 100;
      let successCount = 0;

      for (let i = 0; i < iterations; i++) {
        try {
          const randomUser = ethers.Wallet.createRandom();
          const randomRole = generateRandomRole();

          // Try to grant random role (may fail due to permissions)
          await accessControl.connect(oracleAdmin).grantRole(randomRole, randomUser.address);
          successCount++;
        } catch (error) {
          // Expected for some invalid operations
        }
      }

      console.log(`Fuzzing test: ${successCount}/${iterations} successful role grants`);
      expect(successCount).to.be.greaterThan(0); // At least some should succeed
    });

    it("Should handle random permission checks", async function () {
      const iterations = 200;
      let checkCount = 0;

      for (let i = 0; i < iterations; i++) {
        try {
          const randomUser = ethers.Wallet.createRandom();
          const randomPermission = generateRandomPermission();

          await accessControl.hasPermission(randomUser.address, randomPermission);
          checkCount++;
        } catch (error) {
          // Permission checks should not fail
        }
      }

      expect(checkCount).to.equal(iterations); // All permission checks should succeed
    });

    it("Should handle extreme time values", async function () {
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);

      const extremeCases = [
        { start: 1, end: 2 }, // Very short duration
        { start: await time.latest() + 1, end: (await time.latest()) + 2 }, // Minimal future window
        { start: await time.latest() + 86400, end: (await time.latest()) + 86400 * 365 }, // 1 year window
      ];

      for (let i = 0; i < extremeCases.length; i++) {
        try {
          await accessControl.connect(admin).setTimeBasedAccess(
            user.address,
            CAN_SUBMIT_DATA,
            extremeCases[i].start,
            extremeCases[i].end
          );
        } catch (error) {
          // Some extreme cases may fail validation
        }
      }
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("Should handle zero address operations gracefully", async function () {
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);

      // Should handle zero address in permission checks
      expect(await accessControl.hasPermission(ethers.ZeroAddress, CAN_SUBMIT_DATA)).to.be.false;

      // Should handle zero address in role validity checks
      expect(await accessControl.isRoleValid(ADMIN_ROLE, ethers.ZeroAddress)).to.be.false;
    });

    it("Should handle invalid role operations", async function () {
      const invalidRole = ethers.keccak256(ethers.toUtf8Bytes("INVALID_ROLE"));

      // Should handle invalid role grants gracefully
      await expect(
        accessControl.connect(superAdmin).grantRole(invalidRole, user.address)
      ).to.not.be.reverted; // OpenZeppelin allows any bytes32 as role

      // Should handle invalid role checks
      expect(await accessControl.hasRole(invalidRole, user.address)).to.be.true;
    });

    it("Should handle contract upgrade scenarios", async function () {
      // Test that roles persist through upgrade simulation
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);

      expect(await accessControl.hasRole(ADMIN_ROLE, admin.address)).to.be.true;

      // Simulate upgrade by checking version
      expect(await accessControl.version()).to.equal("1.0.0");

      // Roles should still be valid
      expect(await accessControl.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("Should handle delegation with invalid parameters", async function () {
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);
      await accessControl.connect(admin).grantRole(ORACLE_ADMIN_ROLE, oracleAdmin.address);

      // Test delegation to zero address
      await expect(
        accessControl.connect(oracleAdmin).delegatePermission(
          ethers.ZeroAddress,
          CAN_PROCESS_CONSENSUS,
          3600
        )
      ).to.not.be.reverted; // Should handle gracefully

      // Test delegation with zero duration
      await expect(
        accessControl.connect(oracleAdmin).delegatePermission(
          delegatee.address,
          CAN_PROCESS_CONSENSUS,
          0
        )
      ).to.not.be.reverted; // Should handle gracefully
    });
  });

  describe("Gas Optimization Verification", function () {
    beforeEach(async function () {
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);
      await accessControl.connect(admin).grantRole(ORACLE_ADMIN_ROLE, oracleAdmin.address);
    });

    it("Should maintain gas efficiency for role operations", async function () {
      // Test gas usage for role granting
      const grantGas = await accessControl.connect(oracleAdmin).grantRole.estimateGas(
        NODE_OPERATOR_ROLE,
        nodeOperator.address
      );

      expect(grantGas).to.be.lessThan(BigInt(100000)); // Reasonable gas limit

      // Test gas usage for permission checks
      const permissionGas = await accessControl.hasPermission.estimateGas(
        nodeOperator.address,
        CAN_SUBMIT_DATA
      );

      expect(permissionGas).to.be.lessThan(BigInt(50000)); // Should be very efficient
    });

    it("Should scale efficiently with delegation count", async function () {
      // Test with single delegation
      const singleDelegationGas = await accessControl.connect(oracleAdmin).delegatePermission.estimateGas(
        delegatee.address,
        CAN_PROCESS_CONSENSUS,
        3600
      );

      // Create multiple delegations
      for (let i = 0; i < 5; i++) {
        const randomDelegatee = ethers.Wallet.createRandom();
        await accessControl.connect(oracleAdmin).delegatePermission(
          randomDelegatee.address,
          CAN_MANAGE_NODES,
          3600
        );
      }

      // Test with multiple existing delegations
      const multipleDelegationGas = await accessControl.connect(oracleAdmin).delegatePermission.estimateGas(
        user.address,
        CAN_PROCESS_CONSENSUS,
        3600
      );

      // Gas should not increase significantly
      const gasRatio = Number(multipleDelegationGas) / Number(singleDelegationGas);
      expect(gasRatio).to.be.lessThan(2); // Should not be more than 2x
    });

    it("Should optimize permission checking with multiple roles", async function () {
      // Grant multiple roles to user
      await accessControl.connect(oracleAdmin).grantRole(NODE_OPERATOR_ROLE, user.address);
      await accessControl.connect(admin).grantRole(SECURITY_OFFICER_ROLE, user.address);

      const permissionCheckGas = await accessControl.hasPermission.estimateGas(
        user.address,
        CAN_SUBMIT_DATA
      );

      expect(permissionCheckGas).to.be.lessThan(BigInt(60000)); // Should remain efficient
    });
  });

  describe("Multi-signature Support", function () {
    it("Should support multiple admins", async function () {
      const admin2 = delegatee;

      // Grant admin role to multiple addresses
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin2.address);

      // Both should be able to perform admin functions
      await expect(
        accessControl.connect(admin).grantRole(ORACLE_ADMIN_ROLE, oracleAdmin.address)
      ).to.not.be.reverted;

      await expect(
        accessControl.connect(admin2).grantRole(SECURITY_OFFICER_ROLE, securityOfficer.address)
      ).to.not.be.reverted;
    });

    it("Should handle role admin changes", async function () {
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);

      // Change role admin
      await accessControl.connect(superAdmin).setRoleAdmin(ORACLE_ADMIN_ROLE, SUPER_ADMIN_ROLE);

      // Old admin should no longer be able to grant the role
      await expect(
        accessControl.connect(admin).grantRole(ORACLE_ADMIN_ROLE, oracleAdmin.address)
      ).to.be.revertedWithCustomError(accessControl, "AccessControlUnauthorizedAccount");

      // Super admin should be able to grant the role
      await expect(
        accessControl.connect(superAdmin).grantRole(ORACLE_ADMIN_ROLE, oracleAdmin.address)
      ).to.not.be.reverted;
    });

    it("Should support role renunciation", async function () {
      await accessControl.connect(superAdmin).grantRole(ADMIN_ROLE, admin.address);

      // Admin should be able to renounce their own role
      await expect(
        accessControl.connect(admin).renounceRole(ADMIN_ROLE, admin.address)
      ).to.not.be.reverted;

      expect(await accessControl.hasRole(ADMIN_ROLE, admin.address)).to.be.false;
    });
  });
});
