import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

interface MLModel {
  type: 'execution_time' | 'success_rate' | 'resource_usage' | 'optimal_timing';
  version: string;
  accuracy: number;
  lastTrained: Date;
  features: string[];
}

interface SchedulingFeatures {
  workflowId: string;
  tenantId: string;
  workflowComplexity: number;
  historicalExecutionTime: number;
  historicalSuccessRate: number;
  resourceRequirements: {
    cpu: number;
    memory: number;
    network: number;
  };
  dependencies: string[];
  priority: number;
  timeConstraints: {
    earliestStart?: Date;
    latestEnd?: Date;
    preferredHours?: number[];
    blackoutPeriods?: Array<{ start: Date; end: Date }>;
  };
  contextualFactors: {
    dayOfWeek: number;
    hourOfDay: number;
    systemLoad: number;
    seasonality: number;
  };
}

interface MLPrediction {
  executionTime: {
    predicted: number;
    confidence: number;
    range: { min: number; max: number };
  };
  successProbability: {
    predicted: number;
    confidence: number;
    factors: Array<{ factor: string; impact: number }>;
  };
  resourceUsage: {
    cpu: { predicted: number; confidence: number };
    memory: { predicted: number; confidence: number };
    network: { predicted: number; confidence: number };
  };
  optimalTiming: {
    recommendedStart: Date;
    confidence: number;
    reasoning: string[];
  };
}

interface SmartScheduleResult {
  scheduledTime: Date;
  confidence: number;
  predictions: MLPrediction;
  reasoning: string[];
  alternatives: Array<{
    time: Date;
    confidence: number;
    tradeoffs: string[];
  }>;
  riskFactors: Array<{
    factor: string;
    severity: 'low' | 'medium' | 'high';
    mitigation: string;
  }>;
}

export class SmartScheduler extends EventEmitter {
  private prisma: PrismaClient;
  private models: Map<string, MLModel> = new Map();
  private trainingData: Map<string, any[]> = new Map();
  private featureCache: Map<string, SchedulingFeatures> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.initializeMLModels();
  }

  private async initializeMLModels(): Promise<void> {
    // Initialize ML models (in production, these would be real trained models)
    this.models.set('execution_time', {
      type: 'execution_time',
      version: '1.0.0',
      accuracy: 0.85,
      lastTrained: new Date(),
      features: ['complexity', 'historical_time', 'system_load', 'hour_of_day', 'day_of_week']
    });

    this.models.set('success_rate', {
      type: 'success_rate',
      version: '1.0.0',
      accuracy: 0.92,
      lastTrained: new Date(),
      features: ['historical_success', 'complexity', 'resource_availability', 'dependencies']
    });

    this.models.set('resource_usage', {
      type: 'resource_usage',
      version: '1.0.0',
      accuracy: 0.78,
      lastTrained: new Date(),
      features: ['workflow_type', 'data_size', 'complexity', 'historical_usage']
    });

    this.models.set('optimal_timing', {
      type: 'optimal_timing',
      version: '1.0.0',
      accuracy: 0.88,
      lastTrained: new Date(),
      features: ['system_patterns', 'success_rates_by_time', 'resource_availability', 'business_constraints']
    });

    await this.loadTrainingData();
  }

  async scheduleWithML(workflowId: string, tenantId: string, constraints?: any): Promise<SmartScheduleResult> {
    try {
      // Extract features for ML prediction
      const features = await this.extractFeatures(workflowId, tenantId, constraints);
      
      // Generate ML predictions
      const predictions = await this.generateMLPredictions(features);
      
      // Find optimal scheduling time
      const optimalTime = await this.findOptimalTime(features, predictions);
      
      // Generate alternatives
      const alternatives = await this.generateAlternatives(features, predictions, optimalTime);
      
      // Assess risks
      const riskFactors = await this.assessRisks(features, predictions);
      
      // Build reasoning
      const reasoning = this.buildReasoning(features, predictions, optimalTime);
      
      const result: SmartScheduleResult = {
        scheduledTime: optimalTime.recommendedStart,
        confidence: optimalTime.confidence,
        predictions,
        reasoning,
        alternatives,
        riskFactors
      };

      // Cache the result and emit event
      await this.cacheSchedulingResult(workflowId, tenantId, result);
      this.emit('smart_schedule_created', { workflowId, tenantId, result });

      return result;

    } catch (error) {
      console.error('Error in ML-based scheduling:', error);
      throw error;
    }
  }

  private async extractFeatures(workflowId: string, tenantId: string, constraints?: any): Promise<SchedulingFeatures> {
    const cacheKey = `${tenantId}-${workflowId}`;
    
    // Check cache first
    if (this.featureCache.has(cacheKey)) {
      const cached = this.featureCache.get(cacheKey)!;
      // Update contextual factors
      cached.contextualFactors = await this.getContextualFactors();
      return cached;
    }

    // Get workflow information
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      include: {
        executions: {
          take: 50,
          orderBy: { startTime: 'desc' }
        }
      }
    });

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    // Calculate historical metrics
    const executions = workflow.executions;
    const successfulExecutions = executions.filter(e => e.status === 'completed');
    const avgExecutionTime = successfulExecutions.length > 0 
      ? successfulExecutions.reduce((sum, e) => sum + (e.endTime ? new Date(e.endTime).getTime() - new Date(e.startTime).getTime() : 0), 0) / successfulExecutions.length / 1000
      : 300; // Default 5 minutes

    const successRate = executions.length > 0 ? successfulExecutions.length / executions.length : 0.8;

    // Estimate workflow complexity
    const complexity = this.calculateWorkflowComplexity(workflow);

    // Get resource requirements (estimated based on workflow type and complexity)
    const resourceRequirements = this.estimateResourceRequirements(workflow, complexity);

    // Get dependencies
    const dependencies = await this.getWorkflowDependencies(workflowId);

    // Build features object
    const features: SchedulingFeatures = {
      workflowId,
      tenantId,
      workflowComplexity: complexity,
      historicalExecutionTime: avgExecutionTime,
      historicalSuccessRate: successRate,
      resourceRequirements,
      dependencies,
      priority: workflow.priority || 5,
      timeConstraints: {
        ...constraints,
        preferredHours: constraints?.preferredHours || [9, 10, 11, 14, 15, 16], // Business hours
        blackoutPeriods: constraints?.blackoutPeriods || []
      },
      contextualFactors: await this.getContextualFactors()
    };

    // Cache features
    this.featureCache.set(cacheKey, features);
    
    return features;
  }

  private calculateWorkflowComplexity(workflow: any): number {
    // Simulate complexity calculation based on workflow structure
    let complexity = 1;
    
    // Add complexity for each node (simulated)
    const nodeCount = Math.floor(Math.random() * 10) + 3; // 3-12 nodes
    complexity += nodeCount * 0.5;
    
    // Add complexity for conditions and loops
    const hasConditions = Math.random() > 0.7;
    const hasLoops = Math.random() > 0.8;
    
    if (hasConditions) complexity += 2;
    if (hasLoops) complexity += 3;
    
    // Add complexity for external integrations
    const externalIntegrations = Math.floor(Math.random() * 3);
    complexity += externalIntegrations * 1.5;
    
    return Math.min(10, complexity); // Cap at 10
  }

  private estimateResourceRequirements(workflow: any, complexity: number): SchedulingFeatures['resourceRequirements'] {
    return {
      cpu: Math.min(100, complexity * 10 + Math.random() * 20), // 0-100%
      memory: Math.min(2048, complexity * 100 + Math.random() * 200), // MB
      network: Math.min(100, complexity * 5 + Math.random() * 30) // 0-100%
    };
  }

  private async getWorkflowDependencies(workflowId: string): Promise<string[]> {
    // In production, this would analyze workflow dependencies
    // For now, simulate some dependencies
    const dependencyCount = Math.floor(Math.random() * 3);
    const dependencies: string[] = [];
    
    for (let i = 0; i < dependencyCount; i++) {
      dependencies.push(`dependency-${i + 1}`);
    }
    
    return dependencies;
  }

  private async getContextualFactors(): Promise<SchedulingFeatures['contextualFactors']> {
    const now = new Date();
    
    return {
      dayOfWeek: now.getDay(),
      hourOfDay: now.getHours(),
      systemLoad: await this.getCurrentSystemLoad(),
      seasonality: this.calculateSeasonality(now)
    };
  }

  private async getCurrentSystemLoad(): Promise<number> {
    // Get current system load (simulated)
    const activeExecutions = await this.prisma.workflowExecution.count({
      where: { status: 'running' }
    });
    
    return Math.min(100, activeExecutions * 10); // 0-100%
  }

  private calculateSeasonality(date: Date): number {
    const month = date.getMonth();
    const hour = date.getHours();
    
    // Business hours factor
    const businessHoursFactor = (hour >= 9 && hour <= 17) ? 1.2 : 0.8;
    
    // Monthly seasonality (higher in business months)
    const monthlyFactor = [0.8, 0.9, 1.0, 1.1, 1.2, 1.1, 0.9, 0.8, 1.0, 1.1, 1.2, 0.9][month];
    
    return businessHoursFactor * monthlyFactor;
  }

  private async generateMLPredictions(features: SchedulingFeatures): Promise<MLPrediction> {
    // Simulate ML predictions (in production, these would be real model inferences)
    
    // Execution time prediction
    const baseTime = features.historicalExecutionTime;
    const complexityFactor = 1 + (features.workflowComplexity - 5) * 0.1;
    const loadFactor = 1 + features.contextualFactors.systemLoad * 0.01;
    const predictedTime = baseTime * complexityFactor * loadFactor;
    
    // Success probability prediction
    const baseSuccess = features.historicalSuccessRate;
    const resourceFactor = Math.min(1, 100 / Math.max(features.resourceRequirements.cpu, 50));
    const timingFactor = features.contextualFactors.seasonality;
    const predictedSuccess = Math.min(0.99, baseSuccess * resourceFactor * timingFactor);
    
    // Resource usage prediction
    const cpuUsage = features.resourceRequirements.cpu * (1 + Math.random() * 0.2 - 0.1);
    const memoryUsage = features.resourceRequirements.memory * (1 + Math.random() * 0.2 - 0.1);
    const networkUsage = features.resourceRequirements.network * (1 + Math.random() * 0.2 - 0.1);
    
    // Optimal timing prediction
    const optimalHour = this.findOptimalHour(features);
    const recommendedStart = new Date();
    recommendedStart.setHours(optimalHour, 0, 0, 0);
    
    // If the optimal time is in the past, move to next day
    if (recommendedStart <= new Date()) {
      recommendedStart.setDate(recommendedStart.getDate() + 1);
    }

    return {
      executionTime: {
        predicted: Math.round(predictedTime),
        confidence: 0.85,
        range: {
          min: Math.round(predictedTime * 0.7),
          max: Math.round(predictedTime * 1.5)
        }
      },
      successProbability: {
        predicted: Math.round(predictedSuccess * 100) / 100,
        confidence: 0.92,
        factors: [
          { factor: 'Historical Success Rate', impact: baseSuccess },
          { factor: 'Resource Availability', impact: resourceFactor },
          { factor: 'Timing Factors', impact: timingFactor }
        ]
      },
      resourceUsage: {
        cpu: { predicted: Math.round(cpuUsage), confidence: 0.78 },
        memory: { predicted: Math.round(memoryUsage), confidence: 0.78 },
        network: { predicted: Math.round(networkUsage), confidence: 0.78 }
      },
      optimalTiming: {
        recommendedStart,
        confidence: 0.88,
        reasoning: [
          `Optimal execution hour: ${optimalHour}:00`,
          `System load factor: ${features.contextualFactors.systemLoad}%`,
          `Seasonality factor: ${features.contextualFactors.seasonality.toFixed(2)}`
        ]
      }
    };
  }

  private findOptimalHour(features: SchedulingFeatures): number {
    const preferredHours = features.timeConstraints.preferredHours || [9, 10, 11, 14, 15, 16];
    const currentHour = new Date().getHours();
    
    // Find the next preferred hour
    const nextPreferredHour = preferredHours.find(hour => hour > currentHour);
    
    if (nextPreferredHour) {
      return nextPreferredHour;
    }
    
    // If no preferred hour today, return first preferred hour of next day
    return preferredHours[0];
  }

  private async findOptimalTime(features: SchedulingFeatures, predictions: MLPrediction): Promise<MLPrediction['optimalTiming']> {
    const baseTime = predictions.optimalTiming.recommendedStart;
    
    // Check for blackout periods
    const blackoutPeriods = features.timeConstraints.blackoutPeriods || [];
    let optimalTime = new Date(baseTime);
    
    // Avoid blackout periods
    for (const blackout of blackoutPeriods) {
      if (optimalTime >= blackout.start && optimalTime <= blackout.end) {
        optimalTime = new Date(blackout.end.getTime() + 60 * 60 * 1000); // 1 hour after blackout
      }
    }
    
    // Respect earliest start time
    if (features.timeConstraints.earliestStart && optimalTime < features.timeConstraints.earliestStart) {
      optimalTime = new Date(features.timeConstraints.earliestStart);
    }
    
    // Respect latest end time
    if (features.timeConstraints.latestEnd) {
      const estimatedEndTime = new Date(optimalTime.getTime() + predictions.executionTime.predicted * 1000);
      if (estimatedEndTime > features.timeConstraints.latestEnd) {
        optimalTime = new Date(features.timeConstraints.latestEnd.getTime() - predictions.executionTime.predicted * 1000);
      }
    }

    return {
      recommendedStart: optimalTime,
      confidence: predictions.optimalTiming.confidence,
      reasoning: [
        ...predictions.optimalTiming.reasoning,
        `Adjusted for constraints and blackout periods`,
        `Estimated completion: ${new Date(optimalTime.getTime() + predictions.executionTime.predicted * 1000).toLocaleString()}`
      ]
    };
  }

  private async generateAlternatives(features: SchedulingFeatures, predictions: MLPrediction, optimalTime: MLPrediction['optimalTiming']): Promise<SmartScheduleResult['alternatives']> {
    const alternatives: SmartScheduleResult['alternatives'] = [];
    const baseTime = optimalTime.recommendedStart;
    
    // Generate 3 alternative times
    const offsets = [2, 4, 24]; // 2 hours, 4 hours, 24 hours later
    
    for (const offset of offsets) {
      const altTime = new Date(baseTime.getTime() + offset * 60 * 60 * 1000);
      const altConfidence = Math.max(0.5, optimalTime.confidence - offset * 0.05);
      
      const tradeoffs: string[] = [];
      if (offset <= 4) {
        tradeoffs.push('Slightly lower system performance expected');
      } else {
        tradeoffs.push('Delayed execution may impact dependent workflows');
        tradeoffs.push('Different system load patterns');
      }
      
      alternatives.push({
        time: altTime,
        confidence: Math.round(altConfidence * 100) / 100,
        tradeoffs
      });
    }
    
    return alternatives;
  }

  private async assessRisks(features: SchedulingFeatures, predictions: MLPrediction): Promise<SmartScheduleResult['riskFactors']> {
    const risks: SmartScheduleResult['riskFactors'] = [];
    
    // High complexity risk
    if (features.workflowComplexity > 7) {
      risks.push({
        factor: 'High Workflow Complexity',
        severity: 'medium',
        mitigation: 'Consider breaking down into smaller workflows or increase timeout limits'
      });
    }
    
    // Low success rate risk
    if (predictions.successProbability.predicted < 0.8) {
      risks.push({
        factor: 'Low Success Probability',
        severity: 'high',
        mitigation: 'Review workflow logic and add error handling before scheduling'
      });
    }
    
    // High resource usage risk
    if (predictions.resourceUsage.cpu.predicted > 80) {
      risks.push({
        factor: 'High CPU Usage Expected',
        severity: 'medium',
        mitigation: 'Schedule during low-traffic periods or provision additional resources'
      });
    }
    
    // System load risk
    if (features.contextualFactors.systemLoad > 70) {
      risks.push({
        factor: 'High Current System Load',
        severity: 'medium',
        mitigation: 'Consider delaying execution until system load decreases'
      });
    }
    
    // Dependency risk
    if (features.dependencies.length > 2) {
      risks.push({
        factor: 'Multiple Dependencies',
        severity: 'low',
        mitigation: 'Ensure all dependent services are available at scheduled time'
      });
    }
    
    return risks;
  }

  private buildReasoning(features: SchedulingFeatures, predictions: MLPrediction, optimalTime: MLPrediction['optimalTiming']): string[] {
    const reasoning: string[] = [];
    
    reasoning.push(`Workflow complexity: ${features.workflowComplexity}/10`);
    reasoning.push(`Historical success rate: ${(features.historicalSuccessRate * 100).toFixed(1)}%`);
    reasoning.push(`Predicted execution time: ${predictions.executionTime.predicted} seconds`);
    reasoning.push(`Success probability: ${(predictions.successProbability.predicted * 100).toFixed(1)}%`);
    reasoning.push(`Scheduled for: ${optimalTime.recommendedStart.toLocaleString()}`);
    reasoning.push(`Confidence level: ${(optimalTime.confidence * 100).toFixed(1)}%`);
    
    if (features.contextualFactors.systemLoad > 50) {
      reasoning.push(`High system load (${features.contextualFactors.systemLoad}%) considered in timing`);
    }
    
    if (features.timeConstraints.preferredHours) {
      reasoning.push(`Scheduled within preferred hours: ${features.timeConstraints.preferredHours.join(', ')}`);
    }
    
    return reasoning;
  }

  private async cacheSchedulingResult(workflowId: string, tenantId: string, result: SmartScheduleResult): Promise<void> {
    // In production, this would cache the result in Redis or database
    console.log(`Caching scheduling result for workflow ${workflowId}`);
  }

  private async loadTrainingData(): Promise<void> {
    // Load historical execution data for model training
    try {
      const executions = await this.prisma.workflowExecution.findMany({
        take: 1000,
        orderBy: { startTime: 'desc' },
        include: { workflow: true }
      });

      // Group by tenant for training data
      const trainingDataByTenant = new Map<string, any[]>();
      
      executions.forEach(execution => {
        const tenantData = trainingDataByTenant.get(execution.tenantId) || [];
        tenantData.push({
          workflowId: execution.workflowId,
          executionTime: execution.endTime ? 
            (new Date(execution.endTime).getTime() - new Date(execution.startTime).getTime()) / 1000 : null,
          success: execution.status === 'completed',
          startHour: new Date(execution.startTime).getHours(),
          dayOfWeek: new Date(execution.startTime).getDay(),
          // Add more features as needed
        });
        trainingDataByTenant.set(execution.tenantId, tenantData);
      });

      this.trainingData = trainingDataByTenant;

    } catch (error) {
      console.error('Error loading training data:', error);
    }
  }

  // Public API methods
  async retrainModels(tenantId?: string): Promise<void> {
    console.log(`Retraining ML models${tenantId ? ` for tenant ${tenantId}` : ' globally'}`);
    
    // In production, this would trigger actual model retraining
    const models = Array.from(this.models.values());
    for (const model of models) {
      model.lastTrained = new Date();
      model.accuracy = Math.min(0.99, model.accuracy + Math.random() * 0.05);
    }
    
    this.emit('models_retrained', { tenantId, timestamp: new Date() });
  }

  async getModelMetrics(): Promise<Array<MLModel & { dataPoints: number }>> {
    return Array.from(this.models.values()).map(model => ({
      ...model,
      dataPoints: Array.from(this.trainingData.values()).reduce((sum, data) => sum + data.length, 0)
    }));
  }

  async batchSchedule(requests: Array<{ workflowId: string; tenantId: string; constraints?: any }>): Promise<SmartScheduleResult[]> {
    const results: SmartScheduleResult[] = [];
    
    for (const request of requests) {
      try {
        const result = await this.scheduleWithML(request.workflowId, request.tenantId, request.constraints);
        results.push(result);
      } catch (error) {
        console.error(`Error scheduling workflow ${request.workflowId}:`, error);
        // Continue with other workflows
      }
    }
    
    return results;
  }

  async cleanup(): Promise<void> {
    this.models.clear();
    this.trainingData.clear();
    this.featureCache.clear();
    await this.prisma.$disconnect();
  }
}
