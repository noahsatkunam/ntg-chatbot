import { PrismaClient, PresenceStatus } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';
import { PresenceManager } from '../managers/presenceManager';
import { RoomManager } from '../managers/roomManager';
import { logger } from '../../utils/logger';

interface SocketWithAuth {
  id: string;
  userId?: string;
  tenantId?: string;
  emit: (event: string, data: any) => void;
}

export class PresenceHandler {
  constructor(
    private prisma: PrismaClient,
    private io: SocketServer,
    private presenceManager: PresenceManager,
    private roomManager: RoomManager
  ) {}

  /**
   * Update user presence
   */
  async updatePresence(
    userId: string,
    tenantId: string,
    status: PresenceStatus
  ) {
    try {
      // Update presence in database
      await this.presenceManager.updatePresence(userId, tenantId, status);

      // Get user's conversations
      const conversations = await this.getUserConversations(userId, tenantId);

      // Broadcast to tenant room
      this.roomManager.emitToTenant(
        this.io,
        tenantId,
        'presence:updated',
        {
          userId,
          status,
          timestamp: new Date(),
        }
      );

      // Broadcast to user's conversations
      for (const conversation of conversations) {
        this.roomManager.emitToConversation(
          this.io,
          conversation.id,
          'presence:updated',
          {
            userId,
            status,
            timestamp: new Date(),
            conversationId: conversation.id,
          }
        );
      }

      logger.debug('User presence updated', { userId, status });

    } catch (error) {
      logger.error('Failed to update presence', { error, userId, status });
    }
  }

  /**
   * Handle user disconnect
   */
  async handleDisconnect(userId: string, tenantId: string) {
    // Start grace period
    await this.presenceManager.handleDisconnect(userId, tenantId);
    
    // Check if user has other active connections
    const userSockets = this.roomManager.getUserSockets(userId);
    
    if (userSockets.length === 0) {
      // No other connections, broadcast away status
      await this.updatePresence(userId, tenantId, 'AWAY');
    }
  }

  /**
   * Get user conversations
   */
  private async getUserConversations(userId: string, tenantId: string) {
    return this.prisma.conversation.findMany({
      where: {
        tenantId,
        participants: {
          some: {
            userId,
            leftAt: null,
          },
        },
        status: 'ACTIVE',
      },
      select: {
        id: true,
      },
    });
  }

  /**
   * Get presence for multiple users
   */
  async getMultipleUsersPresence(socket: SocketWithAuth, userIds: string[]) {
    try {
      if (!userIds || userIds.length === 0) {
        socket.emit('presence:multiple', { presences: {} });
        return;
      }

      // Get presence statuses
      const presences = await this.presenceManager.getUsersPresence(userIds);

      // Convert Map to object
      const presenceData: Record<string, PresenceStatus> = {};
      presences.forEach((status, userId) => {
        presenceData[userId] = status;
      });

      socket.emit('presence:multiple', { presences: presenceData });

    } catch (error) {
      logger.error('Failed to get multiple users presence', { error });
      socket.emit('error', { message: 'Failed to get presence data' });
    }
  }

  /**
   * Get online users in conversation
   */
  async getConversationOnlineUsers(
    socket: SocketWithAuth,
    conversationId: string
  ) {
    try {
      // Verify user has access to conversation
      const hasAccess = await this.verifyConversationAccess(
        socket.userId!,
        conversationId,
        socket.tenantId!
      );

      if (!hasAccess) {
        socket.emit('error', { message: 'Access denied' });
        return;
      }

      // Get online users
      const onlineUsers = this.roomManager.getOnlineUsersInConversation(
        this.io,
        conversationId
      );

      socket.emit('conversation:online-users', {
        conversationId,
        users: onlineUsers,
      });

    } catch (error) {
      logger.error('Failed to get conversation online users', { error });
      socket.emit('error', { message: 'Failed to get online users' });
    }
  }

  /**
   * Broadcast presence update to specific users
   */
  async broadcastToUsers(
    userIds: string[],
    userId: string,
    status: PresenceStatus
  ) {
    for (const targetUserId of userIds) {
      this.roomManager.emitToUser(
        this.io,
        targetUserId,
        'presence:updated',
        {
          userId,
          status,
          timestamp: new Date(),
        }
      );
    }
  }

  /**
   * Verify conversation access
   */
  private async verifyConversationAccess(
    userId: string,
    conversationId: string,
    tenantId: string
  ): Promise<boolean> {
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
        conversation: {
          tenantId,
        },
      },
    });

    return !!participant;
  }

  /**
   * Initialize presence for all online users in tenant
   */
  async initializeTenantPresence(tenantId: string) {
    try {
      const onlineUsers = this.roomManager.getOnlineUsersInTenant(this.io, tenantId);
      
      for (const userId of onlineUsers) {
        await this.presenceManager.updatePresence(userId, tenantId, 'ONLINE');
      }

      logger.info('Initialized tenant presence', {
        tenantId,
        onlineUsersCount: onlineUsers.length,
      });

    } catch (error) {
      logger.error('Failed to initialize tenant presence', { error, tenantId });
    }
  }
}
