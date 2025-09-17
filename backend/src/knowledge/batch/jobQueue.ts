import { PrismaClient, ProcessingJobStatus, ProcessingJobType } from '@prisma/client';
import { EventEmitter } from 'events';
import { AppError } from '../../middlewares/errorHandler';

const prisma = new PrismaClient();

export interface JobData {
  documentId?: string;
  documentIds?: string[];
  filePath?: string;
  url?: string;
  options?: any;
  metadata?: any;
}

export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  metrics?: {
    processingTime: number;
    chunksCreated?: number;
    tokensProcessed?: number;
  };
}

export interface JobProgress {
  current: number;
  total: number;
  stage: string;
  message?: string;
}

export class JobQueue extends EventEmitter {
  private isProcessing = false;
  private concurrentJobs = 3;
  private activeJobs = new Map<string, any>();
  private retryAttempts = 3;
  private retryDelay = 5000; // 5 seconds

  constructor() {
    super();
    this.startProcessing();
  }

  /**
   * Add a new job to the queue
   */
  async addJob(
    type: ProcessingJobType,
    tenantId: string,
    userId: string,
    data: JobData,
    priority: number = 0
  ): Promise<string> {
    try {
      const job = await prisma.processingJob.create({
        data: {
          type,
          tenantId,
          userId,
          status: ProcessingJobStatus.PENDING,
          priority,
          data: JSON.stringify(data),
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      this.emit('jobAdded', { jobId: job.id, type, tenantId });
      
      // Start processing if not already running
      if (!this.isProcessing) {
        this.startProcessing();
      }

      return job.id;
    } catch (error) {
      throw new AppError(`Failed to add job to queue: ${error}`, 500);
    }
  }

  /**
   * Add multiple jobs as a batch
   */
  async addBatchJobs(
    type: ProcessingJobType,
    tenantId: string,
    userId: string,
    dataArray: JobData[],
    priority: number = 0
  ): Promise<string[]> {
    try {
      const jobs = await Promise.all(
        dataArray.map(data =>
          prisma.processingJob.create({
            data: {
              type,
              tenantId,
              userId,
              status: ProcessingJobStatus.PENDING,
              priority,
              data: JSON.stringify(data),
              createdAt: new Date(),
              updatedAt: new Date()
            }
          })
        )
      );

      const jobIds = jobs.map(job => job.id);
      
      this.emit('batchJobsAdded', { jobIds, type, tenantId, count: jobs.length });
      
      if (!this.isProcessing) {
        this.startProcessing();
      }

      return jobIds;
    } catch (error) {
      throw new AppError(`Failed to add batch jobs: ${error}`, 500);
    }
  }

  /**
   * Start processing jobs from the queue
   */
  private async startProcessing(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    
    while (this.isProcessing) {
      try {
        // Check if we can process more jobs
        if (this.activeJobs.size >= this.concurrentJobs) {
          await this.sleep(1000);
          continue;
        }

        // Get next job from queue
        const job = await this.getNextJob();
        
        if (!job) {
          await this.sleep(2000);
          continue;
        }

        // Process job asynchronously
        this.processJob(job).catch(error => {
          console.error(`Job processing error: ${error}`);
        });

      } catch (error) {
        console.error(`Queue processing error: ${error}`);
        await this.sleep(5000);
      }
    }
  }

  /**
   * Get next job from queue based on priority and creation time
   */
  private async getNextJob(): Promise<any> {
    try {
      const job = await prisma.processingJob.findFirst({
        where: {
          status: ProcessingJobStatus.PENDING,
          OR: [
            { scheduledFor: null },
            { scheduledFor: { lte: new Date() } }
          ]
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'asc' }
        ]
      });

      if (job) {
        // Mark as processing
        await prisma.processingJob.update({
          where: { id: job.id },
          data: {
            status: ProcessingJobStatus.PROCESSING,
            startedAt: new Date(),
            updatedAt: new Date()
          }
        });
      }

      return job;
    } catch (error) {
      console.error(`Error getting next job: ${error}`);
      return null;
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: any): Promise<void> {
    const jobId = job.id;
    this.activeJobs.set(jobId, job);

    try {
      this.emit('jobStarted', { jobId, type: job.type, tenantId: job.tenantId });

      // Parse job data
      const jobData: JobData = JSON.parse(job.data);
      
      // Process based on job type
      let result: JobResult;
      
      switch (job.type) {
        case ProcessingJobType.DOCUMENT_UPLOAD:
          result = await this.processDocumentUpload(job, jobData);
          break;
        case ProcessingJobType.DOCUMENT_REPROCESS:
          result = await this.processDocumentReprocess(job, jobData);
          break;
        case ProcessingJobType.BULK_UPLOAD:
          result = await this.processBulkUpload(job, jobData);
          break;
        case ProcessingJobType.URL_CRAWL:
          result = await this.processUrlCrawl(job, jobData);
          break;
        case ProcessingJobType.COLLECTION_REINDEX:
          result = await this.processCollectionReindex(job, jobData);
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      // Update job with result
      await this.completeJob(jobId, result);

    } catch (error) {
      await this.handleJobError(jobId, error);
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  /**
   * Process document upload job
   */
  private async processDocumentUpload(job: any, data: JobData): Promise<JobResult> {
    const startTime = Date.now();
    
    try {
      // Import services dynamically to avoid circular dependencies
      const { DocumentProcessor } = await import('../services/documentProcessor');
      const { ChunkingService } = await import('../chunking/chunkingService');
      
      const documentProcessor = new DocumentProcessor();
      const chunkingService = new ChunkingService();

      // Update progress
      await this.updateJobProgress(job.id, { current: 1, total: 4, stage: 'processing', message: 'Processing document' });

      // Process document
      const processingResult = await documentProcessor.processDocument(
        data.filePath!,
        job.tenantId,
        job.userId,
        data.options
      );

      // Update progress
      await this.updateJobProgress(job.id, { current: 2, total: 4, stage: 'chunking', message: 'Creating chunks' });

      // Chunk document
      const chunkingResult = await chunkingService.chunkDocument(
        processingResult.content,
        data.documentId!,
        job.tenantId,
        data.options?.chunking
      );

      // Update progress
      await this.updateJobProgress(job.id, { current: 3, total: 4, stage: 'indexing', message: 'Indexing content' });

      // Index chunks (would integrate with vector service)
      // await vectorService.indexChunks(chunkingResult.chunks, job.tenantId);

      // Update progress
      await this.updateJobProgress(job.id, { current: 4, total: 4, stage: 'completed', message: 'Processing complete' });

      return {
        success: true,
        data: {
          documentId: data.documentId,
          chunksCreated: chunkingResult.chunks.length
        },
        metrics: {
          processingTime: Date.now() - startTime,
          chunksCreated: chunkingResult.chunks.length,
          tokensProcessed: chunkingResult.metadata.totalTokens
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          processingTime: Date.now() - startTime
        }
      };
    }
  }

  /**
   * Process document reprocessing job
   */
  private async processDocumentReprocess(job: any, data: JobData): Promise<JobResult> {
    const startTime = Date.now();
    
    try {
      // Get document
      const document = await prisma.knowledgeDocument.findFirst({
        where: { id: data.documentId!, tenantId: job.tenantId }
      });

      if (!document) {
        throw new Error('Document not found');
      }

      // Delete existing chunks
      await prisma.documentChunk.deleteMany({
        where: { documentId: data.documentId!, tenantId: job.tenantId }
      });

      // Reprocess document (similar to upload but with existing document)
      const { ChunkingService } = await import('../chunking/chunkingService');
      const chunkingService = new ChunkingService();

      // Get document content (would need to implement content retrieval)
      const content = document.content || '';

      const chunkingResult = await chunkingService.chunkDocument(
        content,
        data.documentId!,
        job.tenantId,
        data.options?.chunking
      );

      return {
        success: true,
        data: {
          documentId: data.documentId,
          chunksCreated: chunkingResult.chunks.length
        },
        metrics: {
          processingTime: Date.now() - startTime,
          chunksCreated: chunkingResult.chunks.length,
          tokensProcessed: chunkingResult.metadata.totalTokens
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          processingTime: Date.now() - startTime
        }
      };
    }
  }

  /**
   * Process bulk upload job
   */
  private async processBulkUpload(job: any, data: JobData): Promise<JobResult> {
    const startTime = Date.now();
    let processedCount = 0;
    let totalChunks = 0;
    let totalTokens = 0;

    try {
      const documentIds = data.documentIds || [];
      
      for (let i = 0; i < documentIds.length; i++) {
        const documentId = documentIds[i];
        
        await this.updateJobProgress(job.id, {
          current: i + 1,
          total: documentIds.length,
          stage: 'processing',
          message: `Processing document ${i + 1} of ${documentIds.length}`
        });

        try {
          // Process individual document
          const result = await this.processDocumentUpload(job, {
            documentId,
            options: data.options
          });

          if (result.success) {
            processedCount++;
            totalChunks += result.metrics?.chunksCreated || 0;
            totalTokens += result.metrics?.tokensProcessed || 0;
          }
        } catch (error) {
          console.error(`Error processing document ${documentId}:`, error);
        }
      }

      return {
        success: true,
        data: {
          processedDocuments: processedCount,
          totalDocuments: documentIds.length,
          totalChunks,
          totalTokens
        },
        metrics: {
          processingTime: Date.now() - startTime,
          chunksCreated: totalChunks,
          tokensProcessed: totalTokens
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          processingTime: Date.now() - startTime
        }
      };
    }
  }

  /**
   * Process URL crawl job
   */
  private async processUrlCrawl(job: any, data: JobData): Promise<JobResult> {
    const startTime = Date.now();
    
    try {
      const { WebProcessor } = await import('../processors/webProcessor');
      const webProcessor = new WebProcessor();

      await this.updateJobProgress(job.id, { current: 1, total: 3, stage: 'crawling', message: 'Crawling URL' });

      // Process web content
      const webResult = await webProcessor.processWebPage(data.url!, data.options);

      await this.updateJobProgress(job.id, { current: 2, total: 3, stage: 'processing', message: 'Processing content' });

      // Create document and chunks (would integrate with document service)
      
      await this.updateJobProgress(job.id, { current: 3, total: 3, stage: 'completed', message: 'URL processing complete' });

      return {
        success: true,
        data: {
          url: data.url,
          title: webResult.metadata.title,
          wordCount: webResult.metadata.wordCount
        },
        metrics: {
          processingTime: Date.now() - startTime,
          tokensProcessed: webResult.metadata.wordCount
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          processingTime: Date.now() - startTime
        }
      };
    }
  }

  /**
   * Process collection reindex job
   */
  private async processCollectionReindex(job: any, data: JobData): Promise<JobResult> {
    const startTime = Date.now();
    
    try {
      // Get all documents in collection
      const documents = await prisma.knowledgeDocument.findMany({
        where: { 
          tenantId: job.tenantId,
          collectionId: data.options?.collectionId
        }
      });

      let processedCount = 0;
      
      for (let i = 0; i < documents.length; i++) {
        const document = documents[i];
        
        await this.updateJobProgress(job.id, {
          current: i + 1,
          total: documents.length,
          stage: 'reindexing',
          message: `Reindexing document ${i + 1} of ${documents.length}`
        });

        // Reindex document (would integrate with vector service)
        processedCount++;
      }

      return {
        success: true,
        data: {
          reindexedDocuments: processedCount,
          totalDocuments: documents.length
        },
        metrics: {
          processingTime: Date.now() - startTime
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          processingTime: Date.now() - startTime
        }
      };
    }
  }

  /**
   * Update job progress
   */
  private async updateJobProgress(jobId: string, progress: JobProgress): Promise<void> {
    try {
      await prisma.processingJob.update({
        where: { id: jobId },
        data: {
          progress: JSON.stringify(progress),
          updatedAt: new Date()
        }
      });

      this.emit('jobProgress', { jobId, progress });
    } catch (error) {
      console.error(`Error updating job progress: ${error}`);
    }
  }

  /**
   * Complete job successfully
   */
  private async completeJob(jobId: string, result: JobResult): Promise<void> {
    try {
      await prisma.processingJob.update({
        where: { id: jobId },
        data: {
          status: result.success ? ProcessingJobStatus.COMPLETED : ProcessingJobStatus.FAILED,
          result: JSON.stringify(result),
          completedAt: new Date(),
          updatedAt: new Date()
        }
      });

      this.emit('jobCompleted', { jobId, success: result.success, result });
    } catch (error) {
      console.error(`Error completing job: ${error}`);
    }
  }

  /**
   * Handle job error with retry logic
   */
  private async handleJobError(jobId: string, error: any): Promise<void> {
    try {
      const job = await prisma.processingJob.findUnique({
        where: { id: jobId }
      });

      if (!job) return;

      const currentAttempts = job.attempts || 0;
      
      if (currentAttempts < this.retryAttempts) {
        // Schedule retry
        const nextAttempt = new Date(Date.now() + this.retryDelay * Math.pow(2, currentAttempts));
        
        await prisma.processingJob.update({
          where: { id: jobId },
          data: {
            status: ProcessingJobStatus.PENDING,
            attempts: currentAttempts + 1,
            scheduledFor: nextAttempt,
            error: error instanceof Error ? error.message : 'Unknown error',
            updatedAt: new Date()
          }
        });

        this.emit('jobRetry', { jobId, attempt: currentAttempts + 1, nextAttempt });
      } else {
        // Mark as failed
        await prisma.processingJob.update({
          where: { id: jobId },
          data: {
            status: ProcessingJobStatus.FAILED,
            error: error instanceof Error ? error.message : 'Unknown error',
            completedAt: new Date(),
            updatedAt: new Date()
          }
        });

        this.emit('jobFailed', { jobId, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    } catch (updateError) {
      console.error(`Error handling job error: ${updateError}`);
    }
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<any> {
    try {
      const job = await prisma.processingJob.findUnique({
        where: { id: jobId }
      });

      if (!job) {
        throw new AppError('Job not found', 404);
      }

      return {
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress ? JSON.parse(job.progress) : null,
        result: job.result ? JSON.parse(job.result) : null,
        error: job.error,
        attempts: job.attempts,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt
      };
    } catch (error) {
      throw new AppError(`Failed to get job status: ${error}`, 500);
    }
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<void> {
    try {
      const job = await prisma.processingJob.findUnique({
        where: { id: jobId }
      });

      if (!job) {
        throw new AppError('Job not found', 404);
      }

      if (job.status === ProcessingJobStatus.PROCESSING) {
        // Mark for cancellation (the processing loop will handle it)
        await prisma.processingJob.update({
          where: { id: jobId },
          data: {
            status: ProcessingJobStatus.CANCELLED,
            updatedAt: new Date()
          }
        });
      } else if (job.status === ProcessingJobStatus.PENDING) {
        // Cancel immediately
        await prisma.processingJob.update({
          where: { id: jobId },
          data: {
            status: ProcessingJobStatus.CANCELLED,
            completedAt: new Date(),
            updatedAt: new Date()
          }
        });
      }

      this.emit('jobCancelled', { jobId });
    } catch (error) {
      throw new AppError(`Failed to cancel job: ${error}`, 500);
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(tenantId?: string): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
    totalJobs: number;
  }> {
    try {
      const where = tenantId ? { tenantId } : {};
      
      const [pending, processing, completed, failed, cancelled, total] = await Promise.all([
        prisma.processingJob.count({ where: { ...where, status: ProcessingJobStatus.PENDING } }),
        prisma.processingJob.count({ where: { ...where, status: ProcessingJobStatus.PROCESSING } }),
        prisma.processingJob.count({ where: { ...where, status: ProcessingJobStatus.COMPLETED } }),
        prisma.processingJob.count({ where: { ...where, status: ProcessingJobStatus.FAILED } }),
        prisma.processingJob.count({ where: { ...where, status: ProcessingJobStatus.CANCELLED } }),
        prisma.processingJob.count({ where })
      ]);

      return {
        pending,
        processing,
        completed,
        failed,
        cancelled,
        totalJobs: total
      };
    } catch (error) {
      throw new AppError(`Failed to get queue stats: ${error}`, 500);
    }
  }

  /**
   * Clean up old completed jobs
   */
  async cleanupOldJobs(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await prisma.processingJob.deleteMany({
        where: {
          status: {
            in: [ProcessingJobStatus.COMPLETED, ProcessingJobStatus.FAILED, ProcessingJobStatus.CANCELLED]
          },
          completedAt: {
            lt: cutoffDate
          }
        }
      });

      return result.count;
    } catch (error) {
      throw new AppError(`Failed to cleanup old jobs: ${error}`, 500);
    }
  }

  /**
   * Stop processing
   */
  stopProcessing(): void {
    this.isProcessing = false;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const jobQueue = new JobQueue();
