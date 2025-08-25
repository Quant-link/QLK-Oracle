// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.28;

/**
 * @title DataValidation
 * @dev Library for validating oracle data submissions and detecting anomalies
 * @notice Provides comprehensive validation for CEX/DEX fee data
 */
library DataValidation {
    // Constants for validation thresholds
    uint256 public constant MAX_FEE_BASIS_POINTS = 10000; // 100%
    uint256 public constant MIN_FEE_BASIS_POINTS = 0;
    uint256 public constant MAX_DEVIATION_THRESHOLD = 5000; // 50%
    uint256 public constant OUTLIER_DETECTION_THRESHOLD = 2000; // 20%
    uint256 public constant MAX_TIMESTAMP_DRIFT = 300; // 5 minutes
    uint256 public constant MIN_DATA_POINTS = 3;
    uint256 public constant MAX_DATA_POINTS = 50;

    /**
     * @dev Custom errors for validation failures
     */
    error InvalidFeeRange(uint256 fee, uint256 min, uint256 max);
    error InvalidDataLength(uint256 actual, uint256 expected);
    error TimestampTooOld(uint256 timestamp, uint256 current);
    error TimestampTooFuture(uint256 timestamp, uint256 current);
    error InsufficientDataPoints(uint256 actual, uint256 required);
    error ExcessiveDataPoints(uint256 actual, uint256 maximum);
    error DataDeviationTooHigh(uint256 deviation, uint256 threshold);
    error EmptyDataArray();

    /**
     * @dev Struct for validation results
     */
    struct ValidationResult {
        bool isValid;
        string[] errors;
        uint256 confidence;
        uint256 deviation;
    }

    /**
     * @dev Validates fee data arrays for basic constraints
     * @param cexFees Array of CEX fees to validate
     * @param dexFees Array of DEX fees to validate
     * @return result Validation result with details
     */
    function validateFeeData(
        uint256[] memory cexFees,
        uint256[] memory dexFees
    ) internal pure returns (ValidationResult memory result) {
        result.errors = new string[](10); // Pre-allocate for efficiency
        uint256 errorCount = 0;

        // Check array lengths
        if (cexFees.length == 0 || dexFees.length == 0) {
            result.errors[errorCount++] = "Empty data arrays not allowed";
            result.isValid = false;
            return result;
        }

        if (cexFees.length < MIN_DATA_POINTS || dexFees.length < MIN_DATA_POINTS) {
            result.errors[errorCount++] = "Insufficient data points";
        }

        if (cexFees.length > MAX_DATA_POINTS || dexFees.length > MAX_DATA_POINTS) {
            result.errors[errorCount++] = "Too many data points";
        }

        // Validate individual fee values
        for (uint256 i = 0; i < cexFees.length; i++) {
            if (cexFees[i] > MAX_FEE_BASIS_POINTS) {
                result.errors[errorCount++] = "CEX fee exceeds maximum";
                break;
            }
        }

        for (uint256 i = 0; i < dexFees.length; i++) {
            if (dexFees[i] > MAX_FEE_BASIS_POINTS) {
                result.errors[errorCount++] = "DEX fee exceeds maximum";
                break;
            }
        }

        // Calculate statistical measures
        result.deviation = calculateArrayDeviation(cexFees);
        result.confidence = calculateConfidence(cexFees, dexFees);

        // Resize errors array to actual size
        string[] memory actualErrors = new string[](errorCount);
        for (uint256 i = 0; i < errorCount; i++) {
            actualErrors[i] = result.errors[i];
        }
        result.errors = actualErrors;

        result.isValid = errorCount == 0;
        return result;
    }

    /**
     * @dev Validates timestamp against current block timestamp
     * @param timestamp Timestamp to validate
     * @return isValid Whether timestamp is valid
     */
    function validateTimestamp(uint256 timestamp) internal view returns (bool isValid) {
        uint256 currentTime = block.timestamp;
        
        // Check if timestamp is too old
        if (timestamp + MAX_TIMESTAMP_DRIFT < currentTime) {
            return false;
        }
        
        // Check if timestamp is too far in the future
        if (timestamp > currentTime + MAX_TIMESTAMP_DRIFT) {
            return false;
        }
        
        return true;
    }

    /**
     * @dev Detects outliers in data array using statistical methods
     * @param data Array of data points to analyze
     * @param threshold Deviation threshold for outlier detection
     * @return outlierIndices Indices of detected outliers
     */
    function detectOutliers(
        uint256[] memory data,
        uint256 threshold
    ) internal pure returns (uint256[] memory outlierIndices) {
        if (data.length < 3) {
            return new uint256[](0);
        }

        uint256 median = calculateMedian(data);
        uint256[] memory tempOutliers = new uint256[](data.length);
        uint256 outlierCount = 0;

        for (uint256 i = 0; i < data.length; i++) {
            uint256 deviation = data[i] > median 
                ? ((data[i] - median) * 10000) / median
                : ((median - data[i]) * 10000) / median;
            
            if (deviation > threshold) {
                tempOutliers[outlierCount++] = i;
            }
        }

        // Resize to actual outlier count
        outlierIndices = new uint256[](outlierCount);
        for (uint256 i = 0; i < outlierCount; i++) {
            outlierIndices[i] = tempOutliers[i];
        }

        return outlierIndices;
    }

    /**
     * @dev Calculates median value of an array
     * @param data Array to calculate median for
     * @return median Median value
     */
    function calculateMedian(uint256[] memory data) internal pure returns (uint256 median) {
        if (data.length == 0) revert EmptyDataArray();
        
        // Sort array (simple bubble sort for small arrays)
        uint256[] memory sortedData = new uint256[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            sortedData[i] = data[i];
        }
        
        for (uint256 i = 0; i < sortedData.length - 1; i++) {
            for (uint256 j = 0; j < sortedData.length - i - 1; j++) {
                if (sortedData[j] > sortedData[j + 1]) {
                    uint256 temp = sortedData[j];
                    sortedData[j] = sortedData[j + 1];
                    sortedData[j + 1] = temp;
                }
            }
        }
        
        if (sortedData.length % 2 == 0) {
            median = (sortedData[sortedData.length / 2 - 1] + sortedData[sortedData.length / 2]) / 2;
        } else {
            median = sortedData[sortedData.length / 2];
        }
        
        return median;
    }

    /**
     * @dev Calculates standard deviation of an array
     * @param data Array to calculate deviation for
     * @return deviation Standard deviation
     */
    function calculateArrayDeviation(uint256[] memory data) internal pure returns (uint256 deviation) {
        if (data.length <= 1) return 0;
        
        uint256 mean = calculateMean(data);
        uint256 sumSquaredDiffs = 0;
        
        for (uint256 i = 0; i < data.length; i++) {
            uint256 diff = data[i] > mean ? data[i] - mean : mean - data[i];
            sumSquaredDiffs += diff * diff;
        }
        
        deviation = sqrt(sumSquaredDiffs / data.length);
        return deviation;
    }

    /**
     * @dev Calculates mean (average) of an array
     * @param data Array to calculate mean for
     * @return mean Average value
     */
    function calculateMean(uint256[] memory data) internal pure returns (uint256 mean) {
        if (data.length == 0) return 0;
        
        uint256 sum = 0;
        for (uint256 i = 0; i < data.length; i++) {
            sum += data[i];
        }
        
        mean = sum / data.length;
        return mean;
    }

    /**
     * @dev Calculates confidence score based on data consistency
     * @param cexFees CEX fee data
     * @param dexFees DEX fee data
     * @return confidence Confidence score (0-100)
     */
    function calculateConfidence(
        uint256[] memory cexFees,
        uint256[] memory dexFees
    ) internal pure returns (uint256 confidence) {
        uint256 cexDeviation = calculateArrayDeviation(cexFees);
        uint256 dexDeviation = calculateArrayDeviation(dexFees);
        
        // Lower deviation = higher confidence
        uint256 avgDeviation = (cexDeviation + dexDeviation) / 2;
        
        if (avgDeviation == 0) {
            confidence = 100;
        } else {
            confidence = avgDeviation > 1000 ? 0 : 100 - (avgDeviation / 10);
        }
        
        return confidence;
    }

    /**
     * @dev Calculates square root using Babylonian method
     * @param x Number to calculate square root for
     * @return y Square root of x
     */
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
