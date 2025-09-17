import { Request, Response, NextFunction } from 'express';
import { chatService } from '../services/chatService';
import { AppError } from '../../middlewares/errorHandler';

interface AuthRequest extends Request {
  userId?: string;
  tenantId?: string;
  user?: any;
}

export class ChatController {
  /**
   * Create a new conversation
   */
  async createConversation(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { type, participantIds, metadata } = req.body;
      
      if (!req.userId || !req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const conversation = await chatService.createConversation({
        tenantId: req.tenantId,
        userId: req.userId,
        type,
        participantIds,
        metadata,
      });

      res.status(201).json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user conversations
   */
  async getConversations(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userId || !req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const conversations = await chatService.getUserConversations(
        req.userId,
        req.tenantId
      );

      res.json({
        success: true,
        data: conversations,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get conversation by ID
   */
  async getConversation(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { conversationId } = req.params;
      
      if (!req.userId || !req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const conversation = await chatService.getConversation(
        conversationId,
        req.userId,
        req.tenantId
      );

      res.json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get conversation messages
   */
  async getMessages(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { conversationId } = req.params;
      const { limit, before, after, includeDeleted } = req.query;
      
      if (!req.userId || !req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const messages = await chatService.getMessages(
        conversationId,
        req.userId,
        req.tenantId,
        {
          limit: limit ? parseInt(limit as string) : undefined,
          before: before ? new Date(before as string) : undefined,
          after: after ? new Date(after as string) : undefined,
          includeDeleted: includeDeleted === 'true',
        }
      );

      res.json({
        success: true,
        data: { messages },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Send a message
   */
  async sendMessage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { conversationId } = req.params;
      const { content, type, metadata, attachments } = req.body;
      
      if (!req.userId || !req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const message = await chatService.sendMessage({
        conversationId,
        userId: req.userId,
        content,
        type,
        metadata,
        attachments,
      });

      res.status(201).json({
        success: true,
        data: message,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { messageId } = req.params;
      
      if (!req.userId || !req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      await chatService.deleteMessage(
        messageId,
        req.userId,
        req.tenantId
      );

      res.json({
        success: true,
        message: 'Message deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark messages as read
   */
  async markAsRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { conversationId } = req.params;
      const { messageIds } = req.body;
      
      if (!req.userId || !req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        throw new AppError('Invalid message IDs', 400);
      }

      await chatService.markMessagesAsRead(
        messageIds,
        conversationId,
        req.userId
      );

      res.json({
        success: true,
        message: 'Messages marked as read',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Search messages
   */
  async searchMessages(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { conversationId } = req.params;
      const { q } = req.query;
      
      if (!req.userId || !req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      if (!q || typeof q !== 'string') {
        throw new AppError('Search query required', 400);
      }

      const messages = await chatService.searchMessages(
        conversationId,
        q,
        req.userId,
        req.tenantId
      );

      res.json({
        success: true,
        data: { messages },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Upload files
   */
  async uploadFiles(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userId || !req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        throw new AppError('No files uploaded', 400);
      }

      const attachments = (req.files as Express.Multer.File[]).map(file => ({
        filename: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        url: `/uploads/${file.filename}`, // This would be replaced with actual storage URL
        metadata: {
          uploadedBy: req.userId,
          uploadedAt: new Date(),
        },
      }));

      res.json({
        success: true,
        data: attachments,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const chatController = new ChatController();
