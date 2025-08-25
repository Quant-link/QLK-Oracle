// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "../interfaces/IQuantlinkOracle.sol";
import "../interfaces/INodeManager.sol";
import "../interfaces/IConsensusEngine.sol";
import "../libraries/DataValidation.sol";
import "../libraries/CryptoUtils.sol";

/**
 * @title QuantlinkOracle
 * @dev Main Oracle contract for the Quantlink system providing CEX/DEX fee data
 * @notice Enterprise-grade oracle with 10-node consensus mechanism and 5-minute update cycles
 * @custom:security-contact security@quantlink.io
 */
contract QuantlinkOracle is 
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    IQuantlinkOracle
{
    using DataValidation for uint256[];
    using CryptoUtils for bytes32;

    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant NODE_MANAGER_ROLE = keccak256("NODE_MANAGER_ROLE");
    bytes32 public constant CONSENSUS_ROLE = keccak256("CONSENSUS_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // Core configuration constants
    uint256 public constant UPDATE_INTERVAL = 300; // 5 minutes
    uint256 public constant CONSENSUS_WINDOW = 90; // 90 seconds for consensus
    uint256 public constant SUBMISSION_WINDOW = 180; // 180 seconds for submissions
    uint8 public constant TOTAL_NODES = 10;
    uint8 public constant DEFAULT_CONSENSUS_THRESHOLD = 6; // 6/10 majority

    // State variables
    uint256 private _currentRoundId;
    uint256 private _lastUpdateTime;
    uint8 private _consensusThreshold;
    
    // Contract references
    INodeManager public nodeManager;
    IConsensusEngine public consensusEngine;

    // Data storage
    mapping(uint256 => FeeData) private _feeDataHistory;
    mapping(uint256 => ConsensusRound) private _consensusRounds;
    mapping(uint256 => mapping(address => DataSubmission)) private _roundSubmissions;
    mapping(uint256 => address[]) private _roundSubmitters;
    mapping(address => uint256) private _nodeNonces;

    // Current state
    FeeData private _latestFeeData;
    ConsensusRound private _currentRound;

    // Events (additional to interface)
    event OracleInitialized(
        address indexed admin,
        address indexed nodeManager,
        address indexed consensusEngine,
        uint256 timestamp
    );

    event ConfigurationUpdated(
        string parameter,
        uint256 oldValue,
        uint256 newValue,
        address indexed updatedBy
    );

    event DataValidationFailed(
        address indexed node,
        uint256 indexed roundId,
        string reason,
        uint256 timestamp
    );

    event RoundTimeout(
        uint256 indexed roundId,
        uint8 submissionsReceived,
        uint8 requiredSubmissions,
        uint256 timestamp
    );

    /**
     * @dev Custom errors
     */
    error InvalidConfiguration(string parameter, uint256 value);
    error RoundNotActive(uint256 roundId, uint256 currentRound);
    error SubmissionWindowClosed(uint256 roundId, uint256 deadline);
    error NodeNotAuthorized(address node);
    error DuplicateSubmission(address node, uint256 roundId);
    error InvalidDataSubmission(string reason);
    error ConsensusNotReached(uint256 roundId, uint8 votes, uint8 required);
    error ContractNotInitialized();

    /**
     * @dev Modifier to check if contract is properly initialized
     */
    modifier onlyInitialized() {
        if (address(nodeManager) == address(0) || address(consensusEngine) == address(0)) {
            revert ContractNotInitialized();
        }
        _;
    }

    /**
     * @dev Modifier to check if node is authorized to submit data
     */
    modifier onlyAuthorizedNode() {
        if (!nodeManager.canNodeSubmit(msg.sender)) {
            revert NodeNotAuthorized(msg.sender);
        }
        _;
    }

    /**
     * @dev Modifier to check if submission window is open
     */
    modifier onlyDuringSubmissionWindow(uint256 roundId) {
        ConsensusRound memory round = _consensusRounds[roundId];
        if (block.timestamp > round.startTime + SUBMISSION_WINDOW) {
            revert SubmissionWindowClosed(roundId, round.startTime + SUBMISSION_WINDOW);
        }
        _;
    }

    /**
     * @dev Initializes the Oracle contract
     * @param admin Address of the admin
     * @param _nodeManager Address of the NodeManager contract
     * @param _consensusEngine Address of the ConsensusEngine contract
     */
    function initialize(
        address admin,
        address _nodeManager,
        address _consensusEngine
    ) public initializer {
        require(admin != address(0), "Invalid admin address");
        require(_nodeManager != address(0), "Invalid node manager address");
        require(_consensusEngine != address(0), "Invalid consensus engine address");

        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        // Set up roles
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(EMERGENCY_ROLE, admin);

        // Initialize contract references
        nodeManager = INodeManager(_nodeManager);
        consensusEngine = IConsensusEngine(_consensusEngine);

        // Initialize configuration
        _consensusThreshold = DEFAULT_CONSENSUS_THRESHOLD;
        _currentRoundId = 1;
        _lastUpdateTime = block.timestamp;

        // Start first consensus round
        _startNewRound();

        emit OracleInitialized(admin, _nodeManager, _consensusEngine, block.timestamp);
    }

    /**
     * @dev Submits fee data for the current consensus round
     * @param cexFees Array of CEX fees in basis points
     * @param dexFees Array of DEX fees in basis points
     * @param signature Cryptographic signature of the data
     */
    function submitData(
        uint256[] calldata cexFees,
        uint256[] calldata dexFees,
        bytes calldata signature
    ) 
        external 
        override
        nonReentrant
        whenNotPaused
        onlyInitialized
        onlyAuthorizedNode
        onlyDuringSubmissionWindow(_currentRoundId)
    {
        // Check for duplicate submission
        if (_roundSubmissions[_currentRoundId][msg.sender].nodeAddress != address(0)) {
            revert DuplicateSubmission(msg.sender, _currentRoundId);
        }

        // Validate data format and ranges
        DataValidation.ValidationResult memory validation = 
            DataValidation.validateFeeData(cexFees, dexFees);
        
        if (!validation.isValid) {
            emit DataValidationFailed(msg.sender, _currentRoundId, validation.errors[0], block.timestamp);
            revert InvalidDataSubmission(validation.errors[0]);
        }

        // Validate timestamp
        if (!DataValidation.validateTimestamp(block.timestamp)) {
            revert InvalidDataSubmission("Invalid timestamp");
        }

        // Verify signature
        uint256 nonce = _nodeNonces[msg.sender]++;
        bytes32 dataHash = CryptoUtils.hashFeeData(cexFees, dexFees, block.timestamp, nonce);
        
        if (!CryptoUtils.verifyDataSignature(dataHash, signature, msg.sender)) {
            revert InvalidDataSubmission("Invalid signature");
        }

        // Store submission
        _roundSubmissions[_currentRoundId][msg.sender] = DataSubmission({
            nodeAddress: msg.sender,
            cexFees: cexFees,
            dexFees: dexFees,
            timestamp: block.timestamp,
            signature: signature
        });

        _roundSubmitters[_currentRoundId].push(msg.sender);

        // Record node activity
        nodeManager.recordNodeActivity(msg.sender);

        emit DataSubmitted(msg.sender, _currentRoundId, cexFees, dexFees, block.timestamp);

        // Check if we can process consensus
        if (_roundSubmitters[_currentRoundId].length >= _consensusThreshold) {
            _tryProcessConsensus();
        }
    }

    /**
     * @dev Processes consensus for the current round
     */
    function processConsensus() external override nonReentrant whenNotPaused onlyInitialized {
        _tryProcessConsensus();
    }

    /**
     * @dev Internal function to attempt consensus processing
     */
    function _tryProcessConsensus() internal {
        uint256 roundId = _currentRoundId;
        ConsensusRound storage round = _consensusRounds[roundId];

        // Check if consensus window is still open
        if (block.timestamp <= round.startTime + SUBMISSION_WINDOW) {
            return; // Wait for more submissions or window to close
        }

        uint8 submissionCount = uint8(_roundSubmitters[roundId].length);
        
        if (submissionCount < _consensusThreshold) {
            // Consensus failed - not enough submissions
            round.consensusReached = false;
            round.endTime = block.timestamp;
            
            emit ConsensusFailed(roundId, submissionCount, _consensusThreshold, "Insufficient submissions");
            emit RoundTimeout(roundId, submissionCount, _consensusThreshold, block.timestamp);
            
            _startNewRound();
            return;
        }

        // Process consensus through consensus engine
        bool consensusReached = consensusEngine.processConsensus(roundId);
        
        if (consensusReached) {
            FeeData memory finalData = consensusEngine.finalizeRound(roundId);
            
            // Update state
            _latestFeeData = finalData;
            _feeDataHistory[roundId] = finalData;
            round.consensusReached = true;
            round.finalData = finalData;
            round.endTime = block.timestamp;
            round.submissionsCount = submissionCount;

            // Record consensus participation for all submitting nodes
            for (uint256 i = 0; i < _roundSubmitters[roundId].length; i++) {
                nodeManager.recordConsensusParticipation(_roundSubmitters[roundId][i]);
            }

            emit ConsensusReached(
                roundId,
                finalData.cexFees,
                finalData.dexFees,
                finalData.participatingNodes,
                finalData.timestamp
            );
        } else {
            round.consensusReached = false;
            round.endTime = block.timestamp;
            
            emit ConsensusFailed(roundId, submissionCount, _consensusThreshold, "Consensus algorithm failed");
        }

        emit ConsensusRoundEnded(roundId, block.timestamp, consensusReached);
        _startNewRound();
    }

    /**
     * @dev Starts a new consensus round
     */
    function _startNewRound() internal {
        _currentRoundId++;
        _lastUpdateTime = block.timestamp;

        _currentRound = ConsensusRound({
            roundId: _currentRoundId,
            startTime: block.timestamp,
            endTime: 0,
            submissionsCount: 0,
            consensusReached: false,
            finalData: FeeData({
                cexFees: new uint256[](0),
                dexFees: new uint256[](0),
                timestamp: 0,
                blockNumber: 0,
                consensusReached: false,
                participatingNodes: 0
            })
        });

        _consensusRounds[_currentRoundId] = _currentRound;

        emit ConsensusRoundStarted(_currentRoundId, block.timestamp);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Returns the latest fee data
     */
    function getLatestFeeData() external view override returns (FeeData memory) {
        return _latestFeeData;
    }

    /**
     * @dev Returns fee data for a specific round
     */
    function getFeeDataAtRound(uint256 roundId) external view override returns (FeeData memory) {
        return _feeDataHistory[roundId];
    }

    /**
     * @dev Returns current consensus round information
     */
    function getCurrentRound() external view override returns (ConsensusRound memory) {
        return _currentRound;
    }

    /**
     * @dev Returns the consensus threshold
     */
    function getConsensusThreshold() external view override returns (uint8) {
        return _consensusThreshold;
    }

    /**
     * @dev Returns total number of nodes
     */
    function getTotalNodes() external view override returns (uint8) {
        return TOTAL_NODES;
    }

    /**
     * @dev Returns update interval in seconds
     */
    function getUpdateInterval() external view override returns (uint256) {
        return UPDATE_INTERVAL;
    }

    /**
     * @dev Checks if a node is active
     */
    function isNodeActive(address node) external view override returns (bool) {
        return nodeManager.isNodeActive(node);
    }

    /**
     * @dev Returns current submitter node
     */
    function getCurrentSubmitter() external view override returns (address) {
        return nodeManager.getCurrentSubmitter();
    }

    /**
     * @dev Returns next rotation time
     */
    function getNextRotationTime() external view override returns (uint256) {
        return _lastUpdateTime + UPDATE_INTERVAL;
    }

    /**
     * @dev Returns current round ID
     */
    function getCurrentRoundId() external view returns (uint256) {
        return _currentRoundId;
    }

    /**
     * @dev Returns last update time
     */
    function getLastUpdateTime() external view returns (uint256) {
        return _lastUpdateTime;
    }

    /**
     * @dev Returns submission for a specific node and round
     */
    function getSubmission(
        uint256 roundId,
        address node
    ) external view returns (DataSubmission memory) {
        return _roundSubmissions[roundId][node];
    }

    /**
     * @dev Returns all submitters for a specific round
     */
    function getRoundSubmitters(uint256 roundId) external view returns (address[] memory) {
        return _roundSubmitters[roundId];
    }

    /**
     * @dev Returns node nonce for replay protection
     */
    function getNodeNonce(address node) external view returns (uint256) {
        return _nodeNonces[node];
    }

    /**
     * @dev Checks if submission window is open for current round
     */
    function isSubmissionWindowOpen() external view returns (bool) {
        return block.timestamp <= _currentRound.startTime + SUBMISSION_WINDOW;
    }

    /**
     * @dev Checks if consensus window is open for current round
     */
    function isConsensusWindowOpen() external view returns (bool) {
        return block.timestamp <= _currentRound.startTime + SUBMISSION_WINDOW + CONSENSUS_WINDOW;
    }

    // ============ NODE MANAGEMENT FUNCTIONS ============

    /**
     * @dev Rotates the current submitter node
     */
    function rotateSubmitter() external override nonReentrant whenNotPaused onlyInitialized {
        address oldSubmitter = nodeManager.getCurrentSubmitter();
        address newSubmitter = nodeManager.rotateSubmitter();

        emit NodeRotated(oldSubmitter, newSubmitter, block.timestamp);
    }

    /**
     * @dev Adds a new oracle node (admin only)
     */
    function addNode(address node) external override onlyRole(ADMIN_ROLE) {
        nodeManager.registerNode(node, "");
        _grantRole(NODE_MANAGER_ROLE, node);
    }

    /**
     * @dev Removes an oracle node (admin only)
     */
    function removeNode(address node) external override onlyRole(ADMIN_ROLE) {
        nodeManager.deactivateNode(node);
        _revokeRole(NODE_MANAGER_ROLE, node);
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @dev Updates consensus threshold (admin only)
     */
    function updateConsensusThreshold(uint8 newThreshold) external override onlyRole(ADMIN_ROLE) {
        require(newThreshold > 0 && newThreshold <= TOTAL_NODES, "Invalid threshold");
        require(newThreshold != _consensusThreshold, "Same threshold");

        uint8 oldThreshold = _consensusThreshold;
        _consensusThreshold = newThreshold;

        emit ConfigurationUpdated("consensusThreshold", oldThreshold, newThreshold, msg.sender);
    }

    /**
     * @dev Updates update interval (admin only)
     */
    function updateUpdateInterval(uint256 newInterval) external override onlyRole(ADMIN_ROLE) {
        revert InvalidConfiguration("updateInterval", newInterval);
        // Update interval is constant for security - this function exists for interface compliance
    }

    /**
     * @dev Emergency pause function
     */
    function emergencyPause() external override onlyRole(EMERGENCY_ROLE) {
        _pause();
        emit EmergencyPaused(msg.sender, block.timestamp);
    }

    /**
     * @dev Emergency unpause function
     */
    function emergencyUnpause() external override onlyRole(EMERGENCY_ROLE) {
        _unpause();
        emit EmergencyUnpaused(msg.sender, block.timestamp);
    }

    /**
     * @dev Sets new node manager contract (admin only)
     */
    function setNodeManager(address newNodeManager) external onlyRole(ADMIN_ROLE) {
        require(newNodeManager != address(0), "Invalid address");
        address oldNodeManager = address(nodeManager);
        nodeManager = INodeManager(newNodeManager);

        emit ConfigurationUpdated("nodeManager", uint256(uint160(oldNodeManager)), uint256(uint160(newNodeManager)), msg.sender);
    }

    /**
     * @dev Sets new consensus engine contract (admin only)
     */
    function setConsensusEngine(address newConsensusEngine) external onlyRole(ADMIN_ROLE) {
        require(newConsensusEngine != address(0), "Invalid address");
        address oldConsensusEngine = address(consensusEngine);
        consensusEngine = IConsensusEngine(newConsensusEngine);

        emit ConfigurationUpdated("consensusEngine", uint256(uint160(oldConsensusEngine)), uint256(uint160(newConsensusEngine)), msg.sender);
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
