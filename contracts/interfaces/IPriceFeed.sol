// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

/**
 * @title IPriceFeed
 * @dev Standardized interface for accessing Oracle price and fee data
 * @notice Compatible with Chainlink AggregatorV3Interface for easy integration
 */
interface IPriceFeed {
    /**
     * @dev Struct representing price data with metadata
     * @param price Current price in specified decimals
     * @param timestamp When the price was last updated
     * @param roundId Round identifier for this price update
     * @param confidence Confidence level in the price (0-100)
     * @param source Data source identifier
     */
    struct PriceData {
        int256 price;
        uint256 timestamp;
        uint80 roundId;
        uint8 confidence;
        string source;
    }

    /**
     * @dev Struct representing fee data for exchanges
     * @param cexFees Array of centralized exchange fees (basis points)
     * @param dexFees Array of decentralized exchange fees (basis points)
     * @param timestamp When fees were last updated
     * @param roundId Round identifier for this fee update
     * @param exchangeCount Number of exchanges included in aggregation
     */
    struct FeeData {
        uint256[] cexFees;
        uint256[] dexFees;
        uint256 timestamp;
        uint80 roundId;
        uint8 exchangeCount;
    }

    /**
     * @dev Struct for historical data queries
     * @param startTime Start of time range
     * @param endTime End of time range
     * @param maxResults Maximum number of results to return
     * @param includeMetadata Whether to include additional metadata
     */
    struct HistoricalQuery {
        uint256 startTime;
        uint256 endTime;
        uint256 maxResults;
        bool includeMetadata;
    }

    // Events
    event PriceUpdated(
        int256 indexed price,
        uint80 indexed roundId,
        uint256 timestamp,
        uint8 confidence
    );

    event FeeDataUpdated(
        uint256[] cexFees,
        uint256[] dexFees,
        uint80 indexed roundId,
        uint256 timestamp
    );

    event DataSourceAdded(string indexed source, uint256 timestamp);
    event DataSourceRemoved(string indexed source, uint256 timestamp);

    // ============ CHAINLINK COMPATIBILITY ============

    /**
     * @dev Returns the latest price data (Chainlink compatible)
     * @return roundId Round identifier
     * @return answer Price value
     * @return startedAt When the round started
     * @return updatedAt When the round was last updated
     * @return answeredInRound Round in which the answer was computed
     */
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    /**
     * @dev Returns historical round data (Chainlink compatible)
     * @param _roundId Round identifier to query
     * @return roundId Round identifier
     * @return answer Price value for the round
     * @return startedAt When the round started
     * @return updatedAt When the round was last updated
     * @return answeredInRound Round in which the answer was computed
     */
    function getRoundData(uint80 _roundId)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    /**
     * @dev Returns the number of decimals for price data
     * @return decimals Number of decimals
     */
    function decimals() external view returns (uint8 decimals);

    /**
     * @dev Returns description of the price feed
     * @return description Human-readable description
     */
    function description() external view returns (string memory description);

    /**
     * @dev Returns version of the price feed interface
     * @return version Version number
     */
    function version() external view returns (uint256 version);

    // ============ QUANTLINK SPECIFIC FUNCTIONS ============

    /**
     * @dev Returns the latest fee data from CEX/DEX aggregation
     * @return feeData Current fee data structure
     */
    function getLatestFeeData() external view returns (FeeData memory feeData);

    /**
     * @dev Returns fee data for a specific round
     * @param roundId Round identifier to query
     * @return feeData Fee data for the specified round
     */
    function getFeeDataAtRound(uint80 roundId) external view returns (FeeData memory feeData);

    /**
     * @dev Returns comprehensive price data with metadata
     * @return priceData Enhanced price data structure
     */
    function getLatestPriceData() external view returns (PriceData memory priceData);

    /**
     * @dev Returns price data for a specific round with metadata
     * @param roundId Round identifier to query
     * @return priceData Enhanced price data for the specified round
     */
    function getPriceDataAtRound(uint80 roundId) external view returns (PriceData memory priceData);

    /**
     * @dev Returns historical price data within a time range
     * @param query Historical query parameters
     * @return priceHistory Array of historical price data
     */
    function getHistoricalPriceData(HistoricalQuery calldata query)
        external
        view
        returns (PriceData[] memory priceHistory);

    /**
     * @dev Returns historical fee data within a time range
     * @param query Historical query parameters
     * @return feeHistory Array of historical fee data
     */
    function getHistoricalFeeData(HistoricalQuery calldata query)
        external
        view
        returns (FeeData[] memory feeHistory);

    /**
     * @dev Returns average fee over a specified time period
     * @param timeWindow Time window in seconds
     * @param feeType Type of fee (0 = CEX, 1 = DEX, 2 = Combined)
     * @return averageFee Average fee in basis points
     * @return sampleCount Number of samples used in calculation
     */
    function getAverageFee(uint256 timeWindow, uint8 feeType)
        external
        view
        returns (uint256 averageFee, uint256 sampleCount);

    /**
     * @dev Returns fee volatility over a specified time period
     * @param timeWindow Time window in seconds
     * @param feeType Type of fee (0 = CEX, 1 = DEX, 2 = Combined)
     * @return volatility Fee volatility as standard deviation
     * @return confidence Confidence level in the volatility calculation
     */
    function getFeeVolatility(uint256 timeWindow, uint8 feeType)
        external
        view
        returns (uint256 volatility, uint8 confidence);

    /**
     * @dev Returns the current data freshness status
     * @return isFresh Whether data is considered fresh
     * @return lastUpdateTime When data was last updated
     * @return stalenessThreshold Maximum acceptable staleness
     */
    function getDataFreshness()
        external
        view
        returns (
            bool isFresh,
            uint256 lastUpdateTime,
            uint256 stalenessThreshold
        );

    /**
     * @dev Returns health status of the Oracle system
     * @return isHealthy Whether the Oracle is operating normally
     * @return consensusReached Whether latest consensus was successful
     * @return activeNodes Number of currently active nodes
     * @return lastConsensusTime When consensus was last reached
     */
    function getOracleHealth()
        external
        view
        returns (
            bool isHealthy,
            bool consensusReached,
            uint8 activeNodes,
            uint256 lastConsensusTime
        );

    /**
     * @dev Returns supported data sources
     * @return sources Array of supported data source identifiers
     */
    function getSupportedSources() external view returns (string[] memory sources);

    /**
     * @dev Returns data quality metrics
     * @return accuracy Accuracy percentage (0-100)
     * @return precision Precision in basis points
     * @return reliability Reliability score (0-100)
     * @return coverage Data coverage percentage (0-100)
     */
    function getDataQualityMetrics()
        external
        view
        returns (
            uint8 accuracy,
            uint16 precision,
            uint8 reliability,
            uint8 coverage
        );

    // ============ SUBSCRIPTION FUNCTIONS ============

    /**
     * @dev Subscribes to price updates (for contracts that need notifications)
     * @param subscriber Address to receive update notifications
     * @param priceThreshold Minimum price change to trigger notification (basis points)
     * @param timeThreshold Minimum time between notifications (seconds)
     */
    function subscribeToPriceUpdates(
        address subscriber,
        uint256 priceThreshold,
        uint256 timeThreshold
    ) external;

    /**
     * @dev Subscribes to fee updates
     * @param subscriber Address to receive update notifications
     * @param feeThreshold Minimum fee change to trigger notification (basis points)
     * @param timeThreshold Minimum time between notifications (seconds)
     */
    function subscribeToFeeUpdates(
        address subscriber,
        uint256 feeThreshold,
        uint256 timeThreshold
    ) external;

    /**
     * @dev Unsubscribes from price updates
     * @param subscriber Address to stop receiving notifications
     */
    function unsubscribeFromPriceUpdates(address subscriber) external;

    /**
     * @dev Unsubscribes from fee updates
     * @param subscriber Address to stop receiving notifications
     */
    function unsubscribeFromFeeUpdates(address subscriber) external;

    // ============ EMERGENCY FUNCTIONS ============

    /**
     * @dev Returns emergency status of the Oracle
     * @return isEmergency Whether Oracle is in emergency mode
     * @return emergencyType Type of emergency (if any)
     * @return emergencyStartTime When emergency mode was activated
     */
    function getEmergencyStatus()
        external
        view
        returns (
            bool isEmergency,
            string memory emergencyType,
            uint256 emergencyStartTime
        );

    /**
     * @dev Returns fallback data source information
     * @return hasFallback Whether fallback data is available
     * @return fallbackSource Identifier of fallback data source
     * @return fallbackTimestamp When fallback data was last updated
     */
    function getFallbackInfo()
        external
        view
        returns (
            bool hasFallback,
            string memory fallbackSource,
            uint256 fallbackTimestamp
        );
}
