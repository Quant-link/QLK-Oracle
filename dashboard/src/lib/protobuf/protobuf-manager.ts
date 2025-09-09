/**
 * @fileoverview Protocol Buffers Manager for efficient binary data transfer
 * @author QuantLink Team
 * @version 1.0.0
 */

import { load, Root, Type, Message } from 'protobufjs';

export interface ProtobufConfig {
  protoPath: string;
  enableCompression: boolean;
  enableValidation: boolean;
  cacheMessages: boolean;
}

export class ProtobufManager {
  private root: Root | null = null;
  private messageTypes: Map<string, Type> = new Map();
  private messageCache: Map<string, any> = new Map();
  private config: ProtobufConfig;
  private isInitialized = false;

  constructor(config: Partial<ProtobufConfig> = {}) {
    this.config = {
      protoPath: '/proto/oracle-data.proto',
      enableCompression: true,
      enableValidation: true,
      cacheMessages: false,
      ...config,
    };
  }

  /**
   * Initialize Protocol Buffers
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.root = await load(this.config.protoPath);
      this.loadMessageTypes();
      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Protocol Buffers: ${error}`);
    }
  }

  /**
   * Encode message to binary format
   */
  public encode(messageType: string, data: any): Uint8Array {
    if (!this.isInitialized) {
      throw new Error('ProtobufManager not initialized');
    }

    const type = this.messageTypes.get(messageType);
    if (!type) {
      throw new Error(`Message type not found: ${messageType}`);
    }

    try {
      // Validate message if enabled
      if (this.config.enableValidation) {
        const errMsg = type.verify(data);
        if (errMsg) {
          throw new Error(`Message validation failed: ${errMsg}`);
        }
      }

      // Create and encode message
      const message = type.create(data);
      const buffer = type.encode(message).finish();

      // Apply compression if enabled
      if (this.config.enableCompression) {
        return this.compress(buffer);
      }

      return buffer;
    } catch (error) {
      throw new Error(`Failed to encode message: ${error}`);
    }
  }

  /**
   * Decode binary data to message
   */
  public decode(messageType: string, buffer: Uint8Array): any {
    if (!this.isInitialized) {
      throw new Error('ProtobufManager not initialized');
    }

    const type = this.messageTypes.get(messageType);
    if (!type) {
      throw new Error(`Message type not found: ${messageType}`);
    }

    try {
      // Decompress if needed
      let decodedBuffer = buffer;
      if (this.config.enableCompression && this.isCompressed(buffer)) {
        decodedBuffer = this.decompress(buffer);
      }

      // Decode message
      const message = type.decode(decodedBuffer);
      const object = type.toObject(message, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: true,
        arrays: true,
        objects: true,
      });

      // Cache message if enabled
      if (this.config.cacheMessages) {
        const cacheKey = this.generateCacheKey(messageType, object);
        this.messageCache.set(cacheKey, object);
      }

      return object;
    } catch (error) {
      throw new Error(`Failed to decode message: ${error}`);
    }
  }

  /**
   * Encode Oracle Data Message
   */
  public encodeOracleData(data: any): Uint8Array {
    return this.encode('quantlink.oracle.OracleDataMessage', data);
  }

  /**
   * Decode Oracle Data Message
   */
  public decodeOracleData(buffer: Uint8Array): any {
    return this.decode('quantlink.oracle.OracleDataMessage', buffer);
  }

  /**
   * Encode Price Update
   */
  public encodePriceUpdate(data: any): Uint8Array {
    return this.encode('quantlink.oracle.PriceUpdate', data);
  }

  /**
   * Decode Price Update
   */
  public decodePriceUpdate(buffer: Uint8Array): any {
    return this.decode('quantlink.oracle.PriceUpdate', buffer);
  }

  /**
   * Encode Fee Update
   */
  public encodeFeeUpdate(data: any): Uint8Array {
    return this.encode('quantlink.oracle.FeeUpdate', data);
  }

  /**
   * Decode Fee Update
   */
  public decodeFeeUpdate(buffer: Uint8Array): any {
    return this.decode('quantlink.oracle.FeeUpdate', buffer);
  }

  /**
   * Encode Aggregated Data
   */
  public encodeAggregatedData(data: any): Uint8Array {
    return this.encode('quantlink.oracle.AggregatedData', data);
  }

  /**
   * Decode Aggregated Data
   */
  public decodeAggregatedData(buffer: Uint8Array): any {
    return this.decode('quantlink.oracle.AggregatedData', buffer);
  }

  /**
   * Encode Subscription Message
   */
  public encodeSubscription(data: any): Uint8Array {
    return this.encode('quantlink.oracle.SubscriptionMessage', data);
  }

  /**
   * Decode Subscription Message
   */
  public decodeSubscription(buffer: Uint8Array): any {
    return this.decode('quantlink.oracle.SubscriptionMessage', buffer);
  }

  /**
   * Encode Authentication Message
   */
  public encodeAuth(data: any): Uint8Array {
    return this.encode('quantlink.oracle.AuthMessage', data);
  }

  /**
   * Decode Authentication Message
   */
  public decodeAuth(buffer: Uint8Array): any {
    return this.decode('quantlink.oracle.AuthMessage', buffer);
  }

  /**
   * Encode Error Message
   */
  public encodeError(data: any): Uint8Array {
    return this.encode('quantlink.oracle.ErrorMessage', data);
  }

  /**
   * Decode Error Message
   */
  public decodeError(buffer: Uint8Array): any {
    return this.decode('quantlink.oracle.ErrorMessage', buffer);
  }

  /**
   * Encode Heartbeat Message
   */
  public encodeHeartbeat(data: any): Uint8Array {
    return this.encode('quantlink.oracle.HeartbeatMessage', data);
  }

  /**
   * Decode Heartbeat Message
   */
  public decodeHeartbeat(buffer: Uint8Array): any {
    return this.decode('quantlink.oracle.HeartbeatMessage', buffer);
  }

  /**
   * Get message type information
   */
  public getMessageType(messageType: string): Type | undefined {
    return this.messageTypes.get(messageType);
  }

  /**
   * List all available message types
   */
  public getAvailableMessageTypes(): string[] {
    return Array.from(this.messageTypes.keys());
  }

  /**
   * Validate message against schema
   */
  public validateMessage(messageType: string, data: any): string | null {
    const type = this.messageTypes.get(messageType);
    if (!type) {
      return `Message type not found: ${messageType}`;
    }

    return type.verify(data) || null;
  }

  /**
   * Get message size estimation
   */
  public estimateMessageSize(messageType: string, data: any): number {
    try {
      const encoded = this.encode(messageType, data);
      return encoded.length;
    } catch {
      return -1;
    }
  }

  /**
   * Clear message cache
   */
  public clearCache(): void {
    this.messageCache.clear();
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.messageCache.size,
      hitRate: 0, // TODO: Implement hit rate tracking
    };
  }

  /**
   * Load message types from proto definition
   */
  private loadMessageTypes(): void {
    if (!this.root) return;

    const namespace = this.root.lookup('quantlink.oracle');
    if (!namespace) {
      throw new Error('Oracle namespace not found in proto definition');
    }

    // Load all message types
    const messageTypes = [
      'OracleDataMessage',
      'PriceUpdate',
      'FeeUpdate',
      'VolumeUpdate',
      'HealthStatus',
      'MarketData',
      'AggregatedData',
      'CexData',
      'DexData',
      'PoolData',
      'QualityMetrics',
      'VolumeBreakdown',
      'FeeStructure',
      'FeeTier',
      'SubscriptionMessage',
      'Subscribe',
      'Unsubscribe',
      'SubscriptionStatus',
      'SubscriptionOptions',
      'AuthMessage',
      'ApiKeyAuth',
      'JwtAuth',
      'Web3Auth',
      'ErrorMessage',
      'HeartbeatMessage',
      'ConnectionMetrics',
    ];

    messageTypes.forEach(typeName => {
      const type = namespace.lookup(typeName) as Type;
      if (type) {
        this.messageTypes.set(`quantlink.oracle.${typeName}`, type);
      }
    });
  }

  /**
   * Compress binary data using simple compression
   */
  private compress(buffer: Uint8Array): Uint8Array {
    // Simple compression implementation
    // In production, use a proper compression library like pako
    const compressed = new Uint8Array(buffer.length + 1);
    compressed[0] = 1; // Compression flag
    compressed.set(buffer, 1);
    return compressed;
  }

  /**
   * Decompress binary data
   */
  private decompress(buffer: Uint8Array): Uint8Array {
    // Simple decompression implementation
    if (buffer[0] === 1) {
      return buffer.slice(1);
    }
    return buffer;
  }

  /**
   * Check if buffer is compressed
   */
  private isCompressed(buffer: Uint8Array): boolean {
    return buffer.length > 0 && buffer[0] === 1;
  }

  /**
   * Generate cache key for message
   */
  private generateCacheKey(messageType: string, data: any): string {
    try {
      return `${messageType}:${JSON.stringify(data)}`;
    } catch {
      return `${messageType}:${Date.now()}`;
    }
  }

  /**
   * Destroy the protobuf manager
   */
  public destroy(): void {
    this.messageTypes.clear();
    this.messageCache.clear();
    this.root = null;
    this.isInitialized = false;
  }
}

// Singleton instance
let protobufManager: ProtobufManager | null = null;

export function getProtobufManager(config?: Partial<ProtobufConfig>): ProtobufManager {
  if (!protobufManager) {
    protobufManager = new ProtobufManager(config);
  }
  return protobufManager;
}

export default ProtobufManager;
