import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

interface ScalingMetrics {
  tenantId: string;
  currentLoad: {
    activeExecutions: number;
    queuedExecutions: number;
    cpuUtilization: number;
    memoryUtilization: number;
    networkUtilization: number;
  };
  capacity: {
    maxConcurrentExecutions: number;
    availableWorkers: number;
    totalCpuCores: number;
    totalMemoryGB: number;
  };
  predictions: {
    nextHourLoad: number;
    next4HourLoad: number;
    next24HourLoad: number;
    peakLoadTime: Date;
    recommendedCapacity: number;
  };
}

interface ScalingAction {
  type: 'scale_up' | 'scale_down' | 'maintain';
  reason: string;
  targetCapacity: number;
  estimatedCost: number;
  confidence: number;
  timeline: string;
  resources: {
    workers: number;
    cpu: number;
    memory: number;
  };
}

interface LoadPattern {
  hourlyPattern: Record<number, number>; // hour -> average load
  dailyPattern: Record<string, number>; // day -> average load
  monthlyPattern: Record<number, number>; // month -> average load
  seasonalFactors: {
    businessHours: number;
    weekends: number;
    holidays: number;
  };
}

export class PredictiveScaling extends EventEmitter {
  private prisma: PrismaClient;
  private loadPatterns: Map<string, LoadPattern> = new Map();
  private scalingHistory: Map<string, ScalingAction[]> = new Map();
  private currentMetrics: Map<string, ScalingMetrics> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.initializePredictiveScaling();
  }

  private async initializePredictiveScaling(): Promise<void> {
    await this.loadHistoricalPatterns();
    this.startContinuousMonitoring();
  }

  async analyzeScalingNeeds(tenantId: string): Promise<{ metrics: ScalingMetrics; action: ScalingAction }> {
    try {
      // Gather current metrics
      const metrics = await this.gatherCurrentMetrics(tenantId);
      
      // Generate predictions
      const predictions = await this.generateLoadPredictions(tenantId, metrics);
      metrics.predictions = predictions;
      
      // Determine scaling action
      const action = await this.determineScalingAction(tenantId, metrics);
      
      // Cache metrics
      this.currentMetrics.set(tenantId, metrics);
      
      // Record scaling decision
      await this.recordScalingDecision(tenantId, action);
      
      // Emit scaling event
      this.emit('scaling_analysis', { tenantId, metrics, action });

      return { metrics, action };

    } catch (error) {
      console.error('Error analyzing scaling needs:', error);
      throw error;
    }
  }

  private async gatherCurrentMetrics(tenantId: string): Promise<ScalingMetrics> {
    // Get current running executions
    const activeExecutions = await this.prisma.workflowExecution.count({
      where: {
        tenantId,
        status: 'running'
      }
    });

    // Get queued executions (waiting status)
    const queuedExecutions = await this.prisma.workflowExecution.count({
      where: {
        tenantId,
        status: 'waiting'
      }
    });

    // Simulate resource utilization (in production, this would come from monitoring)
    const cpuUtilization = Math.min(95, (activeExecutions / 10) * 100); // Assume 10 max concurrent
    const memoryUtilization = Math.min(90, (activeExecutions / 8) * 100);
    const networkUtilization = Math.min(80, (activeExecutions / 12) * 100);

    // Get tenant capacity configuration
    const capacity = await this.getTenantCapacity(tenantId);

    return {
      tenantId,
      currentLoad: {
        activeExecutions,
        queuedExecutions,
        cpuUtilization,
        memoryUtilization,
        networkUtilization
      },
      capacity,
      predictions: {
        nextHourLoad: 0,
        next4HourLoad: 0,
        next24HourLoad: 0,
        peakLoadTime: new Date(),
        recommendedCapacity: 0
      }
    };
  }

  private async getTenantCapacity(tenantId: string): Promise<ScalingMetrics['capacity']> {
    // In production, this would come from tenant configuration
    return {
      maxConcurrentExecutions: 10,
      availableWorkers: 5,
      totalCpuCores: 8,
      totalMemoryGB: 16
    };
  }

  private async generateLoadPredictions(tenantId: string, metrics: ScalingMetrics): Promise<ScalingMetrics['predictions']> {
    const pattern = this.loadPatterns.get(tenantId);
    const now = new Date();
    
    if (!pattern) {
      // No historical data, use current load as baseline
      return {
        nextHourLoad: metrics.currentLoad.activeExecutions,
        next4HourLoad: metrics.currentLoad.activeExecutions,
        next24HourLoad: metrics.currentLoad.activeExecutions,
        peakLoadTime: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        recommendedCapacity: Math.max(5, metrics.currentLoad.activeExecutions + 2)
      };
    }

    // Predict load based on historical patterns
    const currentHour = now.getHours();
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
    const currentMonth = now.getMonth();

    // Next hour prediction
    const nextHour = (currentHour + 1) % 24;
    const nextHourBaseline = pattern.hourlyPattern[nextHour] || 0;
    const dayFactor = pattern.dailyPattern[currentDay] || 1;
    const monthFactor = pattern.monthlyPattern[currentMonth] || 1;
    const nextHourLoad = Math.round(nextHourBaseline * dayFactor * monthFactor);

    // Next 4 hours prediction (average of next 4 hours)
    let next4HourTotal = 0;
    for (let i = 1; i <= 4; i++) {
      const hour = (currentHour + i) % 24;
      const hourLoad = (pattern.hourlyPattern[hour] || 0) * dayFactor * monthFactor;
      next4HourTotal += hourLoad;
    }
    const next4HourLoad = Math.round(next4HourTotal / 4);

    // Next 24 hours prediction (consider daily pattern)
    const next24HourLoad = Math.round(
      Object.values(pattern.hourlyPattern).reduce((sum, load) => sum + load, 0) / 24 * dayFactor * monthFactor
    );

    // Find peak load time in next 24 hours
    let peakLoad = 0;
    let peakHour = currentHour;
    for (let i = 0; i < 24; i++) {
      const hour = (currentHour + i) % 24;
      const hourLoad = (pattern.hourlyPattern[hour] || 0) * dayFactor * monthFactor;
      if (hourLoad > peakLoad) {
        peakLoad = hourLoad;
        peakHour = hour;
      }
    }

    const peakLoadTime = new Date(now);
    peakLoadTime.setHours(peakHour, 0, 0, 0);
    if (peakLoadTime <= now) {
      peakLoadTime.setDate(peakLoadTime.getDate() + 1);
    }

    // Recommend capacity based on peak load + buffer
    const recommendedCapacity = Math.max(
      metrics.capacity.maxConcurrentExecutions,
      Math.ceil(peakLoad * 1.2) // 20% buffer
    );

    return {
      nextHourLoad,
      next4HourLoad,
      next24HourLoad,
      peakLoadTime,
      recommendedCapacity
    };
  }

  private async determineScalingAction(tenantId: string, metrics: ScalingMetrics): Promise<ScalingAction> {
    const currentCapacity = metrics.capacity.maxConcurrentExecutions;
    const currentLoad = metrics.currentLoad.activeExecutions + metrics.currentLoad.queuedExecutions;
    const predictedLoad = Math.max(metrics.predictions.nextHourLoad, metrics.predictions.next4HourLoad);
    
    // Calculate utilization
    const currentUtilization = (currentLoad / currentCapacity) * 100;
    const predictedUtilization = (predictedLoad / currentCapacity) * 100;
    
    // Scaling thresholds
    const scaleUpThreshold = 80; // Scale up if utilization > 80%
    const scaleDownThreshold = 30; // Scale down if utilization < 30%
    const urgentThreshold = 95; // Urgent scaling if utilization > 95%

    let action: ScalingAction;

    if (currentUtilization > urgentThreshold || predictedUtilization > urgentThreshold) {
      // Urgent scale up
      const targetCapacity = Math.ceil(Math.max(currentLoad, predictedLoad) * 1.5);
      action = {
        type: 'scale_up',
        reason: `Urgent scaling needed. Current utilization: ${currentUtilization.toFixed(1)}%, Predicted: ${predictedUtilization.toFixed(1)}%`,
        targetCapacity,
        estimatedCost: this.calculateScalingCost(currentCapacity, targetCapacity),
        confidence: 95,
        timeline: 'immediate',
        resources: this.calculateResourceNeeds(targetCapacity)
      };
    } else if (currentUtilization > scaleUpThreshold || predictedUtilization > scaleUpThreshold) {
      // Regular scale up
      const targetCapacity = Math.ceil(Math.max(currentLoad, predictedLoad) * 1.3);
      action = {
        type: 'scale_up',
        reason: `Scale up recommended. Current utilization: ${currentUtilization.toFixed(1)}%, Predicted: ${predictedUtilization.toFixed(1)}%`,
        targetCapacity,
        estimatedCost: this.calculateScalingCost(currentCapacity, targetCapacity),
        confidence: 85,
        timeline: '5-10 minutes',
        resources: this.calculateResourceNeeds(targetCapacity)
      };
    } else if (currentUtilization < scaleDownThreshold && predictedUtilization < scaleDownThreshold) {
      // Scale down
      const targetCapacity = Math.max(5, Math.ceil(Math.max(currentLoad, predictedLoad) * 1.2));
      if (targetCapacity < currentCapacity) {
        action = {
          type: 'scale_down',
          reason: `Scale down opportunity. Current utilization: ${currentUtilization.toFixed(1)}%, Predicted: ${predictedUtilization.toFixed(1)}%`,
          targetCapacity,
          estimatedCost: this.calculateScalingCost(currentCapacity, targetCapacity),
          confidence: 75,
          timeline: '10-15 minutes',
          resources: this.calculateResourceNeeds(targetCapacity)
        };
      } else {
        action = this.createMaintainAction(currentCapacity, currentUtilization, predictedUtilization);
      }
    } else {
      // Maintain current capacity
      action = this.createMaintainAction(currentCapacity, currentUtilization, predictedUtilization);
    }

    return action;
  }

  private createMaintainAction(currentCapacity: number, currentUtilization: number, predictedUtilization: number): ScalingAction {
    return {
      type: 'maintain',
      reason: `Current capacity is optimal. Current utilization: ${currentUtilization.toFixed(1)}%, Predicted: ${predictedUtilization.toFixed(1)}%`,
      targetCapacity: currentCapacity,
      estimatedCost: 0,
      confidence: 90,
      timeline: 'no action needed',
      resources: this.calculateResourceNeeds(currentCapacity)
    };
  }

  private calculateScalingCost(currentCapacity: number, targetCapacity: number): number {
    const capacityDiff = targetCapacity - currentCapacity;
    const costPerUnit = 0.10; // $0.10 per capacity unit per hour
    return Math.abs(capacityDiff) * costPerUnit;
  }

  private calculateResourceNeeds(capacity: number): ScalingAction['resources'] {
    return {
      workers: Math.ceil(capacity / 2), // 2 executions per worker
      cpu: capacity * 0.5, // 0.5 CPU cores per execution
      memory: capacity * 512 // 512MB per execution
    };
  }

  private async loadHistoricalPatterns(): Promise<void> {
    try {
      // Load patterns for active tenants
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true }
      });

      for (const tenant of tenants) {
        const pattern = await this.calculateLoadPattern(tenant.id);
        this.loadPatterns.set(tenant.id, pattern);
      }

    } catch (error) {
      console.error('Error loading historical patterns:', error);
    }
  }

  private async calculateLoadPattern(tenantId: string): Promise<LoadPattern> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        tenantId,
        startTime: { gte: thirtyDaysAgo }
      },
      select: { startTime: true }
    });

    // Initialize patterns
    const hourlyPattern: Record<number, number> = {};
    const dailyPattern: Record<string, number> = {};
    const monthlyPattern: Record<number, number> = {};

    // Initialize with zeros
    for (let i = 0; i < 24; i++) hourlyPattern[i] = 0;
    for (let i = 0; i < 12; i++) monthlyPattern[i] = 0;

    const hourCounts: Record<number, number> = {};
    const dayCounts: Record<string, number> = {};
    const monthCounts: Record<number, number> = {};

    // Count executions by time periods
    executions.forEach(execution => {
      const date = new Date(execution.startTime);
      const hour = date.getHours();
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
      const month = date.getMonth();

      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      dayCounts[dayName] = (dayCounts[dayName] || 0) + 1;
      monthCounts[month] = (monthCounts[month] || 0) + 1;
    });

    // Calculate averages
    const totalDays = 30;
    Object.entries(hourCounts).forEach(([hour, count]) => {
      hourlyPattern[parseInt(hour)] = count / totalDays;
    });

    const totalWeeks = Math.ceil(totalDays / 7);
    Object.entries(dayCounts).forEach(([day, count]) => {
      dailyPattern[day] = count / totalWeeks;
    });

    Object.entries(monthCounts).forEach(([month, count]) => {
      monthlyPattern[parseInt(month)] = count;
    });

    // Calculate seasonal factors
    const businessHourExecutions = Object.entries(hourCounts)
      .filter(([hour]) => parseInt(hour) >= 9 && parseInt(hour) <= 17)
      .reduce((sum, [, count]) => sum + count, 0);
    
    const totalExecutions = executions.length;
    const businessHoursFactor = totalExecutions > 0 ? businessHourExecutions / totalExecutions : 1;

    return {
      hourlyPattern,
      dailyPattern,
      monthlyPattern,
      seasonalFactors: {
        businessHours: businessHoursFactor,
        weekends: 0.3, // Assume 30% of weekday load
        holidays: 0.1  // Assume 10% of normal load
      }
    };
  }

  private async recordScalingDecision(tenantId: string, action: ScalingAction): Promise<void> {
    try {
      const history = this.scalingHistory.get(tenantId) || [];
      history.push({
        ...action,
        timestamp: new Date()
      } as any);
      
      // Keep only last 100 decisions
      if (history.length > 100) {
        history.splice(0, history.length - 100);
      }
      
      this.scalingHistory.set(tenantId, history);

    } catch (error) {
      console.error('Error recording scaling decision:', error);
    }
  }

  private startContinuousMonitoring(): void {
    // Monitor scaling needs every 5 minutes
    setInterval(async () => {
      await this.runContinuousMonitoring();
    }, 5 * 60 * 1000);

    // Update load patterns every hour
    setInterval(async () => {
      await this.loadHistoricalPatterns();
    }, 60 * 60 * 1000);
  }

  private async runContinuousMonitoring(): Promise<void> {
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true }
      });

      for (const tenant of tenants) {
        try {
          const { metrics, action } = await this.analyzeScalingNeeds(tenant.id);
          
          // Execute scaling action if needed
          if (action.type !== 'maintain') {
            await this.executeScalingAction(tenant.id, action);
          }
          
        } catch (error) {
          console.error(`Error monitoring tenant ${tenant.id}:`, error);
        }
      }

    } catch (error) {
      console.error('Error in continuous monitoring:', error);
    }
  }

  private async executeScalingAction(tenantId: string, action: ScalingAction): Promise<void> {
    try {
      console.log(`Executing scaling action for tenant ${tenantId}:`, {
        type: action.type,
        targetCapacity: action.targetCapacity,
        reason: action.reason
      });

      // In production, this would trigger actual infrastructure scaling
      // For now, we'll just emit an event
      this.emit('scaling_action_executed', {
        tenantId,
        action,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('Error executing scaling action:', error);
    }
  }

  // Public API methods
  async getScalingRecommendations(tenantId: string): Promise<any> {
    const { metrics, action } = await this.analyzeScalingNeeds(tenantId);
    const history = this.scalingHistory.get(tenantId) || [];
    
    return {
      currentMetrics: metrics,
      recommendation: action,
      recentHistory: history.slice(-10),
      costProjection: {
        currentMonthlyCost: metrics.capacity.maxConcurrentExecutions * 0.10 * 24 * 30,
        projectedMonthlyCost: action.targetCapacity * 0.10 * 24 * 30,
        potentialSavings: action.type === 'scale_down' ? action.estimatedCost * 24 * 30 : 0
      }
    };
  }

  async getLoadPatterns(tenantId: string): Promise<LoadPattern | null> {
    return this.loadPatterns.get(tenantId) || null;
  }

  async cleanup(): Promise<void> {
    this.loadPatterns.clear();
    this.scalingHistory.clear();
    this.currentMetrics.clear();
    await this.prisma.$disconnect();
  }
}
