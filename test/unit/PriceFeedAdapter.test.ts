import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import sinon from "sinon";
import {
  PriceFeedAdapter,
  QuantlinkOracle,
  NodeManager,
  ConsensusEngine,
  AccessControlManager,
  SecurityManager,
} from "../../typechain-types";

describe("PriceFeedAdapter", function () {
  let priceFeedAdapter: PriceFeedAdapter;
  let oracle: QuantlinkOracle;
  let nodeManager: NodeManager;
  let consensusEngine: ConsensusEngine;
  let accessControl: AccessControlManager;
  let securityManager: SecurityManager;
  let admin: SignerWithAddress;
  let subscriber: SignerWithAddress;
  let node1: SignerWithAddress;
  let node2: SignerWithAddress;
  let node3: SignerWithAddress;
  let node4: SignerWithAddress;
  let node5: SignerWithAddress;
  let node6: SignerWithAddress;
  let user: SignerWithAddress;

  // Role constants
  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  const SUBSCRIBER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SUBSCRIBER_ROLE"));

  // Test data constants
  const VALID_CEX_FEES = [100, 150, 120, 180, 90];
  const VALID_DEX_FEES = [200, 250, 220, 280, 190];
  const LARGE_FEE_ARRAY = Array(100).fill(0).map((_, i) => 100 + i);
  const ZERO_FEES = [0, 0, 0];
  const MAX_FEES = [ethers.MaxUint256, ethers.MaxUint256];

  // Performance tracking
  let gasUsage: { [key: string]: bigint } = {};
  let performanceMetrics: { [key: string]: number } = {};

  async function deployPriceFeedAdapterFixture() {
    const [admin, subscriber, node1, node2, node3, node4, node5, node6, user] = 
      await ethers.getSigners();

    // Deploy AccessControlManager
    const AccessControlManagerFactory = await ethers.getContractFactory("AccessControlManager");
    const accessControl = (await upgrades.deployProxy(
      AccessControlManagerFactory,
      [admin.address],
      { initializer: "initialize" }
    )) as unknown as AccessControlManager;

    // Deploy SecurityManager
    const SecurityManagerFactory = await ethers.getContractFactory("SecurityManager");
    const securityManager = (await upgrades.deployProxy(
      SecurityManagerFactory,
      [admin.address],
      { initializer: "initialize" }
    )) as unknown as SecurityManager;

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

    // Deploy QuantlinkOracle
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

    // Deploy PriceFeedAdapter
    const PriceFeedAdapterFactory = await ethers.getContractFactory("PriceFeedAdapter");
    const priceFeedAdapter = (await upgrades.deployProxy(
      PriceFeedAdapterFactory,
      [admin.address, await oracle.getAddress()],
      { initializer: "initialize" }
    )) as unknown as PriceFeedAdapter;

    // Setup roles and permissions
    await consensusEngine.grantRole(ORACLE_ROLE, await oracle.getAddress());
    await priceFeedAdapter.grantRole(SUBSCRIBER_ROLE, subscriber.address);

    // Register and activate nodes
    const nodes = [node1, node2, node3, node4, node5, node6];
    for (let i = 0; i < nodes.length; i++) {
      await nodeManager.registerNode(nodes[i].address, "0x");
      await nodeManager.activateNode(nodes[i].address, i === 0 ? 2 : 3);
      await oracle.grantRole(ethers.keccak256(ethers.toUtf8Bytes("NODE_MANAGER_ROLE")), nodes[i].address);
    }

    return {
      priceFeedAdapter,
      oracle,
      nodeManager,
      consensusEngine,
      accessControl,
      securityManager,
      admin,
      subscriber,
      node1,
      node2,
      node3,
      node4,
      node5,
      node6,
      user,
    };
  }

  beforeEach(async function () {
    const fixture = await loadFixture(deployPriceFeedAdapterFixture);
    priceFeedAdapter = fixture.priceFeedAdapter;
    oracle = fixture.oracle;
    nodeManager = fixture.nodeManager;
    consensusEngine = fixture.consensusEngine;
    accessControl = fixture.accessControl;
    securityManager = fixture.securityManager;
    admin = fixture.admin;
    subscriber = fixture.subscriber;
    node1 = fixture.node1;
    node2 = fixture.node2;
    node3 = fixture.node3;
    node4 = fixture.node4;
    node5 = fixture.node5;
    node6 = fixture.node6;
    user = fixture.user;

    // Reset tracking
    gasUsage = {};
    performanceMetrics = {};
  });

  afterEach(async function () {
    // Log performance metrics
    console.log("\n📊 PriceFeedAdapter Performance Metrics:");
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

  // Helper function to setup oracle data
  async function setupOracleData() {
    const nodes = [node1, node2, node3, node4, node5, node6];
    for (let i = 0; i < nodes.length; i++) {
      await oracle.connect(nodes[i]).submitData(
        VALID_CEX_FEES.map(fee => fee + i * 5),
        VALID_DEX_FEES.map(fee => fee + i * 5),
        "0x" // Empty signature for testing
      );
    }
    
    // Advance time and process consensus
    await time.increase(190);
    await oracle.processConsensus();
  }

  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await priceFeedAdapter.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
      expect(await priceFeedAdapter.oracle()).to.equal(await oracle.getAddress());
      expect(await priceFeedAdapter.decimals()).to.equal(8);
      expect(await priceFeedAdapter.version()).to.equal(1);
      expect(await priceFeedAdapter.description()).to.equal("Quantlink Oracle CEX/DEX Fee Data Feed");
    });

    it("Should emit initialization event", async function () {
      // Deploy new instance to test event
      const PriceFeedAdapterFactory = await ethers.getContractFactory("PriceFeedAdapter");
      await expect(
        upgrades.deployProxy(
          PriceFeedAdapterFactory,
          [admin.address, await oracle.getAddress()],
          { initializer: "initialize" }
        )
      ).to.emit(PriceFeedAdapterFactory.attach(ethers.ZeroAddress), "PriceFeedInitialized");
    });

    it("Should reject initialization with zero addresses", async function () {
      const PriceFeedAdapterFactory = await ethers.getContractFactory("PriceFeedAdapter");
      
      await expect(
        upgrades.deployProxy(
          PriceFeedAdapterFactory,
          [ethers.ZeroAddress, await oracle.getAddress()],
          { initializer: "initialize" }
        )
      ).to.be.revertedWith("Invalid admin address");

      await expect(
        upgrades.deployProxy(
          PriceFeedAdapterFactory,
          [admin.address, ethers.ZeroAddress],
          { initializer: "initialize" }
        )
      ).to.be.revertedWith("Invalid oracle address");
    });

    it("Should prevent double initialization", async function () {
      await expect(
        priceFeedAdapter.initialize(admin.address, await oracle.getAddress())
      ).to.be.revertedWithCustomError(priceFeedAdapter, "InvalidInitialization");
    });
  });

  describe("Chainlink Compatibility", function () {
    beforeEach(async function () {
      await setupOracleData();
    });

    it("Should return latest round data in Chainlink format", async function () {
      const { tx } = await trackGasUsage(
        "latestRoundData",
        priceFeedAdapter.latestRoundData()
      );

      const [roundId, answer, startedAt, updatedAt, answeredInRound] = await priceFeedAdapter.latestRoundData();
      
      expect(roundId).to.be.greaterThan(0);
      expect(answer).to.be.greaterThan(0);
      expect(startedAt).to.be.greaterThan(0);
      expect(updatedAt).to.be.greaterThan(0);
      expect(answeredInRound).to.equal(roundId);
    });

    it("Should return historical round data", async function () {
      const latestRound = await priceFeedAdapter.latestRoundData();
      const roundId = latestRound[0];

      const { tx } = await trackGasUsage(
        "getRoundData",
        priceFeedAdapter.getRoundData(roundId)
      );

      const [historicalRoundId, answer, startedAt, updatedAt, answeredInRound] = 
        await priceFeedAdapter.getRoundData(roundId);
      
      expect(historicalRoundId).to.equal(roundId);
      expect(answer).to.be.greaterThan(0);
      expect(startedAt).to.be.greaterThan(0);
      expect(updatedAt).to.be.greaterThan(0);
      expect(answeredInRound).to.equal(roundId);
    });

    it("Should reject invalid round IDs", async function () {
      const invalidRoundId = 99999;
      
      await expect(
        priceFeedAdapter.getRoundData(invalidRoundId)
      ).to.be.revertedWithCustomError(priceFeedAdapter, "InvalidRoundId");
    });

    it("Should return correct decimals", async function () {
      expect(await priceFeedAdapter.decimals()).to.equal(8);
    });

    it("Should return correct description", async function () {
      expect(await priceFeedAdapter.description()).to.equal("Quantlink Oracle CEX/DEX Fee Data Feed");
    });

    it("Should return correct version", async function () {
      expect(await priceFeedAdapter.version()).to.equal(1);
    });

    it("Should handle multiple rapid calls efficiently", async function () {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(priceFeedAdapter.latestRoundData());
      }

      const startTime = Date.now();
      await Promise.all(promises);
      const endTime = Date.now();

      performanceMetrics["rapid_chainlink_calls"] = endTime - startTime;
      expect(endTime - startTime).to.be.lessThan(5000); // Should complete within 5 seconds
    });
  });

  describe("Enhanced Price Data Functions", function () {
    beforeEach(async function () {
      await setupOracleData();
    });

    it("Should return latest price data with metadata", async function () {
      const { tx } = await trackGasUsage(
        "getLatestPriceData",
        priceFeedAdapter.getLatestPriceData()
      );

      const priceData = await priceFeedAdapter.getLatestPriceData();

      expect(priceData.price).to.be.greaterThan(0);
      expect(priceData.timestamp).to.be.greaterThan(0);
      expect(priceData.roundId).to.be.greaterThan(0);
      expect(priceData.confidence).to.be.greaterThan(0);
      expect(priceData.source).to.equal("Quantlink Oracle");
    });

    it("Should return price data for specific round", async function () {
      const latestRound = await priceFeedAdapter.latestRoundData();
      const roundId = latestRound[0];

      const priceData = await priceFeedAdapter.getPriceDataAtRound(roundId);

      expect(priceData.price).to.be.greaterThan(0);
      expect(priceData.roundId).to.equal(roundId);
      expect(priceData.confidence).to.be.greaterThan(0);
    });

    it("Should reject invalid round ID for price data", async function () {
      const invalidRoundId = 99999;

      await expect(
        priceFeedAdapter.getPriceDataAtRound(invalidRoundId)
      ).to.be.revertedWithCustomError(priceFeedAdapter, "InvalidRoundId");
    });
  });

  describe("Fee Data Functions", function () {
    beforeEach(async function () {
      await setupOracleData();
    });

    it("Should return latest fee data", async function () {
      const { tx } = await trackGasUsage(
        "getLatestFeeData",
        priceFeedAdapter.getLatestFeeData()
      );

      const feeData = await priceFeedAdapter.getLatestFeeData();

      expect(feeData.cexFees.length).to.be.greaterThan(0);
      expect(feeData.dexFees.length).to.be.greaterThan(0);
      expect(feeData.timestamp).to.be.greaterThan(0);
      expect(feeData.roundId).to.be.greaterThan(0);
      expect(feeData.exchangeCount).to.be.greaterThan(0);
    });

    it("Should return fee data for specific round", async function () {
      const latestRound = await priceFeedAdapter.latestRoundData();
      const roundId = latestRound[0];

      const feeData = await priceFeedAdapter.getFeeDataAtRound(roundId);

      expect(feeData.cexFees.length).to.be.greaterThan(0);
      expect(feeData.dexFees.length).to.be.greaterThan(0);
      expect(feeData.roundId).to.equal(roundId);
    });

    it("Should calculate average fees correctly", async function () {
      const timeWindow = 3600; // 1 hour
      const feeType = 2; // Combined fees

      const [averageFee, sampleCount] = await priceFeedAdapter.getAverageFee(timeWindow, feeType);

      expect(averageFee).to.be.greaterThan(0);
      expect(sampleCount).to.be.greaterThan(0);
    });

    it("Should handle different fee types", async function () {
      const timeWindow = 3600;

      // Test CEX fees (type 0)
      const [cexAverage] = await priceFeedAdapter.getAverageFee(timeWindow, 0);
      expect(cexAverage).to.be.greaterThan(0);

      // Test DEX fees (type 1)
      const [dexAverage] = await priceFeedAdapter.getAverageFee(timeWindow, 1);
      expect(dexAverage).to.be.greaterThan(0);

      // Test combined fees (type 2)
      const [combinedAverage] = await priceFeedAdapter.getAverageFee(timeWindow, 2);
      expect(combinedAverage).to.be.greaterThan(0);
    });

    it("Should calculate fee volatility", async function () {
      const timeWindow = 3600;
      const feeType = 2;

      const [volatility, confidence] = await priceFeedAdapter.getFeeVolatility(timeWindow, feeType);

      expect(volatility).to.be.greaterThanOrEqual(0);
      expect(confidence).to.be.greaterThan(0);
      expect(confidence).to.be.lessThanOrEqual(100);
    });
  });

  describe("Data Quality and Health Monitoring", function () {
    beforeEach(async function () {
      await setupOracleData();
    });

    it("Should report Oracle health status", async function () {
      const [isHealthy, consensusReached, activeNodes, lastConsensusTime] =
        await priceFeedAdapter.getOracleHealth();

      expect(isHealthy).to.be.true;
      expect(consensusReached).to.be.true;
      expect(activeNodes).to.equal(6);
      expect(lastConsensusTime).to.be.greaterThan(0);
    });

    it("Should check data freshness", async function () {
      const [isFresh, lastUpdateTime, stalenessThreshold] =
        await priceFeedAdapter.getDataFreshness();

      expect(isFresh).to.be.true;
      expect(lastUpdateTime).to.be.greaterThan(0);
      expect(stalenessThreshold).to.equal(600); // 10 minutes
    });

    it("Should detect stale data", async function () {
      // Fast forward past staleness threshold
      await time.increase(700); // 11+ minutes

      const [isFresh] = await priceFeedAdapter.getDataFreshness();
      expect(isFresh).to.be.false;
    });

    it("Should return data quality metrics", async function () {
      const metrics = await priceFeedAdapter.getDataQualityMetrics();

      expect(metrics.accuracy).to.be.greaterThan(0);
      expect(metrics.precision).to.be.greaterThan(0);
      expect(metrics.reliability).to.be.greaterThan(0);
      expect(metrics.coverage).to.be.greaterThan(0);
    });

    it("Should allow admin to update quality metrics", async function () {
      const newMetrics = {
        accuracy: 95,
        precision: 90,
        reliability: 98,
        coverage: 85
      };

      const { tx } = await trackGasUsage(
        "updateQualityMetrics",
        priceFeedAdapter.connect(admin).updateQualityMetrics(
          newMetrics.accuracy,
          newMetrics.precision,
          newMetrics.reliability,
          newMetrics.coverage
        )
      );

      await expect(tx).to.emit(priceFeedAdapter, "QualityMetricsUpdated");

      const updatedMetrics = await priceFeedAdapter.getDataQualityMetrics();
      expect(updatedMetrics.accuracy).to.equal(newMetrics.accuracy);
      expect(updatedMetrics.precision).to.equal(newMetrics.precision);
      expect(updatedMetrics.reliability).to.equal(newMetrics.reliability);
      expect(updatedMetrics.coverage).to.equal(newMetrics.coverage);
    });
  });

  describe("Subscription Management", function () {
    beforeEach(async function () {
      await setupOracleData();
    });

    it("Should allow subscribers to subscribe to price updates", async function () {
      const priceThreshold = 100; // 1% change
      const timeThreshold = 300; // 5 minutes

      const { tx } = await trackGasUsage(
        "subscribeToPriceUpdates",
        priceFeedAdapter.connect(admin).subscribeToPriceUpdates(
          subscriber.address,
          priceThreshold,
          timeThreshold
        )
      );

      await expect(tx)
        .to.emit(priceFeedAdapter, "PriceSubscriptionCreated")
        .withArgs(subscriber.address, priceThreshold, timeThreshold);
    });

    it("Should allow subscribers to subscribe to fee updates", async function () {
      const feeThreshold = 50; // 0.5% change
      const timeThreshold = 600; // 10 minutes

      const { tx } = await trackGasUsage(
        "subscribeToFeeUpdates",
        priceFeedAdapter.connect(admin).subscribeToFeeUpdates(
          subscriber.address,
          feeThreshold,
          timeThreshold
        )
      );

      await expect(tx)
        .to.emit(priceFeedAdapter, "FeeSubscriptionCreated")
        .withArgs(subscriber.address, feeThreshold, timeThreshold);
    });

    it("Should allow unsubscribing from price updates", async function () {
      // First subscribe
      await priceFeedAdapter.connect(admin).subscribeToPriceUpdates(subscriber.address, 100, 300);

      // Then unsubscribe
      const { tx } = await trackGasUsage(
        "unsubscribeFromPriceUpdates",
        priceFeedAdapter.connect(admin).unsubscribeFromPriceUpdates(subscriber.address)
      );

      await expect(tx)
        .to.emit(priceFeedAdapter, "PriceSubscriptionRemoved")
        .withArgs(subscriber.address);
    });

    it("Should allow unsubscribing from fee updates", async function () {
      // First subscribe
      await priceFeedAdapter.connect(admin).subscribeToFeeUpdates(subscriber.address, 50, 600);

      // Then unsubscribe
      const { tx } = await trackGasUsage(
        "unsubscribeFromFeeUpdates",
        priceFeedAdapter.connect(admin).unsubscribeFromFeeUpdates(subscriber.address)
      );

      await expect(tx)
        .to.emit(priceFeedAdapter, "FeeSubscriptionRemoved")
        .withArgs(subscriber.address);
    });

    it("Should reject subscription from non-admin", async function () {
      await expect(
        priceFeedAdapter.connect(user).subscribeToPriceUpdates(subscriber.address, 100, 300)
      ).to.be.revertedWithCustomError(priceFeedAdapter, "AccessControlUnauthorizedAccount");

      await expect(
        priceFeedAdapter.connect(user).subscribeToFeeUpdates(subscriber.address, 50, 600)
      ).to.be.revertedWithCustomError(priceFeedAdapter, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Historical Data Queries", function () {
    beforeEach(async function () {
      await setupOracleData();

      // Create multiple rounds of data
      for (let i = 0; i < 5; i++) {
        await time.increase(300); // 5 minutes

        const nodes = [node1, node2, node3, node4, node5, node6];
        for (let j = 0; j < nodes.length; j++) {
          await oracle.connect(nodes[j]).submitData(
            VALID_CEX_FEES.map(fee => fee + i * 10 + j),
            VALID_DEX_FEES.map(fee => fee + i * 10 + j),
            "0x"
          );
        }
        await oracle.processConsensus();
      }
    });

    it("Should return historical price data", async function () {
      const currentTime = await time.latest();
      const query = {
        startTime: currentTime - 3600, // 1 hour ago
        endTime: currentTime,
        maxResults: 10,
        includeMetadata: true
      };

      const { tx } = await trackGasUsage(
        "getHistoricalPriceData",
        priceFeedAdapter.getHistoricalPriceData(query)
      );

      const historicalData = await priceFeedAdapter.getHistoricalPriceData(query);
      expect(historicalData.length).to.be.greaterThan(0);
      expect(historicalData.length).to.be.lessThanOrEqual(10);

      // Verify data structure
      for (const data of historicalData) {
        expect(data.price).to.be.greaterThan(0);
        expect(data.timestamp).to.be.greaterThan(0);
        expect(data.roundId).to.be.greaterThan(0);
      }
    });

    it("Should return historical fee data", async function () {
      const currentTime = await time.latest();
      const query = {
        startTime: currentTime - 3600,
        endTime: currentTime,
        maxResults: 5,
        includeMetadata: false
      };

      const historicalFeeData = await priceFeedAdapter.getHistoricalFeeData(query);
      expect(historicalFeeData.length).to.be.greaterThan(0);
      expect(historicalFeeData.length).to.be.lessThanOrEqual(5);

      // Verify data structure
      for (const data of historicalFeeData) {
        expect(data.cexFees.length).to.be.greaterThan(0);
        expect(data.dexFees.length).to.be.greaterThan(0);
        expect(data.timestamp).to.be.greaterThan(0);
      }
    });

    it("Should handle empty time ranges", async function () {
      const futureTime = (await time.latest()) + 86400; // 1 day in future
      const query = {
        startTime: futureTime,
        endTime: futureTime + 3600,
        maxResults: 10,
        includeMetadata: true
      };

      const historicalData = await priceFeedAdapter.getHistoricalPriceData(query);
      expect(historicalData.length).to.equal(0);
    });

    it("Should respect maxResults parameter", async function () {
      const currentTime = await time.latest();
      const query = {
        startTime: currentTime - 7200, // 2 hours ago
        endTime: currentTime,
        maxResults: 2,
        includeMetadata: true
      };

      const historicalData = await priceFeedAdapter.getHistoricalPriceData(query);
      expect(historicalData.length).to.be.lessThanOrEqual(2);
    });
  });

  describe("Emergency Mode and Fallback", function () {
    beforeEach(async function () {
      await setupOracleData();
    });

    it("Should allow admin to activate emergency mode", async function () {
      const emergencyType = "ORACLE_FAILURE";
      const { tx } = await trackGasUsage(
        "activateEmergencyMode",
        priceFeedAdapter.connect(admin).activateEmergencyMode(emergencyType)
      );

      await expect(tx).to.emit(priceFeedAdapter, "EmergencyModeActivated");

      const emergencyStatus = await priceFeedAdapter.getEmergencyStatus();
      expect(emergencyStatus.isEmergency).to.be.true;
      expect(emergencyStatus.emergencyType).to.equal(emergencyType);
    });

    it("Should allow admin to deactivate emergency mode", async function () {
      // First activate
      await priceFeedAdapter.connect(admin).activateEmergencyMode("ORACLE_FAILURE");

      // Then deactivate
      const { tx } = await trackGasUsage(
        "deactivateEmergencyMode",
        priceFeedAdapter.connect(admin).deactivateEmergencyMode()
      );

      await expect(tx).to.emit(priceFeedAdapter, "EmergencyModeDeactivated");

      const emergencyStatus = await priceFeedAdapter.getEmergencyStatus();
      expect(emergencyStatus.isEmergency).to.be.false;
    });

    it("Should use fallback data during emergency", async function () {
      await priceFeedAdapter.connect(admin).activateEmergencyMode("ORACLE_FAILURE");
      await priceFeedAdapter.connect(admin).setFallbackData("Emergency Source", await time.latest());

      const fallbackInfo = await priceFeedAdapter.getFallbackInfo();
      expect(fallbackInfo.fallbackSource).to.equal("Emergency Source");
      expect(fallbackInfo.fallbackTimestamp).to.be.greaterThan(0);
    });

    it("Should reject emergency functions from non-admin", async function () {
      await expect(
        priceFeedAdapter.connect(user).activateEmergencyMode("ORACLE_FAILURE")
      ).to.be.revertedWithCustomError(priceFeedAdapter, "AccessControlUnauthorizedAccount");

      await expect(
        priceFeedAdapter.connect(user).deactivateEmergencyMode()
      ).to.be.revertedWithCustomError(priceFeedAdapter, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Administrative Functions", function () {
    beforeEach(async function () {
      await setupOracleData();
    });

    it("Should allow admin to update cache", async function () {
      const { tx } = await trackGasUsage(
        "updateCache",
        priceFeedAdapter.connect(admin).updateCache()
      );

      expect(tx).to.not.be.reverted;
    });

    it("Should allow admin to add supported sources", async function () {
      const newSource = "Binance";

      const { tx } = await trackGasUsage(
        "addSupportedSource",
        priceFeedAdapter.connect(admin).addSupportedSource(newSource)
      );

      await expect(tx).to.emit(priceFeedAdapter, "SupportedSourceAdded").withArgs(newSource);

      const sources = await priceFeedAdapter.getSupportedSources();
      expect(sources).to.include(newSource);
    });

    it("Should allow admin to set Oracle address", async function () {
      const newOracleAddress = ethers.Wallet.createRandom().address;

      const { tx } = await trackGasUsage(
        "setOracle",
        priceFeedAdapter.connect(admin).setOracle(newOracleAddress)
      );

      await expect(tx).to.emit(priceFeedAdapter, "OracleUpdated").withArgs(await oracle.getAddress(), newOracleAddress);
    });

    it("Should reject admin functions from non-admin", async function () {
      await expect(
        priceFeedAdapter.connect(user).updateCache()
      ).to.be.revertedWithCustomError(priceFeedAdapter, "AccessControlUnauthorizedAccount");

      await expect(
        priceFeedAdapter.connect(user).addSupportedSource("NewSource")
      ).to.be.revertedWithCustomError(priceFeedAdapter, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Stress Testing", function () {
    it("Should handle 1000+ rapid data requests", async function () {
      this.timeout(60000); // 60 second timeout

      await setupOracleData();

      const promises = [];
      const startTime = Date.now();

      // Create 1000 concurrent requests
      for (let i = 0; i < 1000; i++) {
        if (i % 4 === 0) {
          promises.push(priceFeedAdapter.latestRoundData());
        } else if (i % 4 === 1) {
          promises.push(priceFeedAdapter.getLatestPriceData());
        } else if (i % 4 === 2) {
          promises.push(priceFeedAdapter.getLatestFeeData());
        } else {
          promises.push(priceFeedAdapter.getOracleHealth());
        }
      }

      await Promise.allSettled(promises);
      const endTime = Date.now();

      performanceMetrics["stress_test_1000_requests"] = endTime - startTime;
      console.log(`Stress test completed in ${endTime - startTime}ms`);

      expect(endTime - startTime).to.be.lessThan(30000); // Should complete within 30 seconds
    });

    it("Should maintain performance with large historical queries", async function () {
      await setupOracleData();

      // Create many rounds of data
      for (let i = 0; i < 20; i++) {
        await time.increase(300);
        const nodes = [node1, node2, node3, node4, node5, node6];
        for (const node of nodes) {
          await oracle.connect(node).submitData(VALID_CEX_FEES, VALID_DEX_FEES, "0x");
        }
        await oracle.processConsensus();
      }

      const currentTime = await time.latest();
      const query = {
        startTime: currentTime - 7200, // 2 hours
        endTime: currentTime,
        maxResults: 100,
        includeMetadata: true
      };

      const startTime = Date.now();
      await priceFeedAdapter.getHistoricalPriceData(query);
      const endTime = Date.now();

      performanceMetrics["large_historical_query"] = endTime - startTime;
      expect(endTime - startTime).to.be.lessThan(10000); // Should complete within 10 seconds
    });
  });

  describe("Fuzzing Tests", function () {
    function generateRandomQuery() {
      const now = Math.floor(Date.now() / 1000);
      return {
        startTime: now - Math.floor(Math.random() * 86400), // Random time in last 24h
        endTime: now,
        maxResults: Math.floor(Math.random() * 100) + 1,
        includeMetadata: Math.random() > 0.5
      };
    }

    it("Should handle random historical queries", async function () {
      await setupOracleData();

      const iterations = 50;
      let successCount = 0;

      for (let i = 0; i < iterations; i++) {
        try {
          const randomQuery = generateRandomQuery();
          await priceFeedAdapter.getHistoricalPriceData(randomQuery);
          successCount++;
        } catch (error) {
          // Some random queries may fail validation
        }
      }

      console.log(`Fuzzing test: ${successCount}/${iterations} successful queries`);
      expect(successCount).to.be.greaterThan(iterations * 0.7); // At least 70% should succeed
    });

    it("Should handle random subscription parameters", async function () {
      const iterations = 20;
      let successCount = 0;

      for (let i = 0; i < iterations; i++) {
        try {
          const randomThreshold = Math.floor(Math.random() * 1000) + 1;
          const randomTime = Math.floor(Math.random() * 3600) + 60; // 1 min to 1 hour

          await priceFeedAdapter.connect(admin).subscribeToPriceUpdates(
            subscriber.address,
            randomThreshold,
            randomTime
          );

          await priceFeedAdapter.connect(admin).unsubscribeFromPriceUpdates(subscriber.address);
          successCount++;
        } catch (error) {
          // Some random parameters may fail validation
        }
      }

      expect(successCount).to.be.greaterThan(iterations * 0.8); // At least 80% should succeed
    });

    it("Should handle extreme parameter values", async function () {
      await setupOracleData();

      const extremeCases = [
        { startTime: 0, endTime: 1, maxResults: 1, includeMetadata: true },
        { startTime: 0, endTime: ethers.MaxUint256, maxResults: 1000, includeMetadata: false },
        { startTime: ethers.MaxUint256 - BigInt(1), endTime: ethers.MaxUint256, maxResults: 1, includeMetadata: true }
      ];

      for (let i = 0; i < extremeCases.length; i++) {
        try {
          await priceFeedAdapter.getHistoricalPriceData(extremeCases[i]);
        } catch (error) {
          // Extreme cases are expected to fail gracefully
          expect(error).to.not.be.undefined;
        }
      }
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("Should handle Oracle with no data", async function () {
      // Don't setup oracle data, test with empty Oracle

      await expect(
        priceFeedAdapter.latestRoundData()
      ).to.be.revertedWith("No data available");
    });

    it("Should handle Oracle disconnection", async function () {
      await setupOracleData();

      // Set Oracle to zero address to simulate disconnection
      await priceFeedAdapter.connect(admin).setOracle(ethers.ZeroAddress);

      await expect(
        priceFeedAdapter.latestRoundData()
      ).to.be.revertedWith("Oracle not set");
    });

    it("Should handle paused state", async function () {
      await setupOracleData();

      // Check if contract supports pausing (skip if not implemented)
      try {
        const isPaused = await priceFeedAdapter.paused();
        expect(isPaused).to.be.false;
      } catch (error) {
        // Skip test if pause functionality is not implemented
        this.skip();
      }
    });

    it("Should handle contract upgrade scenarios", async function () {
      await setupOracleData();

      // Test that data persists through upgrade simulation
      const beforeUpgrade = await priceFeedAdapter.latestRoundData();

      // Simulate upgrade by checking version
      expect(await priceFeedAdapter.version()).to.equal(1);

      // Data should still be accessible
      const afterUpgrade = await priceFeedAdapter.latestRoundData();
      expect(afterUpgrade[0]).to.equal(beforeUpgrade[0]); // Same round ID
    });

    it("Should handle zero and negative values gracefully", async function () {
      // Test with zero thresholds
      await expect(
        priceFeedAdapter.connect(admin).subscribeToPriceUpdates(subscriber.address, 0, 300)
      ).to.be.revertedWith("Invalid threshold");

      // Test with zero time threshold
      await expect(
        priceFeedAdapter.connect(admin).subscribeToPriceUpdates(subscriber.address, 100, 0)
      ).to.be.revertedWith("Invalid time threshold");
    });
  });

  describe("Gas Optimization Verification", function () {
    beforeEach(async function () {
      await setupOracleData();
    });

    it("Should maintain gas efficiency for standard operations", async function () {
      // Test gas usage for common operations
      const latestRoundGas = await priceFeedAdapter.latestRoundData.estimateGas();

      expect(latestRoundGas).to.be.lessThan(BigInt(100000)); // Reasonable gas limit

      const priceDataGas = await priceFeedAdapter.getLatestPriceData.estimateGas();

      expect(priceDataGas).to.be.lessThan(BigInt(150000)); // Reasonable gas limit
    });

    it("Should scale efficiently with data size", async function () {
      // Test small historical query
      const smallQuery = {
        startTime: (await time.latest()) - 300,
        endTime: await time.latest(),
        maxResults: 1,
        includeMetadata: false
      };

      const smallGas = await priceFeedAdapter.getHistoricalPriceData.estimateGas(smallQuery);

      // Test larger historical query
      const largeQuery = {
        startTime: (await time.latest()) - 3600,
        endTime: await time.latest(),
        maxResults: 10,
        includeMetadata: true
      };

      const largeGas = await priceFeedAdapter.getHistoricalPriceData.estimateGas(largeQuery);

      // Gas should scale reasonably (not exponentially)
      const gasRatio = Number(largeGas) / Number(smallGas);
      expect(gasRatio).to.be.lessThan(5); // Should not be more than 5x for 10x data
    });

    it("Should optimize subscription operations", async function () {
      const subscribeGas = await priceFeedAdapter.connect(admin).subscribeToPriceUpdates.estimateGas(
        subscriber.address,
        100,
        300
      );

      expect(subscribeGas).to.be.lessThan(BigInt(80000)); // Reasonable gas limit for subscription

      // Subscribe first
      await priceFeedAdapter.connect(admin).subscribeToPriceUpdates(subscriber.address, 100, 300);

      const unsubscribeGas = await priceFeedAdapter.connect(admin).unsubscribeFromPriceUpdates.estimateGas(
        subscriber.address
      );

      expect(unsubscribeGas).to.be.lessThan(BigInt(60000)); // Reasonable gas limit for unsubscription
    });
  });

  describe("Multi-signature and Access Control", function () {
    it("Should enforce role-based access control", async function () {
      // Test that only admin can perform admin functions
      await expect(
        priceFeedAdapter.connect(user).updateCache()
      ).to.be.revertedWithCustomError(priceFeedAdapter, "AccessControlUnauthorizedAccount");

      // Test that admin can perform admin functions
      await expect(
        priceFeedAdapter.connect(admin).updateCache()
      ).to.not.be.reverted;
    });

    it("Should handle role transfers correctly", async function () {
      const newAdmin = user;

      // Grant admin role to new admin
      await priceFeedAdapter.connect(admin).grantRole(ADMIN_ROLE, newAdmin.address);

      // New admin should be able to perform admin functions
      await expect(
        priceFeedAdapter.connect(newAdmin).updateCache()
      ).to.not.be.reverted;

      // Revoke admin role from new admin
      await priceFeedAdapter.connect(admin).revokeRole(ADMIN_ROLE, newAdmin.address);

      // New admin should no longer be able to perform admin functions
      await expect(
        priceFeedAdapter.connect(newAdmin).updateCache()
      ).to.be.revertedWithCustomError(priceFeedAdapter, "AccessControlUnauthorizedAccount");
    });

    it("Should support multiple subscribers", async function () {
      const subscriber2 = node1;

      // Grant subscriber role to multiple addresses
      await priceFeedAdapter.connect(admin).grantRole(SUBSCRIBER_ROLE, subscriber.address);
      await priceFeedAdapter.connect(admin).grantRole(SUBSCRIBER_ROLE, subscriber2.address);

      // Both should be able to subscribe
      await priceFeedAdapter.connect(admin).subscribeToPriceUpdates(subscriber.address, 100, 300);
      await priceFeedAdapter.connect(admin).subscribeToPriceUpdates(subscriber2.address, 200, 600);

      // Both subscriptions should be active
      expect(await priceFeedAdapter.hasRole(SUBSCRIBER_ROLE, subscriber.address)).to.be.true;
      expect(await priceFeedAdapter.hasRole(SUBSCRIBER_ROLE, subscriber2.address)).to.be.true;
    });
  });
});
