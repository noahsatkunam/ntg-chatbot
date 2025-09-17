import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';

export interface JobData {
  id: string;
  type: string;
  payload: any;
  userId: string;
  tenantId: string;
  priority: number;
  delay?: number;
  attempts?: number;
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
}

export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
  completedAt: Date;
}

export interface ScheduledJob {
  id: string;
  name: string;
  schedule: string; // Cron expression
  jobType: string;
  payload: any;
  tenantId: string;
  isActive: boolean;
  lastRun?: Date;
  nextRun: Date;
}

export class JobProcessor extends EventEmitter {
  private prisma: PrismaClient;
  private redis: Redis;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private jobHandlers: Map<string, (job: Job) => Promise<any>> = new Map();

  constructor(redisUrl?: string) {
    super();
    this.prisma = new PrismaClient();
    this.redis = new Redis(redisUrl || 'redis://localhost:6379');
    this.setupQueues();
    this.setupWorkers();
  }

  // Add job to queue
  async addJob(
    queueName: string,
    jobData: JobData,
    options?: {
      delay?: number;
      priority?: number;
      attempts?: number;
      backoff?: any;
    }
  ): Promise<string> {
    try {
      const queue = this.getQueue(queueName);
      
      const job = await queue.add(jobData.type, jobData, {
        delay: options?.delay || jobData.delay,
        priority: options?.priority || jobData.priority || 0,
        attempts: options?.attempts || jobData.attempts || 3,
        backoff: options?.backoff || jobData.backoff || {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50 // Keep last 50 failed jobs
      });

      // Log job creation
      await this.logJob(jobData, 'created', job.id);

      this.emit('job:added', {
        jobId: job.id,
        queueName,
        type: jobData.type,
        tenantId: jobData.tenantId
      });

      return job.id;

    } catch (error) {
      console.error('Error adding job:', error);
      throw error;
    }
  }

  // Schedule recurring job
  async scheduleJob(scheduledJob: ScheduledJob): Promise<string> {
    try {
      // Save to database
      const job = await this.prisma.scheduledJob.create({
        data: {
          name: scheduledJob.name,
          schedule: scheduledJob.schedule,
          jobType: scheduledJob.jobType,
          payload: scheduledJob.payload,
          tenantId: scheduledJob.tenantId,
          isActive: scheduledJob.isActive,
          nextRun: scheduledJob.nextRun
        }
      });

      // Add to scheduler if active
      if (scheduledJob.isActive) {
        await this.addRecurringJob(job.id, scheduledJob);
      }

      this.emit('job:scheduled', {
        jobId: job.id,
        name: scheduledJob.name,
        tenantId: scheduledJob.tenantId
      });

      return job.id;

    } catch (error) {
      console.error('Error scheduling job:', error);
      throw error;
    }
  }

  // Register job handler
  registerJobHandler(
    jobType: string,
    handler: (job: Job) => Promise<any>
  ): void {
    this.jobHandlers.set(jobType, handler);
  }

  // Get job status
  async getJobStatus(jobId: string, queueName: string): Promise<any> {
    try {
      const queue = this.getQueue(queueName);
      const job = await queue.getJob(jobId);
      
      if (!job) {
        return { status: 'not_found' };
      }

      return {
        id: job.id,
        name: job.name,
        data: job.data,
        progress: job.progress,
        returnvalue: job.returnvalue,
        failedReason: job.failedReason,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        opts: job.opts,
        status: await job.getState()
      };

    } catch (error) {
      console.error('Error getting job status:', error);
      return { status: 'error', error: error.message };
    }
  }

  // Cancel job
  async cancelJob(jobId: string, queueName: string): Promise<boolean> {
    try {
      const queue = this.getQueue(queueName);
      const job = await queue.getJob(jobId);
      
      if (!job) {
        return false;
      }

      await job.remove();
      
      // Log cancellation
      await this.logJob(job.data, 'cancelled', jobId);

      this.emit('job:cancelled', {
        jobId,
        queueName,
        tenantId: job.data.tenantId
      });

      return true;

    } catch (error) {
      console.error('Error cancelling job:', error);
      return false;
    }
  }

  // Get queue statistics
  async getQueueStats(queueName: string): Promise<any> {
    try {
      const queue = this.getQueue(queueName);
      
      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const completed = await queue.getCompleted();
      const failed = await queue.getFailed();
      const delayed = await queue.getDelayed();

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        total: waiting.length + active.length + completed.length + failed.length + delayed.length
      };

    } catch (error) {
      console.error('Error getting queue stats:', error);
      return {};
    }
  }

  // Retry failed job
  async retryJob(jobId: string, queueName: string): Promise<boolean> {
    try {
      const queue = this.getQueue(queueName);
      const job = await queue.getJob(jobId);
      
      if (!job) {
        return false;
      }

      await job.retry();
      
      this.emit('job:retried', {
        jobId,
        queueName,
        tenantId: job.data.tenantId
      });

      return true;

    } catch (error) {
      console.error('Error retrying job:', error);
      return false;
    }
  }

  // Clean up old jobs
  async cleanupJobs(queueName: string, olderThan: number = 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const queue = this.getQueue(queueName);
      
      // Clean completed jobs older than specified time
      await queue.clean(olderThan, 100, 'completed');
      
      // Clean failed jobs older than specified time
      await queue.clean(olderThan, 50, 'failed');

      this.emit('jobs:cleaned', {
        queueName,
        olderThan
      });

    } catch (error) {
      console.error('Error cleaning up jobs:', error);
    }
  }

  // Get tenant job statistics
  async getTenantJobStats(tenantId: string, days: number = 7): Promise<any> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const stats = await this.prisma.jobLog.groupBy({
      by: ['status', 'jobType'],
      where: {
        tenantId,
        createdAt: { gte: since }
      },
      _count: {
        id: true
      }
    });

    const result: any = {
      total: 0,
      byStatus: {},
      byType: {},
      success_rate: 0
    };

    let totalJobs = 0;
    let successfulJobs = 0;

    for (const stat of stats) {
      const count = stat._count.id;
      totalJobs += count;
      
      if (stat.status === 'completed') {
        successfulJobs += count;
      }

      // Group by status
      if (!result.byStatus[stat.status]) {
        result.byStatus[stat.status] = 0;
      }
      result.byStatus[stat.status] += count;

      // Group by type
      if (!result.byType[stat.jobType]) {
        result.byType[stat.jobType] = 0;
      }
      result.byType[stat.jobType] += count;
    }

    result.total = totalJobs;
    result.success_rate = totalJobs > 0 ? (successfulJobs / totalJobs) * 100 : 0;

    return result;
  }

  // Private methods
  private setupQueues(): void {
    const queueNames = [
      'workflow-execution',
      'api-requests',
      'notifications',
      'data-processing',
      'scheduled-tasks'
    ];

    for (const queueName of queueNames) {
      const queue = new Queue(queueName, {
        connection: this.redis,
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        }
      });

      this.queues.set(queueName, queue);
    }
  }

  private setupWorkers(): void {
    for (const [queueName, queue] of this.queues) {
      const worker = new Worker(queueName, async (job: Job) => {
        const startTime = Date.now();
        
        try {
          // Get job handler
          const handler = this.jobHandlers.get(job.name);
          if (!handler) {
            throw new Error(`No handler registered for job type: ${job.name}`);
          }

          // Execute job
          const result = await handler(job);
          const duration = Date.now() - startTime;

          // Log success
          await this.logJob(job.data, 'completed', job.id, {
            success: true,
            data: result,
            duration,
            completedAt: new Date()
          });

          this.emit('job:completed', {
            jobId: job.id,
            queueName,
            type: job.name,
            tenantId: job.data.tenantId,
            duration,
            result
          });

          return result;

        } catch (error) {
          const duration = Date.now() - startTime;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          // Log failure
          await this.logJob(job.data, 'failed', job.id, {
            success: false,
            error: errorMessage,
            duration,
            completedAt: new Date()
          });

          this.emit('job:failed', {
            jobId: job.id,
            queueName,
            type: job.name,
            tenantId: job.data.tenantId,
            duration,
            error: errorMessage
          });

          throw error;
        }
      }, {
        connection: this.redis,
        concurrency: 5 // Process up to 5 jobs concurrently per worker
      });

      // Worker event handlers
      worker.on('progress', (job, progress) => {
        this.emit('job:progress', {
          jobId: job.id,
          queueName,
          progress
        });
      });

      worker.on('stalled', (jobId) => {
        this.emit('job:stalled', {
          jobId,
          queueName
        });
      });

      this.workers.set(queueName, worker);
    }
  }

  private getQueue(queueName: string): Queue {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }
    return queue;
  }

  private async addRecurringJob(jobId: string, scheduledJob: ScheduledJob): Promise<void> {
    const queue = this.getQueue('scheduled-tasks');
    
    await queue.add(
      scheduledJob.jobType,
      {
        id: jobId,
        type: scheduledJob.jobType,
        payload: scheduledJob.payload,
        tenantId: scheduledJob.tenantId,
        scheduledJobId: jobId
      },
      {
        repeat: {
          cron: scheduledJob.schedule
        },
        jobId: `scheduled-${jobId}` // Unique ID for recurring job
      }
    );
  }

  private async logJob(
    jobData: JobData,
    status: string,
    jobId?: string,
    result?: JobResult
  ): Promise<void> {
    try {
      await this.prisma.jobLog.create({
        data: {
          jobId: jobId || jobData.id,
          jobType: jobData.type,
          status,
          tenantId: jobData.tenantId,
          userId: jobData.userId,
          payload: jobData.payload,
          result: result ? {
            success: result.success,
            data: result.data,
            error: result.error,
            duration: result.duration,
            completedAt: result.completedAt
          } : null,
          createdAt: new Date()
        }
      });
    } catch (error) {
      console.error('Error logging job:', error);
    }
  }

  // Cleanup resources
  async shutdown(): Promise<void> {
    // Close all workers
    for (const worker of this.workers.values()) {
      await worker.close();
    }

    // Close all queues
    for (const queue of this.queues.values()) {
      await queue.close();
    }

    // Close Redis connection
    await this.redis.quit();
  }
}
