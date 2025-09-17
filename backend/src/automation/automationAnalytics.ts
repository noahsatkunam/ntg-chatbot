import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

interface AnalyticsMetrics {
  tenantId: string;
  timeRange: { start: Date; end: Date };
  workflowMetrics: {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
    totalExecutionTime: number;
    uniqueWorkflows: number;
  };
  performanceMetrics: {
    throughput: number; // executions per hour
    errorRate: number;
    averageResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
  };
  resourceMetrics: {
    totalCpuHours: number;
    totalMemoryHours: number;
    averageCpuUtilization: number;
    averageMemoryUtilization: number;
    peakCpuUtilization: number;
    peakMemoryUtilization: number;
  };
  costMetrics: {
    totalCost: number;
    costPerExecution: number;
    costByCategory: Record<string, number>;
    costTrend: Array<{ date: Date; cost: number }>;
  };
  userAdoptionMetrics: {
    activeUsers: number;
    newUsers: number;
    userRetention: number;
    averageWorkflowsPerUser: number;
    topUsers: Array<{ userId: string; executionCount: number }>;
  };
}

interface BusinessIntelligence {
  roi: {
    totalTimeSaved: number; // hours
    costSavings: number;
    productivityGain: number; // percentage
    automationValue: number;
  };
  trends: {
    executionTrend: Array<{ date: Date; count: number }>;
    errorTrend: Array<{ date: Date; rate: number }>;
    performanceTrend: Array<{ date: Date; avgTime: number }>;
    costTrend: Array<{ date: Date; cost: number }>;
  };
  insights: Array<{
    type: 'opportunity' | 'risk' | 'achievement' | 'recommendation';
    title: string;
    description: string;
    impact: 'low' | 'medium' | 'high';
    actionable: boolean;
  }>;
  forecasts: {
    nextMonthExecutions: number;
    nextMonthCost: number;
    growthRate: number;
    capacityNeeded: number;
  };
}

export class AutomationAnalytics extends EventEmitter {
  private prisma: PrismaClient;
  private metricsCache: Map<string, AnalyticsMetrics> = new Map();
  private biCache: Map<string, BusinessIntelligence> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.initializeAnalytics();
  }

  private async initializeAnalytics(): Promise<void> {
    this.startPeriodicAnalysis();
  }

  async generateAnalytics(tenantId: string, days: number = 30): Promise<AnalyticsMetrics> {
    try {
      const cacheKey = `${tenantId}_${days}`;
      if (this.metricsCache.has(cacheKey)) {
        return this.metricsCache.get(cacheKey)!;
      }

      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

      const workflowMetrics = await this.calculateWorkflowMetrics(tenantId, startDate, endDate);
      const performanceMetrics = await this.calculatePerformanceMetrics(tenantId, startDate, endDate);
      const resourceMetrics = await this.calculateResourceMetrics(tenantId, startDate, endDate);
      const costMetrics = await this.calculateCostMetrics(tenantId, startDate, endDate);
      const userAdoptionMetrics = await this.calculateUserAdoptionMetrics(tenantId, startDate, endDate);

      const analytics: AnalyticsMetrics = {
        tenantId,
        timeRange: { start: startDate, end: endDate },
        workflowMetrics,
        performanceMetrics,
        resourceMetrics,
        costMetrics,
        userAdoptionMetrics
      };

      this.metricsCache.set(cacheKey, analytics);
      setTimeout(() => this.metricsCache.delete(cacheKey), 30 * 60 * 1000); // Cache for 30 minutes

      return analytics;

    } catch (error) {
      console.error('Error generating analytics:', error);
      throw error;
    }
  }

  async generateBusinessIntelligence(tenantId: string, days: number = 90): Promise<BusinessIntelligence> {
    try {
      const cacheKey = `bi_${tenantId}_${days}`;
      if (this.biCache.has(cacheKey)) {
        return this.biCache.get(cacheKey)!;
      }

      const analytics = await this.generateAnalytics(tenantId, days);
      
      const roi = await this.calculateROI(tenantId, analytics);
      const trends = await this.calculateTrends(tenantId, days);
      const insights = await this.generateInsights(analytics, trends);
      const forecasts = await this.generateForecasts(trends);

      const bi: BusinessIntelligence = {
        roi,
        trends,
        insights,
        forecasts
      };

      this.biCache.set(cacheKey, bi);
      setTimeout(() => this.biCache.delete(cacheKey), 60 * 60 * 1000); // Cache for 1 hour

      return bi;

    } catch (error) {
      console.error('Error generating business intelligence:', error);
      throw error;
    }
  }

  private async calculateWorkflowMetrics(tenantId: string, startDate: Date, endDate: Date) {
    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        tenantId,
        startTime: { gte: startDate, lte: endDate }
      }
    });

    const totalExecutions = executions.length;
    const successfulExecutions = executions.filter(e => e.status === 'success').length;
    const failedExecutions = executions.filter(e => e.status === 'error').length;
    
    const durations = executions.filter(e => e.duration).map(e => e.duration!);
    const averageExecutionTime = durations.length > 0 
      ? durations.reduce((a, b) => a + b, 0) / durations.length 
      : 0;
    
    const totalExecutionTime = durations.reduce((a, b) => a + b, 0);
    const uniqueWorkflows = new Set(executions.map(e => e.workflowId)).size;

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      averageExecutionTime,
      totalExecutionTime,
      uniqueWorkflows
    };
  }

  private async calculatePerformanceMetrics(tenantId: string, startDate: Date, endDate: Date) {
    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        tenantId,
        startTime: { gte: startDate, lte: endDate }
      }
    });

    const hoursDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    const throughput = executions.length / hoursDiff;
    
    const errorRate = executions.length > 0 
      ? (executions.filter(e => e.status === 'error').length / executions.length) * 100 
      : 0;

    const durations = executions.filter(e => e.duration).map(e => e.duration!).sort((a, b) => a - b);
    const averageResponseTime = durations.length > 0 
      ? durations.reduce((a, b) => a + b, 0) / durations.length 
      : 0;
    
    const p95Index = Math.floor(durations.length * 0.95);
    const p99Index = Math.floor(durations.length * 0.99);
    const p95ResponseTime = durations.length > 0 ? durations[p95Index] || 0 : 0;
    const p99ResponseTime = durations.length > 0 ? durations[p99Index] || 0 : 0;

    return {
      throughput,
      errorRate,
      averageResponseTime,
      p95ResponseTime,
      p99ResponseTime
    };
  }

  private async calculateResourceMetrics(tenantId: string, startDate: Date, endDate: Date) {
    // Simulated resource metrics - in production, this would come from monitoring
    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        tenantId,
        startTime: { gte: startDate, lte: endDate }
      }
    });

    const totalCpuHours = executions.length * 0.5; // Estimated
    const totalMemoryHours = executions.length * 256; // Estimated MB-hours
    const averageCpuUtilization = 45; // Percentage
    const averageMemoryUtilization = 60; // Percentage
    const peakCpuUtilization = 85;
    const peakMemoryUtilization = 90;

    return {
      totalCpuHours,
      totalMemoryHours,
      averageCpuUtilization,
      averageMemoryUtilization,
      peakCpuUtilization,
      peakMemoryUtilization
    };
  }

  private async calculateCostMetrics(tenantId: string, startDate: Date, endDate: Date) {
    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        tenantId,
        startTime: { gte: startDate, lte: endDate }
      }
    });

    // Simplified cost calculation
    const costPerExecution = 0.05; // Base cost
    const totalCost = executions.length * costPerExecution;
    
    const costByCategory = {
      'compute': totalCost * 0.6,
      'storage': totalCost * 0.2,
      'network': totalCost * 0.1,
      'other': totalCost * 0.1
    };

    // Generate daily cost trend
    const costTrend: Array<{ date: Date; cost: number }> = [];
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    for (let i = 0; i < daysDiff; i++) {
      const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const dayExecutions = executions.filter(e => 
        e.startTime.toDateString() === date.toDateString()
      ).length;
      costTrend.push({ date, cost: dayExecutions * costPerExecution });
    }

    return {
      totalCost,
      costPerExecution,
      costByCategory,
      costTrend
    };
  }

  private async calculateUserAdoptionMetrics(tenantId: string, startDate: Date, endDate: Date) {
    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        tenantId,
        startTime: { gte: startDate, lte: endDate }
      }
    });

    const userIds = executions.map(e => e.triggeredBy).filter(Boolean);
    const activeUsers = new Set(userIds).size;
    
    // Calculate new users (simplified)
    const newUsers = Math.floor(activeUsers * 0.2); // Estimate 20% are new
    
    const userRetention = 85; // Percentage - would be calculated from historical data
    const averageWorkflowsPerUser = userIds.length > 0 ? executions.length / activeUsers : 0;

    // Top users by execution count
    const userExecutionCounts: Record<string, number> = {};
    userIds.forEach(userId => {
      if (userId) {
        userExecutionCounts[userId] = (userExecutionCounts[userId] || 0) + 1;
      }
    });

    const topUsers = Object.entries(userExecutionCounts)
      .map(([userId, count]) => ({ userId, executionCount: count }))
      .sort((a, b) => b.executionCount - a.executionCount)
      .slice(0, 10);

    return {
      activeUsers,
      newUsers,
      userRetention,
      averageWorkflowsPerUser,
      topUsers
    };
  }

  private async calculateROI(tenantId: string, analytics: AnalyticsMetrics) {
    // Estimate time saved (assuming each execution saves 30 minutes of manual work)
    const totalTimeSaved = analytics.workflowMetrics.successfulExecutions * 0.5; // hours
    
    // Estimate cost savings (assuming $50/hour for manual work)
    const costSavings = totalTimeSaved * 50;
    
    // Calculate productivity gain
    const productivityGain = analytics.workflowMetrics.totalExecutions > 0 
      ? (analytics.workflowMetrics.successfulExecutions / analytics.workflowMetrics.totalExecutions) * 100 
      : 0;
    
    // Calculate automation value (cost savings minus automation costs)
    const automationValue = costSavings - analytics.costMetrics.totalCost;

    return {
      totalTimeSaved,
      costSavings,
      productivityGain,
      automationValue
    };
  }

  private async calculateTrends(tenantId: string, days: number) {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    // Generate daily trends
    const trends = {
      executionTrend: [] as Array<{ date: Date; count: number }>,
      errorTrend: [] as Array<{ date: Date; rate: number }>,
      performanceTrend: [] as Array<{ date: Date; avgTime: number }>,
      costTrend: [] as Array<{ date: Date; cost: number }>
    };

    for (let i = 0; i < days; i++) {
      const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(date.setHours(0, 0, 0, 0));
      const dayEnd = new Date(date.setHours(23, 59, 59, 999));

      const dayExecutions = await this.prisma.workflowExecution.findMany({
        where: {
          tenantId,
          startTime: { gte: dayStart, lte: dayEnd }
        }
      });

      const count = dayExecutions.length;
      const errorCount = dayExecutions.filter(e => e.status === 'error').length;
      const errorRate = count > 0 ? (errorCount / count) * 100 : 0;
      
      const durations = dayExecutions.filter(e => e.duration).map(e => e.duration!);
      const avgTime = durations.length > 0 
        ? durations.reduce((a, b) => a + b, 0) / durations.length 
        : 0;
      
      const cost = count * 0.05; // Simplified cost calculation

      trends.executionTrend.push({ date: new Date(dayStart), count });
      trends.errorTrend.push({ date: new Date(dayStart), rate: errorRate });
      trends.performanceTrend.push({ date: new Date(dayStart), avgTime });
      trends.costTrend.push({ date: new Date(dayStart), cost });
    }

    return trends;
  }

  private async generateInsights(analytics: AnalyticsMetrics, trends: BusinessIntelligence['trends']) {
    const insights: BusinessIntelligence['insights'] = [];

    // Performance insights
    if (analytics.performanceMetrics.errorRate > 10) {
      insights.push({
        type: 'risk',
        title: 'High Error Rate Detected',
        description: `Current error rate is ${analytics.performanceMetrics.errorRate.toFixed(1)}%, which is above the recommended 5% threshold.`,
        impact: 'high',
        actionable: true
      });
    }

    // Cost optimization opportunities
    if (analytics.costMetrics.costPerExecution > 0.10) {
      insights.push({
        type: 'opportunity',
        title: 'Cost Optimization Opportunity',
        description: `Cost per execution (${analytics.costMetrics.costPerExecution.toFixed(3)}) could be reduced through resource optimization.`,
        impact: 'medium',
        actionable: true
      });
    }

    // Growth achievements
    const recentExecutions = trends.executionTrend.slice(-7).reduce((sum, day) => sum + day.count, 0);
    const previousExecutions = trends.executionTrend.slice(-14, -7).reduce((sum, day) => sum + day.count, 0);
    
    if (recentExecutions > previousExecutions * 1.2) {
      insights.push({
        type: 'achievement',
        title: 'Strong Growth in Automation Usage',
        description: `Workflow executions increased by ${(((recentExecutions - previousExecutions) / previousExecutions) * 100).toFixed(1)}% this week.`,
        impact: 'high',
        actionable: false
      });
    }

    // User adoption insights
    if (analytics.userAdoptionMetrics.activeUsers < 10) {
      insights.push({
        type: 'opportunity',
        title: 'Low User Adoption',
        description: 'Consider implementing user training programs to increase workflow adoption.',
        impact: 'medium',
        actionable: true
      });
    }

    return insights;
  }

  private async generateForecasts(trends: BusinessIntelligence['trends']) {
    // Simple linear regression for forecasting
    const executionData = trends.executionTrend.slice(-30); // Last 30 days
    const avgDailyExecutions = executionData.reduce((sum, day) => sum + day.count, 0) / executionData.length;
    
    // Calculate growth rate
    const firstHalf = executionData.slice(0, 15).reduce((sum, day) => sum + day.count, 0) / 15;
    const secondHalf = executionData.slice(-15).reduce((sum, day) => sum + day.count, 0) / 15;
    const growthRate = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : 0;

    const nextMonthExecutions = Math.round(avgDailyExecutions * 30 * (1 + growthRate / 100));
    const nextMonthCost = nextMonthExecutions * 0.05;
    const capacityNeeded = Math.ceil(nextMonthExecutions / 1000); // Assuming 1000 executions per capacity unit

    return {
      nextMonthExecutions,
      nextMonthCost,
      growthRate,
      capacityNeeded
    };
  }

  private startPeriodicAnalysis(): void {
    // Generate analytics for all active tenants every 4 hours
    setInterval(async () => {
      await this.runPeriodicAnalysis();
    }, 4 * 60 * 60 * 1000);
  }

  private async runPeriodicAnalysis(): Promise<void> {
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true }
      });

      for (const tenant of tenants) {
        try {
          const analytics = await this.generateAnalytics(tenant.id);
          const bi = await this.generateBusinessIntelligence(tenant.id);
          
          // Emit analytics events for monitoring
          this.emit('analytics_generated', { tenantId: tenant.id, analytics, bi });
          
        } catch (error) {
          console.error(`Error generating analytics for tenant ${tenant.id}:`, error);
        }
      }

    } catch (error) {
      console.error('Error in periodic analysis:', error);
    }
  }

  async cleanup(): Promise<void> {
    this.metricsCache.clear();
    this.biCache.clear();
    await this.prisma.$disconnect();
  }
}
