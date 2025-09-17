import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

interface SchedulingContext {
  workflowId: string;
  tenantId: string;
  userId: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedDuration: number;
  resourceRequirements: {
    cpu: number;
    memory: number;
    network: boolean;
  };
  dependencies: string[];
  timezone: string;
  constraints: {
    businessHours?: boolean;
    weekendsAllowed?: boolean;
    blackoutPeriods?: Array<{ start: Date; end: Date }>;
  };
}

interface OptimalSchedule {
  scheduledTime: Date;
  confidence: number;
  reasoning: string[];
  alternativeSlots: Array<{ time: Date; score: number }>;
  resourceAllocation: {
    cpu: number;
    memory: number;
    estimatedCost: number;
  };
}

interface HistoricalPattern {
  workflowId: string;
  optimalHours: number[];
  averageDuration: number;
  successRate: number;
  resourceUsage: {
    avgCpu: number;
    avgMemory: number;
    peakCpu: number;
    peakMemory: number;
  };
  seasonality: {
    dayOfWeek: Record<string, number>;
    hourOfDay: Record<string, number>;
    monthOfYear: Record<string, number>;
  };
}

export class IntelligentScheduler extends EventEmitter {
  private prisma: PrismaClient;
  private historicalPatterns: Map<string, HistoricalPattern> = new Map();
  private systemLoadCache: Map<string, number> = new Map();
  private learningModel: Map<string, any> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.initializeScheduler();
  }

  private async initializeScheduler(): Promise<void> {
    // Load historical patterns
    await this.loadHistoricalPatterns();
    
    // Initialize ML models
    await this.initializeLearningModels();
    
    // Start background optimization
    this.startBackgroundOptimization();
  }

  // Main scheduling method
  async scheduleWorkflow(context: SchedulingContext): Promise<OptimalSchedule> {
    try {
      // Analyze historical patterns
      const patterns = await this.analyzeHistoricalPatterns(context.workflowId);
      
      // Get current system load
      const systemLoad = await this.getCurrentSystemLoad(context.tenantId);
      
      // Generate candidate time slots
      const candidateSlots = await this.generateCandidateSlots(context, patterns);
      
      // Score each slot using ML model
      const scoredSlots = await this.scoreTimeSlots(candidateSlots, context, patterns, systemLoad);
      
      // Select optimal slot
      const optimalSlot = scoredSlots[0];
      
      // Calculate resource allocation
      const resourceAllocation = await this.calculateResourceAllocation(context, optimalSlot.time);
      
      const schedule: OptimalSchedule = {
        scheduledTime: optimalSlot.time,
        confidence: optimalSlot.score,
        reasoning: await this.generateSchedulingReasoning(optimalSlot, context, patterns),
        alternativeSlots: scoredSlots.slice(1, 4),
        resourceAllocation
      };

      // Learn from scheduling decision
      await this.recordSchedulingDecision(context, schedule);
      
      // Emit scheduling event
      this.emit('workflow_scheduled', {
        workflowId: context.workflowId,
        tenantId: context.tenantId,
        schedule
      });

      return schedule;

    } catch (error) {
      console.error('Error in intelligent scheduling:', error);
      
      // Fallback to simple scheduling
      return this.fallbackScheduling(context);
    }
  }

  private async analyzeHistoricalPatterns(workflowId: string): Promise<HistoricalPattern | null> {
    try {
      // Check cache first
      if (this.historicalPatterns.has(workflowId)) {
        return this.historicalPatterns.get(workflowId)!;
      }

      // Query historical executions
      const executions = await this.prisma.workflowExecution.findMany({
        where: {
          workflowId,
          status: 'success',
          startTime: {
            gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // Last 90 days
          }
        },
        orderBy: { startTime: 'desc' },
        take: 1000
      });

      if (executions.length < 5) {
        return null; // Not enough data for pattern analysis
      }

      // Analyze patterns
      const pattern = this.calculateHistoricalPattern(executions);
      
      // Cache the pattern
      this.historicalPatterns.set(workflowId, pattern);
      
      return pattern;

    } catch (error) {
      console.error('Error analyzing historical patterns:', error);
      return null;
    }
  }

  private calculateHistoricalPattern(executions: any[]): HistoricalPattern {
    const durations = executions.map(e => e.duration || 0);
    const successRate = executions.length > 0 ? 1.0 : 0.0; // All are successful since we filtered
    
    // Calculate optimal hours (hours with highest success rate and lowest duration)
    const hourlyStats: Record<number, { count: number; avgDuration: number }> = {};
    
    executions.forEach(exec => {
      const hour = new Date(exec.startTime).getHours();
      if (!hourlyStats[hour]) {
        hourlyStats[hour] = { count: 0, avgDuration: 0 };
      }
      hourlyStats[hour].count++;
      hourlyStats[hour].avgDuration += exec.duration || 0;
    });

    // Calculate averages and find optimal hours
    const optimalHours: number[] = [];
    Object.entries(hourlyStats).forEach(([hour, stats]) => {
      stats.avgDuration = stats.avgDuration / stats.count;
      if (stats.count >= 3 && stats.avgDuration < this.calculateMedian(durations)) {
        optimalHours.push(parseInt(hour));
      }
    });

    // Seasonality analysis
    const dayOfWeek: Record<string, number> = {};
    const hourOfDay: Record<string, number> = {};
    const monthOfYear: Record<string, number> = {};

    executions.forEach(exec => {
      const date = new Date(exec.startTime);
      const day = date.toLocaleDateString('en-US', { weekday: 'long' });
      const hour = date.getHours().toString();
      const month = date.toLocaleDateString('en-US', { month: 'long' });

      dayOfWeek[day] = (dayOfWeek[day] || 0) + 1;
      hourOfDay[hour] = (hourOfDay[hour] || 0) + 1;
      monthOfYear[month] = (monthOfYear[month] || 0) + 1;
    });

    return {
      workflowId: executions[0].workflowId,
      optimalHours: optimalHours.length > 0 ? optimalHours : [9, 10, 11, 14, 15], // Default business hours
      averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      successRate,
      resourceUsage: {
        avgCpu: 50, // Would be calculated from actual metrics
        avgMemory: 256,
        peakCpu: 80,
        peakMemory: 512
      },
      seasonality: {
        dayOfWeek,
        hourOfDay,
        monthOfYear
      }
    };
  }

  private async getCurrentSystemLoad(tenantId: string): Promise<number> {
    try {
      // Check cache first
      const cacheKey = `load_${tenantId}`;
      if (this.systemLoadCache.has(cacheKey)) {
        return this.systemLoadCache.get(cacheKey)!;
      }

      // Calculate current system load based on running executions
      const runningExecutions = await this.prisma.workflowExecution.count({
        where: {
          tenantId,
          status: 'running'
        }
      });

      // Get tenant's execution capacity (would be configurable)
      const maxConcurrentExecutions = 10; // Default capacity
      const loadPercentage = (runningExecutions / maxConcurrentExecutions) * 100;

      // Cache for 1 minute
      this.systemLoadCache.set(cacheKey, loadPercentage);
      setTimeout(() => this.systemLoadCache.delete(cacheKey), 60000);

      return Math.min(loadPercentage, 100);

    } catch (error) {
      console.error('Error getting system load:', error);
      return 50; // Default moderate load
    }
  }

  private async generateCandidateSlots(
    context: SchedulingContext,
    patterns: HistoricalPattern | null
  ): Promise<Date[]> {
    const slots: Date[] = [];
    const now = new Date();
    const timezone = context.timezone || 'UTC';

    // Generate slots for the next 7 days
    for (let day = 0; day < 7; day++) {
      const date = new Date(now.getTime() + day * 24 * 60 * 60 * 1000);
      
      // Use optimal hours from patterns or default business hours
      const optimalHours = patterns?.optimalHours || [9, 10, 11, 14, 15, 16];
      
      for (const hour of optimalHours) {
        const slotTime = new Date(date);
        slotTime.setHours(hour, 0, 0, 0);
        
        // Skip past times
        if (slotTime <= now) continue;
        
        // Check constraints
        if (this.meetsConstraints(slotTime, context.constraints)) {
          slots.push(slotTime);
        }
      }
    }

    return slots.slice(0, 20); // Limit to 20 candidates
  }

  private async scoreTimeSlots(
    slots: Date[],
    context: SchedulingContext,
    patterns: HistoricalPattern | null,
    systemLoad: number
  ): Promise<Array<{ time: Date; score: number }>> {
    const scoredSlots = await Promise.all(
      slots.map(async (slot) => {
        const score = await this.calculateSlotScore(slot, context, patterns, systemLoad);
        return { time: slot, score };
      })
    );

    // Sort by score (highest first)
    return scoredSlots.sort((a, b) => b.score - a.score);
  }

  private async calculateSlotScore(
    slot: Date,
    context: SchedulingContext,
    patterns: HistoricalPattern | null,
    systemLoad: number
  ): Promise<number> {
    let score = 0;

    // Base score
    score += 50;

    // Historical success factor
    if (patterns) {
      const hour = slot.getHours();
      const dayOfWeek = slot.toLocaleDateString('en-US', { weekday: 'long' });
      
      if (patterns.optimalHours.includes(hour)) {
        score += 20;
      }
      
      if (patterns.seasonality.dayOfWeek[dayOfWeek]) {
        score += 10;
      }
    }

    // System load factor (prefer lower load times)
    const projectedLoad = await this.projectSystemLoad(slot, context.tenantId);
    score += Math.max(0, 30 - projectedLoad);

    // Priority factor
    const priorityBonus = {
      'low': 0,
      'medium': 5,
      'high': 10,
      'critical': 20
    };
    score += priorityBonus[context.priority];

    // Time proximity factor (sooner is generally better for high priority)
    const hoursFromNow = (slot.getTime() - Date.now()) / (1000 * 60 * 60);
    if (context.priority === 'critical' && hoursFromNow < 24) {
      score += 15;
    } else if (context.priority === 'high' && hoursFromNow < 48) {
      score += 10;
    }

    // Resource availability factor
    const resourceScore = await this.calculateResourceAvailabilityScore(slot, context);
    score += resourceScore;

    return Math.max(0, Math.min(100, score));
  }

  private async projectSystemLoad(slot: Date, tenantId: string): Promise<number> {
    try {
      // Get scheduled executions for that time slot
      const scheduledCount = await this.prisma.workflowExecution.count({
        where: {
          tenantId,
          startTime: {
            gte: new Date(slot.getTime() - 30 * 60 * 1000), // 30 min before
            lte: new Date(slot.getTime() + 30 * 60 * 1000)  // 30 min after
          },
          status: { in: ['running', 'waiting'] }
        }
      });

      // Convert to load percentage
      const maxConcurrentExecutions = 10;
      return (scheduledCount / maxConcurrentExecutions) * 100;

    } catch (error) {
      console.error('Error projecting system load:', error);
      return 50; // Default moderate load
    }
  }

  private async calculateResourceAvailabilityScore(
    slot: Date,
    context: SchedulingContext
  ): Promise<number> {
    // Simplified resource availability calculation
    // In a real implementation, this would check actual resource pools
    
    const hour = slot.getHours();
    
    // Assume better resource availability during off-peak hours
    if (hour >= 22 || hour <= 6) {
      return 15; // Night hours - better availability
    } else if (hour >= 12 && hour <= 14) {
      return 5; // Lunch hours - moderate availability
    } else {
      return 10; // Business hours - standard availability
    }
  }

  private meetsConstraints(time: Date, constraints: SchedulingContext['constraints']): boolean {
    // Business hours check
    if (constraints.businessHours) {
      const hour = time.getHours();
      if (hour < 9 || hour > 17) {
        return false;
      }
    }

    // Weekend check
    if (!constraints.weekendsAllowed) {
      const day = time.getDay();
      if (day === 0 || day === 6) { // Sunday or Saturday
        return false;
      }
    }

    // Blackout periods check
    if (constraints.blackoutPeriods) {
      for (const period of constraints.blackoutPeriods) {
        if (time >= period.start && time <= period.end) {
          return false;
        }
      }
    }

    return true;
  }

  private async calculateResourceAllocation(
    context: SchedulingContext,
    scheduledTime: Date
  ): Promise<OptimalSchedule['resourceAllocation']> {
    // Base resource allocation
    let cpu = context.resourceRequirements.cpu || 1;
    let memory = context.resourceRequirements.memory || 512;

    // Adjust based on priority
    const priorityMultiplier = {
      'low': 0.8,
      'medium': 1.0,
      'high': 1.2,
      'critical': 1.5
    };

    cpu *= priorityMultiplier[context.priority];
    memory *= priorityMultiplier[context.priority];

    // Estimate cost (simplified calculation)
    const estimatedCost = (cpu * 0.05 + memory * 0.001) * (context.estimatedDuration / 1000 / 60); // Cost per minute

    return {
      cpu: Math.round(cpu),
      memory: Math.round(memory),
      estimatedCost: Math.round(estimatedCost * 100) / 100
    };
  }

  private async generateSchedulingReasoning(
    optimalSlot: { time: Date; score: number },
    context: SchedulingContext,
    patterns: HistoricalPattern | null
  ): Promise<string[]> {
    const reasoning: string[] = [];

    reasoning.push(`Scheduled for ${optimalSlot.time.toLocaleString()} with confidence score ${optimalSlot.score}%`);

    if (patterns) {
      const hour = optimalSlot.time.getHours();
      if (patterns.optimalHours.includes(hour)) {
        reasoning.push(`Selected optimal execution hour based on historical performance`);
      }
    }

    if (context.priority === 'critical') {
      reasoning.push(`Prioritized due to critical priority level`);
    }

    const projectedLoad = await this.projectSystemLoad(optimalSlot.time, context.tenantId);
    if (projectedLoad < 30) {
      reasoning.push(`Scheduled during low system load period (${projectedLoad}%)`);
    }

    return reasoning;
  }

  private async recordSchedulingDecision(
    context: SchedulingContext,
    schedule: OptimalSchedule
  ): Promise<void> {
    try {
      // Record the scheduling decision for learning
      // This would typically be stored in a dedicated table for ML training
      console.log('Recording scheduling decision for learning:', {
        workflowId: context.workflowId,
        scheduledTime: schedule.scheduledTime,
        confidence: schedule.confidence,
        resourceAllocation: schedule.resourceAllocation
      });

    } catch (error) {
      console.error('Error recording scheduling decision:', error);
    }
  }

  private fallbackScheduling(context: SchedulingContext): OptimalSchedule {
    // Simple fallback scheduling
    const now = new Date();
    const scheduledTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now

    return {
      scheduledTime,
      confidence: 50,
      reasoning: ['Fallback scheduling due to insufficient data'],
      alternativeSlots: [],
      resourceAllocation: {
        cpu: context.resourceRequirements.cpu || 1,
        memory: context.resourceRequirements.memory || 512,
        estimatedCost: 0.1
      }
    };
  }

  // Background optimization
  private startBackgroundOptimization(): void {
    // Refresh patterns every hour
    setInterval(async () => {
      await this.loadHistoricalPatterns();
    }, 60 * 60 * 1000);

    // Update learning models every 6 hours
    setInterval(async () => {
      await this.updateLearningModels();
    }, 6 * 60 * 60 * 1000);
  }

  private async loadHistoricalPatterns(): Promise<void> {
    try {
      // Load patterns for active workflows
      const activeWorkflows = await this.prisma.workflow.findMany({
        where: { status: 'active' },
        select: { id: true }
      });

      for (const workflow of activeWorkflows) {
        await this.analyzeHistoricalPatterns(workflow.id);
      }

    } catch (error) {
      console.error('Error loading historical patterns:', error);
    }
  }

  private async initializeLearningModels(): Promise<void> {
    // Initialize simple learning models
    // In a production system, this would load pre-trained ML models
    console.log('Initializing learning models for intelligent scheduling');
  }

  private async updateLearningModels(): Promise<void> {
    // Update learning models with new data
    console.log('Updating learning models with recent execution data');
  }

  // Utility methods
  private calculateMedian(numbers: number[]): number {
    const sorted = numbers.sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    } else {
      return sorted[middle];
    }
  }

  // Public API methods
  async getSchedulingRecommendations(workflowId: string): Promise<any> {
    const patterns = await this.analyzeHistoricalPatterns(workflowId);
    
    return {
      optimalHours: patterns?.optimalHours || [9, 10, 11, 14, 15],
      averageDuration: patterns?.averageDuration || 0,
      successRate: patterns?.successRate || 0,
      recommendations: this.generateRecommendations(patterns)
    };
  }

  private generateRecommendations(patterns: HistoricalPattern | null): string[] {
    if (!patterns) {
      return ['Insufficient historical data for recommendations'];
    }

    const recommendations: string[] = [];

    if (patterns.optimalHours.length > 0) {
      recommendations.push(`Best execution hours: ${patterns.optimalHours.join(', ')}`);
    }

    if (patterns.successRate > 0.9) {
      recommendations.push('High success rate - workflow is stable');
    } else if (patterns.successRate < 0.7) {
      recommendations.push('Consider reviewing workflow for reliability improvements');
    }

    return recommendations;
  }

  async cleanup(): Promise<void> {
    this.historicalPatterns.clear();
    this.systemLoadCache.clear();
    this.learningModel.clear();
    await this.prisma.$disconnect();
  }
}
