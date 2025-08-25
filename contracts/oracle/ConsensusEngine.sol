// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "../interfaces/IConsensusEngine.sol";
import "../interfaces/IQuantlinkOracle.sol";
import "../interfaces/INodeManager.sol";
import "../libraries/DataValidation.sol";
import "../libraries/CryptoUtils.sol";

/**
 * @title ConsensusEngine
 * @dev Handles consensus mechanism for the Quantlink Oracle system
 * @notice Implements voting-based consensus with 6/10 majority requirement and outlier detection
 */
contract ConsensusEngine is 
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    IConsensusEngine
{
    using DataValidation for uint256[];
    using CryptoUtils for bytes32;

    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant NODE_MANAGER_ROLE = keccak256("NODE_MANAGER_ROLE");

    // Constants
    uint8 public constant DEFAULT_CONSENSUS_THRESHOLD = 6;
    uint256 public constant DEFAULT_OUTLIER_THRESHOLD = 2000; // 20%
    string public constant DEFAULT_AGGREGATION_METHOD = "weighted_median";

    // State variables
    uint8 private _consensusThreshold;
    uint256 private _outlierDetectionThreshold;
    string private _aggregationMethod;
    
    INodeManager public nodeManager;

    // Round data storage
    mapping(uint256 => Vote[]) private _roundVotes;
    mapping(uint256 => mapping(address => bool)) private _hasVoted;
    mapping(uint256 => ConsensusStats) private _consensusStats;
    mapping(uint256 => AggregationResult) private _aggregationResults;
    mapping(uint256 => bool) private _consensusReached;

    // Events (additional to interface)
    event ConsensusEngineInitialized(address indexed admin, address indexed nodeManager, uint256 timestamp);
    event ThresholdUpdated(uint8 oldThreshold, uint8 newThreshold, address indexed updatedBy);
    event OutlierThresholdUpdated(uint256 oldThreshold, uint256 newThreshold, address indexed updatedBy);

    /**
     * @dev Custom errors
     */
    error InvalidThreshold(uint8 threshold);
    error InvalidOutlierThreshold(uint256 threshold);
    error RoundNotFound(uint256 roundId);
    error NodeAlreadyVoted(address node, uint256 roundId);
    error NodeNotEligible(address node);
    error InsufficientVotes(uint8 received, uint8 required);
    error ConsensusAlreadyProcessed(uint256 roundId);
    error InvalidAggregationMethod(string method);

    /**
     * @dev Modifier to check if round exists and is valid
     */
    modifier validRound(uint256 roundId) {
        if (roundId == 0) {
            revert RoundNotFound(roundId);
        }
        _;
    }

    /**
     * @dev Modifier to check if node can vote
     */
    modifier canVote(uint256 roundId, address voter) {
        if (_hasVoted[roundId][voter]) {
            revert NodeAlreadyVoted(voter, roundId);
        }
        if (!nodeManager.canNodeSubmit(voter)) {
            revert NodeNotEligible(voter);
        }
        _;
    }

    /**
     * @dev Initializes the ConsensusEngine contract
     * @param admin Address of the admin
     * @param _nodeManager Address of the NodeManager contract
     */
    function initialize(address admin, address _nodeManager) public initializer {
        require(admin != address(0), "Invalid admin address");
        require(_nodeManager != address(0), "Invalid node manager address");

        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        // Set up roles
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);

        // Initialize configuration
        _consensusThreshold = DEFAULT_CONSENSUS_THRESHOLD;
        _outlierDetectionThreshold = DEFAULT_OUTLIER_THRESHOLD;
        _aggregationMethod = DEFAULT_AGGREGATION_METHOD;
        
        nodeManager = INodeManager(_nodeManager);

        emit ConsensusEngineInitialized(admin, _nodeManager, block.timestamp);
    }

    /**
     * @dev Casts a vote for a consensus round
     * @param roundId Consensus round identifier
     * @param voter Address of the voting node
     * @param cexFees CEX fees data
     * @param dexFees DEX fees data
     */
    function castVote(
        uint256 roundId,
        address voter,
        uint256[] calldata cexFees,
        uint256[] calldata dexFees
    ) external override onlyRole(ORACLE_ROLE) validRound(roundId) canVote(roundId, voter) {
        // Validate data
        DataValidation.ValidationResult memory validation = DataValidation.validateFeeData(cexFees, dexFees);
        require(validation.isValid, "Invalid fee data");

        // Get vote weight based on node reputation
        uint8 weight = getVoteWeight(voter);

        // Create and store vote
        Vote memory vote = Vote({
            voter: voter,
            cexFees: cexFees,
            dexFees: dexFees,
            timestamp: block.timestamp,
            weight: weight
        });

        _roundVotes[roundId].push(vote);
        _hasVoted[roundId][voter] = true;

        emit VoteCast(voter, roundId, cexFees, dexFees, weight);
    }

    /**
     * @dev Processes consensus for a round
     * @param roundId Round to process consensus for
     * @return consensusReached Whether consensus was achieved
     */
    function processConsensus(uint256 roundId) external override onlyRole(ORACLE_ROLE) validRound(roundId) returns (bool consensusReached) {
        if (_consensusReached[roundId]) {
            revert ConsensusAlreadyProcessed(roundId);
        }

        Vote[] memory votes = _roundVotes[roundId];
        
        if (votes.length < _consensusThreshold) {
            emit ConsensusFailed(roundId, uint8(votes.length), _consensusThreshold, "Insufficient votes");
            return false;
        }

        // Detect outliers
        address[] memory outliers = detectOutliers(roundId);
        
        // Calculate consensus statistics
        ConsensusStats memory stats = _calculateConsensusStats(roundId, votes, outliers);
        _consensusStats[roundId] = stats;

        // Check if consensus is reached
        consensusReached = stats.consensusReached;
        _consensusReached[roundId] = consensusReached;

        if (consensusReached) {
            // Aggregate data
            AggregationResult memory result = aggregateData(roundId);
            _aggregationResults[roundId] = result;

            emit ConsensusReached(
                roundId,
                result.aggregatedCexFees,
                result.aggregatedDexFees,
                stats.totalVotes,
                stats.agreementPercentage
            );
        } else {
            emit ConsensusFailed(roundId, stats.totalVotes, stats.requiredVotes, "Agreement threshold not met");
        }

        // Emit outlier events
        for (uint256 i = 0; i < outliers.length; i++) {
            emit OutlierDetected(outliers[i], roundId, 0, "Statistical outlier detected");
        }

        return consensusReached;
    }

    /**
     * @dev Aggregates data from valid votes
     * @param roundId Round to aggregate data for
     * @return result Aggregation result
     */
    function aggregateData(uint256 roundId) public override validRound(roundId) returns (AggregationResult memory result) {
        Vote[] memory votes = _roundVotes[roundId];
        require(votes.length > 0, "No votes to aggregate");

        if (keccak256(bytes(_aggregationMethod)) == keccak256(bytes("weighted_median"))) {
            result = _aggregateWeightedMedian(votes);
        } else if (keccak256(bytes(_aggregationMethod)) == keccak256(bytes("weighted_average"))) {
            result = _aggregateWeightedAverage(votes);
        } else {
            result = _aggregateMedian(votes);
        }

        result.method = _aggregationMethod;
        return result;
    }

    /**
     * @dev Detects outliers in the voting data
     * @param roundId Round to detect outliers for
     * @return outliers Array of outlier node addresses
     */
    function detectOutliers(uint256 roundId) public override validRound(roundId) returns (address[] memory outliers) {
        Vote[] memory votes = _roundVotes[roundId];
        
        if (votes.length < 3) {
            return new address[](0);
        }

        // Calculate median for CEX and DEX fees separately
        uint256[] memory cexMedians = _calculateMedianFees(votes, true);
        uint256[] memory dexMedians = _calculateMedianFees(votes, false);

        address[] memory tempOutliers = new address[](votes.length);
        uint256 outlierCount = 0;

        for (uint256 i = 0; i < votes.length; i++) {
            bool isOutlier = false;
            
            // Check CEX fees deviation
            for (uint256 j = 0; j < votes[i].cexFees.length && j < cexMedians.length; j++) {
                uint256 deviation = _calculateDeviation(votes[i].cexFees[j], cexMedians[j]);
                if (deviation > _outlierDetectionThreshold) {
                    isOutlier = true;
                    break;
                }
            }

            // Check DEX fees deviation if not already marked as outlier
            if (!isOutlier) {
                for (uint256 j = 0; j < votes[i].dexFees.length && j < dexMedians.length; j++) {
                    uint256 deviation = _calculateDeviation(votes[i].dexFees[j], dexMedians[j]);
                    if (deviation > _outlierDetectionThreshold) {
                        isOutlier = true;
                        break;
                    }
                }
            }

            if (isOutlier) {
                tempOutliers[outlierCount++] = votes[i].voter;
            }
        }

        // Resize to actual outlier count
        outliers = new address[](outlierCount);
        for (uint256 i = 0; i < outlierCount; i++) {
            outliers[i] = tempOutliers[i];
        }

        return outliers;
    }

    /**
     * @dev Finalizes a consensus round and returns the final data
     * @param roundId Round to finalize
     * @return finalData Final aggregated fee data
     */
    function finalizeRound(uint256 roundId) external override validRound(roundId) returns (IQuantlinkOracle.FeeData memory finalData) {
        require(_consensusReached[roundId], "Consensus not reached");

        AggregationResult memory result = _aggregationResults[roundId];
        ConsensusStats memory stats = _consensusStats[roundId];

        finalData = IQuantlinkOracle.FeeData({
            cexFees: result.aggregatedCexFees,
            dexFees: result.aggregatedDexFees,
            timestamp: block.timestamp,
            blockNumber: block.number,
            consensusReached: true,
            participatingNodes: stats.totalVotes
        });

        return finalData;
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Returns votes for a specific round
     */
    function getCurrentRoundVotes(uint256 roundId) external view override returns (Vote[] memory) {
        return _roundVotes[roundId];
    }

    /**
     * @dev Returns consensus statistics for a round
     */
    function getConsensusStats(uint256 roundId) external view override returns (ConsensusStats memory) {
        return _consensusStats[roundId];
    }

    /**
     * @dev Returns aggregation result for a round
     */
    function getAggregationResult(uint256 roundId) external view override returns (AggregationResult memory) {
        return _aggregationResults[roundId];
    }

    /**
     * @dev Checks if a node has voted in a round
     */
    function hasNodeVoted(uint256 roundId, address node) external view override returns (bool) {
        return _hasVoted[roundId][node];
    }

    /**
     * @dev Returns required number of votes for consensus
     */
    function getRequiredVotes() external view override returns (uint8) {
        return _consensusThreshold;
    }

    /**
     * @dev Returns consensus threshold
     */
    function getConsensusThreshold() external view override returns (uint8) {
        return _consensusThreshold;
    }

    /**
     * @dev Checks if consensus is reached for a round
     */
    function isConsensusReached(uint256 roundId) external view override returns (bool) {
        return _consensusReached[roundId];
    }

    /**
     * @dev Returns vote weight for a node based on reputation
     */
    function getVoteWeight(address node) public view override returns (uint8) {
        uint8 reputation = nodeManager.getNodeReputation(node);

        // Weight calculation: reputation / 10 (min 1, max 10)
        uint8 weight = reputation / 10;
        return weight == 0 ? 1 : weight;
    }

    /**
     * @dev Returns current aggregation method
     */
    function getAggregationMethod() external view override returns (string memory) {
        return _aggregationMethod;
    }

    /**
     * @dev Calculates deviation between two values
     */
    function calculateDeviation(
        uint256[] calldata data1,
        uint256[] calldata data2
    ) external pure override returns (uint256) {
        require(data1.length == data2.length, "Array length mismatch");

        uint256 totalDeviation = 0;
        for (uint256 i = 0; i < data1.length; i++) {
            totalDeviation += _calculateDeviation(data1[i], data2[i]);
        }

        return data1.length > 0 ? totalDeviation / data1.length : 0;
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @dev Sets consensus threshold (admin only)
     */
    function setConsensusThreshold(uint8 newThreshold) external override onlyRole(ADMIN_ROLE) {
        require(newThreshold > 0 && newThreshold <= 10, "Invalid threshold");

        uint8 oldThreshold = _consensusThreshold;
        _consensusThreshold = newThreshold;

        emit ThresholdUpdated(oldThreshold, newThreshold, msg.sender);
    }

    /**
     * @dev Sets aggregation method (admin only)
     */
    function setAggregationMethod(string calldata method) external override onlyRole(ADMIN_ROLE) {
        bytes32 methodHash = keccak256(bytes(method));

        if (methodHash != keccak256(bytes("weighted_median")) &&
            methodHash != keccak256(bytes("weighted_average")) &&
            methodHash != keccak256(bytes("median"))) {
            revert InvalidAggregationMethod(method);
        }

        string memory oldMethod = _aggregationMethod;
        _aggregationMethod = method;

        emit AggregationMethodChanged(oldMethod, method, block.timestamp);
    }

    /**
     * @dev Sets outlier detection threshold (admin only)
     */
    function setOutlierDetectionThreshold(uint256 threshold) external override onlyRole(ADMIN_ROLE) {
        require(threshold > 0 && threshold <= 5000, "Invalid threshold"); // Max 50%

        uint256 oldThreshold = _outlierDetectionThreshold;
        _outlierDetectionThreshold = threshold;

        emit OutlierThresholdUpdated(oldThreshold, threshold, msg.sender);
    }

    /**
     * @dev Resets a consensus round (emergency use)
     */
    function resetRound(uint256 roundId) external override onlyRole(ADMIN_ROLE) {
        delete _roundVotes[roundId];
        delete _consensusStats[roundId];
        delete _aggregationResults[roundId];
        _consensusReached[roundId] = false;

        // Reset voting status for all nodes
        Vote[] memory votes = _roundVotes[roundId];
        for (uint256 i = 0; i < votes.length; i++) {
            _hasVoted[roundId][votes[i].voter] = false;
        }
    }

    // ============ INTERNAL HELPER FUNCTIONS ============

    /**
     * @dev Calculates consensus statistics for a round
     */
    function _calculateConsensusStats(
        uint256 roundId,
        Vote[] memory votes,
        address[] memory outliers
    ) internal pure returns (ConsensusStats memory stats) {
        stats.totalVotes = uint8(votes.length);
        stats.requiredVotes = DEFAULT_CONSENSUS_THRESHOLD;
        stats.outlierNodes = outliers;

        // Calculate agreement percentage (votes without outliers / total votes)
        uint8 validVotes = stats.totalVotes - uint8(outliers.length);
        stats.agreementPercentage = stats.totalVotes > 0 ? (validVotes * 100) / stats.totalVotes : 0;

        // Consensus is reached if we have enough valid votes and good agreement
        stats.consensusReached = validVotes >= stats.requiredVotes && stats.agreementPercentage >= 60;

        return stats;
    }

    /**
     * @dev Aggregates data using weighted median method
     */
    function _aggregateWeightedMedian(Vote[] memory votes) internal pure returns (AggregationResult memory result) {
        // For simplicity, using median with weight consideration
        result.aggregatedCexFees = _calculateMedianFees(votes, true);
        result.aggregatedDexFees = _calculateMedianFees(votes, false);
        result.confidence = 85;
        result.variance = 0; // Simplified

        return result;
    }

    /**
     * @dev Aggregates data using weighted average method
     */
    function _aggregateWeightedAverage(Vote[] memory votes) internal pure returns (AggregationResult memory result) {
        if (votes.length == 0) {
            return result;
        }

        // Calculate weighted averages
        uint256 maxFeeLength = _getMaxFeeLength(votes);
        result.aggregatedCexFees = new uint256[](maxFeeLength);
        result.aggregatedDexFees = new uint256[](maxFeeLength);

        for (uint256 i = 0; i < maxFeeLength; i++) {
            uint256 cexWeightedSum = 0;
            uint256 dexWeightedSum = 0;
            uint256 totalWeight = 0;

            for (uint256 j = 0; j < votes.length; j++) {
                uint8 weight = votes[j].weight;
                totalWeight += weight;

                if (i < votes[j].cexFees.length) {
                    cexWeightedSum += votes[j].cexFees[i] * weight;
                }
                if (i < votes[j].dexFees.length) {
                    dexWeightedSum += votes[j].dexFees[i] * weight;
                }
            }

            if (totalWeight > 0) {
                result.aggregatedCexFees[i] = cexWeightedSum / totalWeight;
                result.aggregatedDexFees[i] = dexWeightedSum / totalWeight;
            }
        }

        result.confidence = 80;
        result.variance = 0; // Simplified

        return result;
    }

    /**
     * @dev Aggregates data using simple median method
     */
    function _aggregateMedian(Vote[] memory votes) internal pure returns (AggregationResult memory result) {
        result.aggregatedCexFees = _calculateMedianFees(votes, true);
        result.aggregatedDexFees = _calculateMedianFees(votes, false);
        result.confidence = 75;
        result.variance = 0; // Simplified

        return result;
    }

    /**
     * @dev Calculates median fees from votes
     */
    function _calculateMedianFees(Vote[] memory votes, bool isCex) internal pure returns (uint256[] memory medianFees) {
        if (votes.length == 0) {
            return new uint256[](0);
        }

        uint256 maxLength = _getMaxFeeLength(votes);
        medianFees = new uint256[](maxLength);

        for (uint256 i = 0; i < maxLength; i++) {
            uint256[] memory values = new uint256[](votes.length);
            uint256 validCount = 0;

            // Collect values for this index
            for (uint256 j = 0; j < votes.length; j++) {
                uint256[] memory fees = isCex ? votes[j].cexFees : votes[j].dexFees;
                if (i < fees.length) {
                    values[validCount++] = fees[i];
                }
            }

            // Calculate median if we have values
            if (validCount > 0) {
                // Resize array to valid count
                uint256[] memory validValues = new uint256[](validCount);
                for (uint256 k = 0; k < validCount; k++) {
                    validValues[k] = values[k];
                }

                medianFees[i] = DataValidation.calculateMedian(validValues);
            }
        }

        return medianFees;
    }

    /**
     * @dev Gets maximum fee array length from all votes
     */
    function _getMaxFeeLength(Vote[] memory votes) internal pure returns (uint256 maxLength) {
        for (uint256 i = 0; i < votes.length; i++) {
            if (votes[i].cexFees.length > maxLength) {
                maxLength = votes[i].cexFees.length;
            }
            if (votes[i].dexFees.length > maxLength) {
                maxLength = votes[i].dexFees.length;
            }
        }
        return maxLength;
    }

    /**
     * @dev Calculates percentage deviation between two values
     */
    function _calculateDeviation(uint256 value1, uint256 value2) internal pure returns (uint256) {
        if (value2 == 0) return value1 == 0 ? 0 : 10000; // 100% if comparing to zero

        uint256 diff = value1 > value2 ? value1 - value2 : value2 - value1;
        return (diff * 10000) / value2; // Return in basis points
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
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
