import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { FileUploadService } from '../../upload/fileUploadService';
import { logger } from '../../utils/logger';
import { validateRequest } from '../../middleware/validation';
import { fileUploadValidation } from '../validators/fileValidators';

const prisma = new PrismaClient();

export class FileController {
  private fileUploadService: FileUploadService;

  constructor() {
    this.fileUploadService = new FileUploadService();
  }

  // Upload single or multiple files
  public uploadFiles = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId, userId } = req.user!;
      const { conversationId } = req.body;
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No files provided',
        });
        return;
      }

      // Validate conversation access if provided
      if (conversationId) {
        const hasAccess = await this.verifyConversationAccess(
          conversationId,
          tenantId,
          userId
        );
        if (!hasAccess) {
          res.status(403).json({
            success: false,
            error: 'Access denied to conversation',
          });
          return;
        }
      }

      // Upload files
      const uploadedFiles = await this.fileUploadService.uploadFiles(
        files,
        tenantId,
        userId,
        conversationId
      );

      logger.info('Files uploaded successfully', {
        tenantId,
        userId,
        fileCount: uploadedFiles.length,
        conversationId,
      });

      res.status(200).json({
        success: true,
        data: {
          files: uploadedFiles,
        },
      });
    } catch (error) {
      logger.error('File upload failed', {
        error: error.message,
        tenantId: req.user?.tenantId,
        userId: req.user?.userId,
      });

      res.status(500).json({
        success: false,
        error: error.message || 'File upload failed',
      });
    }
  };

  // Get file by ID
  public getFile = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = req.user!;
      const { fileId } = req.params;

      const file = await this.fileUploadService.getFile(fileId, tenantId);

      if (!file) {
        res.status(404).json({
          success: false,
          error: 'File not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { file },
      });
    } catch (error) {
      logger.error('Get file failed', {
        error: error.message,
        fileId: req.params.fileId,
        tenantId: req.user?.tenantId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve file',
      });
    }
  };

  // Serve file content
  public serveFile = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = req.user!;
      const filePath = decodeURIComponent(req.params.filePath);

      // Get file info from database
      const file = await prisma.file.findFirst({
        where: {
          path: filePath,
          tenantId,
        },
      });

      if (!file) {
        res.status(404).json({
          success: false,
          error: 'File not found',
        });
        return;
      }

      // Get file buffer from storage
      const fileBuffer = await this.fileUploadService['storage'].getFile(filePath);

      // Set appropriate headers
      res.setHeader('Content-Type', file.mimetype);
      res.setHeader('Content-Length', file.size);
      res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year cache

      res.send(fileBuffer);
    } catch (error) {
      logger.error('Serve file failed', {
        error: error.message,
        filePath: req.params.filePath,
        tenantId: req.user?.tenantId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to serve file',
      });
    }
  };

  // Delete file
  public deleteFile = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId, userId } = req.user!;
      const { fileId } = req.params;

      await this.fileUploadService.deleteFile(fileId, tenantId, userId);

      logger.info('File deleted successfully', {
        fileId,
        tenantId,
        userId,
      });

      res.status(200).json({
        success: true,
        message: 'File deleted successfully',
      });
    } catch (error) {
      logger.error('Delete file failed', {
        error: error.message,
        fileId: req.params.fileId,
        tenantId: req.user?.tenantId,
        userId: req.user?.userId,
      });

      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete file',
      });
    }
  };

  // Get files for conversation
  public getConversationFiles = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId, userId } = req.user!;
      const { conversationId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      // Verify conversation access
      const hasAccess = await this.verifyConversationAccess(
        conversationId,
        tenantId,
        userId
      );
      if (!hasAccess) {
        res.status(403).json({
          success: false,
          error: 'Access denied to conversation',
        });
        return;
      }

      const files = await this.fileUploadService.getConversationFiles(
        conversationId,
        tenantId,
        limit,
        offset
      );

      res.status(200).json({
        success: true,
        data: {
          files,
          pagination: {
            limit,
            offset,
            hasMore: files.length === limit,
          },
        },
      });
    } catch (error) {
      logger.error('Get conversation files failed', {
        error: error.message,
        conversationId: req.params.conversationId,
        tenantId: req.user?.tenantId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve conversation files',
      });
    }
  };

  // Generate thumbnail
  public generateThumbnail = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = req.user!;
      const { fileId } = req.params;
      const { width, height, quality } = req.body;

      const file = await prisma.file.findFirst({
        where: {
          id: fileId,
          tenantId,
        },
      });

      if (!file) {
        res.status(404).json({
          success: false,
          error: 'File not found',
        });
        return;
      }

      if (!file.mimetype.startsWith('image/')) {
        res.status(400).json({
          success: false,
          error: 'File is not an image',
        });
        return;
      }

      // Get original file
      const fileBuffer = await this.fileUploadService['storage'].getFile(file.path);

      // Generate thumbnail
      const thumbnailUrl = await this.fileUploadService['imageProcessor'].generateThumbnail(
        fileBuffer,
        file.filename,
        tenantId,
        { width, height, quality }
      );

      // Update file record with thumbnail URL
      await prisma.file.update({
        where: { id: fileId },
        data: { thumbnailUrl },
      });

      res.status(200).json({
        success: true,
        data: {
          thumbnailUrl,
        },
      });
    } catch (error) {
      logger.error('Thumbnail generation failed', {
        error: error.message,
        fileId: req.params.fileId,
        tenantId: req.user?.tenantId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to generate thumbnail',
      });
    }
  };

  // Get file upload progress (for large files)
  public getUploadProgress = async (req: Request, res: Response): Promise<void> => {
    try {
      const { uploadId } = req.params;
      
      // TODO: Implement upload progress tracking
      // This would typically involve storing upload progress in Redis or similar
      
      res.status(200).json({
        success: true,
        data: {
          uploadId,
          progress: 100, // Placeholder
          status: 'completed',
        },
      });
    } catch (error) {
      logger.error('Get upload progress failed', {
        error: error.message,
        uploadId: req.params.uploadId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get upload progress',
      });
    }
  };

  // Get tenant storage usage
  public getStorageUsage = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = req.user!;

      const usage = await this.fileUploadService['storage'].getTenantStorageUsage(tenantId);
      
      // Get file count and breakdown by type
      const fileStats = await prisma.file.groupBy({
        by: ['mimetype'],
        where: { tenantId },
        _count: { id: true },
        _sum: { size: true },
      });

      const breakdown = fileStats.map(stat => ({
        mimeType: stat.mimetype,
        count: stat._count.id,
        totalSize: stat._sum.size || 0,
      }));

      res.status(200).json({
        success: true,
        data: {
          totalSize: usage.totalSize,
          fileCount: usage.fileCount,
          breakdown,
        },
      });
    } catch (error) {
      logger.error('Get storage usage failed', {
        error: error.message,
        tenantId: req.user?.tenantId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get storage usage',
      });
    }
  };

  // Private helper methods
  private async verifyConversationAccess(
    conversationId: string,
    tenantId: string,
    userId: string
  ): Promise<boolean> {
    try {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          tenantId,
          participants: {
            some: {
              userId,
            },
          },
        },
      });

      return !!conversation;
    } catch (error) {
      logger.error('Conversation access verification failed', {
        error: error.message,
        conversationId,
        tenantId,
        userId,
      });
      return false;
    }
  }
}
