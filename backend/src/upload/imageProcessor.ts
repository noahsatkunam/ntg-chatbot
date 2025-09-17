import sharp from 'sharp';
import path from 'path';
import { FileStorage } from './fileStorage';
import { logger } from '../utils/logger';

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
}

export interface ImageProcessingResult {
  thumbnailUrl: string;
  thumbnailPath: string;
  width: number;
  height: number;
}

export class ImageProcessor {
  private storage: FileStorage;
  
  private readonly defaultThumbnailOptions: ThumbnailOptions = {
    width: 300,
    height: 300,
    quality: 80,
    format: 'jpeg',
  };

  private readonly previewSizes = {
    thumbnail: { width: 150, height: 150 },
    small: { width: 300, height: 300 },
    medium: { width: 600, height: 600 },
    large: { width: 1200, height: 1200 },
  };

  constructor() {
    this.storage = new FileStorage();
  }

  // Generate thumbnail for image
  public async generateThumbnail(
    imageBuffer: Buffer,
    originalFilename: string,
    tenantId: string,
    options?: ThumbnailOptions
  ): Promise<string> {
    try {
      const opts = { ...this.defaultThumbnailOptions, ...options };
      
      // Generate thumbnail filename
      const ext = path.extname(originalFilename);
      const baseName = path.basename(originalFilename, ext);
      const thumbnailFilename = `${baseName}_thumb_${opts.width}x${opts.height}.${opts.format}`;

      // Process image
      const thumbnailBuffer = await this.processImage(imageBuffer, {
        width: opts.width,
        height: opts.height,
        quality: opts.quality,
        format: opts.format,
      });

      // Store thumbnail
      const thumbnailPath = await this.storage.storeFile(
        thumbnailBuffer,
        thumbnailFilename,
        tenantId,
        'thumbnails'
      );

      // Get thumbnail URL
      const thumbnailUrl = await this.storage.getFileUrl(thumbnailPath);

      logger.info('Thumbnail generated successfully', {
        originalFilename,
        thumbnailFilename,
        tenantId,
        size: thumbnailBuffer.length,
      });

      return thumbnailUrl;
    } catch (error) {
      logger.error('Thumbnail generation failed', {
        error: error.message,
        originalFilename,
        tenantId,
      });
      throw new Error(`Failed to generate thumbnail: ${error.message}`);
    }
  }

  // Generate multiple sizes for responsive images
  public async generateMultipleSizes(
    imageBuffer: Buffer,
    originalFilename: string,
    tenantId: string
  ): Promise<Record<string, ImageProcessingResult>> {
    const results: Record<string, ImageProcessingResult> = {};

    try {
      const processPromises = Object.entries(this.previewSizes).map(
        async ([sizeName, dimensions]) => {
          const ext = path.extname(originalFilename);
          const baseName = path.basename(originalFilename, ext);
          const sizedFilename = `${baseName}_${sizeName}_${dimensions.width}x${dimensions.height}.jpeg`;

          const processedBuffer = await this.processImage(imageBuffer, {
            width: dimensions.width,
            height: dimensions.height,
            quality: 85,
            format: 'jpeg',
          });

          const filePath = await this.storage.storeFile(
            processedBuffer,
            sizedFilename,
            tenantId,
            'processed'
          );

          const fileUrl = await this.storage.getFileUrl(filePath);

          results[sizeName] = {
            thumbnailUrl: fileUrl,
            thumbnailPath: filePath,
            width: dimensions.width,
            height: dimensions.height,
          };
        }
      );

      await Promise.all(processPromises);

      logger.info('Multiple image sizes generated', {
        originalFilename,
        tenantId,
        sizes: Object.keys(results),
      });

      return results;
    } catch (error) {
      logger.error('Multiple size generation failed', {
        error: error.message,
        originalFilename,
        tenantId,
      });
      throw error;
    }
  }

  // Optimize image for web
  public async optimizeForWeb(
    imageBuffer: Buffer,
    options?: {
      maxWidth?: number;
      maxHeight?: number;
      quality?: number;
      format?: 'jpeg' | 'png' | 'webp';
    }
  ): Promise<Buffer> {
    try {
      const opts = {
        maxWidth: 1920,
        maxHeight: 1080,
        quality: 85,
        format: 'jpeg' as const,
        ...options,
      };

      return await this.processImage(imageBuffer, {
        width: opts.maxWidth,
        height: opts.maxHeight,
        quality: opts.quality,
        format: opts.format,
        fit: 'inside',
        withoutEnlargement: true,
      });
    } catch (error) {
      logger.error('Image optimization failed', { error: error.message });
      throw error;
    }
  }

  // Extract image metadata
  public async getImageMetadata(imageBuffer: Buffer): Promise<sharp.Metadata> {
    try {
      return await sharp(imageBuffer).metadata();
    } catch (error) {
      logger.error('Failed to extract image metadata', { error: error.message });
      throw error;
    }
  }

  // Validate image and get info
  public async validateImage(imageBuffer: Buffer): Promise<{
    isValid: boolean;
    metadata?: sharp.Metadata;
    error?: string;
  }> {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      
      // Check if image is valid
      if (!metadata.width || !metadata.height) {
        return {
          isValid: false,
          error: 'Invalid image: missing dimensions',
        };
      }

      // Check image size limits
      const maxDimension = 10000; // 10k pixels max
      if (metadata.width > maxDimension || metadata.height > maxDimension) {
        return {
          isValid: false,
          error: `Image dimensions too large: ${metadata.width}x${metadata.height}`,
        };
      }

      // Check for supported formats
      const supportedFormats = ['jpeg', 'png', 'gif', 'webp', 'tiff', 'svg'];
      if (metadata.format && !supportedFormats.includes(metadata.format)) {
        return {
          isValid: false,
          error: `Unsupported image format: ${metadata.format}`,
        };
      }

      return {
        isValid: true,
        metadata,
      };
    } catch (error) {
      return {
        isValid: false,
        error: `Image validation failed: ${error.message}`,
      };
    }
  }

  // Convert image format
  public async convertFormat(
    imageBuffer: Buffer,
    targetFormat: 'jpeg' | 'png' | 'webp',
    quality = 85
  ): Promise<Buffer> {
    try {
      let pipeline = sharp(imageBuffer);

      switch (targetFormat) {
        case 'jpeg':
          pipeline = pipeline.jpeg({ quality, progressive: true });
          break;
        case 'png':
          pipeline = pipeline.png({ compressionLevel: 9 });
          break;
        case 'webp':
          pipeline = pipeline.webp({ quality });
          break;
      }

      return await pipeline.toBuffer();
    } catch (error) {
      logger.error('Image format conversion failed', {
        error: error.message,
        targetFormat,
      });
      throw error;
    }
  }

  // Remove EXIF data for privacy
  public async stripMetadata(imageBuffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(imageBuffer)
        .rotate() // Auto-rotate based on EXIF
        .removeAlpha() // Remove alpha channel if not needed
        .toBuffer();
    } catch (error) {
      logger.error('Metadata stripping failed', { error: error.message });
      throw error;
    }
  }

  // Private helper method for image processing
  private async processImage(
    imageBuffer: Buffer,
    options: {
      width?: number;
      height?: number;
      quality?: number;
      format?: 'jpeg' | 'png' | 'webp';
      fit?: keyof sharp.FitEnum;
      withoutEnlargement?: boolean;
    }
  ): Promise<Buffer> {
    try {
      let pipeline = sharp(imageBuffer);

      // Resize if dimensions provided
      if (options.width || options.height) {
        pipeline = pipeline.resize(options.width, options.height, {
          fit: options.fit || 'cover',
          withoutEnlargement: options.withoutEnlargement || false,
        });
      }

      // Apply format and quality
      switch (options.format) {
        case 'jpeg':
          pipeline = pipeline.jpeg({
            quality: options.quality || 85,
            progressive: true,
          });
          break;
        case 'png':
          pipeline = pipeline.png({
            compressionLevel: 9,
          });
          break;
        case 'webp':
          pipeline = pipeline.webp({
            quality: options.quality || 85,
          });
          break;
      }

      return await pipeline.toBuffer();
    } catch (error) {
      logger.error('Image processing failed', {
        error: error.message,
        options,
      });
      throw error;
    }
  }

  // Generate image placeholder/blur
  public async generatePlaceholder(
    imageBuffer: Buffer,
    size = 20
  ): Promise<string> {
    try {
      const placeholder = await sharp(imageBuffer)
        .resize(size, size, { fit: 'cover' })
        .blur(1)
        .jpeg({ quality: 50 })
        .toBuffer();

      // Convert to base64 data URL
      const base64 = placeholder.toString('base64');
      return `data:image/jpeg;base64,${base64}`;
    } catch (error) {
      logger.error('Placeholder generation failed', { error: error.message });
      throw error;
    }
  }
}
