// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

/**
 * @title CryptoUtils
 * @dev Library for cryptographic operations in the Quantlink Oracle system
 * @notice Provides signature verification, hashing, and encryption utilities
 */
library CryptoUtils {
    /**
     * @dev Custom errors for cryptographic operations
     */
    error InvalidSignatureLength(uint256 actual, uint256 expected);
    error InvalidSignature();
    error InvalidPublicKey();
    error HashMismatch(bytes32 expected, bytes32 actual);

    /**
     * @dev Struct for signature components
     */
    struct Signature {
        bytes32 r;
        bytes32 s;
        uint8 v;
    }

    /**
     * @dev Verifies ECDSA signature for data submission
     * @param dataHash Hash of the submitted data
     * @param signature Signature to verify
     * @param signer Expected signer address
     * @return isValid Whether signature is valid
     */
    function verifyDataSignature(
        bytes32 dataHash,
        bytes memory signature,
        address signer
    ) internal pure returns (bool isValid) {
        if (signature.length != 65) {
            revert InvalidSignatureLength(signature.length, 65);
        }

        Signature memory sig = splitSignature(signature);
        address recoveredSigner = ecrecover(dataHash, sig.v, sig.r, sig.s);
        
        return recoveredSigner == signer && recoveredSigner != address(0);
    }

    /**
     * @dev Creates hash for fee data submission
     * @param cexFees Array of CEX fees
     * @param dexFees Array of DEX fees
     * @param timestamp Submission timestamp
     * @param nonce Unique nonce to prevent replay attacks
     * @return dataHash Keccak256 hash of the data
     */
    function hashFeeData(
        uint256[] memory cexFees,
        uint256[] memory dexFees,
        uint256 timestamp,
        uint256 nonce
    ) internal pure returns (bytes32 dataHash) {
        return keccak256(abi.encodePacked(
            keccak256(abi.encodePacked(cexFees)),
            keccak256(abi.encodePacked(dexFees)),
            timestamp,
            nonce
        ));
    }

    /**
     * @dev Creates hash for consensus round data
     * @param roundId Consensus round identifier
     * @param cexFees Aggregated CEX fees
     * @param dexFees Aggregated DEX fees
     * @param participatingNodes Number of participating nodes
     * @param timestamp Round timestamp
     * @return roundHash Hash of the consensus round
     */
    function hashConsensusRound(
        uint256 roundId,
        uint256[] memory cexFees,
        uint256[] memory dexFees,
        uint8 participatingNodes,
        uint256 timestamp
    ) internal pure returns (bytes32 roundHash) {
        return keccak256(abi.encodePacked(
            roundId,
            keccak256(abi.encodePacked(cexFees)),
            keccak256(abi.encodePacked(dexFees)),
            participatingNodes,
            timestamp
        ));
    }

    /**
     * @dev Splits signature into r, s, v components
     * @param signature 65-byte signature
     * @return sig Signature components
     */
    function splitSignature(bytes memory signature) internal pure returns (Signature memory sig) {
        if (signature.length != 65) {
            revert InvalidSignatureLength(signature.length, 65);
        }

        // Extract r, s, v from signature
        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        sig.r = r;
        sig.s = s;
        sig.v = v;

        // Adjust v value if necessary
        if (sig.v < 27) {
            sig.v += 27;
        }

        return sig;
    }

    /**
     * @dev Verifies that a public key corresponds to an address
     * @param publicKey 64-byte uncompressed public key
     * @param expectedAddress Expected Ethereum address
     * @return isValid Whether public key matches address
     */
    function verifyPublicKey(
        bytes memory publicKey,
        address expectedAddress
    ) internal pure returns (bool isValid) {
        if (publicKey.length != 64) {
            revert InvalidPublicKey();
        }

        bytes32 hash = keccak256(publicKey);
        address derivedAddress = address(uint160(uint256(hash)));
        
        return derivedAddress == expectedAddress;
    }

    /**
     * @dev Creates a commitment hash for data submission
     * @param data Data to commit to
     * @param salt Random salt for hiding
     * @return commitment Commitment hash
     */
    function createCommitment(
        bytes memory data,
        bytes32 salt
    ) internal pure returns (bytes32 commitment) {
        return keccak256(abi.encodePacked(data, salt));
    }

    /**
     * @dev Verifies a commitment reveal
     * @param commitment Original commitment hash
     * @param data Revealed data
     * @param salt Revealed salt
     * @return isValid Whether reveal is valid
     */
    function verifyCommitmentReveal(
        bytes32 commitment,
        bytes memory data,
        bytes32 salt
    ) internal pure returns (bool isValid) {
        bytes32 computedCommitment = createCommitment(data, salt);
        return computedCommitment == commitment;
    }

    /**
     * @dev Generates a pseudo-random number using block data
     * @param seed Additional entropy seed
     * @return randomNumber Pseudo-random number
     */
    function generatePseudoRandom(bytes32 seed) internal view returns (uint256 randomNumber) {
        return uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            block.number,
            seed
        )));
    }

    /**
     * @dev Creates a merkle root from an array of hashes
     * @param leaves Array of leaf hashes
     * @return root Merkle root hash
     */
    function createMerkleRoot(bytes32[] memory leaves) internal pure returns (bytes32 root) {
        if (leaves.length == 0) {
            return bytes32(0);
        }
        
        if (leaves.length == 1) {
            return leaves[0];
        }

        // Create a working array
        bytes32[] memory currentLevel = new bytes32[](leaves.length);
        for (uint256 i = 0; i < leaves.length; i++) {
            currentLevel[i] = leaves[i];
        }

        while (currentLevel.length > 1) {
            uint256 nextLevelLength = (currentLevel.length + 1) / 2;
            bytes32[] memory nextLevel = new bytes32[](nextLevelLength);
            
            for (uint256 i = 0; i < nextLevelLength; i++) {
                if (2 * i + 1 < currentLevel.length) {
                    nextLevel[i] = keccak256(abi.encodePacked(
                        currentLevel[2 * i],
                        currentLevel[2 * i + 1]
                    ));
                } else {
                    nextLevel[i] = currentLevel[2 * i];
                }
            }
            
            currentLevel = nextLevel;
        }

        return currentLevel[0];
    }

    /**
     * @dev Verifies a merkle proof
     * @param leaf Leaf hash to verify
     * @param proof Array of proof hashes
     * @param root Expected merkle root
     * @return isValid Whether proof is valid
     */
    function verifyMerkleProof(
        bytes32 leaf,
        bytes32[] memory proof,
        bytes32 root
    ) internal pure returns (bool isValid) {
        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        return computedHash == root;
    }

    /**
     * @dev Derives a deterministic address from a seed
     * @param seed Seed for address derivation
     * @param salt Additional salt
     * @return derivedAddress Deterministically derived address
     */
    function deriveAddress(bytes32 seed, bytes32 salt) internal pure returns (address derivedAddress) {
        bytes32 hash = keccak256(abi.encodePacked(seed, salt));
        return address(uint160(uint256(hash)));
    }

    /**
     * @dev Validates signature format and components
     * @param signature Signature to validate
     * @return isValid Whether signature format is valid
     */
    function isValidSignatureFormat(bytes memory signature) internal pure returns (bool isValid) {
        if (signature.length != 65) {
            return false;
        }

        Signature memory sig = splitSignature(signature);
        
        // Check for valid v value
        if (sig.v != 27 && sig.v != 28) {
            return false;
        }

        // Check for valid r and s values (not zero)
        if (sig.r == bytes32(0) || sig.s == bytes32(0)) {
            return false;
        }

        return true;
    }
}
