// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

/**
 * @title INodeManager
 * @dev Interface for managing oracle nodes in the Quantlink system
 * @notice Handles node registration, rotation, and validation
 */
interface INodeManager {
    /**
     * @dev Enum representing different node states
     */
    enum NodeState {
        Inactive,
        Active,
        Submitter,
        Validator,
        Backup,
        Suspended
    }

    /**
     * @dev Struct representing an oracle node
     * @param nodeAddress Ethereum address of the node
     * @param publicKey Public key for signature verification
     * @param state Current state of the node
     * @param registrationTime When the node was registered
     * @param lastActiveTime Last time the node was active
     * @param submissionCount Total number of data submissions
     * @param consensusParticipation Number of consensus rounds participated
     * @param reputation Node reputation score (0-100)
     * @param isBackup Whether this node serves as a backup
     */
    struct OracleNode {
        address nodeAddress;
        bytes publicKey;
        NodeState state;
        uint256 registrationTime;
        uint256 lastActiveTime;
        uint256 submissionCount;
        uint256 consensusParticipation;
        uint8 reputation;
        bool isBackup;
        // Advanced metrics
        uint256 successfulSubmissions;
        uint256 failedSubmissions;
        uint256 averageResponseTime;
        uint256 uptime;
        uint256 lastDowntime;
        uint256 totalEarnings;
        uint8 performanceScore;
    }

    /**
     * @dev Struct for node rotation schedule
     * @param currentSubmitter Address of current submitter
     * @param nextSubmitter Address of next submitter
     * @param rotationTime When the next rotation should occur
     * @param rotationInterval Time between rotations (5 minutes)
     */
    struct RotationSchedule {
        address currentSubmitter;
        address nextSubmitter;
        uint256 rotationTime;
        uint256 rotationInterval;
    }

    // Events
    event NodeRegistered(address indexed node, bytes publicKey, uint256 timestamp);

    event NodeActivated(address indexed node, NodeState newState, uint256 timestamp);

    event NodeDeactivated(address indexed node, NodeState previousState, uint256 timestamp);

    event NodeSuspended(address indexed node, string reason, uint256 timestamp);

    event SubmitterRotated(
        address indexed oldSubmitter,
        address indexed newSubmitter,
        uint256 timestamp
    );

    event BackupNodeActivated(address indexed backupNode, address indexed failedNode, uint256 timestamp);

    event NodeReputationUpdated(address indexed node, uint8 oldReputation, uint8 newReputation);

    // View Functions
    function getNode(address nodeAddress) external view returns (OracleNode memory);

    function getAllActiveNodes() external view returns (address[] memory);

    function getSubmitterNodes() external view returns (address[] memory);

    function getValidatorNodes() external view returns (address[] memory);

    function getBackupNodes() external view returns (address[] memory);

    function getCurrentSubmitter() external view returns (address);

    function getNextSubmitter() external view returns (address);

    function getRotationSchedule() external view returns (RotationSchedule memory);

    function getTotalActiveNodes() external view returns (uint8);

    function isNodeActive(address node) external view returns (bool);

    function isNodeSubmitter(address node) external view returns (bool);

    function isNodeValidator(address node) external view returns (bool);

    function canNodeSubmit(address node) external view returns (bool);

    function getNodeReputation(address node) external view returns (uint8);

    // State-changing Functions
    function registerNode(address nodeAddress, bytes calldata publicKey) external;

    function activateNode(address nodeAddress, NodeState targetState) external;

    function deactivateNode(address nodeAddress) external;

    function suspendNode(address nodeAddress, string calldata reason) external;

    function rotateSubmitter() external returns (address newSubmitter);

    function activateBackupNode(address failedNode) external returns (address backupNode);

    function updateNodeReputation(address nodeAddress, uint8 newReputation) external;

    function recordNodeActivity(address nodeAddress) external;

    function recordConsensusParticipation(address nodeAddress) external;

    // Admin Functions
    function setRotationInterval(uint256 newInterval) external;

    function forceRotation(address newSubmitter) external;

    function emergencyActivateBackup(address failedNode, address backupNode) external;
}
