// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../interfaces/IPriceFeed.sol";

/**
 * @title ProtocolIntegration
 * @dev Helper contract for protocols to integrate with Quantlink Oracle
 * @notice Provides common integration patterns and utilities
 */
contract ProtocolIntegration is 
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PROTOCOL_ROLE = keccak256("PROTOCOL_ROLE");

    // Integration types
    enum IntegrationType {
        PriceFeed,
        FeeCalculation,
        HealthCheck,
        Custom
    }

    // Integration configuration
    struct IntegrationConfig {
        address protocol;
        IntegrationType integrationType;
        address priceFeed;
        uint256 updateFrequency;
        uint256 stalenessThreshold;
        bool isActive;
        uint256 lastUpdate;
        bytes customConfig;
    }

    // Fee calculation parameters
    struct FeeCalculationParams {
        uint256 baseFeeBps; // Base fee in basis points
        uint256 maxFeeBps; // Maximum fee in basis points
        uint256 minFeeBps; // Minimum fee in basis points
        uint256 volatilityMultiplier; // Multiplier for volatility-based fees
        bool useOracleFees; // Whether to use Oracle fees directly
    }

    // Health check configuration
    struct HealthCheckConfig {
        uint256 maxStaleness; // Maximum acceptable data staleness
        uint8 minConfidence; // Minimum confidence level required
        uint8 minActiveNodes; // Minimum active nodes required
        bool requireConsensus; // Whether consensus is required
        address fallbackOracle; // Fallback Oracle address
    }

    // State variables
    mapping(address => IntegrationConfig) private _integrations;
    mapping(address => FeeCalculationParams) private _feeParams;
    mapping(address => HealthCheckConfig) private _healthConfigs;
    mapping(address => uint256) private _lastHealthCheck;
    
    address[] private _registeredProtocols;
    uint256 private _totalIntegrations;

    // Events
    event ProtocolRegistered(
        address indexed protocol,
        IntegrationType integrationType,
        address indexed priceFeed
    );

    event ProtocolUpdated(
        address indexed protocol,
        IntegrationType oldType,
        IntegrationType newType
    );

    event ProtocolDeregistered(address indexed protocol);

    event FeeCalculated(
        address indexed protocol,
        uint256 amount,
        uint256 calculatedFee,
        uint256 oracleFee
    );

    event HealthCheckPerformed(
        address indexed protocol,
        bool isHealthy,
        string reason
    );

    event EmergencyFallbackActivated(
        address indexed protocol,
        address fallbackOracle,
        string reason
    );

    /**
     * @dev Custom errors
     */
    error ProtocolNotRegistered(address protocol);
    error ProtocolAlreadyRegistered(address protocol);
    error InvalidIntegrationType(IntegrationType integrationType);
    error HealthCheckFailed(address protocol, string reason);
    error StaleData(address protocol, uint256 lastUpdate, uint256 threshold);
    error InsufficientConfidence(address protocol, uint8 confidence, uint8 required);

    /**
     * @dev Modifier to check if protocol is registered
     */
    modifier onlyRegisteredProtocol(address protocol) {
        if (!_integrations[protocol].isActive) {
            revert ProtocolNotRegistered(protocol);
        }
        _;
    }

    /**
     * @dev Initializes the ProtocolIntegration contract
     * @param admin Address of the admin
     */
    function initialize(address admin) public initializer {
        require(admin != address(0), "Invalid admin address");

        __AccessControl_init();
        __ReentrancyGuard_init();

        // Set up roles
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    /**
     * @dev Registers a protocol for Oracle integration
     * @param protocol Address of the protocol
     * @param integrationType Type of integration
     * @param priceFeed Address of the price feed contract
     * @param updateFrequency How often the protocol updates (seconds)
     * @param customConfig Custom configuration data
     */
    function registerProtocol(
        address protocol,
        IntegrationType integrationType,
        address priceFeed,
        uint256 updateFrequency,
        bytes calldata customConfig
    ) external onlyRole(ADMIN_ROLE) {
        require(protocol != address(0), "Invalid protocol address");
        require(priceFeed != address(0), "Invalid price feed address");
        require(updateFrequency > 0, "Invalid update frequency");

        if (_integrations[protocol].isActive) {
            revert ProtocolAlreadyRegistered(protocol);
        }

        _integrations[protocol] = IntegrationConfig({
            protocol: protocol,
            integrationType: integrationType,
            priceFeed: priceFeed,
            updateFrequency: updateFrequency,
            stalenessThreshold: updateFrequency * 2, // Default to 2x update frequency
            isActive: true,
            lastUpdate: block.timestamp,
            customConfig: customConfig
        });

        _registeredProtocols.push(protocol);
        _totalIntegrations++;

        // Grant protocol role
        _grantRole(PROTOCOL_ROLE, protocol);

        emit ProtocolRegistered(protocol, integrationType, priceFeed);
    }

    /**
     * @dev Calculates fees for a protocol based on Oracle data
     * @param protocol Address of the protocol
     * @param amount Transaction amount
     * @param feeType Type of fee (0 = CEX, 1 = DEX, 2 = Combined)
     * @return calculatedFee Calculated fee amount
     * @return oracleFee Raw Oracle fee data
     */
    function calculateFee(
        address protocol,
        uint256 amount,
        uint8 feeType
    ) external view onlyRegisteredProtocol(protocol) returns (uint256 calculatedFee, uint256 oracleFee) {
        IntegrationConfig memory config = _integrations[protocol];
        FeeCalculationParams memory params = _feeParams[protocol];
        
        IPriceFeed priceFeed = IPriceFeed(config.priceFeed);
        
        // Get Oracle fee data
        (uint256 averageFee, ) = priceFeed.getAverageFee(3600, feeType); // 1 hour window
        oracleFee = averageFee;

        if (params.useOracleFees) {
            // Use Oracle fees directly with advanced bounds checking
            calculatedFee = _applyAdvancedFeeBounds(amount, averageFee, params, config);
        } else {
            // Use base fee with Oracle data as dynamic adjustment
            uint256 adjustedFee = _calculateDynamicAdjustedFee(params.baseFeeBps, averageFee, params, config);
            calculatedFee = (amount * adjustedFee) / 10000; // Convert from basis points
        }

        // Apply volume-based discounts
        calculatedFee = _applyVolumeDiscounts(protocol, amount, calculatedFee);

        // Apply time-based adjustments
        calculatedFee = _applyTimeBasedAdjustments(calculatedFee, config);

        return (calculatedFee, oracleFee);
    }

    /**
     * @dev Performs health check for a protocol
     * @param protocol Address of the protocol
     * @return isHealthy Whether the Oracle data is healthy for this protocol
     * @return reason Reason if not healthy
     */
    function performHealthCheck(address protocol) 
        external 
        onlyRegisteredProtocol(protocol) 
        returns (bool isHealthy, string memory reason) 
    {
        IntegrationConfig memory config = _integrations[protocol];
        HealthCheckConfig memory healthConfig = _healthConfigs[protocol];
        
        IPriceFeed priceFeed = IPriceFeed(config.priceFeed);
        
        // Check data freshness
        (bool isFresh, uint256 lastUpdateTime, ) = priceFeed.getDataFreshness();
        if (!isFresh || (block.timestamp - lastUpdateTime) > healthConfig.maxStaleness) {
            emit HealthCheckPerformed(protocol, false, "Stale data");
            return (false, "Stale data");
        }

        // Check Oracle health
        (bool oracleHealthy, bool consensusReached, uint8 activeNodes, ) = priceFeed.getOracleHealth();
        
        if (!oracleHealthy) {
            emit HealthCheckPerformed(protocol, false, "Oracle unhealthy");
            return (false, "Oracle unhealthy");
        }

        if (healthConfig.requireConsensus && !consensusReached) {
            emit HealthCheckPerformed(protocol, false, "No consensus");
            return (false, "No consensus");
        }

        if (activeNodes < healthConfig.minActiveNodes) {
            emit HealthCheckPerformed(protocol, false, "Insufficient active nodes");
            return (false, "Insufficient active nodes");
        }

        // Check confidence level
        IPriceFeed.PriceData memory priceData = priceFeed.getLatestPriceData();
        if (priceData.confidence < healthConfig.minConfidence) {
            emit HealthCheckPerformed(protocol, false, "Low confidence");
            return (false, "Low confidence");
        }

        _lastHealthCheck[protocol] = block.timestamp;
        emit HealthCheckPerformed(protocol, true, "");
        return (true, "");
    }

    /**
     * @dev Gets integration status for a protocol
     * @param protocol Address of the protocol
     * @return config Integration configuration
     * @return lastHealthCheck Last health check timestamp
     * @return isHealthy Current health status
     */
    function getIntegrationStatus(address protocol) 
        external 
        view 
        returns (
            IntegrationConfig memory config,
            uint256 lastHealthCheck,
            bool isHealthy
        ) 
    {
        config = _integrations[protocol];
        lastHealthCheck = _lastHealthCheck[protocol];
        
        // Simple health check based on last update time
        isHealthy = config.isActive && 
                   (block.timestamp - config.lastUpdate) <= config.stalenessThreshold;
        
        return (config, lastHealthCheck, isHealthy);
    }

    /**
     * @dev Sets fee calculation parameters for a protocol
     * @param protocol Address of the protocol
     * @param params Fee calculation parameters
     */
    function setFeeCalculationParams(
        address protocol,
        FeeCalculationParams calldata params
    ) external onlyRole(ADMIN_ROLE) onlyRegisteredProtocol(protocol) {
        require(params.minFeeBps <= params.maxFeeBps, "Invalid fee bounds");
        require(params.maxFeeBps <= 10000, "Fee too high"); // Max 100%
        
        _feeParams[protocol] = params;
    }

    /**
     * @dev Sets health check configuration for a protocol
     * @param protocol Address of the protocol
     * @param config Health check configuration
     */
    function setHealthCheckConfig(
        address protocol,
        HealthCheckConfig calldata config
    ) external onlyRole(ADMIN_ROLE) onlyRegisteredProtocol(protocol) {
        require(config.maxStaleness > 0, "Invalid staleness threshold");
        require(config.minConfidence <= 100, "Invalid confidence threshold");
        require(config.minActiveNodes > 0, "Invalid node count");
        
        _healthConfigs[protocol] = config;
    }

    /**
     * @dev Deregisters a protocol
     * @param protocol Address of the protocol to deregister
     */
    function deregisterProtocol(address protocol) external onlyRole(ADMIN_ROLE) {
        require(_integrations[protocol].isActive, "Protocol not registered");
        
        _integrations[protocol].isActive = false;
        _revokeRole(PROTOCOL_ROLE, protocol);
        
        // Remove from registered protocols array
        for (uint256 i = 0; i < _registeredProtocols.length; i++) {
            if (_registeredProtocols[i] == protocol) {
                _registeredProtocols[i] = _registeredProtocols[_registeredProtocols.length - 1];
                _registeredProtocols.pop();
                break;
            }
        }
        
        _totalIntegrations--;
        emit ProtocolDeregistered(protocol);
    }

    /**
     * @dev Returns all registered protocols
     */
    function getRegisteredProtocols() external view returns (address[] memory) {
        return _registeredProtocols;
    }

    /**
     * @dev Returns total number of integrations
     */
    function getTotalIntegrations() external view returns (uint256) {
        return _totalIntegrations;
    }

    // ============ INTERNAL HELPER FUNCTIONS ============

    /**
     * @dev Applies fee bounds to calculated fee
     */
    function _applyFeeBounds(
        uint256 amount,
        uint256 feeBps,
        FeeCalculationParams memory params
    ) internal pure returns (uint256) {
        // Ensure fee is within bounds
        uint256 boundedFeeBps = feeBps;
        if (boundedFeeBps < params.minFeeBps) {
            boundedFeeBps = params.minFeeBps;
        } else if (boundedFeeBps > params.maxFeeBps) {
            boundedFeeBps = params.maxFeeBps;
        }
        
        return (amount * boundedFeeBps) / 10000;
    }

    /**
     * @dev Calculates adjusted fee based on Oracle data
     */
    function _calculateAdjustedFee(
        uint256 baseFee,
        uint256 oracleFee,
        FeeCalculationParams memory params
    ) internal pure returns (uint256) {
        // Simple adjustment: average of base fee and Oracle fee
        uint256 adjustedFee = (baseFee + oracleFee) / 2;
        
        // Apply bounds
        if (adjustedFee < params.minFeeBps) {
            adjustedFee = params.minFeeBps;
        } else if (adjustedFee > params.maxFeeBps) {
            adjustedFee = params.maxFeeBps;
        }
        
        return adjustedFee;
    }

    /**
     * @dev Advanced fee bounds checking with dynamic adjustments
     */
    function _applyAdvancedFeeBounds(
        uint256 amount,
        uint256 feeBps,
        FeeCalculationParams memory params,
        IntegrationConfig memory config
    ) internal view returns (uint256) {
        // Apply volatility adjustments
        uint256 adjustedFeeBps = feeBps;

        // Time-based volatility adjustment
        uint256 timeSinceUpdate = block.timestamp - config.lastUpdate;
        if (timeSinceUpdate > config.updateFrequency * 2) {
            // Increase fee for stale data
            adjustedFeeBps = (adjustedFeeBps * 110) / 100; // 10% increase
        }

        // Apply bounds
        if (adjustedFeeBps < params.minFeeBps) {
            adjustedFeeBps = params.minFeeBps;
        } else if (adjustedFeeBps > params.maxFeeBps) {
            adjustedFeeBps = params.maxFeeBps;
        }

        return (amount * adjustedFeeBps) / 10000;
    }

    /**
     * @dev Dynamic fee adjustment based on Oracle data and market conditions
     */
    function _calculateDynamicAdjustedFee(
        uint256 baseFee,
        uint256 oracleFee,
        FeeCalculationParams memory params,
        IntegrationConfig memory config
    ) internal view returns (uint256) {
        // Weighted average based on data freshness
        uint256 timeSinceUpdate = block.timestamp - config.lastUpdate;
        uint256 oracleWeight = timeSinceUpdate < config.updateFrequency ? 70 : 30; // Fresh data gets higher weight

        uint256 adjustedFee = (baseFee * (100 - oracleWeight) + oracleFee * oracleWeight) / 100;

        // Apply volatility multiplier
        adjustedFee = (adjustedFee * params.volatilityMultiplier) / 100;

        // Apply bounds
        if (adjustedFee < params.minFeeBps) {
            adjustedFee = params.minFeeBps;
        } else if (adjustedFee > params.maxFeeBps) {
            adjustedFee = params.maxFeeBps;
        }

        return adjustedFee;
    }

    /**
     * @dev Apply volume-based discounts
     */
    function _applyVolumeDiscounts(
        address /* protocol */,
        uint256 amount,
        uint256 calculatedFee
    ) internal pure returns (uint256) {
        // Volume tiers for discounts
        if (amount >= 1000000 ether) { // > 1M
            return (calculatedFee * 80) / 100; // 20% discount
        } else if (amount >= 100000 ether) { // > 100K
            return (calculatedFee * 90) / 100; // 10% discount
        } else if (amount >= 10000 ether) { // > 10K
            return (calculatedFee * 95) / 100; // 5% discount
        }

        return calculatedFee; // No discount
    }

    /**
     * @dev Apply time-based adjustments (peak hours, etc.)
     */
    function _applyTimeBasedAdjustments(
        uint256 calculatedFee,
        IntegrationConfig memory /* config */
    ) internal view returns (uint256) {
        // Get current hour (0-23)
        uint256 currentHour = (block.timestamp / 3600) % 24;

        // Peak hours (9 AM - 5 PM UTC) get slight increase
        if (currentHour >= 9 && currentHour <= 17) {
            return (calculatedFee * 105) / 100; // 5% increase during peak hours
        }

        // Off-peak hours get slight discount
        if (currentHour >= 22 || currentHour <= 6) {
            return (calculatedFee * 95) / 100; // 5% discount during off-peak
        }

        return calculatedFee; // Normal hours
    }

    /**
     * @dev Returns contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
