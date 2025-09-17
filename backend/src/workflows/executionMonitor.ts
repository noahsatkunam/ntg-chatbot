import { PrismaClient } from '@prisma/client';
import { N8nClient, N8nExecution } from './n8nClient';
import { EventEmitter } from 'events';

export interface ExecutionFilters {
  status?: string;
  startTime?: { gte?: Date; lte?: Date };
  triggeredBy?: string;
  limit?: number;
  offset?: number;
}

export class ExecutionMonitor extends EventEmitter {
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private readonly POLLING_INTERVAL = 5000; // 5 seconds

  constructor(
    private prisma: PrismaClient,
    private n8nClient: N8nClient
  ) {
    super();
  }

  async startMonitoring(executionId: string, n8nExecutionId: string): Promise<void> {
    // Clear existing monitoring for this execution
    this.stopMonitoring(executionId);

    const interval = setInterval(async () => {
      try {
        await this.checkExecutionStatus(executionId, n8nExecutionId);
      } catch (error) {
        console.error(`Error monitoring execution ${executionId}:`, error);
        this.stopMonitoring(executionId);
      }
    }, this.POLLING_INTERVAL);

    this.monitoringIntervals.set(executionId, interval);
  }

  stopMonitoring(executionId: string): void {
    const interval = this.monitoringIntervals.get(executionId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(executionId);
    }
  }

  private async checkExecutionStatus(executionId: string, n8nExecutionId: string): Promise<void> {
    try {
      // Get current execution from database
      const dbExecution = await this.prisma.workflowExecution.findUnique({
        where: { id: executionId }
      });

      if (!dbExecution) {
        this.stopMonitoring(executionId);
        return;
      }

      // Skip if already completed
      if (['success', 'error', 'cancelled'].includes(dbExecution.status)) {
        this.stopMonitoring(executionId);
        return;
      }

      // Get execution status from n8n
      const n8nExecution = await this.n8nClient.getExecution(n8nExecutionId);
      
      // Update database if status changed
      if (n8nExecution.status !== dbExecution.status) {
        const updateData: any = {
          status: n8nExecution.status,
          updatedAt: new Date()
        };

        if (n8nExecution.stoppedAt && !dbExecution.endTime) {
          updateData.endTime = n8nExecution.stoppedAt;
          updateData.duration = new Date(n8nExecution.stoppedAt).getTime() - 
                               new Date(dbExecution.startTime).getTime();
        }

        if (n8nExecution.data) {
          updateData.resultData = n8nExecution.data;
        }

        const updatedExecution = await this.prisma.workflowExecution.update({
          where: { id: executionId },
          data: updateData
        });

        // Emit events based on status
        switch (n8nExecution.status) {
          case 'success':
            this.emit('execution:completed', updatedExecution);
            this.stopMonitoring(executionId);
            break;
          case 'error':
            this.emit('execution:failed', updatedExecution);
            this.stopMonitoring(executionId);
            break;
          case 'canceled':
            this.emit('execution:cancelled', updatedExecution);
            this.stopMonitoring(executionId);
            break;
          case 'running':
            this.emit('execution:progress', updatedExecution);
            break;
        }

        // Update analytics
        await this.updateAnalytics(updatedExecution);
      }

    } catch (error) {
      console.error(`Failed to check execution status for ${executionId}:`, error);
      
      // Mark execution as error if n8n is unreachable
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: 'error',
          errorMessage: `Monitoring failed: ${error}`,
          endTime: new Date()
        }
      });

      this.stopMonitoring(executionId);
    }
  }

  async getExecution(executionId: string, tenantId: string): Promise<any> {
    const execution = await this.prisma.workflowExecution.findFirst({
      where: {
        id: executionId,
        tenantId
      },
      include: {
        workflow: {
          select: {
            id: true,
            name: true,
            category: true
          }
        }
      }
    });

    if (!execution) {
      throw new Error('Execution not found');
    }

    return execution;
  }

  async listExecutions(
    tenantId: string,
    workflowId?: string,
    filters: ExecutionFilters = {}
  ): Promise<any[]> {
    const {
      status,
      startTime,
      triggeredBy,
      limit = 20,
      offset = 0
    } = filters;

    const whereClause: any = { tenantId };

    if (workflowId) {
      whereClause.workflowId = workflowId;
    }

    if (status) {
      whereClause.status = status;
    }

    if (startTime) {
      whereClause.startTime = startTime;
    }

    if (triggeredBy) {
      whereClause.triggeredBy = triggeredBy;
    }

    const executions = await this.prisma.workflowExecution.findMany({
      where: whereClause,
      include: {
        workflow: {
          select: {
            id: true,
            name: true,
            category: true
          }
        }
      },
      orderBy: { startTime: 'desc' },
      take: limit,
      skip: offset
    });

    return executions;
  }

  async cancelExecution(executionId: string, tenantId: string): Promise<void> {
    const execution = await this.prisma.workflowExecution.findFirst({
      where: {
        id: executionId,
        tenantId
      }
    });

    if (!execution) {
      throw new Error('Execution not found');
    }

    if (!['running', 'waiting'].includes(execution.status)) {
      throw new Error('Execution cannot be cancelled');
    }

    // Cancel in n8n if execution ID exists
    if (execution.n8nExecutionId) {
      try {
        await this.n8nClient.stopExecution(execution.n8nExecutionId);
      } catch (error) {
        console.error('Failed to cancel execution in n8n:', error);
      }
    }

    // Update status in database
    await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: 'cancelled',
        endTime: new Date(),
        errorMessage: 'Execution cancelled by user'
      }
    });

    // Stop monitoring
    this.stopMonitoring(executionId);

    this.emit('execution:cancelled', { executionId, tenantId });
  }

  async retryExecution(executionId: string, tenantId: string): Promise<string> {
    const originalExecution = await this.prisma.workflowExecution.findFirst({
      where: {
        id: executionId,
        tenantId
      },
      include: {
        workflow: true
      }
    });

    if (!originalExecution) {
      throw new Error('Execution not found');
    }

    if (originalExecution.status !== 'error') {
      throw new Error('Only failed executions can be retried');
    }

    // Create new execution record
    const newExecution = await this.prisma.workflowExecution.create({
      data: {
        workflowId: originalExecution.workflowId,
        tenantId,
        triggerData: originalExecution.triggerData,
        triggeredBy: originalExecution.triggeredBy,
        metadata: {
          ...originalExecution.metadata,
          retryOf: executionId
        },
        status: 'running'
      }
    });

    // Execute in n8n if workflow is deployed
    if (originalExecution.workflow.n8nId) {
      try {
        const n8nExecution = await this.n8nClient.executeWorkflow(
          originalExecution.workflow.n8nId,
          originalExecution.triggerData
        );

        // Update with n8n execution ID
        await this.prisma.workflowExecution.update({
          where: { id: newExecution.id },
          data: { n8nExecutionId: n8nExecution.id }
        });

        // Start monitoring
        this.startMonitoring(newExecution.id, n8nExecution.id);

      } catch (error) {
        // Mark as failed if n8n execution fails
        await this.prisma.workflowExecution.update({
          where: { id: newExecution.id },
          data: {
            status: 'error',
            errorMessage: `Retry failed: ${error}`,
            endTime: new Date()
          }
        });

        throw new Error(`Failed to retry execution: ${error}`);
      }
    }

    return newExecution.id;
  }

  async getExecutionLogs(executionId: string, tenantId: string): Promise<any> {
    const execution = await this.prisma.workflowExecution.findFirst({
      where: {
        id: executionId,
        tenantId
      }
    });

    if (!execution) {
      throw new Error('Execution not found');
    }

    // Get logs from n8n if available
    let n8nLogs = null;
    if (execution.n8nExecutionId) {
      try {
        const n8nExecution = await this.n8nClient.getExecution(execution.n8nExecutionId);
        n8nLogs = n8nExecution.data;
      } catch (error) {
        console.error('Failed to get n8n logs:', error);
      }
    }

    return {
      executionId,
      status: execution.status,
      startTime: execution.startTime,
      endTime: execution.endTime,
      duration: execution.duration,
      errorMessage: execution.errorMessage,
      logs: execution.logs,
      n8nLogs,
      triggerData: execution.triggerData,
      resultData: execution.resultData
    };
  }

  async getExecutionStats(
    tenantId: string,
    timeRange?: { start: Date; end: Date }
  ): Promise<any> {
    const whereClause: any = { tenantId };
    
    if (timeRange) {
      whereClause.startTime = {
        gte: timeRange.start,
        lte: timeRange.end
      };
    }

    const [statusStats, durationStats, totalCount] = await Promise.all([
      this.prisma.workflowExecution.groupBy({
        by: ['status'],
        where: whereClause,
        _count: { id: true }
      }),
      this.prisma.workflowExecution.aggregate({
        where: {
          ...whereClause,
          duration: { not: null }
        },
        _avg: { duration: true },
        _min: { duration: true },
        _max: { duration: true }
      }),
      this.prisma.workflowExecution.count({
        where: whereClause
      })
    ]);

    const statusCounts = statusStats.reduce((acc, stat) => {
      acc[stat.status] = stat._count.id;
      return acc;
    }, {} as any);

    return {
      totalExecutions: totalCount,
      statusBreakdown: statusCounts,
      successRate: totalCount > 0 ? (statusCounts.success || 0) / totalCount : 0,
      averageDuration: durationStats._avg.duration,
      minDuration: durationStats._min.duration,
      maxDuration: durationStats._max.duration
    };
  }

  private async updateAnalytics(execution: any): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Update or create daily analytics
      await this.prisma.workflowAnalytics.upsert({
        where: {
          tenantId_date: {
            tenantId: execution.tenantId,
            date: today
          }
        },
        update: {
          totalExecutions: { increment: 1 },
          successfulExecutions: execution.status === 'success' ? { increment: 1 } : undefined,
          failedExecutions: execution.status === 'error' ? { increment: 1 } : undefined,
          totalDuration: execution.duration ? { increment: execution.duration } : undefined,
          updatedAt: new Date()
        },
        create: {
          tenantId: execution.tenantId,
          date: today,
          totalExecutions: 1,
          successfulExecutions: execution.status === 'success' ? 1 : 0,
          failedExecutions: execution.status === 'error' ? 1 : 0,
          totalDuration: execution.duration || 0,
          uniqueWorkflows: 1
        }
      });

      // Update average duration
      const analytics = await this.prisma.workflowAnalytics.findUnique({
        where: {
          tenantId_date: {
            tenantId: execution.tenantId,
            date: today
          }
        }
      });

      if (analytics && analytics.totalExecutions > 0) {
        await this.prisma.workflowAnalytics.update({
          where: {
            tenantId_date: {
              tenantId: execution.tenantId,
              date: today
            }
          },
          data: {
            averageDuration: analytics.totalDuration / analytics.totalExecutions
          }
        });
      }

    } catch (error) {
      console.error('Failed to update analytics:', error);
    }
  }

  // Cleanup method to stop all monitoring when service shuts down
  cleanup(): void {
    for (const [executionId, interval] of this.monitoringIntervals) {
      clearInterval(interval);
    }
    this.monitoringIntervals.clear();
  }
}
