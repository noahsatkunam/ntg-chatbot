import { Server as SocketServer } from 'socket.io';
import { RoomManager } from '../managers/roomManager';
import { logger } from '../../utils/logger';

interface SocketWithAuth {
  id: string;
  userId?: string;
  tenantId?: string;
  emit: (event: string, data: any) => void;
}

interface TypingData {
  conversationId: string;
}

export class TypingHandler {
  private typingTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly TYPING_TIMEOUT = 5000; // 5 seconds

  constructor(
    private io: SocketServer,
    private roomManager: RoomManager
  ) {}

  /**
   * Handle typing start
   */
  async handleTypingStart(socket: SocketWithAuth, data: TypingData) {
    try {
      const { conversationId } = data;

      if (!conversationId) {
        socket.emit('error', { message: 'Invalid typing data' });
        return;
      }

      const key = `${socket.userId}:${conversationId}`;

      // Clear existing timer
      this.clearTypingTimer(key);

      // Broadcast typing start to conversation room (except sender)
      socket.to(this.roomManager.getConversationRoom(conversationId)).emit('typing:start', {
        conversationId,
        userId: socket.userId,
        timestamp: new Date(),
      });

      // Set auto-stop timer
      const timer = setTimeout(() => {
        this.handleTypingStop(socket, { conversationId });
      }, this.TYPING_TIMEOUT);

      this.typingTimers.set(key, timer);

      logger.debug('User started typing', {
        userId: socket.userId,
        conversationId,
      });

    } catch (error) {
      logger.error('Failed to handle typing start', { error });
      socket.emit('error', { message: 'Failed to update typing status' });
    }
  }

  /**
   * Handle typing stop
   */
  async handleTypingStop(socket: SocketWithAuth, data: TypingData) {
    try {
      const { conversationId } = data;

      if (!conversationId) {
        return;
      }

      const key = `${socket.userId}:${conversationId}`;

      // Clear timer
      this.clearTypingTimer(key);

      // Broadcast typing stop to conversation room (except sender)
      socket.to(this.roomManager.getConversationRoom(conversationId)).emit('typing:stop', {
        conversationId,
        userId: socket.userId,
        timestamp: new Date(),
      });

      logger.debug('User stopped typing', {
        userId: socket.userId,
        conversationId,
      });

    } catch (error) {
      logger.error('Failed to handle typing stop', { error });
    }
  }

  /**
   * Clear typing timer
   */
  private clearTypingTimer(key: string) {
    const timer = this.typingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(key);
    }
  }

  /**
   * Clear all typing timers for a user
   */
  clearUserTimers(userId: string) {
    for (const [key, timer] of this.typingTimers.entries()) {
      if (key.startsWith(`${userId}:`)) {
        clearTimeout(timer);
        this.typingTimers.delete(key);
      }
    }
  }

  /**
   * Get active typers in a conversation
   */
  getActiveTypers(conversationId: string): string[] {
    const typers: string[] = [];
    
    for (const key of this.typingTimers.keys()) {
      if (key.endsWith(`:${conversationId}`)) {
        const userId = key.split(':')[0];
        typers.push(userId);
      }
    }

    return typers;
  }
}
