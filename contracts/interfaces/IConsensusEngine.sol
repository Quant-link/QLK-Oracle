// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

import "./IQuantlinkOracle.sol";

/**
 * @title IConsensusEngine
 * @dev Interface for the consensus mechanism in the Quantlink Oracle system
 * @notice Handles voting, aggregation, and consensus validation
 */
interface IConsensusEngine {
    /**
     * @dev Struct representing a vote in the consensus process
     * @param voter Address of the voting node
     * @param cexFees Voted CEX fees
     * @param dexFees Voted DEX fees
     * @param timestamp When the vote was cast
     * @param weight Weight of this vote (based on node reputation)
     */
    struct Vote {
        address voter;
        uint256[] cexFees;
        uint256[] dexFees;
        uint256 timestamp;
        uint8 weight;
    }

    /**
     * @dev Struct representing consensus statistics
     * @param totalVotes Total number of votes received
     * @param requiredVotes Minimum votes needed for consensus
     * @param consensusReached Whether consensus was achieved
     * @param agreementPercentage Percentage of nodes in agreement
     * @param outlierNodes Nodes whose data significantly deviated
     */
    struct ConsensusStats {
        uint8 totalVotes;
        uint8 requiredVotes;
        bool consensusReached;
        uint8 agreementPercentage;
        address[] outlierNodes;
    }

    /**
     * @dev Struct for data aggregation results
     * @param aggregatedCexFees Final aggregated CEX fees
     * @param aggregatedDexFees Final aggregated DEX fees
     * @param confidence Confidence level in the aggregated data (0-100)
     * @param variance Statistical variance in the submitted data
     * @param method Aggregation method used (median, weighted average, etc.)
     */
    struct AggregationResult {
        uint256[] aggregatedCexFees;
        uint256[] aggregatedDexFees;
        uint8 confidence;
        uint256 variance;
        string method;
    }

    // Events
    event VoteCast(
        address indexed voter,
        uint256 indexed roundId,
        uint256[] cexFees,
        uint256[] dexFees,
        uint8 weight
    );

    event ConsensusReached(
        uint256 indexed roundId,
        uint256[] finalCexFees,
        uint256[] finalDexFees,
        uint8 participatingNodes,
        uint8 agreementPercentage
    );

    event ConsensusFailed(
        uint256 indexed roundId,
        uint8 totalVotes,
        uint8 requiredVotes,
        string reason
    );

    event OutlierDetected(
        address indexed node,
        uint256 indexed roundId,
        uint256 deviation,
        string reason
    );

    event AggregationMethodChanged(string oldMethod, string newMethod, uint256 timestamp);

    // View Functions
    function getCurrentRoundVotes(uint256 roundId) external view returns (Vote[] memory);

    function getConsensusStats(uint256 roundId) external view returns (ConsensusStats memory);

    function getAggregationResult(uint256 roundId) external view returns (AggregationResult memory);

    function hasNodeVoted(uint256 roundId, address node) external view returns (bool);

    function getRequiredVotes() external view returns (uint8);

    function getConsensusThreshold() external view returns (uint8);

    function isConsensusReached(uint256 roundId) external view returns (bool);

    function getVoteWeight(address node) external view returns (uint8);

    function getAggregationMethod() external view returns (string memory);

    function calculateDeviation(
        uint256[] calldata data1,
        uint256[] calldata data2
    ) external pure returns (uint256);

    // State-changing Functions
    function castVote(
        uint256 roundId,
        address voter,
        uint256[] calldata cexFees,
        uint256[] calldata dexFees
    ) external;

    function processConsensus(uint256 roundId) external returns (bool consensusReached);

    function aggregateData(uint256 roundId) external returns (AggregationResult memory);

    function detectOutliers(uint256 roundId) external returns (address[] memory outliers);

    function finalizeRound(uint256 roundId) external returns (IQuantlinkOracle.FeeData memory);

    // Admin Functions
    function setConsensusThreshold(uint8 newThreshold) external;

    function setAggregationMethod(string calldata method) external;

    function setOutlierDetectionThreshold(uint256 threshold) external;

    function resetRound(uint256 roundId) external;
}
