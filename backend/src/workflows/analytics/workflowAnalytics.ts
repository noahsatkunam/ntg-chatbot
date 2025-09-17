import { PrismaClient } from '@prisma/client';

export interface AnalyticsTimeRange {
  start: Date;
  end: Date;
}

export interface WorkflowMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  cancelledExecutions: number;
  successRate: number;
  averageDuration: number;
  totalDuration: number;
  uniqueWorkflows: number;
  chatTriggeredExecutions: number;
  webhookTriggeredExecutions: number;
  manualExecutions: number;
}

export interface ExecutionTrend {
  date: string;
  executions: number;
  successRate: number;
  averageDuration: number;
}

export interface WorkflowPerformance {
  workflowId: string;
  workflowName: string;
  totalExecutions: number;
  successRate: number;
  averageDuration: number;
  lastExecuted: Date;
  errorRate: number;
  popularityScore: number;
}

export interface TriggerAnalytics {
  triggerType: string;
  totalTriggers: number;
  activeTriggers: number;
  executionsTriggered: number;
  successRate: number;
  averageResponseTime: number;
}

export class WorkflowAnalyticsService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  // Get comprehensive workflow metrics for tenant
  async getWorkflowMetrics(
    tenantId: string,
    timeRange?: AnalyticsTimeRange
  ): Promise<WorkflowMetrics> {
    const whereClause: any = { tenantId };
    
    if (timeRange) {
      whereClause.startTime = {
        gte: timeRange.start,
        lte: timeRange.end
      };
    }

    const [executions, aggregates] = await Promise.all([
      this.prisma.workflowExecution.findMany({
        where: whereClause,
        select: {
          status: true,
          duration: true,
          workflowId: true,
          metadata: true
        }
      }),
      this.prisma.workflowExecution.aggregate({
        where: whereClause,
        _count: { id: true },
        _avg: { duration: true },
        _sum: { duration: true }
      })
    ]);

    const totalExecutions = aggregates._count.id;
    const successfulExecutions = executions.filter(e => e.status === 'success').length;
    const failedExecutions = executions.filter(e => e.status === 'error').length;
    const cancelledExecutions = executions.filter(e => e.status === 'cancelled').length;
    
    const uniqueWorkflows = new Set(executions.map(e => e.workflowId)).size;
    
    const chatTriggeredExecutions = executions.filter(e => 
      e.metadata?.triggerType === 'chat_message'
    ).length;
    
    const webhookTriggeredExecutions = executions.filter(e => 
      e.metadata?.triggerType === 'webhook'
    ).length;
    
    const manualExecutions = executions.filter(e => 
      e.metadata?.triggerType === 'manual'
    ).length;

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      cancelledExecutions,
      successRate: totalExecutions > 0 ? successfulExecutions / totalExecutions : 0,
      averageDuration: aggregates._avg.duration || 0,
      totalDuration: aggregates._sum.duration || 0,
      uniqueWorkflows,
      chatTriggeredExecutions,
      webhookTriggeredExecutions,
      manualExecutions
    };
  }

  // Get execution trends over time
  async getExecutionTrends(
    tenantId: string,
    timeRange: AnalyticsTimeRange,
    granularity: 'hour' | 'day' | 'week' = 'day'
  ): Promise<ExecutionTrend[]> {
    const trends: ExecutionTrend[] = [];
    const current = new Date(timeRange.start);
    
    while (current <= timeRange.end) {
      const periodStart = new Date(current);
      const periodEnd = new Date(current);
      
      switch (granularity) {
        case 'hour':
          periodEnd.setHours(periodEnd.getHours() + 1);
          break;
        case 'day':
          periodEnd.setDate(periodEnd.getDate() + 1);
          break;
        case 'week':
          periodEnd.setDate(periodEnd.getDate() + 7);
          break;
      }

      const executions = await this.prisma.workflowExecution.findMany({
        where: {
          tenantId,
          startTime: {
            gte: periodStart,
            lt: periodEnd
          }
        },
        select: {
          status: true,
          duration: true
        }
      });

      const totalExecutions = executions.length;
      const successfulExecutions = executions.filter(e => e.status === 'success').length;
      const averageDuration = executions.reduce((sum, e) => sum + (e.duration || 0), 0) / totalExecutions || 0;

      trends.push({
        date: periodStart.toISOString().split('T')[0],
        executions: totalExecutions,
        successRate: totalExecutions > 0 ? successfulExecutions / totalExecutions : 0,
        averageDuration
      });

      current.setTime(periodEnd.getTime());
    }

    return trends;
  }

  // Get workflow performance analytics
  async getWorkflowPerformance(
    tenantId: string,
    timeRange?: AnalyticsTimeRange,
    limit: number = 20
  ): Promise<WorkflowPerformance[]> {
    const whereClause: any = { tenantId };
    
    if (timeRange) {
      whereClause.startTime = {
        gte: timeRange.start,
        lte: timeRange.end
      };
    }

    const workflowStats = await this.prisma.workflowExecution.groupBy({
      by: ['workflowId'],
      where: whereClause,
      _count: { id: true },
      _avg: { duration: true },
      _max: { startTime: true }
    });

    const workflowPerformance: WorkflowPerformance[] = [];

    for (const stat of workflowStats) {
      const workflow = await this.prisma.workflow.findUnique({
        where: { id: stat.workflowId },
        select: { name: true }
      });

      if (!workflow) continue;

      const executions = await this.prisma.workflowExecution.findMany({
        where: {
          workflowId: stat.workflowId,
          tenantId,
          ...(timeRange ? {
            startTime: {
              gte: timeRange.start,
              lte: timeRange.end
            }
          } : {})
        },
        select: { status: true }
      });

      const totalExecutions = executions.length;
      const successfulExecutions = executions.filter(e => e.status === 'success').length;
      const errorExecutions = executions.filter(e => e.status === 'error').length;

      // Calculate popularity score based on recent usage and success rate
      const recentExecutions = await this.prisma.workflowExecution.count({
        where: {
          workflowId: stat.workflowId,
          tenantId,
          startTime: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
          }
        }
      });

      const successRate = totalExecutions > 0 ? successfulExecutions / totalExecutions : 0;
      const popularityScore = (recentExecutions * 0.7) + (successRate * 30);

      workflowPerformance.push({
        workflowId: stat.workflowId,
        workflowName: workflow.name,
        totalExecutions,
        successRate,
        averageDuration: stat._avg.duration || 0,
        lastExecuted: stat._max.startTime || new Date(),
        errorRate: totalExecutions > 0 ? errorExecutions / totalExecutions : 0,
        popularityScore
      });
    }

    return workflowPerformance
      .sort((a, b) => b.popularityScore - a.popularityScore)
      .slice(0, limit);
  }

  // Get trigger analytics
  async getTriggerAnalytics(tenantId: string): Promise<TriggerAnalytics[]> {
    const triggers = await this.prisma.workflowTrigger.groupBy({
      by: ['triggerType'],
      where: { tenantId },
      _count: { id: true }
    });

    const analytics: TriggerAnalytics[] = [];

    for (const trigger of triggers) {
      const [activeTriggers, executions] = await Promise.all([
        this.prisma.workflowTrigger.count({
          where: {
            tenantId,
            triggerType: trigger.triggerType,
            isActive: true
          }
        }),
        this.prisma.workflowExecution.findMany({
          where: {
            tenantId,
            metadata: {
              path: ['triggerType'],
              equals: trigger.triggerType
            }
          },
          select: {
            status: true,
            startTime: true,
            endTime: true
          }
        })
      ]);

      const totalExecutions = executions.length;
      const successfulExecutions = executions.filter(e => e.status === 'success').length;
      const averageResponseTime = executions
        .filter(e => e.endTime)
        .reduce((sum, e) => sum + (e.endTime!.getTime() - e.startTime.getTime()), 0) / totalExecutions || 0;

      analytics.push({
        triggerType: trigger.triggerType,
        totalTriggers: trigger._count.id,
        activeTriggers,
        executionsTriggered: totalExecutions,
        successRate: totalExecutions > 0 ? successfulExecutions / totalExecutions : 0,
        averageResponseTime
      });
    }

    return analytics;
  }

  // Get error analysis
  async getErrorAnalysis(
    tenantId: string,
    timeRange?: AnalyticsTimeRange
  ): Promise<any> {
    const whereClause: any = {
      tenantId,
      status: 'error'
    };
    
    if (timeRange) {
      whereClause.startTime = {
        gte: timeRange.start,
        lte: timeRange.end
      };
    }

    const errorExecutions = await this.prisma.workflowExecution.findMany({
      where: whereClause,
      select: {
        workflowId: true,
        errorMessage: true,
        startTime: true,
        workflow: {
          select: { name: true }
        }
      }
    });

    // Group errors by workflow
    const errorsByWorkflow = errorExecutions.reduce((acc, execution) => {
      const workflowId = execution.workflowId;
      if (!acc[workflowId]) {
        acc[workflowId] = {
          workflowName: execution.workflow?.name || 'Unknown',
          errorCount: 0,
          errors: []
        };
      }
      acc[workflowId].errorCount++;
      acc[workflowId].errors.push({
        message: execution.errorMessage,
        timestamp: execution.startTime
      });
      return acc;
    }, {} as any);

    // Group errors by message
    const errorsByMessage = errorExecutions.reduce((acc, execution) => {
      const message = execution.errorMessage || 'Unknown error';
      if (!acc[message]) {
        acc[message] = {
          count: 0,
          workflows: new Set(),
          lastOccurrence: execution.startTime
        };
      }
      acc[message].count++;
      acc[message].workflows.add(execution.workflow?.name || 'Unknown');
      if (execution.startTime > acc[message].lastOccurrence) {
        acc[message].lastOccurrence = execution.startTime;
      }
      return acc;
    }, {} as any);

    // Convert sets to arrays for JSON serialization
    Object.values(errorsByMessage).forEach((error: any) => {
      error.workflows = Array.from(error.workflows);
    });

    return {
      totalErrors: errorExecutions.length,
      errorsByWorkflow,
      errorsByMessage,
      errorTrend: await this.getErrorTrend(tenantId, timeRange)
    };
  }

  // Get error trend over time
  private async getErrorTrend(
    tenantId: string,
    timeRange?: AnalyticsTimeRange
  ): Promise<any[]> {
    const range = timeRange || {
      start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
      end: new Date()
    };

    const trends = [];
    const current = new Date(range.start);

    while (current <= range.end) {
      const dayStart = new Date(current);
      const dayEnd = new Date(current);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const [totalExecutions, errorExecutions] = await Promise.all([
        this.prisma.workflowExecution.count({
          where: {
            tenantId,
            startTime: {
              gte: dayStart,
              lt: dayEnd
            }
          }
        }),
        this.prisma.workflowExecution.count({
          where: {
            tenantId,
            status: 'error',
            startTime: {
              gte: dayStart,
              lt: dayEnd
            }
          }
        })
      ]);

      trends.push({
        date: dayStart.toISOString().split('T')[0],
        totalExecutions,
        errorExecutions,
        errorRate: totalExecutions > 0 ? errorExecutions / totalExecutions : 0
      });

      current.setDate(current.getDate() + 1);
    }

    return trends;
  }

  // Get resource usage analytics
  async getResourceUsageAnalytics(
    tenantId: string,
    timeRange?: AnalyticsTimeRange
  ): Promise<any> {
    const whereClause: any = { tenantId };
    
    if (timeRange) {
      whereClause.date = {
        gte: timeRange.start,
        lte: timeRange.end
      };
    }

    const analytics = await this.prisma.workflowAnalytics.findMany({
      where: whereClause,
      orderBy: { date: 'asc' }
    });

    const totalDuration = analytics.reduce((sum, a) => sum + (a.totalDuration || 0), 0);
    const averageMemoryUsage = analytics.reduce((sum, a) => sum + (a.averageMemoryUsage || 0), 0) / analytics.length || 0;
    const averageCpuUsage = analytics.reduce((sum, a) => sum + (a.averageCpuUsage || 0), 0) / analytics.length || 0;
    const totalDiskUsage = analytics.reduce((sum, a) => sum + (a.totalDiskUsage || 0), 0);
    const totalNetworkRequests = analytics.reduce((sum, a) => sum + (a.totalNetworkRequests || 0), 0);

    return {
      summary: {
        totalDuration,
        averageMemoryUsage,
        averageCpuUsage,
        totalDiskUsage,
        totalNetworkRequests
      },
      daily: analytics.map(a => ({
        date: a.date.toISOString().split('T')[0],
        duration: a.totalDuration,
        memoryUsage: a.averageMemoryUsage,
        cpuUsage: a.averageCpuUsage,
        diskUsage: a.totalDiskUsage,
        networkRequests: a.totalNetworkRequests
      }))
    };
  }

  // Get chat integration analytics
  async getChatIntegrationAnalytics(tenantId: string): Promise<any> {
    const [chatTriggers, chatExecutions, chatResponses] = await Promise.all([
      this.prisma.workflowTrigger.count({
        where: {
          tenantId,
          triggerType: 'chat_message'
        }
      }),
      this.prisma.workflowExecution.count({
        where: {
          tenantId,
          metadata: {
            path: ['triggerType'],
            equals: 'chat_message'
          }
        }
      }),
      this.prisma.workflowExecution.count({
        where: {
          tenantId,
          metadata: {
            path: ['triggerType'],
            equals: 'chat_message'
          },
          status: 'success'
        }
      })
    ]);

    const responseRate = chatExecutions > 0 ? chatResponses / chatExecutions : 0;

    return {
      totalChatTriggers: chatTriggers,
      chatTriggeredExecutions: chatExecutions,
      successfulChatResponses: chatResponses,
      chatResponseRate: responseRate
    };
  }

  // Generate comprehensive analytics report
  async generateAnalyticsReport(
    tenantId: string,
    timeRange?: AnalyticsTimeRange
  ): Promise<any> {
    const [
      metrics,
      trends,
      performance,
      triggerAnalytics,
      errorAnalysis,
      resourceUsage,
      chatAnalytics
    ] = await Promise.all([
      this.getWorkflowMetrics(tenantId, timeRange),
      this.getExecutionTrends(tenantId, timeRange || {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date()
      }),
      this.getWorkflowPerformance(tenantId, timeRange),
      this.getTriggerAnalytics(tenantId),
      this.getErrorAnalysis(tenantId, timeRange),
      this.getResourceUsageAnalytics(tenantId, timeRange),
      this.getChatIntegrationAnalytics(tenantId)
    ]);

    return {
      summary: metrics,
      trends,
      topPerformingWorkflows: performance.slice(0, 10),
      triggerAnalytics,
      errorAnalysis,
      resourceUsage,
      chatIntegration: chatAnalytics,
      generatedAt: new Date().toISOString(),
      timeRange: timeRange || {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date()
      }
    };
  }

  // Update analytics data (called periodically)
  async updateAnalytics(tenantId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get executions for today
    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        tenantId,
        startTime: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
        }
      }
    });

    const totalExecutions = executions.length;
    const successfulExecutions = executions.filter(e => e.status === 'success').length;
    const failedExecutions = executions.filter(e => e.status === 'error').length;
    const totalDuration = executions.reduce((sum, e) => sum + (e.duration || 0), 0);
    const uniqueWorkflows = new Set(executions.map(e => e.workflowId)).size;

    const chatTriggeredExecutions = executions.filter(e => 
      e.metadata?.triggerType === 'chat_message'
    ).length;

    // Update or create analytics record
    await this.prisma.workflowAnalytics.upsert({
      where: {
        tenantId_date: {
          tenantId,
          date: today
        }
      },
      update: {
        totalExecutions,
        successfulExecutions,
        failedExecutions,
        totalDuration,
        averageDuration: totalExecutions > 0 ? totalDuration / totalExecutions : 0,
        uniqueWorkflows,
        chatTriggeredExecutions,
        updatedAt: new Date()
      },
      create: {
        tenantId,
        date: today,
        totalExecutions,
        successfulExecutions,
        failedExecutions,
        totalDuration,
        averageDuration: totalExecutions > 0 ? totalDuration / totalExecutions : 0,
        uniqueWorkflows,
        chatTriggeredExecutions
      }
    });
  }
}
