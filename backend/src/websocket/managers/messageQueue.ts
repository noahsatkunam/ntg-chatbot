import { PrismaClient } from '@prisma/client';
import { Socket } from 'socket.io';
import { logger } from '../../utils/logger';

interface QueuedMessage {
  id: string;
  userId: string;
  conversationId: string;
  message: any;
  createdAt: Date;
}

export class MessageQueue {
  private queue: Map<string, QueuedMessage[]> = new Map();
  private readonly MAX_QUEUE_SIZE = 100;
  private readonly MESSAGE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(private prisma: PrismaClient) {
    // Periodically clean up old messages
    setInterval(() => {
      this.cleanupExpiredMessages();
    }, 60 * 60 * 1000); // Every hour
  }

  /**
   * Add message to queue for offline user
   */
  async queueMessage(
    userId: string,
    conversationId: string,
    message: any
  ): Promise<void> {
    try {
      const queuedMessage: QueuedMessage = {
        id: `queue_${Date.now()}_${Math.random()}`,
        userId,
        conversationId,
        message,
        createdAt: new Date(),
      };

      // Get user's queue
      if (!this.queue.has(userId)) {
        this.queue.set(userId, []);
      }

      const userQueue = this.queue.get(userId)!;

      // Check queue size limit
      if (userQueue.length >= this.MAX_QUEUE_SIZE) {
        // Remove oldest message
        userQueue.shift();
      }

      // Add new message
      userQueue.push(queuedMessage);

      // Also persist to database for reliability
      await this.persistQueuedMessage(queuedMessage);

      logger.debug('Message queued for offline user', {
        userId,
        conversationId,
        queueSize: userQueue.length,
      });
    } catch (error) {
      logger.error('Failed to queue message', { error, userId });
    }
  }

  /**
   * Deliver queued messages to user
   */
  async deliverQueuedMessages(userId: string, socket: Socket): Promise<void> {
    try {
      // Get messages from memory
      const memoryMessages = this.queue.get(userId) || [];

      // Get messages from database (in case of server restart)
      const dbMessages = await this.getPersistedMessages(userId);

      // Combine and deduplicate
      const allMessages = this.deduplicateMessages([...memoryMessages, ...dbMessages]);

      if (allMessages.length === 0) {
        return;
      }

      logger.info('Delivering queued messages', {
        userId,
        count: allMessages.length,
      });

      // Sort by creation date
      allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      // Deliver messages in batches
      const batchSize = 10;
      for (let i = 0; i < allMessages.length; i += batchSize) {
        const batch = allMessages.slice(i, i + batchSize);
        
        socket.emit('messages:queued', {
          messages: batch.map(m => m.message),
          hasMore: i + batchSize < allMessages.length,
        });

        // Small delay between batches
        if (i + batchSize < allMessages.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Clear delivered messages
      this.queue.delete(userId);
      await this.clearPersistedMessages(userId);

    } catch (error) {
      logger.error('Failed to deliver queued messages', { error, userId });
    }
  }

  /**
   * Check if user has queued messages
   */
  hasQueuedMessages(userId: string): boolean {
    const queue = this.queue.get(userId);
    return queue ? queue.length > 0 : false;
  }

  /**
   * Get queue size for user
   */
  getQueueSize(userId: string): number {
    const queue = this.queue.get(userId);
    return queue ? queue.length : 0;
  }

  /**
   * Persist queued message to database
   */
  private async persistQueuedMessage(message: QueuedMessage): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO message_queue (id, user_id, conversation_id, message, created_at)
        VALUES (${message.id}, ${message.userId}, ${message.conversationId}, 
                ${JSON.stringify(message.message)}::jsonb, ${message.createdAt})
        ON CONFLICT (id) DO NOTHING
      `;
    } catch (error) {
      logger.error('Failed to persist queued message', { error });
    }
  }

  /**
   * Get persisted messages from database
   */
  private async getPersistedMessages(userId: string): Promise<QueuedMessage[]> {
    try {
      const results = await this.prisma.$queryRaw<any[]>`
        SELECT id, user_id, conversation_id, message, created_at
        FROM message_queue
        WHERE user_id = ${userId}
        AND created_at > ${new Date(Date.now() - this.MESSAGE_TTL)}
        ORDER BY created_at ASC
        LIMIT ${this.MAX_QUEUE_SIZE}
      `;

      return results.map(r => ({
        id: r.id,
        userId: r.user_id,
        conversationId: r.conversation_id,
        message: r.message,
        createdAt: new Date(r.created_at),
      }));
    } catch (error) {
      logger.error('Failed to get persisted messages', { error });
      return [];
    }
  }

  /**
   * Clear persisted messages for user
   */
  private async clearPersistedMessages(userId: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        DELETE FROM message_queue
        WHERE user_id = ${userId}
      `;
    } catch (error) {
      logger.error('Failed to clear persisted messages', { error });
    }
  }

  /**
   * Deduplicate messages by ID
   */
  private deduplicateMessages(messages: QueuedMessage[]): QueuedMessage[] {
    const seen = new Set<string>();
    return messages.filter(msg => {
      if (seen.has(msg.id)) {
        return false;
      }
      seen.add(msg.id);
      return true;
    });
  }

  /**
   * Clean up expired messages
   */
  private async cleanupExpiredMessages(): Promise<void> {
    try {
      // Clean memory queue
      for (const [userId, messages] of this.queue.entries()) {
        const cutoffDate = new Date(Date.now() - this.MESSAGE_TTL);
        const validMessages = messages.filter(m => m.createdAt > cutoffDate);
        
        if (validMessages.length === 0) {
          this.queue.delete(userId);
        } else if (validMessages.length < messages.length) {
          this.queue.set(userId, validMessages);
        }
      }

      // Clean database
      await this.prisma.$executeRaw`
        DELETE FROM message_queue
        WHERE created_at < ${new Date(Date.now() - this.MESSAGE_TTL)}
      `;

      logger.info('Cleaned up expired queued messages');
    } catch (error) {
      logger.error('Failed to cleanup expired messages', { error });
    }
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    totalUsers: number;
    totalMessages: number;
    largestQueue: { userId: string; size: number } | null;
  } {
    let totalMessages = 0;
    let largestQueue: { userId: string; size: number } | null = null;

    for (const [userId, messages] of this.queue.entries()) {
      totalMessages += messages.length;
      
      if (!largestQueue || messages.length > largestQueue.size) {
        largestQueue = { userId, size: messages.length };
      }
    }

    return {
      totalUsers: this.queue.size,
      totalMessages,
      largestQueue,
    };
  }
}

// Create message_queue table migration
export const MESSAGE_QUEUE_TABLE = `
CREATE TABLE IF NOT EXISTS message_queue (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  conversation_id VARCHAR(255) NOT NULL,
  message JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at)
);
`;
