import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

export interface ChainStep {
  id: string;
  workflowId: string;
  order: number;
  condition?: ChainCondition;
  parameters?: any;
  onSuccess?: ChainAction[];
  onFailure?: ChainAction[];
  timeout?: number;
  retries?: number;
}

export interface ChainCondition {
  type: 'always' | 'success' | 'failure' | 'custom';
  expression?: string;
  variables?: string[];
}

export interface ChainAction {
  type: 'continue' | 'skip' | 'stop' | 'branch' | 'retry' | 'rollback';
  parameters?: any;
}

export interface WorkflowChain {
  id: string;
  name: string;
  description?: string;
  steps: ChainStep[];
  variables: Map<string, any>;
  rollbackSteps?: ChainStep[];
  isActive: boolean;
  metadata?: any;
}

export interface ChainExecution {
  id: string;
  chainId: string;
  userId: string;
  tenantId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  currentStep: number;
  completedSteps: string[];
  failedSteps: string[];
  variables: Map<string, any>;
  results: Map<string, any>;
  startTime: Date;
  endTime?: Date;
  error?: string;
}

export class WorkflowChain extends EventEmitter {
  private prisma: PrismaClient;
  private chains: Map<string, WorkflowChain> = new Map();
  private executions: Map<string, ChainExecution> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.loadChains();
  }

  // Create workflow chain
  async createChain(
    tenantId: string,
    chainData: Omit<WorkflowChain, 'id'>
  ): Promise<string> {
    try {
      // Validate chain structure
      this.validateChain(chainData);

      const chain = await this.prisma.workflowChain.create({
        data: {
          tenantId,
          name: chainData.name,
          description: chainData.description,
          steps: chainData.steps,
          variables: Object.fromEntries(chainData.variables),
          rollbackSteps: chainData.rollbackSteps,
          isActive: chainData.isActive,
          metadata: chainData.metadata
        }
      });

      // Cache chain
      this.chains.set(chain.id, {
        id: chain.id,
        name: chain.name,
        description: chain.description,
        steps: chain.steps as ChainStep[],
        variables: new Map(Object.entries(chain.variables as any || {})),
        rollbackSteps: chain.rollbackSteps as ChainStep[],
        isActive: chain.isActive,
        metadata: chain.metadata
      });

      this.emit('chain:created', {
        chainId: chain.id,
        tenantId,
        name: chainData.name
      });

      return chain.id;

    } catch (error) {
      console.error('Error creating workflow chain:', error);
      throw error;
    }
  }

  // Execute workflow chain
  async executeChain(
    chainId: string,
    userId: string,
    tenantId: string,
    initialVariables?: Map<string, any>
  ): Promise<string> {
    try {
      const chain = await this.getChain(chainId, tenantId);
      if (!chain || !chain.isActive) {
        throw new Error('Chain not found or inactive');
      }

      // Create execution record
      const execution: ChainExecution = {
        id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        chainId,
        userId,
        tenantId,
        status: 'running',
        currentStep: 0,
        completedSteps: [],
        failedSteps: [],
        variables: new Map([...chain.variables, ...(initialVariables || new Map())]),
        results: new Map(),
        startTime: new Date()
      };

      // Save execution to database
      await this.prisma.chainExecution.create({
        data: {
          id: execution.id,
          chainId,
          userId,
          tenantId,
          status: execution.status,
          currentStep: execution.currentStep,
          completedSteps: execution.completedSteps,
          failedSteps: execution.failedSteps,
          variables: Object.fromEntries(execution.variables),
          results: Object.fromEntries(execution.results),
          startTime: execution.startTime
        }
      });

      // Cache execution
      this.executions.set(execution.id, execution);

      this.emit('chain:started', {
        executionId: execution.id,
        chainId,
        userId,
        tenantId
      });

      // Start execution
      this.processChainExecution(execution.id);

      return execution.id;

    } catch (error) {
      console.error('Error executing workflow chain:', error);
      throw error;
    }
  }

  // Get chain execution status
  async getExecutionStatus(executionId: string): Promise<ChainExecution | null> {
    // Check cache first
    const cached = this.executions.get(executionId);
    if (cached) {
      return cached;
    }

    // Load from database
    const execution = await this.prisma.chainExecution.findUnique({
      where: { id: executionId }
    });

    if (!execution) {
      return null;
    }

    const chainExecution: ChainExecution = {
      id: execution.id,
      chainId: execution.chainId,
      userId: execution.userId,
      tenantId: execution.tenantId,
      status: execution.status as any,
      currentStep: execution.currentStep,
      completedSteps: execution.completedSteps,
      failedSteps: execution.failedSteps,
      variables: new Map(Object.entries(execution.variables as any || {})),
      results: new Map(Object.entries(execution.results as any || {})),
      startTime: execution.startTime,
      endTime: execution.endTime,
      error: execution.error
    };

    this.executions.set(executionId, chainExecution);
    return chainExecution;
  }

  // Cancel chain execution
  async cancelExecution(executionId: string, tenantId: string): Promise<boolean> {
    const execution = await this.getExecutionStatus(executionId);
    if (!execution || execution.tenantId !== tenantId) {
      return false;
    }

    if (execution.status !== 'running' && execution.status !== 'paused') {
      return false;
    }

    execution.status = 'cancelled';
    execution.endTime = new Date();

    await this.updateExecution(execution);

    this.emit('chain:cancelled', {
      executionId,
      chainId: execution.chainId,
      tenantId
    });

    return true;
  }

  // Pause chain execution
  async pauseExecution(executionId: string, tenantId: string): Promise<boolean> {
    const execution = await this.getExecutionStatus(executionId);
    if (!execution || execution.tenantId !== tenantId || execution.status !== 'running') {
      return false;
    }

    execution.status = 'paused';
    await this.updateExecution(execution);

    this.emit('chain:paused', {
      executionId,
      chainId: execution.chainId,
      tenantId
    });

    return true;
  }

  // Resume chain execution
  async resumeExecution(executionId: string, tenantId: string): Promise<boolean> {
    const execution = await this.getExecutionStatus(executionId);
    if (!execution || execution.tenantId !== tenantId || execution.status !== 'paused') {
      return false;
    }

    execution.status = 'running';
    await this.updateExecution(execution);

    this.emit('chain:resumed', {
      executionId,
      chainId: execution.chainId,
      tenantId
    });

    // Continue processing
    this.processChainExecution(executionId);

    return true;
  }

  // Add step result to chain execution
  async addStepResult(
    executionId: string,
    stepId: string,
    result: any,
    success: boolean
  ): Promise<void> {
    const execution = await this.getExecutionStatus(executionId);
    if (!execution) {
      return;
    }

    execution.results.set(stepId, result);

    if (success) {
      if (!execution.completedSteps.includes(stepId)) {
        execution.completedSteps.push(stepId);
      }
    } else {
      if (!execution.failedSteps.includes(stepId)) {
        execution.failedSteps.push(stepId);
      }
    }

    await this.updateExecution(execution);

    this.emit('step:completed', {
      executionId,
      stepId,
      success,
      result
    });
  }

  // Private methods
  private async processChainExecution(executionId: string): Promise<void> {
    try {
      const execution = await this.getExecutionStatus(executionId);
      if (!execution || execution.status !== 'running') {
        return;
      }

      const chain = await this.getChain(execution.chainId, execution.tenantId);
      if (!chain) {
        throw new Error('Chain not found');
      }

      // Process steps sequentially
      while (execution.currentStep < chain.steps.length && execution.status === 'running') {
        const step = chain.steps[execution.currentStep];
        
        // Check step condition
        if (step.condition && !this.evaluateStepCondition(step.condition, execution)) {
          execution.currentStep++;
          continue;
        }

        // Execute step
        const stepResult = await this.executeStep(step, execution);
        
        if (stepResult.success) {
          // Handle success actions
          if (step.onSuccess) {
            const action = await this.processStepActions(step.onSuccess, execution);
            if (action === 'stop') break;
            if (action === 'skip') {
              execution.currentStep++;
              continue;
            }
          }
          execution.currentStep++;
        } else {
          // Handle failure actions
          if (step.onFailure) {
            const action = await this.processStepActions(step.onFailure, execution);
            if (action === 'stop') {
              execution.status = 'failed';
              execution.error = stepResult.error;
              break;
            }
            if (action === 'retry') {
              continue; // Retry current step
            }
            if (action === 'rollback') {
              await this.executeRollback(execution);
              execution.status = 'failed';
              break;
            }
          } else {
            execution.status = 'failed';
            execution.error = stepResult.error;
            break;
          }
        }

        await this.updateExecution(execution);
      }

      // Complete execution if all steps processed
      if (execution.currentStep >= chain.steps.length && execution.status === 'running') {
        execution.status = 'completed';
        execution.endTime = new Date();
      }

      await this.updateExecution(execution);

      this.emit('chain:completed', {
        executionId,
        chainId: execution.chainId,
        status: execution.status,
        tenantId: execution.tenantId
      });

    } catch (error) {
      console.error('Error processing chain execution:', error);
      
      const execution = await this.getExecutionStatus(executionId);
      if (execution) {
        execution.status = 'failed';
        execution.error = error.message;
        execution.endTime = new Date();
        await this.updateExecution(execution);
      }
    }
  }

  private async executeStep(step: ChainStep, execution: ChainExecution): Promise<{ success: boolean; error?: string }> {
    try {
      // Emit event for step execution
      this.emit('step:execute', {
        executionId: execution.id,
        stepId: step.id,
        workflowId: step.workflowId,
        parameters: step.parameters
      });

      // Mock step execution - replace with actual workflow execution
      // This would integrate with the workflow executor
      const success = Math.random() > 0.1; // 90% success rate for demo
      
      if (success) {
        const result = { stepId: step.id, executedAt: new Date() };
        await this.addStepResult(execution.id, step.id, result, true);
        return { success: true };
      } else {
        const error = 'Step execution failed';
        await this.addStepResult(execution.id, step.id, { error }, false);
        return { success: false, error };
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.addStepResult(execution.id, step.id, { error: errorMessage }, false);
      return { success: false, error: errorMessage };
    }
  }

  private evaluateStepCondition(condition: ChainCondition, execution: ChainExecution): boolean {
    switch (condition.type) {
      case 'always':
        return true;
      
      case 'success':
        return execution.failedSteps.length === 0;
      
      case 'failure':
        return execution.failedSteps.length > 0;
      
      case 'custom':
        // Evaluate custom expression
        return this.evaluateCustomCondition(condition.expression || '', execution);
      
      default:
        return true;
    }
  }

  private evaluateCustomCondition(expression: string, execution: ChainExecution): boolean {
    try {
      // Simple expression evaluation - can be enhanced with a proper expression parser
      const context = {
        variables: Object.fromEntries(execution.variables),
        results: Object.fromEntries(execution.results),
        completedSteps: execution.completedSteps,
        failedSteps: execution.failedSteps
      };

      // Replace variables in expression
      let processedExpression = expression;
      for (const [key, value] of execution.variables) {
        processedExpression = processedExpression.replace(
          new RegExp(`\\$${key}\\b`, 'g'),
          JSON.stringify(value)
        );
      }

      // Evaluate expression (use a safe evaluation method in production)
      return Boolean(eval(processedExpression));

    } catch (error) {
      console.error('Error evaluating custom condition:', error);
      return false;
    }
  }

  private async processStepActions(actions: ChainAction[], execution: ChainExecution): Promise<string> {
    for (const action of actions) {
      switch (action.type) {
        case 'continue':
          return 'continue';
        
        case 'skip':
          return 'skip';
        
        case 'stop':
          return 'stop';
        
        case 'retry':
          return 'retry';
        
        case 'rollback':
          return 'rollback';
        
        case 'branch':
          // Handle branching logic
          if (action.parameters?.condition) {
            const shouldBranch = this.evaluateCustomCondition(action.parameters.condition, execution);
            if (shouldBranch && action.parameters.targetStep) {
              execution.currentStep = action.parameters.targetStep;
            }
          }
          break;
      }
    }

    return 'continue';
  }

  private async executeRollback(execution: ChainExecution): Promise<void> {
    const chain = await this.getChain(execution.chainId, execution.tenantId);
    if (!chain || !chain.rollbackSteps) {
      return;
    }

    this.emit('chain:rollback:started', {
      executionId: execution.id,
      chainId: execution.chainId
    });

    // Execute rollback steps in reverse order
    for (let i = chain.rollbackSteps.length - 1; i >= 0; i--) {
      const rollbackStep = chain.rollbackSteps[i];
      
      try {
        await this.executeStep(rollbackStep, execution);
      } catch (error) {
        console.error('Error in rollback step:', error);
        // Continue with other rollback steps even if one fails
      }
    }

    this.emit('chain:rollback:completed', {
      executionId: execution.id,
      chainId: execution.chainId
    });
  }

  private validateChain(chain: Omit<WorkflowChain, 'id'>): void {
    if (!chain.steps || chain.steps.length === 0) {
      throw new Error('Chain must have at least one step');
    }

    // Validate step order
    const orders = chain.steps.map(s => s.order).sort((a, b) => a - b);
    for (let i = 0; i < orders.length; i++) {
      if (orders[i] !== i) {
        throw new Error('Step orders must be sequential starting from 0');
      }
    }

    // Validate step references
    for (const step of chain.steps) {
      if (!step.workflowId) {
        throw new Error('Each step must reference a workflow');
      }
    }
  }

  private async getChain(chainId: string, tenantId: string): Promise<WorkflowChain | null> {
    // Check cache first
    const cached = this.chains.get(chainId);
    if (cached) {
      return cached;
    }

    // Load from database
    const chain = await this.prisma.workflowChain.findFirst({
      where: { id: chainId, tenantId }
    });

    if (!chain) {
      return null;
    }

    const workflowChain: WorkflowChain = {
      id: chain.id,
      name: chain.name,
      description: chain.description,
      steps: chain.steps as ChainStep[],
      variables: new Map(Object.entries(chain.variables as any || {})),
      rollbackSteps: chain.rollbackSteps as ChainStep[],
      isActive: chain.isActive,
      metadata: chain.metadata
    };

    this.chains.set(chainId, workflowChain);
    return workflowChain;
  }

  private async updateExecution(execution: ChainExecution): Promise<void> {
    await this.prisma.chainExecution.update({
      where: { id: execution.id },
      data: {
        status: execution.status,
        currentStep: execution.currentStep,
        completedSteps: execution.completedSteps,
        failedSteps: execution.failedSteps,
        variables: Object.fromEntries(execution.variables),
        results: Object.fromEntries(execution.results),
        endTime: execution.endTime,
        error: execution.error
      }
    });

    // Update cache
    this.executions.set(execution.id, execution);
  }

  private async loadChains(): Promise<void> {
    try {
      const chains = await this.prisma.workflowChain.findMany({
        where: { isActive: true }
      });

      for (const chain of chains) {
        this.chains.set(chain.id, {
          id: chain.id,
          name: chain.name,
          description: chain.description,
          steps: chain.steps as ChainStep[],
          variables: new Map(Object.entries(chain.variables as any || {})),
          rollbackSteps: chain.rollbackSteps as ChainStep[],
          isActive: chain.isActive,
          metadata: chain.metadata
        });
      }
    } catch (error) {
      console.error('Error loading workflow chains:', error);
    }
  }
}
