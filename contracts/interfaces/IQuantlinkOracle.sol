// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

/**
 * @title IQuantlinkOracle
 * @dev Interface for the Quantlink Oracle system providing CEX/DEX fee data aggregation
 * @notice This interface defines the core functionality for accessing oracle data
 */
interface IQuantlinkOracle {
    /**
     * @dev Struct representing fee data from exchanges
     * @param cexFees Array of centralized exchange fees (in basis points)
     * @param dexFees Array of decentralized exchange fees (in basis points)
     * @param timestamp Unix timestamp when data was last updated
     * @param blockNumber Block number when data was last updated
     * @param consensusReached Whether consensus was reached for this data
     * @param participatingNodes Number of nodes that participated in consensus
     */
    struct FeeData {
        uint256[] cexFees;
        uint256[] dexFees;
        uint256 timestamp;
        uint256 blockNumber;
        bool consensusReached;
        uint8 participatingNodes;
    }

    /**
     * @dev Struct representing a data submission from an oracle node
     * @param nodeAddress Address of the submitting node
     * @param cexFees Array of CEX fees submitted
     * @param dexFees Array of DEX fees submitted
     * @param timestamp Submission timestamp
     * @param signature Cryptographic signature of the submission
     */
    struct DataSubmission {
        address nodeAddress;
        uint256[] cexFees;
        uint256[] dexFees;
        uint256 timestamp;
        bytes signature;
    }

    /**
     * @dev Struct representing consensus round information
     * @param roundId Unique identifier for the consensus round
     * @param startTime When the consensus round started
     * @param endTime When the consensus round ended
     * @param submissionsCount Number of submissions received
     * @param consensusReached Whether consensus was achieved
     * @param finalData The agreed-upon data if consensus was reached
     */
    struct ConsensusRound {
        uint256 roundId;
        uint256 startTime;
        uint256 endTime;
        uint8 submissionsCount;
        bool consensusReached;
        FeeData finalData;
    }

    // Events
    event DataSubmitted(
        address indexed node,
        uint256 indexed roundId,
        uint256[] cexFees,
        uint256[] dexFees,
        uint256 timestamp
    );

    event ConsensusReached(
        uint256 indexed roundId,
        uint256[] cexFees,
        uint256[] dexFees,
        uint8 participatingNodes,
        uint256 timestamp
    );

    event ConsensusRoundStarted(uint256 indexed roundId, uint256 startTime);

    event ConsensusRoundEnded(uint256 indexed roundId, uint256 endTime, bool consensusReached);

    event NodeRotated(address indexed oldSubmitter, address indexed newSubmitter, uint256 timestamp);

    event EmergencyPaused(address indexed admin, uint256 timestamp);

    event EmergencyUnpaused(address indexed admin, uint256 timestamp);

    event ConsensusFailed(
        uint256 indexed roundId,
        uint8 submissionsReceived,
        uint8 requiredSubmissions,
        string reason
    );

    // View Functions
    function getLatestFeeData() external view returns (FeeData memory);

    function getFeeDataAtRound(uint256 roundId) external view returns (FeeData memory);

    function getCurrentRound() external view returns (ConsensusRound memory);

    function getConsensusThreshold() external view returns (uint8);

    function getTotalNodes() external view returns (uint8);

    function getUpdateInterval() external view returns (uint256);

    function isNodeActive(address node) external view returns (bool);

    function getCurrentSubmitter() external view returns (address);

    function getNextRotationTime() external view returns (uint256);

    // State-changing Functions
    function submitData(
        uint256[] calldata cexFees,
        uint256[] calldata dexFees,
        bytes calldata signature
    ) external;

    function processConsensus() external;

    function rotateSubmitter() external;

    // Admin Functions
    function addNode(address node) external;

    function removeNode(address node) external;

    function updateConsensusThreshold(uint8 newThreshold) external;

    function updateUpdateInterval(uint256 newInterval) external;

    function emergencyPause() external;

    function emergencyUnpause() external;
}
