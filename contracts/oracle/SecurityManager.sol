// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "../libraries/CryptoUtils.sol";

/**
 * @title SecurityManager
 * @dev Advanced security management for the Quantlink Oracle system
 * @notice Handles threat detection, rate limiting, and security monitoring
 */
contract SecurityManager is 
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using CryptoUtils for bytes32;

    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SECURITY_ROLE = keccak256("SECURITY_ROLE");
    bytes32 public constant MONITOR_ROLE = keccak256("MONITOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // Security constants
    uint256 public constant MAX_SUBMISSIONS_PER_HOUR = 100;
    uint256 public constant MAX_FAILED_ATTEMPTS = 5;
    uint256 public constant LOCKOUT_DURATION = 3600; // 1 hour
    uint256 public constant ANOMALY_THRESHOLD = 3;
    uint256 public constant REPUTATION_DECAY_RATE = 1; // per day

    // Security state
    struct SecurityMetrics {
        uint256 totalSubmissions;
        uint256 failedSubmissions;
        uint256 suspiciousActivity;
        uint256 lastAnomalyTime;
        uint256 threatLevel; // 0-5 scale
        bool isUnderAttack;
    }

    struct NodeSecurityProfile {
        uint256 submissionCount;
        uint256 failedAttempts;
        uint256 lastSubmissionTime;
        uint256 lockoutUntil;
        uint256 reputationScore;
        uint256 anomalyCount;
        bool isBlacklisted;
        bytes32[] submissionHashes;
    }

    struct ThreatAlert {
        address source;
        string threatType;
        uint256 severity; // 1-5
        uint256 timestamp;
        string description;
        bool resolved;
    }

    // State variables
    SecurityMetrics private _globalMetrics;
    mapping(address => NodeSecurityProfile) private _nodeProfiles;
    mapping(bytes32 => bool) private _knownAttackSignatures;
    mapping(address => uint256) private _rateLimits;
    
    ThreatAlert[] private _threatAlerts;
    address[] private _blacklistedAddresses;
    bytes32[] private _suspiciousHashes;

    // Events
    event ThreatDetected(
        address indexed source,
        string threatType,
        uint256 severity,
        string description,
        uint256 timestamp
    );

    event NodeBlacklisted(address indexed node, string reason, uint256 timestamp);
    event NodeWhitelisted(address indexed node, uint256 timestamp);
    event AnomalyDetected(address indexed node, string anomalyType, uint256 timestamp);
    event SecurityLevelChanged(uint256 oldLevel, uint256 newLevel, uint256 timestamp);
    event EmergencyLockdown(address indexed initiator, string reason, uint256 timestamp);
    event RateLimitExceeded(address indexed node, uint256 attempts, uint256 timestamp);

    /**
     * @dev Custom errors
     */
    error NodeBlacklistedError(address node);
    error RateLimitExceededError(address node, uint256 nextAllowedTime);
    error InsufficientReputationError(address node, uint256 required, uint256 actual);
    error SuspiciousActivityError(address node, string reason);
    error ThreatLevelTooHighError(uint256 currentLevel, uint256 maxAllowed);
    error InvalidSecurityParametersError(string parameter);

    /**
     * @dev Modifier to check if node is not blacklisted
     */
    modifier notBlacklisted(address node) {
        if (_nodeProfiles[node].isBlacklisted) {
            revert NodeBlacklistedError(node);
        }
        _;
    }

    /**
     * @dev Modifier to check rate limits
     */
    modifier rateLimited(address node) {
        _checkRateLimit(node);
        _;
    }

    /**
     * @dev Modifier to check threat level
     */
    modifier threatLevelCheck(uint256 maxLevel) {
        if (_globalMetrics.threatLevel > maxLevel) {
            revert ThreatLevelTooHighError(_globalMetrics.threatLevel, maxLevel);
        }
        _;
    }

    /**
     * @dev Initializes the SecurityManager contract
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
        _grantRole(SECURITY_ROLE, admin);
        _grantRole(EMERGENCY_ROLE, admin);

        // Initialize security metrics
        _globalMetrics = SecurityMetrics({
            totalSubmissions: 0,
            failedSubmissions: 0,
            suspiciousActivity: 0,
            lastAnomalyTime: 0,
            threatLevel: 0,
            isUnderAttack: false
        });
    }

    /**
     * @dev Validates a data submission for security threats
     * @param node Address of the submitting node
     * @param dataHash Hash of the submitted data
     * @param signature Signature of the submission
     * @return isValid Whether the submission passes security checks
     */
    function validateSubmission(
        address node,
        bytes32 dataHash,
        bytes calldata signature
    ) external onlyRole(SECURITY_ROLE) notBlacklisted(node) rateLimited(node) returns (bool isValid) {
        NodeSecurityProfile storage profile = _nodeProfiles[node];
        
        // Update submission metrics
        profile.submissionCount++;
        profile.lastSubmissionTime = block.timestamp;
        _globalMetrics.totalSubmissions++;

        // Check for replay attacks
        if (_isReplayAttack(profile, dataHash)) {
            _recordThreat(node, "replay_attack", 4, "Duplicate submission hash detected");
            return false;
        }

        // Verify signature integrity
        if (!_verifySignatureIntegrity(signature)) {
            _recordThreat(node, "invalid_signature", 3, "Malformed or invalid signature");
            profile.failedAttempts++;
            return false;
        }

        // Check for anomalous patterns
        if (_detectAnomalousPattern(node)) {
            _recordThreat(node, "anomalous_pattern", 2, "Unusual submission pattern detected");
            profile.anomalyCount++;
        }

        // Store submission hash for replay detection
        profile.submissionHashes.push(dataHash);
        
        // Limit stored hashes to prevent unbounded growth
        if (profile.submissionHashes.length > 100) {
            _removeOldestHash(profile);
        }

        return true;
    }

    /**
     * @dev Records a security threat
     * @param source Source address of the threat
     * @param threatType Type of threat detected
     * @param severity Severity level (1-5)
     * @param description Description of the threat
     */
    function _recordThreat(
        address source,
        string memory threatType,
        uint256 severity,
        string memory description
    ) internal {
        ThreatAlert memory alert = ThreatAlert({
            source: source,
            threatType: threatType,
            severity: severity,
            timestamp: block.timestamp,
            description: description,
            resolved: false
        });

        _threatAlerts.push(alert);
        _globalMetrics.suspiciousActivity++;

        // Update threat level based on severity
        if (severity >= 4) {
            _updateThreatLevel(_globalMetrics.threatLevel + 1);
        }

        // Auto-blacklist for severe threats
        if (severity >= 4 && !_nodeProfiles[source].isBlacklisted) {
            _blacklistNode(source, threatType);
        }

        emit ThreatDetected(source, threatType, severity, description, block.timestamp);
    }

    /**
     * @dev Checks for replay attacks
     */
    function _isReplayAttack(NodeSecurityProfile storage profile, bytes32 dataHash) internal view returns (bool) {
        for (uint256 i = 0; i < profile.submissionHashes.length; i++) {
            if (profile.submissionHashes[i] == dataHash) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Verifies signature integrity
     */
    function _verifySignatureIntegrity(bytes calldata signature) internal pure returns (bool) {
        return CryptoUtils.isValidSignatureFormat(signature);
    }

    /**
     * @dev Detects anomalous submission patterns
     */
    function _detectAnomalousPattern(address node) internal view returns (bool) {
        NodeSecurityProfile storage profile = _nodeProfiles[node];
        
        // Check submission frequency
        if (profile.submissionCount > 0) {
            uint256 avgInterval = (block.timestamp - profile.lastSubmissionTime) / profile.submissionCount;
            if (avgInterval < 60) { // Less than 1 minute average
                return true;
            }
        }

        // Check for burst submissions
        uint256 timeWindow = block.timestamp - 300; // 5 minutes

        // This is a simplified check - in production, you'd want more sophisticated pattern detection
        if (profile.lastSubmissionTime > timeWindow && profile.submissionCount > 10) {
            return true;
        }

        return false;
    }

    /**
     * @dev Removes oldest hash from profile to prevent unbounded growth
     */
    function _removeOldestHash(NodeSecurityProfile storage profile) internal {
        for (uint256 i = 0; i < profile.submissionHashes.length - 1; i++) {
            profile.submissionHashes[i] = profile.submissionHashes[i + 1];
        }
        profile.submissionHashes.pop();
    }

    /**
     * @dev Checks rate limits for a node
     */
    function _checkRateLimit(address node) internal {
        NodeSecurityProfile storage profile = _nodeProfiles[node];
        
        // Check if node is in lockout period
        if (profile.lockoutUntil > block.timestamp) {
            revert RateLimitExceededError(node, profile.lockoutUntil);
        }

        // Check hourly submission limit
        uint256 hourAgo = block.timestamp - 3600;
        if (profile.lastSubmissionTime > hourAgo && profile.submissionCount >= MAX_SUBMISSIONS_PER_HOUR) {
            profile.lockoutUntil = block.timestamp + LOCKOUT_DURATION;
            emit RateLimitExceeded(node, profile.submissionCount, block.timestamp);
            revert RateLimitExceededError(node, profile.lockoutUntil);
        }

        // Reset counters if more than an hour has passed
        if (profile.lastSubmissionTime <= hourAgo) {
            profile.submissionCount = 0;
            profile.failedAttempts = 0;
        }
    }

    /**
     * @dev Blacklists a node
     */
    function _blacklistNode(address node, string memory reason) internal {
        _nodeProfiles[node].isBlacklisted = true;
        _blacklistedAddresses.push(node);
        
        emit NodeBlacklisted(node, reason, block.timestamp);
    }

    /**
     * @dev Updates global threat level
     */
    function _updateThreatLevel(uint256 newLevel) internal {
        uint256 oldLevel = _globalMetrics.threatLevel;
        _globalMetrics.threatLevel = newLevel > 5 ? 5 : newLevel;
        
        // Trigger emergency lockdown if threat level is critical
        if (_globalMetrics.threatLevel >= 5 && !_globalMetrics.isUnderAttack) {
            _globalMetrics.isUnderAttack = true;
            _pause();
            emit EmergencyLockdown(msg.sender, "Critical threat level reached", block.timestamp);
        }

        emit SecurityLevelChanged(oldLevel, _globalMetrics.threatLevel, block.timestamp);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Returns global security metrics
     */
    function getSecurityMetrics() external view returns (SecurityMetrics memory) {
        return _globalMetrics;
    }

    /**
     * @dev Returns security profile for a node
     */
    function getNodeSecurityProfile(address node) external view returns (NodeSecurityProfile memory) {
        return _nodeProfiles[node];
    }

    /**
     * @dev Returns all threat alerts
     */
    function getThreatAlerts() external view returns (ThreatAlert[] memory) {
        return _threatAlerts;
    }

    /**
     * @dev Returns recent threat alerts (last 24 hours)
     */
    function getRecentThreatAlerts() external view returns (ThreatAlert[] memory) {
        uint256 dayAgo = block.timestamp - 86400;
        uint256 recentCount = 0;

        // Count recent alerts
        for (uint256 i = 0; i < _threatAlerts.length; i++) {
            if (_threatAlerts[i].timestamp > dayAgo) {
                recentCount++;
            }
        }

        // Create array of recent alerts
        ThreatAlert[] memory recentAlerts = new ThreatAlert[](recentCount);
        uint256 index = 0;

        for (uint256 i = 0; i < _threatAlerts.length; i++) {
            if (_threatAlerts[i].timestamp > dayAgo) {
                recentAlerts[index++] = _threatAlerts[i];
            }
        }

        return recentAlerts;
    }

    /**
     * @dev Returns blacklisted addresses
     */
    function getBlacklistedAddresses() external view returns (address[] memory) {
        return _blacklistedAddresses;
    }

    /**
     * @dev Checks if an address is blacklisted
     */
    function isBlacklisted(address node) external view returns (bool) {
        return _nodeProfiles[node].isBlacklisted;
    }

    /**
     * @dev Returns current threat level
     */
    function getThreatLevel() external view returns (uint256) {
        return _globalMetrics.threatLevel;
    }

    /**
     * @dev Checks if system is under attack
     */
    function isUnderAttack() external view returns (bool) {
        return _globalMetrics.isUnderAttack;
    }

    /**
     * @dev Returns node reputation score
     */
    function getNodeReputation(address node) external view returns (uint256) {
        return _nodeProfiles[node].reputationScore;
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @dev Manually blacklists a node (admin only)
     */
    function blacklistNode(address node, string calldata reason) external onlyRole(ADMIN_ROLE) {
        _blacklistNode(node, reason);
    }

    /**
     * @dev Removes a node from blacklist (admin only)
     */
    function whitelistNode(address node) external onlyRole(ADMIN_ROLE) {
        require(_nodeProfiles[node].isBlacklisted, "Node not blacklisted");

        _nodeProfiles[node].isBlacklisted = false;

        // Remove from blacklisted addresses array
        for (uint256 i = 0; i < _blacklistedAddresses.length; i++) {
            if (_blacklistedAddresses[i] == node) {
                _blacklistedAddresses[i] = _blacklistedAddresses[_blacklistedAddresses.length - 1];
                _blacklistedAddresses.pop();
                break;
            }
        }

        emit NodeWhitelisted(node, block.timestamp);
    }

    /**
     * @dev Manually sets threat level (admin only)
     */
    function setThreatLevel(uint256 level) external onlyRole(ADMIN_ROLE) {
        require(level <= 5, "Invalid threat level");
        _updateThreatLevel(level);
    }

    /**
     * @dev Resolves a threat alert (security role)
     */
    function resolveThreatAlert(uint256 alertIndex) external onlyRole(SECURITY_ROLE) {
        require(alertIndex < _threatAlerts.length, "Invalid alert index");
        _threatAlerts[alertIndex].resolved = true;
    }

    /**
     * @dev Clears old threat alerts (admin only)
     */
    function clearOldThreatAlerts(uint256 olderThanDays) external onlyRole(ADMIN_ROLE) {
        uint256 cutoffTime = block.timestamp - (olderThanDays * 86400);

        // Create new array without old alerts
        ThreatAlert[] memory newAlerts = new ThreatAlert[](_threatAlerts.length);
        uint256 newCount = 0;

        for (uint256 i = 0; i < _threatAlerts.length; i++) {
            if (_threatAlerts[i].timestamp > cutoffTime) {
                newAlerts[newCount++] = _threatAlerts[i];
            }
        }

        // Clear old array and copy new alerts
        delete _threatAlerts;
        for (uint256 i = 0; i < newCount; i++) {
            _threatAlerts.push(newAlerts[i]);
        }
    }

    /**
     * @dev Emergency reset of security state (emergency role)
     */
    function emergencyReset() external onlyRole(EMERGENCY_ROLE) {
        _globalMetrics.threatLevel = 0;
        _globalMetrics.isUnderAttack = false;
        _globalMetrics.suspiciousActivity = 0;

        // Clear all blacklisted addresses
        delete _blacklistedAddresses;

        // Reset all node profiles
        // Note: This is a simplified reset - in production you might want more granular control

        _unpause();
        emit SecurityLevelChanged(5, 0, block.timestamp);
    }

    /**
     * @dev Updates node reputation (security role)
     */
    function updateNodeReputation(address node, uint256 newReputation) external onlyRole(SECURITY_ROLE) {
        require(newReputation <= 100, "Invalid reputation score");
        _nodeProfiles[node].reputationScore = newReputation;
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
