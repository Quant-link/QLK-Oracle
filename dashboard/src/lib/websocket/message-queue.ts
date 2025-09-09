/**
 * @fileoverview Message Queue with priority lanes for WebSocket communication
 * @author QuantLink Team
 * @version 1.0.0
 */

export enum MessagePriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

export interface QueuedMessage {
  id: string;
  event: string;
  data: any;
  priority: MessagePriority;
  timestamp: number;
  retries: number;
  maxRetries: number;
  timeout?: number;
  callback?: (error?: Error, response?: any) => void;
}

export interface QueueConfig {
  maxSize: number;
  maxRetries: number;
  defaultTimeout: number;
  batchSize: number;
  flushInterval: number;
}

export class MessageQueue {
  private queues: Map<MessagePriority, QueuedMessage[]> = new Map();
  private config: QueueConfig;
  private flushTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private messageIdCounter = 0;
  private pendingMessages = new Map<string, QueuedMessage>();

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = {
      maxSize: 1000,
      maxRetries: 3,
      defaultTimeout: 30000,
      batchSize: 10,
      flushInterval: 100,
      ...config,
    };

    // Initialize priority queues
    Object.values(MessagePriority).forEach(priority => {
      if (typeof priority === 'number') {
        this.queues.set(priority, []);
      }
    });

    this.startFlushTimer();
  }

  /**
   * Add message to queue
   */
  public enqueue(
    event: string,
    data: any,
    priority: MessagePriority = MessagePriority.NORMAL,
    options: {
      maxRetries?: number;
      timeout?: number;
      callback?: (error?: Error, response?: any) => void;
    } = {}
  ): string {
    const messageId = this.generateMessageId();
    
    const message: QueuedMessage = {
      id: messageId,
      event,
      data,
      priority,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: options.maxRetries ?? this.config.maxRetries,
      timeout: options.timeout ?? this.config.defaultTimeout,
      callback: options.callback,
    };

    const queue = this.queues.get(priority);
    if (!queue) {
      throw new Error(`Invalid priority: ${priority}`);
    }

    // Check queue size limits
    if (this.getTotalSize() >= this.config.maxSize) {
      // Remove oldest low priority messages
      this.evictLowPriorityMessages();
    }

    queue.push(message);
    this.pendingMessages.set(messageId, message);

    return messageId;
  }

  /**
   * Get next batch of messages to send
   */
  public dequeue(batchSize: number = this.config.batchSize): QueuedMessage[] {
    const batch: QueuedMessage[] = [];
    
    // Process messages by priority (highest first)
    const priorities = [
      MessagePriority.CRITICAL,
      MessagePriority.HIGH,
      MessagePriority.NORMAL,
      MessagePriority.LOW,
    ];

    for (const priority of priorities) {
      const queue = this.queues.get(priority);
      if (!queue || queue.length === 0) continue;

      while (batch.length < batchSize && queue.length > 0) {
        const message = queue.shift();
        if (message) {
          batch.push(message);
        }
      }

      if (batch.length >= batchSize) break;
    }

    return batch;
  }

  /**
   * Mark message as sent successfully
   */
  public markSent(messageId: string, response?: any): void {
    const message = this.pendingMessages.get(messageId);
    if (message) {
      this.pendingMessages.delete(messageId);
      
      if (message.callback) {
        message.callback(undefined, response);
      }
    }
  }

  /**
   * Mark message as failed and retry if possible
   */
  public markFailed(messageId: string, error: Error): void {
    const message = this.pendingMessages.get(messageId);
    if (!message) return;

    message.retries++;

    if (message.retries <= message.maxRetries) {
      // Retry message - add back to queue with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, message.retries), 30000);
      
      setTimeout(() => {
        const queue = this.queues.get(message.priority);
        if (queue) {
          // Add to front of queue for retry
          queue.unshift(message);
        }
      }, delay);
    } else {
      // Max retries exceeded
      this.pendingMessages.delete(messageId);
      
      if (message.callback) {
        message.callback(new Error(`Max retries exceeded: ${error.message}`));
      }
    }
  }

  /**
   * Remove message from queue
   */
  public remove(messageId: string): boolean {
    const message = this.pendingMessages.get(messageId);
    if (!message) return false;

    this.pendingMessages.delete(messageId);

    // Remove from queue
    const queue = this.queues.get(message.priority);
    if (queue) {
      const index = queue.findIndex(m => m.id === messageId);
      if (index !== -1) {
        queue.splice(index, 1);
        return true;
      }
    }

    return false;
  }

  /**
   * Clear all messages
   */
  public clear(): void {
    this.queues.forEach(queue => queue.length = 0);
    this.pendingMessages.clear();
  }

  /**
   * Get queue statistics
   */
  public getStats(): {
    totalMessages: number;
    messagesByPriority: Record<MessagePriority, number>;
    pendingMessages: number;
    oldestMessage?: number;
  } {
    const stats = {
      totalMessages: this.getTotalSize(),
      messagesByPriority: {} as Record<MessagePriority, number>,
      pendingMessages: this.pendingMessages.size,
      oldestMessage: undefined as number | undefined,
    };

    let oldestTimestamp = Infinity;

    this.queues.forEach((queue, priority) => {
      stats.messagesByPriority[priority] = queue.length;
      
      if (queue.length > 0) {
        const oldest = Math.min(...queue.map(m => m.timestamp));
        if (oldest < oldestTimestamp) {
          oldestTimestamp = oldest;
        }
      }
    });

    if (oldestTimestamp !== Infinity) {
      stats.oldestMessage = Date.now() - oldestTimestamp;
    }

    return stats;
  }

  /**
   * Check if queue is empty
   */
  public isEmpty(): boolean {
    return this.getTotalSize() === 0;
  }

  /**
   * Get total number of messages across all queues
   */
  public getTotalSize(): number {
    let total = 0;
    this.queues.forEach(queue => {
      total += queue.length;
    });
    return total;
  }

  /**
   * Start automatic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (!this.isEmpty() && !this.isProcessing) {
        this.processQueue();
      }
    }, this.config.flushInterval);
  }

  /**
   * Stop flush timer
   */
  public stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Process queue and emit flush event
   */
  private processQueue(): void {
    if (this.isProcessing || this.isEmpty()) return;

    this.isProcessing = true;
    
    try {
      const batch = this.dequeue();
      if (batch.length > 0) {
        // Emit event for external processing
        this.emit('flush', batch);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Evict low priority messages when queue is full
   */
  private evictLowPriorityMessages(): void {
    const lowPriorityQueue = this.queues.get(MessagePriority.LOW);
    if (lowPriorityQueue && lowPriorityQueue.length > 0) {
      const evicted = lowPriorityQueue.shift();
      if (evicted) {
        this.pendingMessages.delete(evicted.id);
        
        if (evicted.callback) {
          evicted.callback(new Error('Message evicted due to queue overflow'));
        }
      }
    }
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${++this.messageIdCounter}`;
  }

  /**
   * Clean up expired messages
   */
  public cleanupExpiredMessages(): void {
    const now = Date.now();
    
    this.queues.forEach((queue, priority) => {
      for (let i = queue.length - 1; i >= 0; i--) {
        const message = queue[i];
        
        if (message.timeout && (now - message.timestamp) > message.timeout) {
          queue.splice(i, 1);
          this.pendingMessages.delete(message.id);
          
          if (message.callback) {
            message.callback(new Error('Message timeout'));
          }
        }
      }
    });
  }

  /**
   * Event emitter functionality
   */
  private listeners: Map<string, Function[]> = new Map();

  public on(event: string, listener: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  public off(event: string, listener: Function): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index !== -1) {
        eventListeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, ...args: any[]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(listener => {
        try {
          listener(...args);
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      });
    }
  }

  /**
   * Destroy the message queue
   */
  public destroy(): void {
    this.stopFlushTimer();
    this.clear();
    this.listeners.clear();
  }
}

export default MessageQueue;
