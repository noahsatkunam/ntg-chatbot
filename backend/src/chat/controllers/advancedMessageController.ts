import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';
import { sanitizeInput } from '../../utils/sanitizer';
import archiver from 'archiver';
import { SearchService } from '../../search/searchService';

const prisma = new PrismaClient();

export class AdvancedMessageController {
  private searchService: SearchService;

  constructor() {
    this.searchService = new SearchService();
  }

  // Add reaction to message
  public addReaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId, userId } = req.user!;
      const { messageId } = req.params;
      const { reaction } = req.body;

      // Validate message access
      const message = await prisma.message.findFirst({
        where: {
          id: messageId,
          tenantId,
          conversation: {
            participants: {
              some: { userId },
            },
          },
        },
      });

      if (!message) {
        res.status(404).json({
          success: false,
          error: 'Message not found or access denied',
        });
        return;
      }

      // Add or update reaction
      const messageReaction = await prisma.messageReaction.upsert({
        where: {
          messageId_userId_reaction: {
            messageId,
            userId,
            reaction,
          },
        },
        create: {
          messageId,
          userId,
          tenantId,
          reaction,
        },
        update: {
          createdAt: new Date(),
        },
      });

      logger.info('Reaction added to message', {
        messageId,
        userId,
        tenantId,
        reaction,
      });

      res.status(200).json({
        success: true,
        data: { reaction: messageReaction },
      });
    } catch (error) {
      logger.error('Add reaction failed', {
        error: error.message,
        messageId: req.params.messageId,
        tenantId: req.user?.tenantId,
        userId: req.user?.userId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to add reaction',
      });
    }
  };

  // Remove reaction from message
  public removeReaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId, userId } = req.user!;
      const { messageId } = req.params;
      const { reaction } = req.body;

      await prisma.messageReaction.deleteMany({
        where: {
          messageId,
          userId,
          tenantId,
          reaction,
        },
      });

      logger.info('Reaction removed from message', {
        messageId,
        userId,
        tenantId,
        reaction,
      });

      res.status(200).json({
        success: true,
        message: 'Reaction removed successfully',
      });
    } catch (error) {
      logger.error('Remove reaction failed', {
        error: error.message,
        messageId: req.params.messageId,
        tenantId: req.user?.tenantId,
        userId: req.user?.userId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to remove reaction',
      });
    }
  };

  // Reply to message
  public replyToMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId, userId } = req.user!;
      const { messageId } = req.params;
      const { content, type = 'text' } = req.body;

      // Validate parent message access
      const parentMessage = await prisma.message.findFirst({
        where: {
          id: messageId,
          tenantId,
          conversation: {
            participants: {
              some: { userId },
            },
          },
        },
        include: {
          conversation: true,
        },
      });

      if (!parentMessage) {
        res.status(404).json({
          success: false,
          error: 'Parent message not found or access denied',
        });
        return;
      }

      // Create reply message
      const replyMessage = await prisma.message.create({
        data: {
          conversationId: parentMessage.conversationId,
          tenantId,
          userId,
          content: sanitizeInput(content),
          type,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      // Create reply relationship
      await prisma.messageReply.create({
        data: {
          parentMessageId: messageId,
          replyMessageId: replyMessage.id,
          tenantId,
        },
      });

      // Update conversation last message time
      await prisma.conversation.update({
        where: { id: parentMessage.conversationId },
        data: { lastMessageAt: new Date() },
      });

      // Index message for search
      await this.searchService.indexMessage(replyMessage.id, tenantId);

      logger.info('Reply message created', {
        parentMessageId: messageId,
        replyMessageId: replyMessage.id,
        tenantId,
        userId,
      });

      res.status(201).json({
        success: true,
        data: { message: replyMessage },
      });
    } catch (error) {
      logger.error('Reply to message failed', {
        error: error.message,
        messageId: req.params.messageId,
        tenantId: req.user?.tenantId,
        userId: req.user?.userId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to create reply',
      });
    }
  };

  // Edit message
  public editMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId, userId } = req.user!;
      const { messageId } = req.params;
      const { content } = req.body;

      // Validate message ownership
      const message = await prisma.message.findFirst({
        where: {
          id: messageId,
          tenantId,
          userId,
          deleted: false,
        },
      });

      if (!message) {
        res.status(404).json({
          success: false,
          error: 'Message not found or cannot be edited',
        });
        return;
      }

      // Check if message is too old to edit (24 hours)
      const hoursSinceCreation = (Date.now() - message.createdAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceCreation > 24) {
        res.status(400).json({
          success: false,
          error: 'Message is too old to edit',
        });
        return;
      }

      // Update message
      const updatedMessage = await prisma.message.update({
        where: { id: messageId },
        data: {
          content: sanitizeInput(content),
          updatedAt: new Date(),
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      // Update search index
      await this.searchService.indexMessage(messageId, tenantId);

      logger.info('Message edited successfully', {
        messageId,
        tenantId,
        userId,
      });

      res.status(200).json({
        success: true,
        data: { message: updatedMessage },
      });
    } catch (error) {
      logger.error('Edit message failed', {
        error: error.message,
        messageId: req.params.messageId,
        tenantId: req.user?.tenantId,
        userId: req.user?.userId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to edit message',
      });
    }
  };

  // Bulk operations on messages
  public bulkOperations = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId, userId } = req.user!;
      const { operation, messageIds, data } = req.body;

      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Message IDs array is required',
        });
        return;
      }

      let result;

      switch (operation) {
        case 'delete':
          result = await this.bulkDeleteMessages(messageIds, tenantId, userId);
          break;
        case 'mark_read':
          result = await this.bulkMarkAsRead(messageIds, tenantId, userId);
          break;
        case 'archive':
          result = await this.bulkArchiveMessages(messageIds, tenantId, userId);
          break;
        default:
          res.status(400).json({
            success: false,
            error: 'Invalid operation',
          });
          return;
      }

      logger.info('Bulk operation completed', {
        operation,
        messageCount: messageIds.length,
        tenantId,
        userId,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Bulk operation failed', {
        error: error.message,
        tenantId: req.user?.tenantId,
        userId: req.user?.userId,
      });

      res.status(500).json({
        success: false,
        error: 'Bulk operation failed',
      });
    }
  };

  // Export conversation
  public exportConversation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId, userId } = req.user!;
      const { conversationId } = req.params;
      const { format = 'json', includeFiles = false } = req.query;

      // Validate conversation access
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          tenantId,
          participants: {
            some: { userId },
          },
        },
        include: {
          messages: {
            where: { deleted: false },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              attachments: includeFiles === 'true',
              reactions: true,
            },
            orderBy: { createdAt: 'asc' },
          },
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      if (!conversation) {
        res.status(404).json({
          success: false,
          error: 'Conversation not found or access denied',
        });
        return;
      }

      const exportData = {
        conversation: {
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          participants: conversation.participants,
        },
        messages: conversation.messages,
        exportedAt: new Date(),
        exportedBy: userId,
      };

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="conversation-${conversationId}.json"`
        );
        res.send(JSON.stringify(exportData, null, 2));
      } else if (format === 'csv') {
        // Convert to CSV format
        const csvData = this.convertToCSV(exportData);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="conversation-${conversationId}.csv"`
        );
        res.send(csvData);
      } else {
        res.status(400).json({
          success: false,
          error: 'Unsupported export format',
        });
      }

      logger.info('Conversation exported', {
        conversationId,
        format,
        tenantId,
        userId,
      });
    } catch (error) {
      logger.error('Export conversation failed', {
        error: error.message,
        conversationId: req.params.conversationId,
        tenantId: req.user?.tenantId,
        userId: req.user?.userId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to export conversation',
      });
    }
  };

  // Get message thread (replies)
  public getMessageThread = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId, userId } = req.user!;
      const { messageId } = req.params;

      // Validate message access
      const message = await prisma.message.findFirst({
        where: {
          id: messageId,
          tenantId,
          conversation: {
            participants: {
              some: { userId },
            },
          },
        },
      });

      if (!message) {
        res.status(404).json({
          success: false,
          error: 'Message not found or access denied',
        });
        return;
      }

      // Get all replies to this message
      const replies = await prisma.messageReply.findMany({
        where: {
          parentMessageId: messageId,
          tenantId,
        },
        include: {
          replyMessage: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              reactions: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const thread = replies.map(reply => reply.replyMessage);

      res.status(200).json({
        success: true,
        data: {
          parentMessage: message,
          replies: thread,
        },
      });
    } catch (error) {
      logger.error('Get message thread failed', {
        error: error.message,
        messageId: req.params.messageId,
        tenantId: req.user?.tenantId,
        userId: req.user?.userId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get message thread',
      });
    }
  };

  // Private helper methods
  private async bulkDeleteMessages(
    messageIds: string[],
    tenantId: string,
    userId: string
  ): Promise<{ deletedCount: number }> {
    const result = await prisma.message.updateMany({
      where: {
        id: { in: messageIds },
        tenantId,
        userId, // Only allow deleting own messages
      },
      data: {
        deleted: true,
        deletedAt: new Date(),
      },
    });

    return { deletedCount: result.count };
  }

  private async bulkMarkAsRead(
    messageIds: string[],
    tenantId: string,
    userId: string
  ): Promise<{ markedCount: number }> {
    // Get conversation IDs for the messages
    const messages = await prisma.message.findMany({
      where: {
        id: { in: messageIds },
        tenantId,
      },
      select: {
        id: true,
        conversationId: true,
      },
    });

    // Create read receipts
    const readReceipts = messages.map(message => ({
      messageId: message.id,
      userId,
      conversationId: message.conversationId,
      tenantId,
      readAt: new Date(),
    }));

    await prisma.messageReadReceipt.createMany({
      data: readReceipts,
      skipDuplicates: true,
    });

    return { markedCount: readReceipts.length };
  }

  private async bulkArchiveMessages(
    messageIds: string[],
    tenantId: string,
    userId: string
  ): Promise<{ archivedCount: number }> {
    // This would typically involve moving messages to an archived state
    // For now, we'll just mark them with metadata
    const result = await prisma.message.updateMany({
      where: {
        id: { in: messageIds },
        tenantId,
        conversation: {
          participants: {
            some: { userId },
          },
        },
      },
      data: {
        metadata: {
          archived: true,
          archivedAt: new Date(),
          archivedBy: userId,
        },
      },
    });

    return { archivedCount: result.count };
  }

  private convertToCSV(exportData: any): string {
    const headers = ['Timestamp', 'Sender', 'Message', 'Type'];
    const rows = [headers.join(',')];

    exportData.messages.forEach((message: any) => {
      const row = [
        message.createdAt,
        message.user?.name || 'Unknown',
        `"${message.content.replace(/"/g, '""')}"`, // Escape quotes
        message.type,
      ];
      rows.push(row.join(','));
    });

    return rows.join('\n');
  }
}
