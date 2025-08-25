// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "../interfaces/IPriceFeed.sol";
import "../interfaces/IQuantlinkOracle.sol";
import "../libraries/DataValidation.sol";

/**
 * @title PriceFeedAdapter
 * @dev Adapter contract that provides standardized price feed interface for Quantlink Oracle
 * @notice Implements Chainlink-compatible interface for easy integration with existing protocols
 */
contract PriceFeedAdapter is 
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IPriceFeed
{
    using DataValidation for uint256[];

    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant SUBSCRIBER_ROLE = keccak256("SUBSCRIBER_ROLE");

    // Constants
    uint8 public constant DECIMALS = 8;
    uint256 public constant VERSION = 1;
    string public constant DESCRIPTION = "Quantlink Oracle CEX/DEX Fee Data Feed";
    uint256 public constant STALENESS_THRESHOLD = 600; // 10 minutes

    // State variables
    IQuantlinkOracle public oracle;
    
    // Data storage
    mapping(uint80 => PriceData) private _priceHistory;
    mapping(uint80 => FeeData) private _feeHistory;
    mapping(address => SubscriptionConfig) private _priceSubscriptions;
    mapping(address => SubscriptionConfig) private _feeSubscriptions;

    uint80 private _currentRoundId;
    string[] private _supportedSources;

    // Historical data tracking
    uint80[] private _historicalRounds;
    mapping(uint256 => uint80[]) private _roundsByTimestamp; // timestamp => round IDs
    uint256 private _oldestDataTimestamp;
    
    // Emergency state
    bool private _isEmergency;
    string private _emergencyType;
    uint256 private _emergencyStartTime;
    
    // Fallback data
    bool private _hasFallback;
    string private _fallbackSource;
    uint256 private _fallbackTimestamp;

    /**
     * @dev Subscription configuration
     */
    struct SubscriptionConfig {
        bool isActive;
        uint256 threshold; // Minimum change to trigger notification (basis points)
        uint256 timeThreshold; // Minimum time between notifications
        uint256 lastNotification; // Last notification timestamp
    }

    /**
     * @dev Data quality metrics
     */
    struct QualityMetrics {
        uint8 accuracy;
        uint16 precision;
        uint8 reliability;
        uint8 coverage;
        uint256 lastUpdated;
    }

    QualityMetrics private _qualityMetrics;

    // Events
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event SubscriptionCreated(address indexed subscriber, string subscriptionType);
    event SubscriptionRemoved(address indexed subscriber, string subscriptionType);
    event EmergencyModeActivated(string emergencyType, uint256 timestamp);
    event EmergencyModeDeactivated(uint256 timestamp);
    event FallbackDataActivated(string source, uint256 timestamp);

    /**
     * @dev Custom errors
     */
    error InvalidRoundId(uint80 roundId);
    error StaleData(uint256 lastUpdate, uint256 threshold);
    error EmergencyModeActive();
    error InvalidSubscriptionConfig(address subscriber);
    error OracleNotSet();

    /**
     * @dev Modifier to check if Oracle is set
     */
    modifier oracleSet() {
        if (address(oracle) == address(0)) {
            revert OracleNotSet();
        }
        _;
    }

    /**
     * @dev Modifier to check if not in emergency mode
     */
    modifier notInEmergency() {
        if (_isEmergency) {
            revert EmergencyModeActive();
        }
        _;
    }

    /**
     * @dev Initializes the PriceFeedAdapter
     * @param admin Address of the admin
     * @param _oracle Address of the Quantlink Oracle contract
     */
    function initialize(address admin, address _oracle) public initializer {
        require(admin != address(0), "Invalid admin address");
        require(_oracle != address(0), "Invalid oracle address");

        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        // Set up roles
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);

        // Set oracle
        oracle = IQuantlinkOracle(_oracle);

        // Initialize supported sources
        _supportedSources.push("Binance");
        _supportedSources.push("Coinbase");
        _supportedSources.push("OKEx");
        _supportedSources.push("Uniswap");
        _supportedSources.push("PancakeSwap");
        _supportedSources.push("SushiSwap");

        // Initialize quality metrics
        _qualityMetrics = QualityMetrics({
            accuracy: 95,
            precision: 10, // 0.1%
            reliability: 98,
            coverage: 90,
            lastUpdated: block.timestamp
        });

        _currentRoundId = 1;
    }

    // ============ CHAINLINK COMPATIBILITY ============

    /**
     * @dev Returns the latest round data (Chainlink compatible)
     */
    function latestRoundData()
        external
        view
        override
        oracleSet
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        IQuantlinkOracle.FeeData memory latestData = oracle.getLatestFeeData();
        
        // Convert fee data to price-like format (average of all fees)
        int256 averageFee = _calculateAverageFee(latestData.cexFees, latestData.dexFees);
        
        return (
            uint80(latestData.blockNumber),
            averageFee,
            latestData.timestamp,
            latestData.timestamp,
            uint80(latestData.blockNumber)
        );
    }

    /**
     * @dev Returns historical round data (Chainlink compatible)
     */
    function getRoundData(uint80 _roundId)
        external
        view
        override
        oracleSet
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        IQuantlinkOracle.FeeData memory roundData = oracle.getFeeDataAtRound(_roundId);
        
        if (roundData.timestamp == 0) {
            revert InvalidRoundId(_roundId);
        }
        
        int256 averageFee = _calculateAverageFee(roundData.cexFees, roundData.dexFees);
        
        return (
            _roundId,
            averageFee,
            roundData.timestamp,
            roundData.timestamp,
            _roundId
        );
    }

    /**
     * @dev Returns the number of decimals
     */
    function decimals() external pure override returns (uint8) {
        return DECIMALS;
    }

    /**
     * @dev Returns description of the price feed
     */
    function description() external pure override returns (string memory) {
        return DESCRIPTION;
    }

    /**
     * @dev Returns version of the price feed interface
     */
    function version() external pure override returns (uint256) {
        return VERSION;
    }

    // ============ QUANTLINK SPECIFIC FUNCTIONS ============

    /**
     * @dev Returns the latest fee data
     */
    function getLatestFeeData() external view override oracleSet returns (FeeData memory feeData) {
        IQuantlinkOracle.FeeData memory oracleData = oracle.getLatestFeeData();

        feeData = FeeData({
            cexFees: oracleData.cexFees,
            dexFees: oracleData.dexFees,
            timestamp: oracleData.timestamp,
            roundId: uint80(oracleData.blockNumber),
            exchangeCount: uint8(oracleData.cexFees.length + oracleData.dexFees.length)
        });

        return feeData;
    }

    /**
     * @dev Returns fee data for a specific round
     */
    function getFeeDataAtRound(uint80 roundId) external view override oracleSet returns (FeeData memory feeData) {
        IQuantlinkOracle.FeeData memory oracleData = oracle.getFeeDataAtRound(roundId);
        
        if (oracleData.timestamp == 0) {
            revert InvalidRoundId(roundId);
        }
        
        return FeeData({
            cexFees: oracleData.cexFees,
            dexFees: oracleData.dexFees,
            timestamp: oracleData.timestamp,
            roundId: roundId,
            exchangeCount: uint8(oracleData.cexFees.length + oracleData.dexFees.length)
        });
    }

    /**
     * @dev Returns comprehensive price data with metadata
     */
    function getLatestPriceData() external view override oracleSet returns (PriceData memory priceData) {
        IQuantlinkOracle.FeeData memory latestData = oracle.getLatestFeeData();
        
        int256 averageFee = _calculateAverageFee(latestData.cexFees, latestData.dexFees);
        uint8 confidence = _calculateConfidence(latestData);
        
        return PriceData({
            price: averageFee,
            timestamp: latestData.timestamp,
            roundId: uint80(latestData.blockNumber),
            confidence: confidence,
            source: "Quantlink Oracle"
        });
    }

    /**
     * @dev Returns price data for a specific round with metadata
     */
    function getPriceDataAtRound(uint80 roundId) external view override oracleSet returns (PriceData memory priceData) {
        IQuantlinkOracle.FeeData memory roundData = oracle.getFeeDataAtRound(roundId);
        
        if (roundData.timestamp == 0) {
            revert InvalidRoundId(roundId);
        }
        
        int256 averageFee = _calculateAverageFee(roundData.cexFees, roundData.dexFees);
        uint8 confidence = _calculateConfidence(roundData);
        
        return PriceData({
            price: averageFee,
            timestamp: roundData.timestamp,
            roundId: roundId,
            confidence: confidence,
            source: "Quantlink Oracle"
        });
    }

    /**
     * @dev Returns historical price data within a time range
     */
    function getHistoricalPriceData(HistoricalQuery calldata query)
        external
        view
        override
        returns (PriceData[] memory priceHistory)
    {
        // Validate query parameters
        require(query.startTime < query.endTime, "Invalid time range");
        require(query.maxResults > 0 && query.maxResults <= 1000, "Invalid max results");

        // Get rounds within time range
        uint80[] memory relevantRounds = _getRoundsInTimeRange(query.startTime, query.endTime);

        // Limit results
        uint256 resultCount = relevantRounds.length > query.maxResults ? query.maxResults : relevantRounds.length;
        priceHistory = new PriceData[](resultCount);

        // Populate historical data
        for (uint256 i = 0; i < resultCount; i++) {
            uint80 roundId = relevantRounds[i];
            if (_priceHistory[roundId].timestamp != 0) {
                priceHistory[i] = _priceHistory[roundId];
            } else {
                // Generate price data from Oracle if not cached
                try oracle.getFeeDataAtRound(roundId) returns (IQuantlinkOracle.FeeData memory oracleData) {
                    priceHistory[i] = PriceData({
                        price: _calculateAverageFee(oracleData.cexFees, oracleData.dexFees),
                        timestamp: oracleData.timestamp,
                        roundId: roundId,
                        confidence: _calculateConfidence(oracleData),
                        source: "Quantlink Oracle"
                    });
                } catch {
                    // Skip invalid rounds
                    continue;
                }
            }
        }

        return priceHistory;
    }

    /**
     * @dev Gets rounds within a time range
     * @param startTime Start timestamp
     * @param endTime End timestamp
     * @return rounds Array of round IDs in the time range
     */
    function _getRoundsInTimeRange(uint256 startTime, uint256 endTime) internal view returns (uint80[] memory rounds) {
        uint256 resultCount = 0;

        // Count rounds in range
        for (uint256 i = 0; i < _historicalRounds.length; i++) {
            uint80 roundId = _historicalRounds[i];
            uint256 roundTimestamp = _getRoundTimestamp(roundId);

            if (roundTimestamp >= startTime && roundTimestamp <= endTime) {
                resultCount++;
            }
        }

        // Create result array
        rounds = new uint80[](resultCount);
        uint256 index = 0;

        for (uint256 i = 0; i < _historicalRounds.length; i++) {
            uint80 roundId = _historicalRounds[i];
            uint256 roundTimestamp = _getRoundTimestamp(roundId);

            if (roundTimestamp >= startTime && roundTimestamp <= endTime) {
                rounds[index++] = roundId;
            }
        }

        return rounds;
    }

    /**
     * @dev Gets timestamp for a round
     * @param roundId Round ID
     * @return timestamp Round timestamp
     */
    function _getRoundTimestamp(uint80 roundId) internal view returns (uint256 timestamp) {
        if (_priceHistory[roundId].timestamp != 0) {
            return _priceHistory[roundId].timestamp;
        }

        if (_feeHistory[roundId].timestamp != 0) {
            return _feeHistory[roundId].timestamp;
        }

        // Try to get from Oracle
        try oracle.getFeeDataAtRound(roundId) returns (IQuantlinkOracle.FeeData memory data) {
            return data.timestamp;
        } catch {
            return 0;
        }
    }

    /**
     * @dev Caches round data for historical queries
     * @param roundId Round ID
     * @param feeData Fee data to cache
     * @param oracleData Original oracle data
     */
    function _cacheRoundData(
        uint80 roundId,
        FeeData memory feeData,
        IQuantlinkOracle.FeeData memory oracleData
    ) internal {
        // Cache fee data if not already cached
        if (_feeHistory[roundId].timestamp == 0) {
            _feeHistory[roundId] = feeData;
        }

        // Cache price data if not already cached
        if (_priceHistory[roundId].timestamp == 0) {
            _priceHistory[roundId] = PriceData({
                price: _calculateAverageFee(oracleData.cexFees, oracleData.dexFees),
                timestamp: oracleData.timestamp,
                roundId: roundId,
                confidence: _calculateConfidence(oracleData),
                source: "Quantlink Oracle"
            });
        }

        // Add to historical rounds if not already present
        bool roundExists = false;
        for (uint256 i = 0; i < _historicalRounds.length; i++) {
            if (_historicalRounds[i] == roundId) {
                roundExists = true;
                break;
            }
        }

        if (!roundExists) {
            _historicalRounds.push(roundId);

            // Update oldest data timestamp
            if (_oldestDataTimestamp == 0 || oracleData.timestamp < _oldestDataTimestamp) {
                _oldestDataTimestamp = oracleData.timestamp;
            }
        }
    }

    /**
     * @dev Returns historical fee data within a time range
     */
    function getHistoricalFeeData(HistoricalQuery calldata query)
        external
        view
        override
        returns (FeeData[] memory feeHistory)
    {
        // Validate query parameters
        require(query.startTime < query.endTime, "Invalid time range");
        require(query.maxResults > 0 && query.maxResults <= 1000, "Invalid max results");

        // Get rounds within time range
        uint80[] memory relevantRounds = _getRoundsInTimeRange(query.startTime, query.endTime);

        // Limit results
        uint256 resultCount = relevantRounds.length > query.maxResults ? query.maxResults : relevantRounds.length;
        feeHistory = new FeeData[](resultCount);

        // Populate historical data
        for (uint256 i = 0; i < resultCount; i++) {
            uint80 roundId = relevantRounds[i];
            if (_feeHistory[roundId].timestamp != 0) {
                feeHistory[i] = _feeHistory[roundId];
            } else {
                // Generate fee data from Oracle if not cached
                try oracle.getFeeDataAtRound(roundId) returns (IQuantlinkOracle.FeeData memory oracleData) {
                    feeHistory[i] = FeeData({
                        cexFees: oracleData.cexFees,
                        dexFees: oracleData.dexFees,
                        timestamp: oracleData.timestamp,
                        roundId: roundId,
                        exchangeCount: uint8(oracleData.cexFees.length + oracleData.dexFees.length)
                    });
                } catch {
                    // Skip invalid rounds
                    continue;
                }
            }
        }

        return feeHistory;
    }

    /**
     * @dev Returns average fee over a specified time period
     */
    function getAverageFee(uint256 timeWindow, uint8 feeType)
        external
        view
        override
        oracleSet
        returns (uint256 averageFee, uint256 sampleCount)
    {
        require(timeWindow > 0 && timeWindow <= 86400, "Invalid time window"); // Max 24 hours
        require(feeType <= 2, "Invalid fee type");

        IQuantlinkOracle.FeeData memory latestData = oracle.getLatestFeeData();

        // Simplified calculation using latest data
        if (feeType == 0) { // CEX
            averageFee = _calculateArrayAverage(latestData.cexFees);
            sampleCount = latestData.cexFees.length;
        } else if (feeType == 1) { // DEX
            averageFee = _calculateArrayAverage(latestData.dexFees);
            sampleCount = latestData.dexFees.length;
        } else { // Combined
            uint256 cexAvg = _calculateArrayAverage(latestData.cexFees);
            uint256 dexAvg = _calculateArrayAverage(latestData.dexFees);
            averageFee = (cexAvg + dexAvg) / 2;
            sampleCount = latestData.cexFees.length + latestData.dexFees.length;
        }

        return (averageFee, sampleCount);
    }

    /**
     * @dev Returns fee volatility over a specified time period
     */
    function getFeeVolatility(uint256 timeWindow, uint8 feeType)
        external
        view
        override
        oracleSet
        returns (uint256 volatility, uint8 confidence)
    {
        require(timeWindow > 0 && timeWindow <= 86400, "Invalid time window");
        require(feeType <= 2, "Invalid fee type");

        IQuantlinkOracle.FeeData memory latestData = oracle.getLatestFeeData();

        // Simplified volatility calculation
        if (feeType == 0) { // CEX
            volatility = DataValidation.calculateArrayDeviation(latestData.cexFees);
            confidence = latestData.cexFees.length >= 3 ? 80 : 50;
        } else if (feeType == 1) { // DEX
            volatility = DataValidation.calculateArrayDeviation(latestData.dexFees);
            confidence = latestData.dexFees.length >= 3 ? 80 : 50;
        } else { // Combined
            uint256 cexVol = DataValidation.calculateArrayDeviation(latestData.cexFees);
            uint256 dexVol = DataValidation.calculateArrayDeviation(latestData.dexFees);
            volatility = (cexVol + dexVol) / 2;
            confidence = 75;
        }

        return (volatility, confidence);
    }

    /**
     * @dev Returns the current data freshness status
     */
    function getDataFreshness()
        external
        view
        override
        oracleSet
        returns (
            bool isFresh,
            uint256 lastUpdateTime,
            uint256 stalenessThreshold
        )
    {
        IQuantlinkOracle.FeeData memory latestData = oracle.getLatestFeeData();
        lastUpdateTime = latestData.timestamp;
        stalenessThreshold = STALENESS_THRESHOLD;
        isFresh = (block.timestamp - lastUpdateTime) <= stalenessThreshold;

        return (isFresh, lastUpdateTime, stalenessThreshold);
    }

    /**
     * @dev Returns health status of the Oracle system
     */
    function getOracleHealth()
        external
        view
        override
        oracleSet
        returns (
            bool isHealthy,
            bool consensusReached,
            uint8 activeNodes,
            uint256 lastConsensusTime
        )
    {
        IQuantlinkOracle.FeeData memory latestData = oracle.getLatestFeeData();

        consensusReached = latestData.consensusReached;
        activeNodes = latestData.participatingNodes;
        lastConsensusTime = latestData.timestamp;

        // Health check based on data freshness and consensus
        bool dataFresh = (block.timestamp - latestData.timestamp) <= STALENESS_THRESHOLD;
        isHealthy = dataFresh && consensusReached && activeNodes >= 6;

        return (isHealthy, consensusReached, activeNodes, lastConsensusTime);
    }

    /**
     * @dev Returns supported data sources
     */
    function getSupportedSources() external view override returns (string[] memory sources) {
        return _supportedSources;
    }

    /**
     * @dev Returns data quality metrics
     */
    function getDataQualityMetrics()
        external
        view
        override
        returns (
            uint8 accuracy,
            uint16 precision,
            uint8 reliability,
            uint8 coverage
        )
    {
        return (
            _qualityMetrics.accuracy,
            _qualityMetrics.precision,
            _qualityMetrics.reliability,
            _qualityMetrics.coverage
        );
    }

    // ============ SUBSCRIPTION FUNCTIONS ============

    /**
     * @dev Subscribes to price updates
     */
    function subscribeToPriceUpdates(
        address subscriber,
        uint256 priceThreshold,
        uint256 timeThreshold
    ) external override {
        require(subscriber != address(0), "Invalid subscriber");
        require(priceThreshold > 0 && priceThreshold <= 10000, "Invalid price threshold");
        require(timeThreshold >= 60, "Time threshold too low"); // Minimum 1 minute

        _priceSubscriptions[subscriber] = SubscriptionConfig({
            isActive: true,
            threshold: priceThreshold,
            timeThreshold: timeThreshold,
            lastNotification: 0
        });

        emit SubscriptionCreated(subscriber, "price");
    }

    /**
     * @dev Subscribes to fee updates
     */
    function subscribeToFeeUpdates(
        address subscriber,
        uint256 feeThreshold,
        uint256 timeThreshold
    ) external override {
        require(subscriber != address(0), "Invalid subscriber");
        require(feeThreshold > 0 && feeThreshold <= 10000, "Invalid fee threshold");
        require(timeThreshold >= 60, "Time threshold too low");

        _feeSubscriptions[subscriber] = SubscriptionConfig({
            isActive: true,
            threshold: feeThreshold,
            timeThreshold: timeThreshold,
            lastNotification: 0
        });

        emit SubscriptionCreated(subscriber, "fee");
    }

    /**
     * @dev Unsubscribes from price updates
     */
    function unsubscribeFromPriceUpdates(address subscriber) external override {
        require(_priceSubscriptions[subscriber].isActive, "No active subscription");
        delete _priceSubscriptions[subscriber];
        emit SubscriptionRemoved(subscriber, "price");
    }

    /**
     * @dev Unsubscribes from fee updates
     */
    function unsubscribeFromFeeUpdates(address subscriber) external override {
        require(_feeSubscriptions[subscriber].isActive, "No active subscription");
        delete _feeSubscriptions[subscriber];
        emit SubscriptionRemoved(subscriber, "fee");
    }

    // ============ EMERGENCY FUNCTIONS ============

    /**
     * @dev Returns emergency status of the Oracle
     */
    function getEmergencyStatus()
        external
        view
        override
        returns (
            bool isEmergency,
            string memory emergencyType,
            uint256 emergencyStartTime
        )
    {
        return (_isEmergency, _emergencyType, _emergencyStartTime);
    }

    /**
     * @dev Returns fallback data source information
     */
    function getFallbackInfo()
        external
        view
        override
        returns (
            bool hasFallback,
            string memory fallbackSource,
            uint256 fallbackTimestamp
        )
    {
        return (_hasFallback, _fallbackSource, _fallbackTimestamp);
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @dev Sets the Oracle contract address (admin only)
     */
    function setOracle(address _oracle) external onlyRole(ADMIN_ROLE) {
        require(_oracle != address(0), "Invalid oracle address");
        address oldOracle = address(oracle);
        oracle = IQuantlinkOracle(_oracle);
        emit OracleUpdated(oldOracle, _oracle);
    }

    /**
     * @dev Activates emergency mode (admin only)
     */
    function activateEmergencyMode(string calldata emergencyType) external onlyRole(ADMIN_ROLE) {
        _isEmergency = true;
        _emergencyType = emergencyType;
        _emergencyStartTime = block.timestamp;
        _pause();
        emit EmergencyModeActivated(emergencyType, block.timestamp);
    }

    /**
     * @dev Deactivates emergency mode (admin only)
     */
    function deactivateEmergencyMode() external onlyRole(ADMIN_ROLE) {
        _isEmergency = false;
        _emergencyType = "";
        _emergencyStartTime = 0;
        _unpause();
        emit EmergencyModeDeactivated(block.timestamp);
    }

    /**
     * @dev Sets fallback data source (admin only)
     */
    function setFallbackData(string calldata source, uint256 timestamp) external onlyRole(ADMIN_ROLE) {
        _hasFallback = true;
        _fallbackSource = source;
        _fallbackTimestamp = timestamp;
        emit FallbackDataActivated(source, timestamp);
    }

    /**
     * @dev Updates quality metrics (admin only)
     */
    function updateQualityMetrics(
        uint8 accuracy,
        uint16 precision,
        uint8 reliability,
        uint8 coverage
    ) external onlyRole(ADMIN_ROLE) {
        require(accuracy <= 100, "Invalid accuracy");
        require(reliability <= 100, "Invalid reliability");
        require(coverage <= 100, "Invalid coverage");

        _qualityMetrics = QualityMetrics({
            accuracy: accuracy,
            precision: precision,
            reliability: reliability,
            coverage: coverage,
            lastUpdated: block.timestamp
        });
    }

    /**
     * @dev Adds a supported data source (admin only)
     */
    function addSupportedSource(string calldata source) external onlyRole(ADMIN_ROLE) {
        _supportedSources.push(source);
        emit DataSourceAdded(source, block.timestamp);
    }

    /**
     * @dev Removes a supported data source (admin only)
     */
    function removeSupportedSource(string calldata source) external onlyRole(ADMIN_ROLE) {
        for (uint256 i = 0; i < _supportedSources.length; i++) {
            if (keccak256(bytes(_supportedSources[i])) == keccak256(bytes(source))) {
                _supportedSources[i] = _supportedSources[_supportedSources.length - 1];
                _supportedSources.pop();
                emit DataSourceRemoved(source, block.timestamp);
                break;
            }
        }
    }

    /**
     * @dev Updates cache with latest Oracle data (admin only)
     */
    function updateCache() external onlyRole(ADMIN_ROLE) {
        IQuantlinkOracle.FeeData memory oracleData = oracle.getLatestFeeData();
        uint80 roundId = uint80(oracleData.blockNumber);

        FeeData memory feeData = FeeData({
            cexFees: oracleData.cexFees,
            dexFees: oracleData.dexFees,
            timestamp: oracleData.timestamp,
            roundId: roundId,
            exchangeCount: uint8(oracleData.cexFees.length + oracleData.dexFees.length)
        });

        _cacheRoundData(roundId, feeData, oracleData);
    }

    // ============ INTERNAL HELPER FUNCTIONS ============

    /**
     * @dev Calculates average fee from CEX and DEX arrays
     */
    function _calculateAverageFee(uint256[] memory cexFees, uint256[] memory dexFees) internal pure returns (int256) {
        if (cexFees.length == 0 && dexFees.length == 0) {
            return 0;
        }

        uint256 totalFees = 0;
        uint256 totalCount = 0;

        for (uint256 i = 0; i < cexFees.length; i++) {
            totalFees += cexFees[i];
            totalCount++;
        }

        for (uint256 i = 0; i < dexFees.length; i++) {
            totalFees += dexFees[i];
            totalCount++;
        }

        return totalCount > 0 ? int256(totalFees / totalCount) : int256(0);
    }

    /**
     * @dev Calculates confidence level based on consensus data
     */
    function _calculateConfidence(IQuantlinkOracle.FeeData memory data) internal pure returns (uint8) {
        if (!data.consensusReached) {
            return 0;
        }

        // Base confidence on number of participating nodes
        uint8 baseConfidence = (data.participatingNodes * 10); // 10% per node

        // Cap at 100%
        return baseConfidence > 100 ? 100 : baseConfidence;
    }

    /**
     * @dev Calculates average of an array
     */
    function _calculateArrayAverage(uint256[] memory array) internal pure returns (uint256) {
        if (array.length == 0) {
            return 0;
        }

        uint256 sum = 0;
        for (uint256 i = 0; i < array.length; i++) {
            sum += array[i];
        }

        return sum / array.length;
    }

    // ============ UPGRADE FUNCTIONS ============

    /**
     * @dev Authorizes contract upgrades (admin only)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {
        // Additional upgrade validation can be added here
    }

    /**
     * @dev Returns contract version
     */
    function getContractVersion() external pure returns (string memory) {
        return "1.0.0";
    }
}
