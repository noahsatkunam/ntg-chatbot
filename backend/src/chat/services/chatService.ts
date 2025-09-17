import { PrismaClient, ConversationType, MessageType } from '@prisma/client';
import { AppError } from '../../middlewares/errorHandler';
import { logger } from '../../utils/logger';
import { sanitizeInput } from '../../utils/sanitizer';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

interface CreateConversationData {
  tenantId: string;
  userId: string;
  type?: ConversationType;
  participantIds?: string[];
  metadata?: any;
}

interface SendMessageData {
  conversationId: string;
  userId: string;
  content: string;
  type?: MessageType;
  metadata?: any;
  attachments?: Array<{
    filename: string;
    fileSize: number;
    mimeType: string;
    url: string;
    metadata?: any;
  }>;
}

interface GetMessagesOptions {
  limit?: number;
  before?: Date;
  after?: Date;
  includeDeleted?: boolean;
}

export class ChatService {
  /**
   * Create a new conversation
   */
  async createConversation(data: CreateConversationData) {
    const { tenantId, userId, type = 'SUPPORT', participantIds = [], metadata } = data;

    try {
      // Create conversation with participants
      const conversation = await prisma.conversation.create({
        data: {
          tenantId,
          type,
          metadata: metadata || {},
          participants: {
            create: [
              // Creator as owner
              {
                userId,
                role: 'OWNER',
              },
              // Additional participants
              ...participantIds
                .filter(id => id !== userId)
                .map(id => ({
                  userId: id,
                  role: 'MEMBER' as const,
                })),
            ],
          },
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  avatarUrl: true,
                  email: true,
                },
              },
            },
          },
          _count: {
            select: {
              messages: true,
            },
          },
        },
      });

      logger.info('Conversation created', {
        conversationId: conversation.id,
        tenantId,
        type,
        participantCount: conversation.participants.length,
      });

      return conversation;
    } catch (error) {
      logger.error('Failed to create conversation', { error, data });
      throw new AppError('Failed to create conversation', 500);
    }
  }

  /**
   * Get user conversations
   */
  async getUserConversations(userId: string, tenantId: string) {
    try {
      const conversations = await prisma.conversation.findMany({
        where: {
          tenantId,
          participants: {
            some: {
              userId,
              leftAt: null,
            },
          },
          status: { in: ['ACTIVE', 'CLOSED'] },
        },
        include: {
          participants: {
            where: { leftAt: null },
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  avatarUrl: true,
                },
              },
            },
          },
          messages: {
            where: { deleted: false },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                },
              },
            },
          },
          _count: {
            select: {
              messages: {
                where: {
                  deleted: false,
                  readReceipts: {
                    none: { userId },
                  },
                },
              },
            },
          },
        },
        orderBy: [
          { lastMessageAt: 'desc' },
          { createdAt: 'desc' },
        ],
      });

      // Format response
      return conversations.map(conv => ({
        ...conv,
        lastMessage: conv.messages[0] || null,
        unreadCount: conv._count.messages,
        messages: undefined,
        _count: undefined,
      }));
    } catch (error) {
      logger.error('Failed to get user conversations', { error, userId });
      throw new AppError('Failed to get conversations', 500);
    }
  }

  /**
   * Get conversation by ID
   */
  async getConversation(conversationId: string, userId: string, tenantId: string) {
    try {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          tenantId,
          participants: {
            some: {
              userId,
              leftAt: null,
            },
          },
        },
        include: {
          participants: {
            where: { leftAt: null },
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  avatarUrl: true,
                  email: true,
                  role: true,
                },
              },
              chatbot: {
                select: {
                  id: true,
                  name: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      });

      if (!conversation) {
        throw new AppError('Conversation not found', 404);
      }

      return conversation;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to get conversation', { error, conversationId });
      throw new AppError('Failed to get conversation', 500);
    }
  }

  /**
   * Get conversation messages
   */
  async getMessages(
    conversationId: string,
    userId: string,
    tenantId: string,
    options: GetMessagesOptions = {}
  ) {
    const { 
      limit = 50, 
      before, 
      after, 
      includeDeleted = false 
    } = options;

    try {
      // Verify access
      const hasAccess = await this.verifyConversationAccess(
        conversationId,
        userId,
        tenantId
      );

      if (!hasAccess) {
        throw new AppError('Access denied', 403);
      }

      // Build query
      const where: any = {
        conversationId,
        ...(includeDeleted ? {} : { deleted: false }),
      };

      if (before) {
        where.createdAt = { lt: before };
      } else if (after) {
        where.createdAt = { gt: after };
      }

      // Get messages
      const messages = await prisma.message.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
            },
          },
          chatbot: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
            },
          },
          attachments: true,
          reactions: {
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                },
              },
            },
          },
          readReceipts: {
            where: { userId },
            select: {
              readAt: true,
            },
          },
          _count: {
            select: {
              readReceipts: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      // Mark messages as read
      const unreadMessageIds = messages
        .filter(msg => msg.readReceipts.length === 0)
        .map(msg => msg.id);

      if (unreadMessageIds.length > 0) {
        await this.markMessagesAsRead(unreadMessageIds, conversationId, userId);
      }

      return messages.reverse(); // Return in chronological order
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to get messages', { error, conversationId });
      throw new AppError('Failed to get messages', 500);
    }
  }

  /**
   * Send a message
   */
  async sendMessage(data: SendMessageData) {
    const {
      conversationId,
      userId,
      content,
      type = 'TEXT',
      metadata,
      attachments,
    } = data;

    try {
      // Verify access
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          participants: {
            some: {
              userId,
              leftAt: null,
            },
          },
          status: 'ACTIVE',
        },
        select: {
          tenantId: true,
        },
      });

      if (!conversation) {
        throw new AppError('Conversation not found or access denied', 404);
      }

      // Sanitize content
      const sanitizedContent = sanitizeInput(content);

      // Create message
      const message = await prisma.message.create({
        data: {
          id: uuidv4(),
          conversationId,
          content: sanitizedContent,
          type,
          metadata: metadata || {},
          tenantId: conversation.tenantId,
          userId,
          attachments: attachments ? {
            create: attachments,
          } : undefined,
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
          reactions: [],
          readReceipts: [],
        },
      });

      // Update conversation last message timestamp
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });

      logger.info('Message sent', {
        messageId: message.id,
        conversationId,
        userId,
        type,
      });

      return message;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to send message', { error, data });
      throw new AppError('Failed to send message', 500);
    }
  }

  /**
   * Mark messages as read
   */
  async markMessagesAsRead(
    messageIds: string[],
    conversationId: string,
    userId: string
  ) {
    try {
      const readReceipts = messageIds.map(messageId => ({
        messageId,
        conversationId,
        userId,
      }));

      await prisma.messageReadReceipt.createMany({
        data: readReceipts,
        skipDuplicates: true,
      });

      logger.debug('Messages marked as read', {
        count: messageIds.length,
        conversationId,
        userId,
      });
    } catch (error) {
      logger.error('Failed to mark messages as read', { error });
      // Don't throw - this is not critical
    }
  }

  /**
   * Delete a message (soft delete)
   */
  async deleteMessage(messageId: string, userId: string, tenantId: string) {
    try {
      // Verify ownership or admin role
      const message = await prisma.message.findFirst({
        where: {
          id: messageId,
          tenantId,
          deleted: false,
          OR: [
            { userId },
            // Admin can delete any message
            {
              conversation: {
                participants: {
                  some: {
                    userId,
                    role: { in: ['ADMIN', 'OWNER'] },
                  },
                },
              },
            },
          ],
        },
      });

      if (!message) {
        throw new AppError('Message not found or access denied', 404);
      }

      // Soft delete
      await prisma.message.update({
        where: { id: messageId },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      logger.info('Message deleted', { messageId, userId });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to delete message', { error, messageId });
      throw new AppError('Failed to delete message', 500);
    }
  }

  /**
   * Search messages
   */
  async searchMessages(
    conversationId: string,
    query: string,
    userId: string,
    tenantId: string
  ) {
    try {
      // Verify access
      const hasAccess = await this.verifyConversationAccess(
        conversationId,
        userId,
        tenantId
      );

      if (!hasAccess) {
        throw new AppError('Access denied', 403);
      }

      // Search messages
      const messages = await prisma.message.findMany({
        where: {
          conversationId,
          deleted: false,
          content: {
            contains: query,
            mode: 'insensitive',
          },
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      return messages;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to search messages', { error });
      throw new AppError('Failed to search messages', 500);
    }
  }

  /**
   * Verify user has access to conversation
   */
  private async verifyConversationAccess(
    conversationId: string,
    userId: string,
    tenantId: string
  ): Promise<boolean> {
    const participant = await prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
        conversation: {
          tenantId,
          status: { in: ['ACTIVE', 'CLOSED'] },
        },
      },
    });

    return !!participant;
  }
}

export const chatService = new ChatService();
