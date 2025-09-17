import { PrismaClient, MessageType } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';
import { RoomManager } from '../managers/roomManager';
import { MessageQueue } from '../managers/messageQueue';
import { logger } from '../../utils/logger';
import { sanitizeInput } from '../../utils/sanitizer';

interface SocketWithAuth {
  id: string;
  userId?: string;
  tenantId?: string;
  conversationIds?: string[];
  emit: (event: string, data: any) => void;
}

interface SendMessageData {
  conversationId: string;
  content: string;
  type?: MessageType;
  metadata?: any;
  attachments?: any[];
}

export class MessageHandler {
  constructor(
    private prisma: PrismaClient,
    private io: SocketServer,
    private roomManager: RoomManager,
    private messageQueue: MessageQueue
  ) {}

  /**
   * Handle send message
   */
  async handleSendMessage(socket: SocketWithAuth, data: SendMessageData) {
    try {
      const { conversationId, content, type = 'TEXT', metadata, attachments } = data;

      // Validate input
      if (!conversationId || !content?.trim()) {
        socket.emit('error', { message: 'Invalid message data' });
        return;
      }

      // Sanitize content
      const sanitizedContent = sanitizeInput(content);

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

      // Create message
      const message = await this.prisma.message.create({
        data: {
          conversationId,
          content: sanitizedContent,
          type,
          metadata: metadata || {},
          tenantId: socket.tenantId!,
          userId: socket.userId!,
          attachments: attachments ? {
            create: attachments.map(att => ({
              filename: att.filename,
              fileSize: att.fileSize,
              mimeType: att.mimeType,
              url: att.url,
              metadata: att.metadata,
            })),
          } : undefined,
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              role: true,
            },
          },
          attachments: true,
          reactions: true,
          readReceipts: true,
        },
      });

      // Update conversation last message timestamp
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });

      // Broadcast to conversation room
      this.roomManager.emitToConversation(
        this.io,
        conversationId,
        'message:new',
        message
      );

      // Queue for offline users
      await this.queueForOfflineUsers(conversationId, message);

      // Send confirmation to sender
      socket.emit('message:sent', { 
        messageId: message.id,
        timestamp: message.createdAt,
      });

      logger.info('Message sent', {
        messageId: message.id,
        conversationId,
        userId: socket.userId,
      });

    } catch (error) {
      logger.error('Failed to send message', { error, userId: socket.userId });
      socket.emit('error', { message: 'Failed to send message' });
    }
  }

  /**
   * Handle edit message
   */
  async handleEditMessage(socket: SocketWithAuth, data: { messageId: string; content: string }) {
    try {
      const { messageId, content } = data;

      if (!messageId || !content?.trim()) {
        socket.emit('error', { message: 'Invalid edit data' });
        return;
      }

      // Get message and verify ownership
      const message = await this.prisma.message.findFirst({
        where: {
          id: messageId,
          userId: socket.userId,
          tenantId: socket.tenantId,
          deleted: false,
        },
      });

      if (!message) {
        socket.emit('error', { message: 'Message not found or access denied' });
        return;
      }

      // Sanitize content
      const sanitizedContent = sanitizeInput(content);

      // Update message
      const updatedMessage = await this.prisma.message.update({
        where: { id: messageId },
        data: {
          content: sanitizedContent,
          edited: true,
          editedAt: new Date(),
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
            },
          },
          attachments: true,
          reactions: true,
        },
      });

      // Broadcast update
      this.roomManager.emitToConversation(
        this.io,
        message.conversationId,
        'message:updated',
        updatedMessage
      );

      socket.emit('message:edited', { messageId });

    } catch (error) {
      logger.error('Failed to edit message', { error });
      socket.emit('error', { message: 'Failed to edit message' });
    }
  }

  /**
   * Handle delete message
   */
  async handleDeleteMessage(socket: SocketWithAuth, data: { messageId: string }) {
    try {
      const { messageId } = data;

      // Get message and verify ownership or admin role
      const message = await this.prisma.message.findFirst({
        where: {
          id: messageId,
          tenantId: socket.tenantId,
          deleted: false,
          OR: [
            { userId: socket.userId },
            // Admin can delete any message in their tenant
            {
              conversation: {
                participants: {
                  some: {
                    userId: socket.userId,
                    role: { in: ['ADMIN', 'OWNER'] },
                  },
                },
              },
            },
          ],
        },
      });

      if (!message) {
        socket.emit('error', { message: 'Message not found or access denied' });
        return;
      }

      // Soft delete
      await this.prisma.message.update({
        where: { id: messageId },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      // Broadcast deletion
      this.roomManager.emitToConversation(
        this.io,
        message.conversationId,
        'message:deleted',
        { messageId, conversationId: message.conversationId }
      );

      socket.emit('message:deleted', { messageId });

    } catch (error) {
      logger.error('Failed to delete message', { error });
      socket.emit('error', { message: 'Failed to delete message' });
    }
  }

  /**
   * Handle add reaction
   */
  async handleAddReaction(socket: SocketWithAuth, data: { messageId: string; emoji: string }) {
    try {
      const { messageId, emoji } = data;

      if (!messageId || !emoji) {
        socket.emit('error', { message: 'Invalid reaction data' });
        return;
      }

      // Verify message exists in user's tenant
      const message = await this.prisma.message.findFirst({
        where: {
          id: messageId,
          tenantId: socket.tenantId,
          deleted: false,
        },
      });

      if (!message) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }

      // Add reaction
      const reaction = await this.prisma.messageReaction.create({
        data: {
          messageId,
          userId: socket.userId!,
          emoji,
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
      });

      // Broadcast update
      this.roomManager.emitToConversation(
        this.io,
        message.conversationId,
        'message:reaction:added',
        {
          messageId,
          reaction,
        }
      );

    } catch (error) {
      // Handle unique constraint violation (user already reacted with same emoji)
      if (error.code === 'P2002') {
        socket.emit('error', { message: 'Already reacted with this emoji' });
      } else {
        logger.error('Failed to add reaction', { error });
        socket.emit('error', { message: 'Failed to add reaction' });
      }
    }
  }

  /**
   * Handle remove reaction
   */
  async handleRemoveReaction(socket: SocketWithAuth, data: { messageId: string; emoji: string }) {
    try {
      const { messageId, emoji } = data;

      // Delete reaction
      await this.prisma.messageReaction.deleteMany({
        where: {
          messageId,
          userId: socket.userId,
          emoji,
        },
      });

      // Get message to find conversation
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: { conversationId: true },
      });

      if (message) {
        // Broadcast update
        this.roomManager.emitToConversation(
          this.io,
          message.conversationId,
          'message:reaction:removed',
          {
            messageId,
            emoji,
            userId: socket.userId,
          }
        );
      }

    } catch (error) {
      logger.error('Failed to remove reaction', { error });
      socket.emit('error', { message: 'Failed to remove reaction' });
    }
  }

  /**
   * Handle mark as read
   */
  async handleMarkAsRead(socket: SocketWithAuth, data: { messageIds: string[] }) {
    try {
      const { messageIds } = data;

      if (!messageIds || messageIds.length === 0) {
        return;
      }

      // Get messages to verify they belong to user's conversations
      const messages = await this.prisma.message.findMany({
        where: {
          id: { in: messageIds },
          tenantId: socket.tenantId,
          conversation: {
            participants: {
              some: {
                userId: socket.userId,
              },
            },
          },
        },
        select: {
          id: true,
          conversationId: true,
        },
      });

      if (messages.length === 0) {
        return;
      }

      // Create read receipts
      const readReceipts = messages.map(msg => ({
        messageId: msg.id,
        conversationId: msg.conversationId,
        userId: socket.userId!,
      }));

      await this.prisma.messageReadReceipt.createMany({
        data: readReceipts,
        skipDuplicates: true,
      });

      // Group by conversation
      const conversationGroups = messages.reduce((acc, msg) => {
        if (!acc[msg.conversationId]) {
          acc[msg.conversationId] = [];
        }
        acc[msg.conversationId].push(msg.id);
        return acc;
      }, {} as Record<string, string[]>);

      // Broadcast to each conversation
      for (const [conversationId, msgIds] of Object.entries(conversationGroups)) {
        this.roomManager.emitToConversation(
          this.io,
          conversationId,
          'messages:read',
          {
            userId: socket.userId,
            messageIds: msgIds,
            readAt: new Date(),
          }
        );
      }

    } catch (error) {
      logger.error('Failed to mark messages as read', { error });
    }
  }

  /**
   * Verify user has access to conversation
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
          status: 'ACTIVE',
        },
      },
    });

    return !!participant;
  }

  /**
   * Queue message for offline users
   */
  private async queueForOfflineUsers(conversationId: string, message: any) {
    try {
      // Get all participants
      const participants = await this.prisma.conversationParticipant.findMany({
        where: {
          conversationId,
          leftAt: null,
          userId: { not: null },
        },
        select: { userId: true },
      });

      // Check who's online
      for (const participant of participants) {
        if (participant.userId && participant.userId !== message.userId) {
          const isOnline = this.roomManager.isUserOnline(participant.userId);
          
          if (!isOnline) {
            await this.messageQueue.queueMessage(
              participant.userId,
              conversationId,
              message
            );
          }
        }
      }
    } catch (error) {
      logger.error('Failed to queue message for offline users', { error });
    }
  }
}
