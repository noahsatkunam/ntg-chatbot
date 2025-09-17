import { PrismaClient, ProcessingJobType } from '@prisma/client';
import { JobQueue, JobData } from './jobQueue';
import { EventEmitter } from 'events';
import { AppError } from '../../middlewares/errorHandler';
import * as fs from 'fs/promises';
import * as path from 'path';

const prisma = new PrismaClient();

export interface BatchUploadOptions {
  chunkingStrategy?: 'semantic' | 'hierarchical' | 'overlapping' | 'hybrid';
  chunkSize?: number;
  chunkOverlap?: number;
  preserveStructure?: boolean;
  extractMetadata?: boolean;
  enableOCR?: boolean;
  collectionId?: string;
  tags?: string[];
  priority?: number;
}

export interface BatchProcessingResult {
  batchId: string;
  jobIds: string[];
  totalFiles: number;
  estimatedTime: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
}

export class BatchProcessor extends EventEmitter {
  private jobQueue: JobQueue;

  constructor(jobQueue: JobQueue) {
    super();
    this.jobQueue = jobQueue;
    
    // Listen to job queue events
    this.jobQueue.on('jobCompleted', this.handleJobCompleted.bind(this));
    this.jobQueue.on('jobFailed', this.handleJobFailed.bind(this));
    this.jobQueue.on('jobProgress', this.handleJobProgress.bind(this));
  }

  /**
   * Process multiple files in batch
   */
  async processBatchUpload(
    filePaths: string[],
    tenantId: string,
    userId: string,
    options: BatchUploadOptions = {}
  ): Promise<BatchProcessingResult> {
    try {
      // Validate files
      const validatedFiles = await this.validateFiles(filePaths);
      
      if (validatedFiles.length === 0) {
        throw new AppError('No valid files found for processing', 400);
      }

      // Create batch record
      const batchId = await this.createBatchRecord(tenantId, userId, validatedFiles.length, options);

      // Create individual jobs for each file
      const jobDataArray: JobData[] = validatedFiles.map(filePath => ({
        filePath,
        options: {
          chunking: {
            strategy: options.chunkingStrategy || 'semantic',
            chunkSize: options.chunkSize || 1000,
            chunkOverlap: options.chunkOverlap || 200,
            preserveStructure: options.preserveStructure !== false
          },
          processing: {
            extractMetadata: options.extractMetadata !== false,
            enableOCR: options.enableOCR || false
          },
          collection: {
            collectionId: options.collectionId,
            tags: options.tags || []
          }
        },
        metadata: {
          batchId,
          originalPath: filePath
        }
      }));

      // Add jobs to queue
      const jobIds = await this.jobQueue.addBatchJobs(
        ProcessingJobType.BULK_UPLOAD,
        tenantId,
        userId,
        jobDataArray,
        options.priority || 0
      );

      // Update batch record with job IDs
      await this.updateBatchRecord(batchId, { jobIds });

      // Estimate processing time
      const estimatedTime = this.estimateProcessingTime(validatedFiles);

      const result: BatchProcessingResult = {
        batchId,
        jobIds,
        totalFiles: validatedFiles.length,
        estimatedTime,
        status: 'queued'
      };

      this.emit('batchStarted', result);

      return result;
    } catch (error) {
      throw new AppError(`Batch processing failed: ${error}`, 500);
    }
  }

  /**
   * Process URLs in batch
   */
  async processBatchUrls(
    urls: string[],
    tenantId: string,
    userId: string,
    options: BatchUploadOptions = {}
  ): Promise<BatchProcessingResult> {
    try {
      // Validate URLs
      const validatedUrls = await this.validateUrls(urls);
      
      if (validatedUrls.length === 0) {
        throw new AppError('No valid URLs found for processing', 400);
      }

      // Create batch record
      const batchId = await this.createBatchRecord(tenantId, userId, validatedUrls.length, options);

      // Create jobs for each URL
      const jobDataArray: JobData[] = validatedUrls.map(url => ({
        url,
        options: {
          chunking: {
            strategy: options.chunkingStrategy || 'hybrid',
            chunkSize: options.chunkSize || 1000,
            chunkOverlap: options.chunkOverlap || 200
          },
          web: {
            extractImages: true,
            extractLinks: true,
            preserveFormatting: true,
            removeAds: true
          },
          collection: {
            collectionId: options.collectionId,
            tags: options.tags || []
          }
        },
        metadata: {
          batchId,
          originalUrl: url
        }
      }));

      const jobIds = await this.jobQueue.addBatchJobs(
        ProcessingJobType.URL_CRAWL,
        tenantId,
        userId,
        jobDataArray,
        options.priority || 0
      );

      await this.updateBatchRecord(batchId, { jobIds });

      const result: BatchProcessingResult = {
        batchId,
        jobIds,
        totalFiles: validatedUrls.length,
        estimatedTime: this.estimateUrlProcessingTime(validatedUrls),
        status: 'queued'
      };

      this.emit('batchStarted', result);

      return result;
    } catch (error) {
      throw new AppError(`Batch URL processing failed: ${error}`, 500);
    }
  }

  /**
   * Reprocess documents in batch
   */
  async reprocessDocuments(
    documentIds: string[],
    tenantId: string,
    userId: string,
    options: BatchUploadOptions = {}
  ): Promise<BatchProcessingResult> {
    try {
      // Validate documents exist
      const documents = await prisma.knowledgeDocument.findMany({
        where: {
          id: { in: documentIds },
          tenantId
        }
      });

      if (documents.length === 0) {
        throw new AppError('No valid documents found for reprocessing', 400);
      }

      const batchId = await this.createBatchRecord(tenantId, userId, documents.length, options);

      const jobDataArray: JobData[] = documents.map(doc => ({
        documentId: doc.id,
        options: {
          chunking: {
            strategy: options.chunkingStrategy || 'semantic',
            chunkSize: options.chunkSize || 1000,
            chunkOverlap: options.chunkOverlap || 200,
            preserveStructure: options.preserveStructure !== false
          }
        },
        metadata: {
          batchId,
          originalDocumentId: doc.id
        }
      }));

      const jobIds = await this.jobQueue.addBatchJobs(
        ProcessingJobType.DOCUMENT_REPROCESS,
        tenantId,
        userId,
        jobDataArray,
        options.priority || 0
      );

      await this.updateBatchRecord(batchId, { jobIds });

      const result: BatchProcessingResult = {
        batchId,
        jobIds,
        totalFiles: documents.length,
        estimatedTime: this.estimateReprocessingTime(documents),
        status: 'queued'
      };

      this.emit('batchStarted', result);

      return result;
    } catch (error) {
      throw new AppError(`Batch reprocessing failed: ${error}`, 500);
    }
  }

  /**
   * Get batch status and progress
   */
  async getBatchStatus(batchId: string): Promise<{
    batchId: string;
    status: string;
    progress: {
      completed: number;
      failed: number;
      processing: number;
      pending: number;
      total: number;
      percentage: number;
    };
    jobs: any[];
    startedAt?: Date;
    completedAt?: Date;
    estimatedCompletion?: Date;
  }> {
    try {
      // Get batch record
      const batch = await this.getBatchRecord(batchId);
      
      if (!batch) {
        throw new AppError('Batch not found', 404);
      }

      // Get job statuses
      const jobs = await Promise.all(
        batch.jobIds.map(jobId => this.jobQueue.getJobStatus(jobId))
      );

      // Calculate progress
      const progress = {
        completed: jobs.filter(job => job.status === 'COMPLETED').length,
        failed: jobs.filter(job => job.status === 'FAILED').length,
        processing: jobs.filter(job => job.status === 'PROCESSING').length,
        pending: jobs.filter(job => job.status === 'PENDING').length,
        total: jobs.length,
        percentage: 0
      };

      progress.percentage = progress.total > 0 
        ? Math.round(((progress.completed + progress.failed) / progress.total) * 100)
        : 0;

      // Determine overall status
      let status = 'processing';
      if (progress.pending === progress.total) {
        status = 'queued';
      } else if (progress.completed + progress.failed === progress.total) {
        status = progress.failed > 0 ? 'completed_with_errors' : 'completed';
      }

      // Estimate completion time
      let estimatedCompletion: Date | undefined;
      if (status === 'processing' && progress.completed > 0) {
        const avgTimePerJob = this.calculateAverageJobTime(jobs.filter(j => j.completedAt));
        const remainingJobs = progress.processing + progress.pending;
        estimatedCompletion = new Date(Date.now() + (avgTimePerJob * remainingJobs));
      }

      return {
        batchId,
        status,
        progress,
        jobs,
        startedAt: batch.startedAt,
        completedAt: batch.completedAt,
        estimatedCompletion
      };
    } catch (error) {
      throw new AppError(`Failed to get batch status: ${error}`, 500);
    }
  }

  /**
   * Cancel batch processing
   */
  async cancelBatch(batchId: string): Promise<void> {
    try {
      const batch = await this.getBatchRecord(batchId);
      
      if (!batch) {
        throw new AppError('Batch not found', 404);
      }

      // Cancel all jobs in batch
      await Promise.all(
        batch.jobIds.map(jobId => 
          this.jobQueue.cancelJob(jobId).catch(error => 
            console.error(`Failed to cancel job ${jobId}:`, error)
          )
        )
      );

      // Update batch status
      await this.updateBatchRecord(batchId, { 
        status: 'cancelled',
        completedAt: new Date()
      });

      this.emit('batchCancelled', { batchId });
    } catch (error) {
      throw new AppError(`Failed to cancel batch: ${error}`, 500);
    }
  }

  /**
   * Validate files before processing
   */
  private async validateFiles(filePaths: string[]): Promise<string[]> {
    const validFiles: string[] = [];
    const supportedExtensions = ['.pdf', '.docx', '.doc', '.txt', '.md', '.json', '.csv'];

    for (const filePath of filePaths) {
      try {
        // Check if file exists
        await fs.access(filePath);
        
        // Check file extension
        const ext = path.extname(filePath).toLowerCase();
        if (supportedExtensions.includes(ext)) {
          // Check file size (max 50MB)
          const stats = await fs.stat(filePath);
          if (stats.size <= 50 * 1024 * 1024) {
            validFiles.push(filePath);
          }
        }
      } catch (error) {
        console.warn(`Invalid file ${filePath}:`, error);
      }
    }

    return validFiles;
  }

  /**
   * Validate URLs before processing
   */
  private async validateUrls(urls: string[]): Promise<string[]> {
    const validUrls: string[] = [];

    for (const url of urls) {
      try {
        // Basic URL validation
        new URL(url);
        
        // Check if URL is accessible (simplified check)
        if (url.startsWith('http://') || url.startsWith('https://')) {
          validUrls.push(url);
        }
      } catch (error) {
        console.warn(`Invalid URL ${url}:`, error);
      }
    }

    return validUrls;
  }

  /**
   * Estimate processing time for files
   */
  private estimateProcessingTime(filePaths: string[]): number {
    // Base time per file: 30 seconds
    // Additional time based on file size and type
    return filePaths.length * 30000; // 30 seconds per file in milliseconds
  }

  /**
   * Estimate processing time for URLs
   */
  private estimateUrlProcessingTime(urls: string[]): number {
    // URLs typically take longer due to network requests
    return urls.length * 45000; // 45 seconds per URL in milliseconds
  }

  /**
   * Estimate reprocessing time
   */
  private estimateReprocessingTime(documents: any[]): number {
    // Reprocessing is typically faster as content is already available
    return documents.length * 20000; // 20 seconds per document in milliseconds
  }

  /**
   * Calculate average job completion time
   */
  private calculateAverageJobTime(completedJobs: any[]): number {
    if (completedJobs.length === 0) return 30000; // Default 30 seconds

    const totalTime = completedJobs.reduce((sum, job) => {
      if (job.startedAt && job.completedAt) {
        return sum + (new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime());
      }
      return sum;
    }, 0);

    return totalTime / completedJobs.length;
  }

  /**
   * Create batch record in database
   */
  private async createBatchRecord(
    tenantId: string, 
    userId: string, 
    totalFiles: number, 
    options: BatchUploadOptions
  ): Promise<string> {
    // This would create a batch record in the database
    // For now, return a generated ID
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update batch record
   */
  private async updateBatchRecord(batchId: string, updates: any): Promise<void> {
    // This would update the batch record in the database
    console.log(`Updating batch ${batchId}:`, updates);
  }

  /**
   * Get batch record
   */
  private async getBatchRecord(batchId: string): Promise<any> {
    // This would retrieve the batch record from the database
    // For now, return a mock record
    return {
      id: batchId,
      jobIds: [], // Would be populated from database
      startedAt: new Date(),
      completedAt: null,
      status: 'processing'
    };
  }

  /**
   * Handle job completion
   */
  private handleJobCompleted(event: any): void {
    this.emit('jobCompleted', event);
    
    // Check if batch is complete
    this.checkBatchCompletion(event.jobId);
  }

  /**
   * Handle job failure
   */
  private handleJobFailed(event: any): void {
    this.emit('jobFailed', event);
    
    // Check if batch is complete (even with failures)
    this.checkBatchCompletion(event.jobId);
  }

  /**
   * Handle job progress
   */
  private handleJobProgress(event: any): void {
    this.emit('jobProgress', event);
  }

  /**
   * Check if batch processing is complete
   */
  private async checkBatchCompletion(jobId: string): Promise<void> {
    try {
      // Get job to find batch ID
      const job = await this.jobQueue.getJobStatus(jobId);
      const jobData = JSON.parse(job.data || '{}');
      const batchId = jobData.metadata?.batchId;

      if (!batchId) return;

      // Check batch status
      const batchStatus = await this.getBatchStatus(batchId);
      
      if (batchStatus.status === 'completed' || batchStatus.status === 'completed_with_errors') {
        await this.updateBatchRecord(batchId, {
          status: batchStatus.status,
          completedAt: new Date()
        });

        this.emit('batchCompleted', {
          batchId,
          status: batchStatus.status,
          progress: batchStatus.progress
        });
      }
    } catch (error) {
      console.error('Error checking batch completion:', error);
    }
  }

  /**
   * Get batch processing statistics
   */
  async getBatchStats(tenantId: string, days: number = 30): Promise<{
    totalBatches: number;
    completedBatches: number;
    failedBatches: number;
    totalFilesProcessed: number;
    averageProcessingTime: number;
    successRate: number;
  }> {
    try {
      // This would query batch records from the database
      // For now, return mock statistics
      return {
        totalBatches: 0,
        completedBatches: 0,
        failedBatches: 0,
        totalFilesProcessed: 0,
        averageProcessingTime: 0,
        successRate: 0
      };
    } catch (error) {
      throw new AppError(`Failed to get batch stats: ${error}`, 500);
    }
  }
}
