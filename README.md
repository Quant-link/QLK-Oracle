# Quantlink Oracle Contracts

Enterprise-grade decentralized oracle system for CEX/DEX fee data aggregation with 10-node consensus mechanism and 5-minute update cycles.

## 🏗️ Architecture Overview

The Quantlink Oracle system consists of seven core contracts working together to provide reliable, secure, and decentralized fee data:

### Core Contracts

- **QuantlinkOracle**: Main oracle contract managing consensus rounds and data aggregation
- **NodeManager**: Handles 10-node network with automatic rotation and backup mechanisms
- **ConsensusEngine**: Implements 6/10 majority voting with outlier detection
- **SecurityManager**: Advanced threat detection, rate limiting, and security monitoring
- **AccessControlManager**: Fine-grained role-based permissions with time-based access
- **PriceFeedAdapter**: Chainlink-compatible interface for seamless protocol integration
- **ProtocolIntegration**: Helper contract for common integration patterns

## Key Features

### Oracle Functionality
- **5-minute update cycles** with 180-second submission windows
- **6/10 majority consensus** requirement for data validation
- **Automatic node rotation** every 5 minutes for decentralization
- **Backup node activation** for fault tolerance
- **Real-time outlier detection** and data validation

### Security Features
- **Multi-layered access control** with role hierarchies
- **Rate limiting** (max 100 submissions/hour per node)
- **Replay attack prevention** with submission hash tracking
- **Anomaly detection** for suspicious patterns
- **Emergency pause/unpause** functionality
- **Blacklist management** with automatic threat response

### Integration Features
- **Chainlink AggregatorV3Interface compatibility**
- **Real-time data freshness monitoring**
- **Subscription-based update notifications**
- **Historical data queries** with configurable time windows
- **Protocol-specific fee calculation** with bounds checking
- **Health monitoring** and fallback mechanisms

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/quantlink/oracle-contracts.git
cd oracle-contracts

# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests
npm test

# Run coverage
npm run test:coverage
```

## 🔧 Configuration

Create a `.env` file with your configuration:

```env
# Network Configuration
INFURA_API_KEY=your_infura_key
ALCHEMY_API_KEY=your_alchemy_key
PRIVATE_KEY=your_private_key

# Deployment Configuration
ADMIN_ADDRESS=0x...
NODE_ADDRESSES=0x...,0x...,0x...
EMERGENCY_MULTISIG=0x...

# Etherscan Verification
ETHERSCAN_API_KEY=your_etherscan_key
POLYGONSCAN_API_KEY=your_polygonscan_key
ARBISCAN_API_KEY=your_arbiscan_key
```

## Deployment

### Local Development
```bash
# Start local node
npm run node

# Deploy to localhost
npm run deploy:localhost
```

### Testnet Deployment
```bash
# Deploy to Sepolia
npm run deploy:sepolia

# Verify contracts
npm run verify:sepolia
```

### Mainnet Deployment
```bash
# Deploy to mainnet (requires proper configuration)
npm run deploy:mainnet

# Verify contracts
npm run verify:mainnet
```

## Upgrades

The system supports UUPS upgradeable contracts:

```bash
# Upgrade specific contracts
UPGRADE_CONTRACTS=QuantlinkOracle,NodeManager npm run upgrade

# Emergency upgrade (skips validation)
EMERGENCY_UPGRADE=true npm run upgrade

# Deploy new implementation only
NEW_IMPLEMENTATION_ONLY=true npm run upgrade
```

## Testing

Comprehensive test suite covering all functionality:

```bash
# Run all tests
npm test

# Run specific test files
npm test test/unit/QuantlinkOracle.test.ts
npm test test/integration/OracleSystem.test.ts

# Run with gas reporting
npm run test:gas

# Generate coverage report
npm run test:coverage
```

## Integration Examples

### Chainlink-Compatible Integration

```solidity
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract MyProtocol {
    AggregatorV3Interface internal priceFeed;

    constructor(address _priceFeed) {
        priceFeed = AggregatorV3Interface(_priceFeed);
    }

    function getLatestPrice() public view returns (int) {
        (,int price,,,) = priceFeed.latestRoundData();
        return price;
    }
}
```

### Native Quantlink Integration

```solidity
import "./interfaces/IQuantlinkOracle.sol";

contract MyProtocol {
    IQuantlinkOracle internal oracle;

    constructor(address _oracle) {
        oracle = IQuantlinkOracle(_oracle);
    }

    function getLatestFeeData() public view returns (IQuantlinkOracle.FeeData memory) {
        return oracle.getLatestFeeData();
    }

    function calculateDynamicFee(uint256 amount) public view returns (uint256) {
        IQuantlinkOracle.FeeData memory data = oracle.getLatestFeeData();

        // Use CEX fees for dynamic fee calculation
        uint256 avgCexFee = 0;
        for (uint i = 0; i < data.cexFees.length; i++) {
            avgCexFee += data.cexFees[i];
        }
        avgCexFee = avgCexFee / data.cexFees.length;

        return (amount * avgCexFee) / 10000; // Convert from basis points
    }
}
```

### Protocol Integration Helper

```solidity
import "./interfaces/IProtocolIntegration.sol";

contract MyProtocol {
    IProtocolIntegration internal integration;

    constructor(address _integration) {
        integration = IProtocolIntegration(_integration);
    }

    function registerWithOracle() external {
        integration.registerProtocol(
            address(this),
            IProtocolIntegration.IntegrationType.FeeCalculation,
            priceFeedAddress,
            300, // 5 minute updates
            "0x" // custom config
        );
    }

    function calculateFeeWithOracle(uint256 amount) external view returns (uint256) {
        (uint256 fee,) = integration.calculateFee(
            address(this),
            amount,
            2 // combined fee type
        );
        return fee;
    }
}
```

## 🔒 Security Considerations

### Access Control
- **Role-based permissions** with hierarchical structure
- **Time-based access control** for sensitive operations
- **Emergency override** capabilities for critical situations
- **Multi-signature support** for admin operations

### Data Integrity
- **Cryptographic signature verification** for all submissions
- **Merkle proof validation** for data authenticity
- **Replay attack prevention** with nonce-based protection
- **Statistical outlier detection** for data quality

### Operational Security
- **Rate limiting** to prevent spam attacks
- **Blacklist management** for malicious actors
- **Emergency pause** functionality for critical issues
- **Automated threat response** based on severity levels

## 📈 Monitoring and Maintenance

### Health Monitoring
```solidity
// Check Oracle health
(bool isHealthy, bool consensusReached, uint8 activeNodes, uint256 lastConsensusTime) =
    priceFeed.getOracleHealth();

// Check data freshness
(bool isFresh, uint256 lastUpdateTime, uint256 stalenessThreshold) =
    priceFeed.getDataFreshness();

// Get quality metrics
(uint8 accuracy, uint16 precision, uint8 reliability, uint8 coverage) =
    priceFeed.getDataQualityMetrics();
```

### Emergency Procedures
```solidity
// Emergency pause (admin only)
oracle.emergencyPause();

// Security threat response
securityManager.setThreatLevel(5); // Critical level

// Node management
nodeManager.suspendNode(maliciousNode, "Detected malicious behavior");
nodeManager.activateBackupNode(failedNode);
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the BSD-3-Clause License - see the [LICENSE](LICENSE) file for details.

## Support

- **Documentation**: [docs.quantlink.io](https://docs.quantlink.io)
- **Discord**: [discord.gg/quantlink](https://discord.gg/quantlink)
- **Email**: support@quantlink.io
- **GitHub Issues**: [github.com/quantlink/oracle-contracts/issues](https://github.com/quantlink/oracle-contracts/issues)

## Acknowledgments

- OpenZeppelin for secure contract libraries
- Chainlink for oracle interface standards
- Hardhat for development framework
- The Ethereum community for continuous innovation