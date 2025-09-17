import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';

export interface StorageConfig {
  type: 'local' | 's3' | 'minio';
  basePath?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKey?: string;
  secretKey?: string;
}

export class FileStorage {
  private config: StorageConfig;
  private basePath: string;

  constructor(config?: StorageConfig) {
    this.config = config || {
      type: 'local',
      basePath: process.env.UPLOAD_PATH || './uploads',
    };
    
    this.basePath = this.config.basePath || './uploads';
    this.ensureDirectoryExists();
  }

  // Store file and return path
  public async storeFile(
    buffer: Buffer,
    filename: string,
    tenantId: string,
    subfolder = 'files'
  ): Promise<string> {
    try {
      const relativePath = this.generateFilePath(tenantId, subfolder, filename);
      const fullPath = path.join(this.basePath, relativePath);
      
      // Ensure directory exists
      await this.ensureDirectoryExists(path.dirname(fullPath));
      
      // Write file
      await fs.writeFile(fullPath, buffer);
      
      logger.info('File stored successfully', {
        filename,
        tenantId,
        path: relativePath,
        size: buffer.length,
      });
      
      return relativePath;
    } catch (error) {
      logger.error('File storage failed', {
        error: error.message,
        filename,
        tenantId,
      });
      throw new Error(`Failed to store file: ${error.message}`);
    }
  }

  // Get file URL for serving
  public async getFileUrl(filePath: string): Promise<string> {
    // For local storage, return a URL that can be served by Express
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001';
    return `${baseUrl}/api/files/serve/${encodeURIComponent(filePath)}`;
  }

  // Get file buffer
  public async getFile(filePath: string): Promise<Buffer> {
    try {
      const fullPath = path.join(this.basePath, filePath);
      return await fs.readFile(fullPath);
    } catch (error) {
      logger.error('File retrieval failed', {
        error: error.message,
        filePath,
      });
      throw new Error(`Failed to retrieve file: ${error.message}`);
    }
  }

  // Delete file
  public async deleteFile(filePath: string): Promise<void> {
    try {
      const fullPath = path.join(this.basePath, filePath);
      await fs.unlink(fullPath);
      
      logger.info('File deleted successfully', { filePath });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error('File deletion failed', {
          error: error.message,
          filePath,
        });
        throw new Error(`Failed to delete file: ${error.message}`);
      }
    }
  }

  // Check if file exists
  public async fileExists(filePath: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.basePath, filePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  // Get file stats
  public async getFileStats(filePath: string): Promise<{
    size: number;
    createdAt: Date;
    modifiedAt: Date;
  }> {
    try {
      const fullPath = path.join(this.basePath, filePath);
      const stats = await fs.stat(fullPath);
      
      return {
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      };
    } catch (error) {
      logger.error('Failed to get file stats', {
        error: error.message,
        filePath,
      });
      throw new Error(`Failed to get file stats: ${error.message}`);
    }
  }

  // Move file to different location
  public async moveFile(
    currentPath: string,
    newPath: string
  ): Promise<void> {
    try {
      const currentFullPath = path.join(this.basePath, currentPath);
      const newFullPath = path.join(this.basePath, newPath);
      
      // Ensure target directory exists
      await this.ensureDirectoryExists(path.dirname(newFullPath));
      
      // Move file
      await fs.rename(currentFullPath, newFullPath);
      
      logger.info('File moved successfully', {
        from: currentPath,
        to: newPath,
      });
    } catch (error) {
      logger.error('File move failed', {
        error: error.message,
        from: currentPath,
        to: newPath,
      });
      throw new Error(`Failed to move file: ${error.message}`);
    }
  }

  // Copy file
  public async copyFile(
    sourcePath: string,
    targetPath: string
  ): Promise<void> {
    try {
      const sourceFullPath = path.join(this.basePath, sourcePath);
      const targetFullPath = path.join(this.basePath, targetPath);
      
      // Ensure target directory exists
      await this.ensureDirectoryExists(path.dirname(targetFullPath));
      
      // Copy file
      await fs.copyFile(sourceFullPath, targetFullPath);
      
      logger.info('File copied successfully', {
        from: sourcePath,
        to: targetPath,
      });
    } catch (error) {
      logger.error('File copy failed', {
        error: error.message,
        from: sourcePath,
        to: targetPath,
      });
      throw new Error(`Failed to copy file: ${error.message}`);
    }
  }

  // List files in directory
  public async listFiles(
    tenantId: string,
    subfolder = 'files',
    limit = 100,
    offset = 0
  ): Promise<string[]> {
    try {
      const dirPath = path.join(this.basePath, tenantId, subfolder);
      
      // Check if directory exists
      try {
        await fs.access(dirPath);
      } catch {
        return []; // Directory doesn't exist, return empty array
      }
      
      const files = await fs.readdir(dirPath);
      return files
        .slice(offset, offset + limit)
        .map(file => path.join(tenantId, subfolder, file));
    } catch (error) {
      logger.error('Failed to list files', {
        error: error.message,
        tenantId,
        subfolder,
      });
      throw new Error(`Failed to list files: ${error.message}`);
    }
  }

  // Get tenant storage usage
  public async getTenantStorageUsage(tenantId: string): Promise<{
    totalSize: number;
    fileCount: number;
  }> {
    try {
      const tenantPath = path.join(this.basePath, tenantId);
      
      // Check if tenant directory exists
      try {
        await fs.access(tenantPath);
      } catch {
        return { totalSize: 0, fileCount: 0 };
      }
      
      let totalSize = 0;
      let fileCount = 0;
      
      const calculateSize = async (dirPath: string): Promise<void> => {
        const items = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const item of items) {
          const itemPath = path.join(dirPath, item.name);
          
          if (item.isDirectory()) {
            await calculateSize(itemPath);
          } else if (item.isFile()) {
            const stats = await fs.stat(itemPath);
            totalSize += stats.size;
            fileCount++;
          }
        }
      };
      
      await calculateSize(tenantPath);
      
      return { totalSize, fileCount };
    } catch (error) {
      logger.error('Failed to calculate tenant storage usage', {
        error: error.message,
        tenantId,
      });
      return { totalSize: 0, fileCount: 0 };
    }
  }

  // Clean up old files
  public async cleanupOldFiles(
    tenantId: string,
    olderThanDays: number
  ): Promise<number> {
    try {
      const tenantPath = path.join(this.basePath, tenantId);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      let deletedCount = 0;
      
      const cleanupDirectory = async (dirPath: string): Promise<void> => {
        try {
          const items = await fs.readdir(dirPath, { withFileTypes: true });
          
          for (const item of items) {
            const itemPath = path.join(dirPath, item.name);
            
            if (item.isDirectory()) {
              await cleanupDirectory(itemPath);
            } else if (item.isFile()) {
              const stats = await fs.stat(itemPath);
              
              if (stats.mtime < cutoffDate) {
                await fs.unlink(itemPath);
                deletedCount++;
              }
            }
          }
        } catch (error) {
          logger.warn('Error during cleanup', {
            error: error.message,
            dirPath,
          });
        }
      };
      
      await cleanupDirectory(tenantPath);
      
      logger.info('File cleanup completed', {
        tenantId,
        deletedCount,
        olderThanDays,
      });
      
      return deletedCount;
    } catch (error) {
      logger.error('File cleanup failed', {
        error: error.message,
        tenantId,
        olderThanDays,
      });
      return 0;
    }
  }

  // Private helper methods
  private generateFilePath(
    tenantId: string,
    subfolder: string,
    filename: string
  ): string {
    // Create date-based subdirectory for organization
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    return path.join(tenantId, subfolder, `${year}`, `${month}`, `${day}`, filename);
  }

  private async ensureDirectoryExists(dirPath?: string): Promise<void> {
    const targetPath = dirPath || this.basePath;
    
    try {
      await fs.access(targetPath);
    } catch {
      await fs.mkdir(targetPath, { recursive: true });
      logger.info('Directory created', { path: targetPath });
    }
  }
}
