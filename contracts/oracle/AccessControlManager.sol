// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title AccessControlManager
 * @dev Advanced access control system for the Quantlink Oracle
 * @notice Manages fine-grained permissions and role hierarchies
 */
contract AccessControlManager is 
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    // Role hierarchy levels
    bytes32 public constant SUPER_ADMIN_ROLE = keccak256("SUPER_ADMIN_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ORACLE_ADMIN_ROLE = keccak256("ORACLE_ADMIN_ROLE");
    bytes32 public constant NODE_OPERATOR_ROLE = keccak256("NODE_OPERATOR_ROLE");
    bytes32 public constant SECURITY_OFFICER_ROLE = keccak256("SECURITY_OFFICER_ROLE");
    bytes32 public constant MONITOR_ROLE = keccak256("MONITOR_ROLE");
    bytes32 public constant EMERGENCY_RESPONDER_ROLE = keccak256("EMERGENCY_RESPONDER_ROLE");

    // Permission flags
    bytes32 public constant CAN_SUBMIT_DATA = keccak256("CAN_SUBMIT_DATA");
    bytes32 public constant CAN_PROCESS_CONSENSUS = keccak256("CAN_PROCESS_CONSENSUS");
    bytes32 public constant CAN_MANAGE_NODES = keccak256("CAN_MANAGE_NODES");
    bytes32 public constant CAN_UPDATE_CONFIG = keccak256("CAN_UPDATE_CONFIG");
    bytes32 public constant CAN_PAUSE_SYSTEM = keccak256("CAN_PAUSE_SYSTEM");
    bytes32 public constant CAN_UPGRADE_CONTRACTS = keccak256("CAN_UPGRADE_CONTRACTS");
    bytes32 public constant CAN_BLACKLIST_NODES = keccak256("CAN_BLACKLIST_NODES");
    bytes32 public constant CAN_VIEW_SENSITIVE_DATA = keccak256("CAN_VIEW_SENSITIVE_DATA");

    // Time-based access control
    struct TimeBasedAccess {
        uint256 startTime;
        uint256 endTime;
        bool isActive;
    }

    // Permission delegation
    struct DelegatedPermission {
        address delegator;
        address delegatee;
        bytes32 permission;
        uint256 expiryTime;
        bool isActive;
    }

    // State variables
    mapping(address => mapping(bytes32 => TimeBasedAccess)) private _timeBasedAccess;
    mapping(bytes32 => DelegatedPermission) private _delegatedPermissions;
    mapping(address => uint256) private _lastActivityTime;
    mapping(bytes32 => uint256) private _roleExpiryTimes;
    mapping(address => bool) private _emergencyOverride;

    uint256 public constant MAX_ROLE_DURATION = 365 days;
    uint256 public constant ACTIVITY_TIMEOUT = 30 days;

    // Events
    event RoleGrantedWithExpiry(
        bytes32 indexed role,
        address indexed account,
        address indexed sender,
        uint256 expiryTime
    );

    event PermissionDelegated(
        address indexed delegator,
        address indexed delegatee,
        bytes32 indexed permission,
        uint256 expiryTime
    );

    event EmergencyOverrideActivated(address indexed account, address indexed activator);
    event EmergencyOverrideDeactivated(address indexed account, address indexed deactivator);
    event ActivityRecorded(address indexed account, uint256 timestamp);
    event InactiveRoleRevoked(bytes32 indexed role, address indexed account);

    /**
     * @dev Custom errors
     */
    error RoleExpired(bytes32 role, address account);
    error PermissionDenied(address account, bytes32 permission);
    error InvalidTimeRange(uint256 startTime, uint256 endTime);
    error DelegationNotFound(bytes32 delegationId);
    error InactiveAccount(address account, uint256 lastActivity);
    error EmergencyOverrideActive(address account);

    /**
     * @dev Modifier to check time-based access
     */
    modifier timeBasedAccess(bytes32 permission) {
        _checkTimeBasedAccess(msg.sender, permission);
        _;
    }

    /**
     * @dev Modifier to record activity
     */
    modifier recordActivity() {
        _lastActivityTime[msg.sender] = block.timestamp;
        emit ActivityRecorded(msg.sender, block.timestamp);
        _;
    }

    /**
     * @dev Modifier to check if account is active
     */
    modifier onlyActiveAccount(address account) {
        if (block.timestamp - _lastActivityTime[account] > ACTIVITY_TIMEOUT) {
            revert InactiveAccount(account, _lastActivityTime[account]);
        }
        _;
    }

    /**
     * @dev Initializes the AccessControlManager
     * @param superAdmin Address of the super admin
     */
    function initialize(address superAdmin) public initializer {
        require(superAdmin != address(0), "Invalid super admin address");

        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        // Set up role hierarchy
        _grantRole(DEFAULT_ADMIN_ROLE, superAdmin);
        _grantRole(SUPER_ADMIN_ROLE, superAdmin);
        
        // Set role admin relationships
        _setRoleAdmin(ADMIN_ROLE, SUPER_ADMIN_ROLE);
        _setRoleAdmin(ORACLE_ADMIN_ROLE, ADMIN_ROLE);
        _setRoleAdmin(NODE_OPERATOR_ROLE, ORACLE_ADMIN_ROLE);
        _setRoleAdmin(SECURITY_OFFICER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(MONITOR_ROLE, SECURITY_OFFICER_ROLE);
        _setRoleAdmin(EMERGENCY_RESPONDER_ROLE, SUPER_ADMIN_ROLE);

        // Initialize activity tracking
        _lastActivityTime[superAdmin] = block.timestamp;
    }

    /**
     * @dev Grants a role with expiry time
     * @param role Role to grant
     * @param account Account to grant role to
     * @param expiryTime When the role expires
     */
    function grantRoleWithExpiry(
        bytes32 role,
        address account,
        uint256 expiryTime
    ) external onlyRole(getRoleAdmin(role)) recordActivity {
        require(expiryTime > block.timestamp, "Expiry time must be in future");
        require(expiryTime <= block.timestamp + MAX_ROLE_DURATION, "Expiry time too far in future");

        _grantRole(role, account);
        _roleExpiryTimes[_getRoleKey(role, account)] = expiryTime;
        _lastActivityTime[account] = block.timestamp;

        emit RoleGrantedWithExpiry(role, account, msg.sender, expiryTime);
    }

    /**
     * @dev Delegates a permission to another account
     * @param delegatee Account to delegate permission to
     * @param permission Permission to delegate
     * @param duration Duration of delegation in seconds
     */
    function delegatePermission(
        address delegatee,
        bytes32 permission,
        uint256 duration
    ) external recordActivity returns (bytes32 delegationId) {
        require(hasPermission(msg.sender, permission), "Delegator lacks permission");
        require(duration <= 7 days, "Delegation duration too long");

        delegationId = keccak256(abi.encodePacked(msg.sender, delegatee, permission, block.timestamp));
        uint256 expiryTime = block.timestamp + duration;

        _delegatedPermissions[delegationId] = DelegatedPermission({
            delegator: msg.sender,
            delegatee: delegatee,
            permission: permission,
            expiryTime: expiryTime,
            isActive: true
        });

        emit PermissionDelegated(msg.sender, delegatee, permission, expiryTime);
        return delegationId;
    }

    /**
     * @dev Sets time-based access for a permission
     * @param account Account to set access for
     * @param permission Permission to control
     * @param startTime When access starts
     * @param endTime When access ends
     */
    function setTimeBasedAccess(
        address account,
        bytes32 permission,
        uint256 startTime,
        uint256 endTime
    ) external onlyRole(ADMIN_ROLE) {
        if (startTime >= endTime || endTime <= block.timestamp) {
            revert InvalidTimeRange(startTime, endTime);
        }

        _timeBasedAccess[account][permission] = TimeBasedAccess({
            startTime: startTime,
            endTime: endTime,
            isActive: true
        });
    }

    /**
     * @dev Activates emergency override for an account
     * @param account Account to activate override for
     */
    function activateEmergencyOverride(address account) external onlyRole(EMERGENCY_RESPONDER_ROLE) {
        _emergencyOverride[account] = true;
        emit EmergencyOverrideActivated(account, msg.sender);
    }

    /**
     * @dev Deactivates emergency override for an account
     * @param account Account to deactivate override for
     */
    function deactivateEmergencyOverride(address account) external onlyRole(SUPER_ADMIN_ROLE) {
        _emergencyOverride[account] = false;
        emit EmergencyOverrideDeactivated(account, msg.sender);
    }

    /**
     * @dev Checks if an account has a specific permission
     * @param account Account to check
     * @param permission Permission to check
     * @return hasAccess Whether the account has the permission
     */
    function hasPermission(address account, bytes32 permission) public view returns (bool hasAccess) {
        // Check emergency override
        if (_emergencyOverride[account]) {
            return true;
        }

        // Check direct role permissions
        if (_hasDirectPermission(account, permission)) {
            return true;
        }

        // Check delegated permissions
        if (_hasDelegatedPermission(account, permission)) {
            return true;
        }

        // Check time-based access
        if (_hasTimeBasedAccess(account, permission)) {
            return true;
        }

        return false;
    }

    /**
     * @dev Checks if a role is still valid (not expired)
     * @param role Role to check
     * @param account Account to check
     * @return isValid Whether the role is still valid
     */
    function isRoleValid(bytes32 role, address account) public view returns (bool isValid) {
        if (!hasRole(role, account)) {
            return false;
        }

        bytes32 roleKey = _getRoleKey(role, account);
        uint256 expiryTime = _roleExpiryTimes[roleKey];
        
        if (expiryTime == 0) {
            return true; // No expiry set
        }

        return block.timestamp <= expiryTime;
    }

    /**
     * @dev Revokes expired roles for an account
     * @param account Account to check and revoke expired roles for
     */
    function revokeExpiredRoles(address account) external {
        bytes32[] memory roles = _getAllRoles();
        
        for (uint256 i = 0; i < roles.length; i++) {
            if (hasRole(roles[i], account) && !isRoleValid(roles[i], account)) {
                _revokeRole(roles[i], account);
                emit InactiveRoleRevoked(roles[i], account);
            }
        }
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Checks time-based access for an account and permission
     */
    function _checkTimeBasedAccess(address account, bytes32 permission) internal view {
        TimeBasedAccess memory access = _timeBasedAccess[account][permission];
        
        if (access.isActive) {
            require(
                block.timestamp >= access.startTime && block.timestamp <= access.endTime,
                "Time-based access not valid"
            );
        }
    }

    /**
     * @dev Checks if account has direct permission through roles
     */
    function _hasDirectPermission(address account, bytes32 permission) internal view returns (bool) {
        // Map permissions to roles
        if (permission == CAN_SUBMIT_DATA) {
            return hasRole(NODE_OPERATOR_ROLE, account) && isRoleValid(NODE_OPERATOR_ROLE, account);
        }
        if (permission == CAN_PROCESS_CONSENSUS) {
            return hasRole(ORACLE_ADMIN_ROLE, account) && isRoleValid(ORACLE_ADMIN_ROLE, account);
        }
        if (permission == CAN_MANAGE_NODES) {
            return hasRole(ORACLE_ADMIN_ROLE, account) && isRoleValid(ORACLE_ADMIN_ROLE, account);
        }
        if (permission == CAN_UPDATE_CONFIG) {
            return hasRole(ADMIN_ROLE, account) && isRoleValid(ADMIN_ROLE, account);
        }
        if (permission == CAN_PAUSE_SYSTEM) {
            return hasRole(EMERGENCY_RESPONDER_ROLE, account) && isRoleValid(EMERGENCY_RESPONDER_ROLE, account);
        }
        if (permission == CAN_UPGRADE_CONTRACTS) {
            return hasRole(SUPER_ADMIN_ROLE, account) && isRoleValid(SUPER_ADMIN_ROLE, account);
        }
        if (permission == CAN_BLACKLIST_NODES) {
            return hasRole(SECURITY_OFFICER_ROLE, account) && isRoleValid(SECURITY_OFFICER_ROLE, account);
        }
        if (permission == CAN_VIEW_SENSITIVE_DATA) {
            return hasRole(MONITOR_ROLE, account) && isRoleValid(MONITOR_ROLE, account);
        }
        
        return false;
    }

    /**
     * @dev Checks if account has delegated permission
     */
    function _hasDelegatedPermission(address account, bytes32 permission) internal view returns (bool) {
        // This is a simplified check - in production you'd iterate through delegations
        // For now, we'll return false as delegation lookup requires more complex indexing
        return false;
    }

    /**
     * @dev Checks if account has time-based access to permission
     */
    function _hasTimeBasedAccess(address account, bytes32 permission) internal view returns (bool) {
        TimeBasedAccess memory access = _timeBasedAccess[account][permission];
        
        if (!access.isActive) {
            return false;
        }

        return block.timestamp >= access.startTime && block.timestamp <= access.endTime;
    }

    /**
     * @dev Creates a unique key for role-account combination
     */
    function _getRoleKey(bytes32 role, address account) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(role, account));
    }

    /**
     * @dev Returns all defined roles
     */
    function _getAllRoles() internal pure returns (bytes32[] memory) {
        bytes32[] memory roles = new bytes32[](7);
        roles[0] = SUPER_ADMIN_ROLE;
        roles[1] = ADMIN_ROLE;
        roles[2] = ORACLE_ADMIN_ROLE;
        roles[3] = NODE_OPERATOR_ROLE;
        roles[4] = SECURITY_OFFICER_ROLE;
        roles[5] = MONITOR_ROLE;
        roles[6] = EMERGENCY_RESPONDER_ROLE;
        return roles;
    }

    // ============ UPGRADE FUNCTIONS ============

    /**
     * @dev Authorizes contract upgrades
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(SUPER_ADMIN_ROLE) {
        // Additional upgrade validation can be added here
    }

    /**
     * @dev Returns contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
