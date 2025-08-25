// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "../interfaces/INodeManager.sol";
import "../libraries/CryptoUtils.sol";

/**
 * @title NodeManager
 * @dev Manages oracle nodes in the Quantlink system with rotation and backup mechanisms
 * @notice Handles 10-node network with submitter/validator roles and 5-minute rotation
 */
contract NodeManager is 
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    INodeManager
{
    using CryptoUtils for bytes32;

    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // Constants
    uint8 public constant MAX_NODES = 10;
    uint8 public constant MIN_ACTIVE_NODES = 1;
    uint256 public constant DEFAULT_ROTATION_INTERVAL = 300; // 5 minutes
    uint8 public constant MIN_REPUTATION = 50;
    uint8 public constant MAX_REPUTATION = 100;

    // State variables
    mapping(address => OracleNode) private _nodes;
    address[] private _activeNodes;
    address[] private _submitterNodes;
    address[] private _validatorNodes;
    address[] private _backupNodes;
    
    RotationSchedule private _rotationSchedule;
    uint256 private _totalRegisteredNodes;
    uint256 private _rotationCounter;

    // Events (additional to interface)
    event NodeManagerInitialized(address indexed admin, uint256 timestamp);
    event RotationIntervalUpdated(uint256 oldInterval, uint256 newInterval, address indexed updatedBy);
    event NodeReputationDecayed(address indexed node, uint8 oldReputation, uint8 newReputation);
    event EmergencyNodeActivation(address indexed node, string reason, uint256 timestamp);
    event NodePerformanceUpdated(address indexed node, uint8 performanceScore, string reason);
    event NodeDowntimeRecorded(address indexed node, uint256 downtimeStart, uint256 downtimeEnd);

    /**
     * @dev Custom errors
     */
    error MaxNodesReached(uint8 current, uint8 maximum);
    error NodeNotFound(address node);
    error NodeAlreadyRegistered(address node);
    error InsufficientActiveNodes(uint8 current, uint8 minimum);
    error InvalidRotationInterval(uint256 interval);
    error NoEligibleSubmitters();
    error InvalidReputation(uint8 reputation);
    error RotationTooEarly(uint256 currentTime, uint256 nextRotationTime);

    /**
     * @dev Modifier to check if node exists
     */
    modifier nodeExists(address nodeAddress) {
        if (_nodes[nodeAddress].nodeAddress == address(0)) {
            revert NodeNotFound(nodeAddress);
        }
        _;
    }

    /**
     * @dev Modifier to check rotation timing
     */
    modifier onlyDuringRotationWindow() {
        if (block.timestamp < _rotationSchedule.rotationTime) {
            revert RotationTooEarly(block.timestamp, _rotationSchedule.rotationTime);
        }
        _;
    }

    /**
     * @dev Initializes the NodeManager contract
     * @param admin Address of the admin
     */
    function initialize(address admin) public initializer {
        require(admin != address(0), "Invalid admin address");

        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        // Set up roles
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(EMERGENCY_ROLE, admin);

        // Initialize rotation schedule
        _rotationSchedule = RotationSchedule({
            currentSubmitter: address(0),
            nextSubmitter: address(0),
            rotationTime: block.timestamp + DEFAULT_ROTATION_INTERVAL,
            rotationInterval: DEFAULT_ROTATION_INTERVAL
        });

        emit NodeManagerInitialized(admin, block.timestamp);
    }

    /**
     * @dev Registers a new oracle node
     * @param nodeAddress Address of the node to register
     * @param publicKey Public key for signature verification
     */
    function registerNode(
        address nodeAddress,
        bytes calldata publicKey
    ) external override onlyRole(ADMIN_ROLE) {
        if (_nodes[nodeAddress].nodeAddress != address(0)) {
            revert NodeAlreadyRegistered(nodeAddress);
        }
        
        if (_totalRegisteredNodes >= MAX_NODES) {
            revert MaxNodesReached(uint8(_totalRegisteredNodes), MAX_NODES);
        }

        // Verify public key if provided
        if (publicKey.length > 0 && !CryptoUtils.verifyPublicKey(publicKey, nodeAddress)) {
            revert CryptoUtils.InvalidPublicKey();
        }

        _nodes[nodeAddress] = OracleNode({
            nodeAddress: nodeAddress,
            publicKey: publicKey,
            state: NodeState.Inactive,
            registrationTime: block.timestamp,
            lastActiveTime: 0,
            submissionCount: 0,
            consensusParticipation: 0,
            reputation: 75, // Start with medium reputation
            isBackup: false,
            // Initialize advanced metrics
            successfulSubmissions: 0,
            failedSubmissions: 0,
            averageResponseTime: 0,
            uptime: 0,
            lastDowntime: 0,
            totalEarnings: 0,
            performanceScore: 75
        });

        _totalRegisteredNodes++;

        emit NodeRegistered(nodeAddress, publicKey, block.timestamp);
    }

    /**
     * @dev Activates a node with a specific role
     * @param nodeAddress Address of the node to activate
     * @param targetState Target state for the node
     */
    function activateNode(
        address nodeAddress,
        NodeState targetState
    ) external override onlyRole(ADMIN_ROLE) nodeExists(nodeAddress) {
        OracleNode storage node = _nodes[nodeAddress];
        NodeState previousState = node.state;

        // Remove from previous role arrays
        _removeFromRoleArrays(nodeAddress, previousState);

        // Update node state
        node.state = targetState;
        node.lastActiveTime = block.timestamp;

        // Add to appropriate role arrays
        if (targetState == NodeState.Active || targetState == NodeState.Submitter || targetState == NodeState.Validator) {
            _activeNodes.push(nodeAddress);
        }

        if (targetState == NodeState.Submitter) {
            _submitterNodes.push(nodeAddress);
            
            // Set as current submitter if none exists
            if (_rotationSchedule.currentSubmitter == address(0)) {
                _rotationSchedule.currentSubmitter = nodeAddress;
                _rotationSchedule.rotationTime = block.timestamp + _rotationSchedule.rotationInterval;
            }
        } else if (targetState == NodeState.Validator) {
            _validatorNodes.push(nodeAddress);
        } else if (targetState == NodeState.Backup) {
            _backupNodes.push(nodeAddress);
            node.isBackup = true;
        }

        emit NodeActivated(nodeAddress, targetState, block.timestamp);
    }

    /**
     * @dev Deactivates a node
     * @param nodeAddress Address of the node to deactivate
     */
    function deactivateNode(address nodeAddress) external override onlyRole(ADMIN_ROLE) nodeExists(nodeAddress) {
        OracleNode storage node = _nodes[nodeAddress];
        NodeState previousState = node.state;

        // Check if deactivation would leave insufficient active nodes
        if (_getActiveNodeCount() <= MIN_ACTIVE_NODES) {
            revert InsufficientActiveNodes(_getActiveNodeCount() - 1, MIN_ACTIVE_NODES);
        }

        // Remove from role arrays
        _removeFromRoleArrays(nodeAddress, previousState);

        // Update node state
        node.state = NodeState.Inactive;
        node.isBackup = false;

        // Handle submitter rotation if current submitter is being deactivated
        if (_rotationSchedule.currentSubmitter == nodeAddress) {
            _forceRotateSubmitter();
        }

        emit NodeDeactivated(nodeAddress, previousState, block.timestamp);
    }

    /**
     * @dev Suspends a node for misconduct
     * @param nodeAddress Address of the node to suspend
     * @param reason Reason for suspension
     */
    function suspendNode(
        address nodeAddress,
        string calldata reason
    ) external override onlyRole(ADMIN_ROLE) nodeExists(nodeAddress) {
        OracleNode storage node = _nodes[nodeAddress];
        NodeState previousState = node.state;

        // Remove from role arrays
        _removeFromRoleArrays(nodeAddress, previousState);

        // Update node state
        node.state = NodeState.Suspended;
        node.reputation = node.reputation > 20 ? node.reputation - 20 : 0;

        // Handle submitter rotation if current submitter is being suspended
        if (_rotationSchedule.currentSubmitter == nodeAddress) {
            _forceRotateSubmitter();
        }

        emit NodeSuspended(nodeAddress, reason, block.timestamp);
    }

    /**
     * @dev Rotates the current submitter to the next eligible node
     */
    function rotateSubmitter() 
        external 
        override 
        onlyRole(ORACLE_ROLE) 
        onlyDuringRotationWindow 
        returns (address newSubmitter) 
    {
        return _rotateSubmitter();
    }

    /**
     * @dev Internal function to rotate submitter
     */
    function _rotateSubmitter() internal returns (address newSubmitter) {
        address currentSubmitter = _rotationSchedule.currentSubmitter;
        
        // Find next eligible submitter
        newSubmitter = _findNextSubmitter();
        if (newSubmitter == address(0)) {
            revert NoEligibleSubmitters();
        }

        // Update rotation schedule
        _rotationSchedule.currentSubmitter = newSubmitter;
        _rotationSchedule.nextSubmitter = _findNextSubmitter();
        _rotationSchedule.rotationTime = block.timestamp + _rotationSchedule.rotationInterval;
        _rotationCounter++;

        // Update node states
        if (currentSubmitter != address(0)) {
            _nodes[currentSubmitter].state = NodeState.Validator;
            _removeFromArray(_submitterNodes, currentSubmitter);
            _validatorNodes.push(currentSubmitter);
        }

        _nodes[newSubmitter].state = NodeState.Submitter;
        _removeFromArray(_validatorNodes, newSubmitter);
        _submitterNodes.push(newSubmitter);

        emit SubmitterRotated(currentSubmitter, newSubmitter, block.timestamp);
        return newSubmitter;
    }

    /**
     * @dev Forces submitter rotation (emergency use)
     */
    function _forceRotateSubmitter() internal {
        address newSubmitter = _findNextSubmitter();
        if (newSubmitter != address(0)) {
            _rotationSchedule.currentSubmitter = newSubmitter;
            _rotationSchedule.rotationTime = block.timestamp + _rotationSchedule.rotationInterval;
            
            _nodes[newSubmitter].state = NodeState.Submitter;
            emit SubmitterRotated(address(0), newSubmitter, block.timestamp);
        }
    }

    /**
     * @dev Activates a backup node when a primary node fails
     * @param failedNode Address of the failed node
     */
    function activateBackupNode(address failedNode) external override onlyRole(ORACLE_ROLE) returns (address backupNode) {
        // Find an available backup node
        for (uint256 i = 0; i < _backupNodes.length; i++) {
            address candidate = _backupNodes[i];
            if (_nodes[candidate].state == NodeState.Backup && _nodes[candidate].reputation >= MIN_REPUTATION) {
                backupNode = candidate;
                break;
            }
        }

        if (backupNode == address(0)) {
            revert NoEligibleSubmitters();
        }

        // Activate backup node as validator
        _nodes[backupNode].state = NodeState.Validator;
        _nodes[backupNode].isBackup = false;
        _removeFromArray(_backupNodes, backupNode);
        _validatorNodes.push(backupNode);
        _activeNodes.push(backupNode);

        // Deactivate failed node if it exists
        if (failedNode != address(0) && _nodes[failedNode].nodeAddress != address(0)) {
            _removeFromRoleArrays(failedNode, _nodes[failedNode].state);
            _nodes[failedNode].state = NodeState.Suspended;
            _nodes[failedNode].reputation = _nodes[failedNode].reputation > 30 ? _nodes[failedNode].reputation - 30 : 0;
        }

        emit BackupNodeActivated(backupNode, failedNode, block.timestamp);
        return backupNode;
    }

    /**
     * @dev Updates node reputation based on performance
     * @param nodeAddress Address of the node
     * @param newReputation New reputation score (0-100)
     */
    function updateNodeReputation(
        address nodeAddress,
        uint8 newReputation
    ) external override onlyRole(ORACLE_ROLE) nodeExists(nodeAddress) {
        if (newReputation > MAX_REPUTATION) {
            revert InvalidReputation(newReputation);
        }

        OracleNode storage node = _nodes[nodeAddress];
        uint8 oldReputation = node.reputation;
        node.reputation = newReputation;

        emit NodeReputationUpdated(nodeAddress, oldReputation, newReputation);

        // Suspend node if reputation falls too low
        if (newReputation < MIN_REPUTATION && node.state != NodeState.Suspended) {
            this.suspendNode(nodeAddress, "Low reputation");
        }
    }

    /**
     * @dev Records node activity for reputation tracking
     * @param nodeAddress Address of the active node
     */
    function recordNodeActivity(address nodeAddress) external override onlyRole(ORACLE_ROLE) nodeExists(nodeAddress) {
        OracleNode storage node = _nodes[nodeAddress];
        node.lastActiveTime = block.timestamp;
        node.submissionCount++;

        // Increase reputation for consistent activity
        if (node.reputation < MAX_REPUTATION) {
            node.reputation = node.reputation + 1 > MAX_REPUTATION ? MAX_REPUTATION : node.reputation + 1;
        }
    }

    /**
     * @dev Records consensus participation for reputation tracking
     * @param nodeAddress Address of the participating node
     */
    function recordConsensusParticipation(
        address nodeAddress
    ) external override onlyRole(ORACLE_ROLE) nodeExists(nodeAddress) {
        OracleNode storage node = _nodes[nodeAddress];
        node.consensusParticipation++;
        node.successfulSubmissions++;

        // Increase reputation for consensus participation
        if (node.reputation < MAX_REPUTATION) {
            node.reputation = node.reputation + 2 > MAX_REPUTATION ? MAX_REPUTATION : node.reputation + 2;
        }

        // Update performance score
        _updatePerformanceScore(nodeAddress);
    }

    /**
     * @dev Records failed submission for a node
     */
    function recordFailedSubmission(address nodeAddress, string calldata reason) external onlyRole(ORACLE_ROLE) nodeExists(nodeAddress) {
        OracleNode storage node = _nodes[nodeAddress];
        node.failedSubmissions++;

        // Decrease reputation for failed submission
        if (node.reputation > 0) {
            node.reputation = node.reputation > 5 ? node.reputation - 5 : 0;
        }

        // Update performance score
        _updatePerformanceScore(nodeAddress);

        emit NodePerformanceUpdated(nodeAddress, node.performanceScore, reason);
    }

    /**
     * @dev Records node response time
     */
    function recordResponseTime(address nodeAddress, uint256 responseTime) external onlyRole(ORACLE_ROLE) nodeExists(nodeAddress) {
        OracleNode storage node = _nodes[nodeAddress];

        // Calculate rolling average response time
        if (node.averageResponseTime == 0) {
            node.averageResponseTime = responseTime;
        } else {
            // Weighted average: 80% old, 20% new
            node.averageResponseTime = (node.averageResponseTime * 80 + responseTime * 20) / 100;
        }

        // Update performance score based on response time
        _updatePerformanceScore(nodeAddress);
    }

    /**
     * @dev Records node downtime
     */
    function recordDowntime(address nodeAddress, uint256 downtimeStart, uint256 downtimeEnd) external onlyRole(ORACLE_ROLE) nodeExists(nodeAddress) {
        OracleNode storage node = _nodes[nodeAddress];

        node.lastDowntime = downtimeEnd - downtimeStart;

        // Update uptime calculation
        uint256 totalTime = block.timestamp - node.registrationTime;
        if (totalTime > 0) {
            uint256 totalDowntime = node.lastDowntime;
            node.uptime = ((totalTime - totalDowntime) * 100) / totalTime;
        }

        // Update performance score
        _updatePerformanceScore(nodeAddress);

        emit NodeDowntimeRecorded(nodeAddress, downtimeStart, downtimeEnd);
    }

    /**
     * @dev Updates performance score based on various metrics
     */
    function _updatePerformanceScore(address nodeAddress) internal {
        OracleNode storage node = _nodes[nodeAddress];

        uint256 totalSubmissions = node.successfulSubmissions + node.failedSubmissions;
        uint8 newScore = 0;

        if (totalSubmissions > 0) {
            // Success rate (40% weight) - safe calculation
            uint256 successRate = (node.successfulSubmissions * 100) / totalSubmissions;
            uint256 successScore = (successRate * 40) / 100;
            newScore += successScore > 255 ? 255 : uint8(successScore);

            // Reputation (30% weight) - safe calculation
            uint256 reputationScore = (uint256(node.reputation) * 30) / 100;
            newScore += reputationScore > 255 ? 255 : uint8(reputationScore);

            // Uptime (20% weight) - safe calculation
            uint256 uptimeScore = (node.uptime * 20) / 100;
            newScore += uptimeScore > 255 ? 255 : uint8(uptimeScore);

            // Response time (10% weight) - inverse relationship
            if (node.averageResponseTime > 0) {
                uint256 responseScore = node.averageResponseTime < 1000 ? 100 :
                                      node.averageResponseTime < 5000 ? 80 :
                                      node.averageResponseTime < 10000 ? 60 : 40;
                uint256 responseWeighted = (responseScore * 10) / 100;
                newScore += responseWeighted > 255 ? 255 : uint8(responseWeighted);
            } else {
                newScore += 10; // Default if no response time data
            }
        } else {
            // Default score based on reputation - safe calculation
            uint256 defaultScore = (uint256(node.reputation) * 75) / 100;
            newScore = defaultScore > 255 ? 255 : uint8(defaultScore);
        }

        node.performanceScore = newScore > 100 ? 100 : newScore;
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Returns node information
     */
    function getNode(address nodeAddress) external view override returns (OracleNode memory) {
        return _nodes[nodeAddress];
    }

    /**
     * @dev Returns all active node addresses
     */
    function getAllActiveNodes() external view override returns (address[] memory) {
        return _activeNodes;
    }

    /**
     * @dev Returns submitter node addresses
     */
    function getSubmitterNodes() external view override returns (address[] memory) {
        return _submitterNodes;
    }

    /**
     * @dev Returns validator node addresses
     */
    function getValidatorNodes() external view override returns (address[] memory) {
        return _validatorNodes;
    }

    /**
     * @dev Returns backup node addresses
     */
    function getBackupNodes() external view override returns (address[] memory) {
        return _backupNodes;
    }

    /**
     * @dev Returns current submitter address
     */
    function getCurrentSubmitter() external view override returns (address) {
        return _rotationSchedule.currentSubmitter;
    }

    /**
     * @dev Returns next submitter address
     */
    function getNextSubmitter() external view override returns (address) {
        return _rotationSchedule.nextSubmitter;
    }

    /**
     * @dev Returns rotation schedule information
     */
    function getRotationSchedule() external view override returns (RotationSchedule memory) {
        return _rotationSchedule;
    }

    /**
     * @dev Returns total number of active nodes
     */
    function getTotalActiveNodes() external view override returns (uint8) {
        return uint8(_activeNodes.length);
    }

    /**
     * @dev Checks if a node is active
     */
    function isNodeActive(address node) external view override returns (bool) {
        NodeState state = _nodes[node].state;
        return state == NodeState.Active || state == NodeState.Submitter || state == NodeState.Validator;
    }

    /**
     * @dev Checks if a node is a submitter
     */
    function isNodeSubmitter(address node) external view override returns (bool) {
        return _nodes[node].state == NodeState.Submitter;
    }

    /**
     * @dev Checks if a node is a validator
     */
    function isNodeValidator(address node) external view override returns (bool) {
        return _nodes[node].state == NodeState.Validator;
    }

    /**
     * @dev Checks if a node can submit data
     */
    function canNodeSubmit(address node) external view override returns (bool) {
        OracleNode memory nodeInfo = _nodes[node];
        return (nodeInfo.state == NodeState.Submitter || nodeInfo.state == NodeState.Validator) &&
               nodeInfo.reputation >= MIN_REPUTATION;
    }

    /**
     * @dev Returns node reputation
     */
    function getNodeReputation(address node) external view override returns (uint8) {
        return _nodes[node].reputation;
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @dev Sets rotation interval (admin only)
     * @param newInterval New rotation interval in seconds
     */
    function setRotationInterval(uint256 newInterval) external override onlyRole(ADMIN_ROLE) {
        if (newInterval < 60 || newInterval > 3600) { // 1 minute to 1 hour
            revert InvalidRotationInterval(newInterval);
        }

        uint256 oldInterval = _rotationSchedule.rotationInterval;
        _rotationSchedule.rotationInterval = newInterval;

        emit RotationIntervalUpdated(oldInterval, newInterval, msg.sender);
    }

    /**
     * @dev Forces rotation to a specific submitter (emergency use)
     * @param newSubmitter Address of the new submitter
     */
    function forceRotation(address newSubmitter) external override onlyRole(EMERGENCY_ROLE) nodeExists(newSubmitter) {
        require(_nodes[newSubmitter].reputation >= MIN_REPUTATION, "Insufficient reputation");

        address oldSubmitter = _rotationSchedule.currentSubmitter;

        // Update states
        if (oldSubmitter != address(0)) {
            _nodes[oldSubmitter].state = NodeState.Validator;
        }

        _nodes[newSubmitter].state = NodeState.Submitter;
        _rotationSchedule.currentSubmitter = newSubmitter;
        _rotationSchedule.rotationTime = block.timestamp + _rotationSchedule.rotationInterval;

        emit SubmitterRotated(oldSubmitter, newSubmitter, block.timestamp);
    }

    /**
     * @dev Emergency activation of backup node
     * @param failedNode Address of the failed node
     * @param backupNode Address of the backup node to activate
     */
    function emergencyActivateBackup(
        address failedNode,
        address backupNode
    ) external override onlyRole(EMERGENCY_ROLE) {
        require(_nodes[backupNode].state == NodeState.Backup, "Not a backup node");
        require(_nodes[backupNode].reputation >= MIN_REPUTATION, "Insufficient reputation");

        // Activate backup
        _nodes[backupNode].state = NodeState.Validator;
        _nodes[backupNode].isBackup = false;
        _removeFromArray(_backupNodes, backupNode);
        _validatorNodes.push(backupNode);
        _activeNodes.push(backupNode);

        // Suspend failed node
        if (failedNode != address(0) && _nodes[failedNode].nodeAddress != address(0)) {
            _removeFromRoleArrays(failedNode, _nodes[failedNode].state);
            _nodes[failedNode].state = NodeState.Suspended;
        }

        emit EmergencyNodeActivation(backupNode, "Emergency backup activation", block.timestamp);
        emit BackupNodeActivated(backupNode, failedNode, block.timestamp);
    }

    // ============ INTERNAL HELPER FUNCTIONS ============

    /**
     * @dev Finds the next eligible submitter
     */
    function _findNextSubmitter() internal view returns (address) {
        // Look for validators with highest reputation
        address bestCandidate = address(0);
        uint8 highestReputation = 0;

        for (uint256 i = 0; i < _validatorNodes.length; i++) {
            address candidate = _validatorNodes[i];
            OracleNode memory node = _nodes[candidate];

            if (node.state == NodeState.Validator &&
                node.reputation >= MIN_REPUTATION &&
                node.reputation > highestReputation) {
                bestCandidate = candidate;
                highestReputation = node.reputation;
            }
        }

        return bestCandidate;
    }

    /**
     * @dev Removes a node from role-specific arrays
     */
    function _removeFromRoleArrays(address nodeAddress, NodeState state) internal {
        if (state == NodeState.Active || state == NodeState.Submitter || state == NodeState.Validator) {
            _removeFromArray(_activeNodes, nodeAddress);
        }

        if (state == NodeState.Submitter) {
            _removeFromArray(_submitterNodes, nodeAddress);
        } else if (state == NodeState.Validator) {
            _removeFromArray(_validatorNodes, nodeAddress);
        } else if (state == NodeState.Backup) {
            _removeFromArray(_backupNodes, nodeAddress);
        }
    }

    /**
     * @dev Removes an address from an array
     */
    function _removeFromArray(address[] storage array, address element) internal {
        for (uint256 i = 0; i < array.length; i++) {
            if (array[i] == element) {
                array[i] = array[array.length - 1];
                array.pop();
                break;
            }
        }
    }

    /**
     * @dev Returns the count of active nodes
     */
    function _getActiveNodeCount() internal view returns (uint8) {
        return uint8(_activeNodes.length);
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
