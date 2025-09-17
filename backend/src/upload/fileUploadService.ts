import { Request } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import mimeTypes from 'mime-types';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { sanitizeInput } from '../utils/sanitizer';
import { FileValidationService } from './fileValidation';
import { ImageProcessor } from './imageProcessor';
import { FileStorage } from './fileStorage';

const prisma = new PrismaClient();

export interface FileUploadOptions {
  maxFileSize: number;
  allowedMimeTypes: string[];
  generateThumbnail: boolean;
  virusScan: boolean;
}

export interface UploadedFileInfo {
  id: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  path: string;
  url: string;
  thumbnailUrl?: string;
  metadata?: any;
}

export class FileUploadService {
  private storage: FileStorage;
  private validator: FileValidationService;
  private imageProcessor: ImageProcessor;

  constructor() {
    this.storage = new FileStorage();
    this.validator = new FileValidationService();
    this.imageProcessor = new ImageProcessor();
  }

  // Configure multer for file uploads
  public getMulterConfig(tenantId: string): multer.Multer {
    const storage = multer.memoryStorage();
    
    return multer({
      storage,
      limits: {
        fileSize: this.getMaxFileSize(tenantId),
        files: 10, // Max 10 files per upload
      },
      fileFilter: (req, file, cb) => {
        this.validateFileType(file, tenantId)
          .then(isValid => cb(null, isValid))
          .catch(err => cb(err));
      },
    });
  }

  // Upload single file
  public async uploadFile(
    file: Express.Multer.File,
    tenantId: string,
    userId: string,
    conversationId?: string,
    options?: Partial<FileUploadOptions>
  ): Promise<UploadedFileInfo> {
    try {
      // Validate file
      await this.validator.validateFile(file, tenantId);

      // Generate unique filename
      const filename = this.generateFilename(file.originalname);
      const sanitizedOriginalName = sanitizeInput(file.originalname);

      // Detect file type
      const detectedType = await fileTypeFromBuffer(file.buffer);
      const mimetype = detectedType?.mime || file.mimetype;

      // Virus scan if enabled
      if (options?.virusScan !== false) {
        await this.validator.scanForVirus(file.buffer);
      }

      // Store file
      const filePath = await this.storage.storeFile(
        file.buffer,
        filename,
        tenantId
      );

      // Generate thumbnail for images
      let thumbnailUrl: string | undefined;
      if (this.isImage(mimetype) && options?.generateThumbnail !== false) {
        thumbnailUrl = await this.imageProcessor.generateThumbnail(
          file.buffer,
          filename,
          tenantId
        );
      }

      // Get file URL
      const fileUrl = await this.storage.getFileUrl(filePath);

      // Extract metadata
      const metadata = await this.extractMetadata(file.buffer, mimetype);

      // Save to database
      const savedFile = await prisma.file.create({
        data: {
          tenantId,
          conversationId,
          uploadedBy: userId,
          filename,
          originalName: sanitizedOriginalName,
          mimetype,
          size: file.size,
          path: filePath,
          url: fileUrl,
          thumbnailUrl,
          metadata,
          virusScanned: options?.virusScan !== false,
          scanResult: 'clean',
        },
      });

      logger.info('File uploaded successfully', {
        fileId: savedFile.id,
        tenantId,
        userId,
        filename: sanitizedOriginalName,
        size: file.size,
      });

      return {
        id: savedFile.id,
        filename: savedFile.filename,
        originalName: savedFile.originalName,
        mimetype: savedFile.mimetype,
        size: savedFile.size,
        path: savedFile.path,
        url: savedFile.url!,
        thumbnailUrl: savedFile.thumbnailUrl || undefined,
        metadata: savedFile.metadata as any,
      };
    } catch (error) {
      logger.error('File upload failed', {
        error: error.message,
        tenantId,
        userId,
        filename: file.originalname,
      });
      throw error;
    }
  }

  // Upload multiple files
  public async uploadFiles(
    files: Express.Multer.File[],
    tenantId: string,
    userId: string,
    conversationId?: string,
    options?: Partial<FileUploadOptions>
  ): Promise<UploadedFileInfo[]> {
    const uploadPromises = files.map(file =>
      this.uploadFile(file, tenantId, userId, conversationId, options)
    );

    return Promise.all(uploadPromises);
  }

  // Get file by ID
  public async getFile(fileId: string, tenantId: string): Promise<UploadedFileInfo | null> {
    const file = await prisma.file.findFirst({
      where: {
        id: fileId,
        tenantId,
      },
    });

    if (!file) {
      return null;
    }

    return {
      id: file.id,
      filename: file.filename,
      originalName: file.originalName,
      mimetype: file.mimetype,
      size: file.size,
      path: file.path,
      url: file.url!,
      thumbnailUrl: file.thumbnailUrl || undefined,
      metadata: file.metadata as any,
    };
  }

  // Delete file
  public async deleteFile(fileId: string, tenantId: string, userId: string): Promise<void> {
    const file = await prisma.file.findFirst({
      where: {
        id: fileId,
        tenantId,
      },
    });

    if (!file) {
      throw new Error('File not found');
    }

    // Check permissions (owner or admin)
    if (file.uploadedBy !== userId) {
      // TODO: Check if user is admin
      throw new Error('Insufficient permissions to delete file');
    }

    // Delete from storage
    await this.storage.deleteFile(file.path);
    
    // Delete thumbnail if exists
    if (file.thumbnailUrl) {
      await this.storage.deleteFile(file.thumbnailUrl);
    }

    // Delete from database
    await prisma.file.delete({
      where: { id: fileId },
    });

    logger.info('File deleted successfully', {
      fileId,
      tenantId,
      userId,
      filename: file.originalName,
    });
  }

  // Get files for conversation
  public async getConversationFiles(
    conversationId: string,
    tenantId: string,
    limit = 50,
    offset = 0
  ): Promise<UploadedFileInfo[]> {
    const files = await prisma.file.findMany({
      where: {
        conversationId,
        tenantId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
    });

    return files.map(file => ({
      id: file.id,
      filename: file.filename,
      originalName: file.originalName,
      mimetype: file.mimetype,
      size: file.size,
      path: file.path,
      url: file.url!,
      thumbnailUrl: file.thumbnailUrl || undefined,
      metadata: file.metadata as any,
    }));
  }

  // Private helper methods
  private generateFilename(originalName: string): string {
    const ext = path.extname(originalName);
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2);
    return `${timestamp}-${random}${ext}`;
  }

  private async validateFileType(file: Express.Multer.File, tenantId: string): Promise<boolean> {
    const allowedTypes = await this.getAllowedMimeTypes(tenantId);
    return allowedTypes.includes(file.mimetype);
  }

  private async getMaxFileSize(tenantId: string): Promise<number> {
    // TODO: Get from tenant configuration
    return 10 * 1024 * 1024; // 10MB default
  }

  private async getAllowedMimeTypes(tenantId: string): Promise<string[]> {
    // TODO: Get from tenant configuration
    return [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
  }

  private isImage(mimetype: string): boolean {
    return mimetype.startsWith('image/');
  }

  private async extractMetadata(buffer: Buffer, mimetype: string): Promise<any> {
    const metadata: any = {};

    if (this.isImage(mimetype)) {
      try {
        const imageInfo = await sharp(buffer).metadata();
        metadata.width = imageInfo.width;
        metadata.height = imageInfo.height;
        metadata.format = imageInfo.format;
        metadata.hasAlpha = imageInfo.hasAlpha;
      } catch (error) {
        logger.warn('Failed to extract image metadata', { error: error.message });
      }
    }

    return metadata;
  }
}
