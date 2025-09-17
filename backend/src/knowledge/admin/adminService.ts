import { PrismaClient } from '@prisma/client';
import { JobQueue } from '../batch/jobQueue';
import { BatchProcessor } from '../batch/batchProcessor';
import { DocumentAnalyzer } from '../analysis/documentAnalyzer';
import { ChunkingService } from '../chunking/chunkingService';
import { AppError } from '../../middlewares/errorHandler';
import * as fs from 'fs/promises';
import * as path from 'path';

const prisma = new PrismaClient();

export interface AdminDashboardStats {
  overview: {
    totalDocuments: number;
    totalChunks: number;
    totalCollections: number;
    storageUsed: number;
    processingJobs: {
      pending: number;
      processing: number;
      completed: number;
      failed: number;
    };
  };
  recent: {
    recentUploads: Array<{
      id: string;
      title: string;
      uploadedAt: Date;
      status: string;
      size: number;
    }>;
    recentSearches: Array<{
      query: string;
      timestamp: Date;
      results: number;
      userId: string;
    }>;
    recentErrors: Array<{
      message: string;
      timestamp: Date;
      documentId?: string;
    }>;
  };
  analytics: {
    documentsPerDay: Array<{ date: string; count: number }>;
    searchesPerDay: Array<{ date: string; count: number }>;
    popularDocuments: Array<{
      id: string;
      title: string;
      views: number;
      searches: number;
    }>;
    qualityDistribution: {
      high: number;
      medium: number;
      low: number;
    };
  };
}

export interface BulkOperationResult {
  operationId: string;
  type: 'upload' | 'reprocess' | 'delete' | 'move';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: {
    total: number;
    completed: number;
    failed: number;
    percentage: number;
  };
  results?: any[];
  errors?: string[];
}

export class AdminService {
  private jobQueue: JobQueue;
  private batchProcessor: BatchProcessor;
  private documentAnalyzer: DocumentAnalyzer;
  private chunkingService: ChunkingService;

  constructor(jobQueue: JobQueue) {
    this.jobQueue = jobQueue;
    this.batchProcessor = new BatchProcessor(jobQueue);
    this.documentAnalyzer = new DocumentAnalyzer();
    this.chunkingService = new ChunkingService();
  }

  /**
   * Get comprehensive dashboard statistics
   */
  async getDashboardStats(tenantId: string): Promise<AdminDashboardStats> {
    try {
      const [
        overview,
        recentUploads,
        recentSearches,
        recentErrors,
        documentsPerDay,
        searchesPerDay,
        popularDocuments,
        qualityDistribution
      ] = await Promise.all([
        this.getOverviewStats(tenantId),
        this.getRecentUploads(tenantId),
        this.getRecentSearches(tenantId),
        this.getRecentErrors(tenantId),
        this.getDocumentsPerDay(tenantId),
        this.getSearchesPerDay(tenantId),
        this.getPopularDocuments(tenantId),
        this.getQualityDistribution(tenantId)
      ]);

      return {
        overview,
        recent: {
          recentUploads,
          recentSearches,
          recentErrors
        },
        analytics: {
          documentsPerDay,
          searchesPerDay,
          popularDocuments,
          qualityDistribution
        }
      };
    } catch (error) {
      throw new AppError(`Failed to get dashboard stats: ${error}`, 500);
    }
  }

  /**
   * Bulk upload documents
   */
  async bulkUpload(
    files: Array<{ path: string; originalName: string }>,
    tenantId: string,
    userId: string,
    options: {
      collectionId?: string;
      tags?: string[];
      chunkingStrategy?: string;
      priority?: number;
    } = {}
  ): Promise<BulkOperationResult> {
    try {
      const filePaths = files.map(f => f.path);
      
      const result = await this.batchProcessor.processBatchUpload(
        filePaths,
        tenantId,
        userId,
        {
          collectionId: options.collectionId,
          tags: options.tags,
          chunkingStrategy: options.chunkingStrategy as any,
          priority: options.priority
        }
      );

      return {
        operationId: result.batchId,
        type: 'upload',
        status: result.status as any,
        progress: {
          total: result.totalFiles,
          completed: 0,
          failed: 0,
          percentage: 0
        }
      };
    } catch (error) {
      throw new AppError(`Bulk upload failed: ${error}`, 500);
    }
  }

  /**
   * Bulk reprocess documents
   */
  async bulkReprocess(
    documentIds: string[],
    tenantId: string,
    userId: string,
    options: {
      chunkingStrategy?: string;
      chunkSize?: number;
      chunkOverlap?: number;
    } = {}
  ): Promise<BulkOperationResult> {
    try {
      const result = await this.batchProcessor.reprocessDocuments(
        documentIds,
        tenantId,
        userId,
        {
          chunkingStrategy: options.chunkingStrategy as any,
          chunkSize: options.chunkSize,
          chunkOverlap: options.chunkOverlap
        }
      );

      return {
        operationId: result.batchId,
        type: 'reprocess',
        status: result.status as any,
        progress: {
          total: result.totalFiles,
          completed: 0,
          failed: 0,
          percentage: 0
        }
      };
    } catch (error) {
      throw new AppError(`Bulk reprocess failed: ${error}`, 500);
    }
  }

  /**
   * Bulk delete documents
   */
  async bulkDelete(
    documentIds: string[],
    tenantId: string,
    userId: string
  ): Promise<BulkOperationResult> {
    try {
      const operationId = `delete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let completed = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const documentId of documentIds) {
        try {
          await this.deleteDocument(documentId, tenantId);
          completed++;
        } catch (error) {
          failed++;
          errors.push(`Failed to delete document ${documentId}: ${error}`);
        }
      }

      return {
        operationId,
        type: 'delete',
        status: failed === 0 ? 'completed' : 'completed',
        progress: {
          total: documentIds.length,
          completed,
          failed,
          percentage: Math.round(((completed + failed) / documentIds.length) * 100)
        },
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      throw new AppError(`Bulk delete failed: ${error}`, 500);
    }
  }

  /**
   * Move documents to different collection
   */
  async bulkMoveToCollection(
    documentIds: string[],
    targetCollectionId: string,
    tenantId: string,
    userId: string
  ): Promise<BulkOperationResult> {
    try {
      const operationId = `move_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const result = await prisma.knowledgeDocument.updateMany({
        where: {
          id: { in: documentIds },
          tenantId
        },
        data: {
          collectionId: targetCollectionId,
          updatedAt: new Date()
        }
      });

      return {
        operationId,
        type: 'move',
        status: 'completed',
        progress: {
          total: documentIds.length,
          completed: result.count,
          failed: documentIds.length - result.count,
          percentage: 100
        }
      };
    } catch (error) {
      throw new AppError(`Bulk move failed: ${error}`, 500);
    }
  }

  /**
   * Get operation status
   */
  async getOperationStatus(operationId: string): Promise<BulkOperationResult> {
    try {
      // Check if it's a batch operation
      const batchStatus = await this.batchProcessor.getBatchStatus(operationId);
      
      return {
        operationId,
        type: 'upload', // Would determine from operation ID or database
        status: batchStatus.status as any,
        progress: {
          total: batchStatus.progress.total,
          completed: batchStatus.progress.completed,
          failed: batchStatus.progress.failed,
          percentage: batchStatus.progress.percentage
        }
      };
    } catch (error) {
      throw new AppError(`Failed to get operation status: ${error}`, 500);
    }
  }

  /**
   * Get knowledge base settings
   */
  async getSettings(tenantId: string): Promise<any> {
    try {
      const settings = await prisma.knowledgeBaseSettings.findUnique({
        where: { tenantId }
      });

      return settings || this.getDefaultSettings();
    } catch (error) {
      throw new AppError(`Failed to get settings: ${error}`, 500);
    }
  }

  /**
   * Update knowledge base settings
   */
  async updateSettings(tenantId: string, settings: any): Promise<any> {
    try {
      const updatedSettings = await prisma.knowledgeBaseSettings.upsert({
        where: { tenantId },
        update: {
          ...settings,
          updatedAt: new Date()
        },
        create: {
          tenantId,
          ...settings,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      return updatedSettings;
    } catch (error) {
      throw new AppError(`Failed to update settings: ${error}`, 500);
    }
  }

  /**
   * Get system health status
   */
  async getSystemHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    services: {
      database: { status: string; responseTime: number };
      vectorDb: { status: string; responseTime: number };
      jobQueue: { status: string; pendingJobs: number };
      storage: { status: string; usage: number };
    };
    metrics: {
      totalRequests: number;
      errorRate: number;
      avgResponseTime: number;
    };
  }> {
    try {
      const [
        dbHealth,
        queueStats,
        storageStats
      ] = await Promise.all([
        this.checkDatabaseHealth(),
        this.jobQueue.getQueueStats(),
        this.getStorageStats()
      ]);

      const services = {
        database: dbHealth,
        vectorDb: { status: 'healthy', responseTime: 50 }, // Mock
        jobQueue: { 
          status: queueStats.failed > queueStats.completed * 0.1 ? 'degraded' : 'healthy',
          pendingJobs: queueStats.pending + queueStats.processing
        },
        storage: storageStats
      };

      const overallStatus = Object.values(services).every(s => s.status === 'healthy') 
        ? 'healthy' 
        : Object.values(services).some(s => s.status === 'unhealthy')
        ? 'unhealthy'
        : 'degraded';

      return {
        status: overallStatus,
        services,
        metrics: {
          totalRequests: 0, // Would track in production
          errorRate: 0,
          avgResponseTime: 0
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        services: {
          database: { status: 'unhealthy', responseTime: 0 },
          vectorDb: { status: 'unknown', responseTime: 0 },
          jobQueue: { status: 'unknown', pendingJobs: 0 },
          storage: { status: 'unknown', usage: 0 }
        },
        metrics: {
          totalRequests: 0,
          errorRate: 1,
          avgResponseTime: 0
        }
      };
    }
  }

  /**
   * Cleanup old data
   */
  async cleanupOldData(
    tenantId: string,
    options: {
      deleteOldJobs?: boolean;
      deleteOldLogs?: boolean;
      deleteOldAnalytics?: boolean;
      olderThanDays?: number;
    } = {}
  ): Promise<{
    jobsDeleted: number;
    logsDeleted: number;
    analyticsDeleted: number;
  }> {
    try {
      const olderThanDays = options.olderThanDays || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      let jobsDeleted = 0;
      let logsDeleted = 0;
      let analyticsDeleted = 0;

      if (options.deleteOldJobs) {
        jobsDeleted = await this.jobQueue.cleanupOldJobs(olderThanDays);
      }

      if (options.deleteOldLogs) {
        const result = await prisma.retrievalLog.deleteMany({
          where: {
            tenantId,
            createdAt: { lt: cutoffDate }
          }
        });
        logsDeleted = result.count;
      }

      if (options.deleteOldAnalytics) {
        const result = await prisma.searchAnalytics.deleteMany({
          where: {
            tenantId,
            createdAt: { lt: cutoffDate }
          }
        });
        analyticsDeleted = result.count;
      }

      return {
        jobsDeleted,
        logsDeleted,
        analyticsDeleted
      };
    } catch (error) {
      throw new AppError(`Cleanup failed: ${error}`, 500);
    }
  }

  /**
   * Export knowledge base data
   */
  async exportData(
    tenantId: string,
    options: {
      includeDocuments?: boolean;
      includeChunks?: boolean;
      includeAnalytics?: boolean;
      format?: 'json' | 'csv';
    } = {}
  ): Promise<{
    exportId: string;
    downloadUrl: string;
    expiresAt: Date;
  }> {
    try {
      const exportId = `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // This would generate export file in background
      // For now, return mock response
      
      return {
        exportId,
        downloadUrl: `/api/admin/exports/${exportId}/download`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      };
    } catch (error) {
      throw new AppError(`Export failed: ${error}`, 500);
    }
  }

  // Private helper methods

  private async getOverviewStats(tenantId: string): Promise<any> {
    const [
      totalDocuments,
      totalChunks,
      totalCollections,
      queueStats
    ] = await Promise.all([
      prisma.knowledgeDocument.count({ where: { tenantId } }),
      prisma.documentChunk.count({ where: { tenantId } }),
      prisma.knowledgeCollection.count({ where: { tenantId } }),
      this.jobQueue.getQueueStats(tenantId)
    ]);

    return {
      totalDocuments,
      totalChunks,
      totalCollections,
      storageUsed: 0, // Would calculate from file sizes
      processingJobs: queueStats
    };
  }

  private async getRecentUploads(tenantId: string): Promise<any[]> {
    const documents = await prisma.knowledgeDocument.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        createdAt: true,
        fileSize: true
      }
    });

    return documents.map(doc => ({
      id: doc.id,
      title: doc.title || 'Untitled',
      uploadedAt: doc.createdAt,
      status: 'completed',
      size: doc.fileSize || 0
    }));
  }

  private async getRecentSearches(tenantId: string): Promise<any[]> {
    const searches = await prisma.searchAnalytics.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        query: true,
        createdAt: true,
        resultsCount: true,
        userId: true
      }
    });

    return searches.map(search => ({
      query: search.query,
      timestamp: search.createdAt,
      results: search.resultsCount || 0,
      userId: search.userId
    }));
  }

  private async getRecentErrors(tenantId: string): Promise<any[]> {
    // This would query error logs from database
    return [];
  }

  private async getDocumentsPerDay(tenantId: string): Promise<any[]> {
    // This would aggregate document creation by day
    return [];
  }

  private async getSearchesPerDay(tenantId: string): Promise<any[]> {
    // This would aggregate searches by day
    return [];
  }

  private async getPopularDocuments(tenantId: string): Promise<any[]> {
    // This would get most accessed documents
    return [];
  }

  private async getQualityDistribution(tenantId: string): Promise<any> {
    // This would analyze document quality scores
    return {
      high: 0,
      medium: 0,
      low: 0
    };
  }

  private async deleteDocument(documentId: string, tenantId: string): Promise<void> {
    // Delete chunks first
    await prisma.documentChunk.deleteMany({
      where: { documentId, tenantId }
    });

    // Delete document
    await prisma.knowledgeDocument.delete({
      where: { id: documentId }
    });
  }

  private getDefaultSettings(): any {
    return {
      chunkingStrategy: 'semantic',
      chunkSize: 1000,
      chunkOverlap: 200,
      enableOCR: false,
      autoReprocess: false,
      maxFileSize: 50 * 1024 * 1024, // 50MB
      allowedFileTypes: ['pdf', 'docx', 'txt', 'md'],
      searchSettings: {
        enableFacetedSearch: true,
        maxResults: 50,
        enableAnalytics: true
      }
    };
  }

  private async checkDatabaseHealth(): Promise<{ status: string; responseTime: number }> {
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        status: 'healthy',
        responseTime: Date.now() - start
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - start
      };
    }
  }

  private async getStorageStats(): Promise<{ status: string; usage: number }> {
    try {
      // This would check actual storage usage
      return {
        status: 'healthy',
        usage: 0.3 // 30% usage
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        usage: 0
      };
    }
  }
}
