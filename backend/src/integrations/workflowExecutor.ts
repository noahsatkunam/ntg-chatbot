import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { WorkflowService } from '../workflows/workflowService';
import { ContextManager } from './contextManager';
import { ResponseHandler } from './responseHandler';
import { ChatTriggerContext, TriggerMatch } from './chatTriggerService';

export interface ExecutionRequest {
  workflowId: string;
  triggerMatch: TriggerMatch;
  chatContext: ChatTriggerContext;
  parameters?: any;
  userConfirmed?: boolean;
}

export interface ExecutionResult {
  executionId: string;
  workflowId: string;
  status: 'started' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: any;
  error?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  chatResponse?: any;
}

export interface ExecutionPermissions {
  canExecute: boolean;
  reason?: string;
  requiresApproval?: boolean;
  approvalRequired?: string[];
}

export class WorkflowExecutor extends EventEmitter {
  private prisma: PrismaClient;
  private workflowService: WorkflowService;
  private contextManager: ContextManager;
  private responseHandler: ResponseHandler;
  private activeExecutions: Map<string, ExecutionResult> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.workflowService = new WorkflowService();
    this.contextManager = new ContextManager();
    this.responseHandler = new ResponseHandler();

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen to workflow service events
    this.workflowService.on('execution:started', (execution) => {
      this.handleExecutionStarted(execution);
    });

    this.workflowService.on('execution:completed', (execution) => {
      this.handleExecutionCompleted(execution);
    });

    this.workflowService.on('execution:failed', (execution) => {
      this.handleExecutionFailed(execution);
    });

    this.workflowService.on('execution:progress', (execution) => {
      this.handleExecutionProgress(execution);
    });
  }

  // Main method to execute workflow from chat trigger
  async executeWorkflow(request: ExecutionRequest): Promise<ExecutionResult> {
    try {
      // Validate execution permissions
      const permissions = await this.checkExecutionPermissions(request);
      if (!permissions.canExecute) {
        throw new Error(permissions.reason || 'Execution not permitted');
      }

      // Check if confirmation is required and not provided
      if (request.triggerMatch.requiresConfirmation && !request.userConfirmed) {
        return await this.requestUserConfirmation(request);
      }

      // Prepare execution context
      const executionContext = await this.prepareExecutionContext(request);

      // Start workflow execution
      const executionId = await this.workflowService.executeWorkflow(
        request.workflowId,
        executionContext
      );

      // Create execution result
      const executionResult: ExecutionResult = {
        executionId,
        workflowId: request.workflowId,
        status: 'started',
        startTime: new Date()
      };

      // Store in active executions
      this.activeExecutions.set(executionId, executionResult);

      // Emit execution started event
      this.emit('execution:started', {
        executionId,
        workflowId: request.workflowId,
        chatContext: request.chatContext,
        triggerMatch: request.triggerMatch
      });

      return executionResult;

    } catch (error) {
      console.error('Workflow execution error:', error);
      
      const errorResult: ExecutionResult = {
        executionId: `error_${Date.now()}`,
        workflowId: request.workflowId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        startTime: new Date(),
        endTime: new Date()
      };

      this.emit('execution:failed', {
        executionResult: errorResult,
        chatContext: request.chatContext,
        error
      });

      return errorResult;
    }
  }

  // Check if user has permission to execute workflow
  private async checkExecutionPermissions(request: ExecutionRequest): Promise<ExecutionPermissions> {
    try {
      const { workflowId, chatContext } = request;
      const { userId, tenantId } = chatContext;

      // Check if workflow exists and is active
      const workflow = await this.prisma.workflow.findFirst({
        where: {
          id: workflowId,
          tenantId,
          status: 'active'
        }
      });

      if (!workflow) {
        return {
          canExecute: false,
          reason: 'Workflow not found or inactive'
        };
      }

      // Check user permissions
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true }
      });

      if (!user) {
        return {
          canExecute: false,
          reason: 'User not found'
        };
      }

      // Check workflow-specific permissions
      let workflowPermission = await this.prisma.workflowPermission.findFirst({
        where: {
          workflowId,
          tenantId,
          userId
        }
      });

      if (!workflowPermission) {
        workflowPermission = await this.prisma.workflowPermission.findFirst({
          where: {
            workflowId,
            tenantId,
            role: user.role
          }
        });
      }

      if (workflowPermission) {
        if (!workflowPermission.canExecute) {
          return {
            canExecute: false,
            reason: 'No execute permission for this workflow'
          };
        }
      } else {
        const rolePermissions = await this.getRolePermissions(user.role, tenantId);
        if (!rolePermissions.canExecute) {
          return {
            canExecute: false,
            reason: 'Insufficient permissions to execute workflows'
          };
        }
      }

      // Check execution limits
      const executionLimits = await this.checkExecutionLimits(userId, tenantId);
      if (!executionLimits.allowed) {
        return {
          canExecute: false,
          reason: executionLimits.reason
        };
      }

      // Check if approval is required
      const requiresApproval = await this.checkApprovalRequirement(workflow, user.role);
      if (requiresApproval.required) {
        return {
          canExecute: false,
          reason: 'Approval required',
          requiresApproval: true,
          approvalRequired: requiresApproval.approvers
        };
      }

      return { canExecute: true };

    } catch (error) {
      console.error('Error checking execution permissions:', error);
      return {
        canExecute: false,
        reason: 'Permission check failed'
      };
    }
  }

  // Prepare execution context with chat data
  private async prepareExecutionContext(request: ExecutionRequest): Promise<any> {
    const { chatContext, triggerMatch, parameters } = request;

    // Get conversation context
    const conversationContext = await this.contextManager.getConversationContext(
      chatContext.conversationId
    );

    // Get user context
    const userContext = await this.contextManager.getUserContext(
      chatContext.userId,
      chatContext.tenantId
    );

    // Prepare workflow input data
    const inputData = {
      // Chat context
      message: {
        id: chatContext.messageId,
        content: chatContext.messageContent,
        timestamp: chatContext.timestamp,
        metadata: chatContext.metadata
      },
      conversation: {
        id: chatContext.conversationId,
        context: conversationContext
      },
      user: {
        id: chatContext.userId,
        context: userContext
      },
      trigger: {
        type: triggerMatch.triggerType,
        matchedText: triggerMatch.matchedText,
        confidence: triggerMatch.confidence,
        parameters: triggerMatch.parameters
      },
      // Additional parameters
      parameters: parameters || {},
      // System context
      system: {
        tenantId: chatContext.tenantId,
        timestamp: new Date().toISOString(),
        source: 'chat_integration'
      }
    };

    return {
      tenantId: chatContext.tenantId,
      userId: chatContext.userId,
      triggerData: inputData,
      metadata: {
        triggerType: 'chat_message',
        conversationId: chatContext.conversationId,
        messageId: chatContext.messageId,
        source: 'chat_integration'
      }
    };
  }

  // Request user confirmation for workflow execution
  private async requestUserConfirmation(request: ExecutionRequest): Promise<ExecutionResult> {
    const confirmationId = `confirm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store pending confirmation
    await this.storePendingConfirmation(confirmationId, request);

    // Generate confirmation response
    const confirmationResponse = await this.responseHandler.generateConfirmationRequest(
      request.triggerMatch,
      request.chatContext,
      confirmationId
    );

    const result: ExecutionResult = {
      executionId: confirmationId,
      workflowId: request.workflowId,
      status: 'started',
      startTime: new Date(),
      chatResponse: confirmationResponse
    };

    this.emit('confirmation:requested', {
      confirmationId,
      request,
      response: confirmationResponse
    });

    return result;
  }

  // Handle user confirmation response
  async handleUserConfirmation(
    confirmationId: string,
    confirmed: boolean,
    chatContext: ChatTriggerContext
  ): Promise<ExecutionResult> {
    try {
      const pendingRequest = await this.getPendingConfirmation(
        confirmationId,
        chatContext.tenantId,
        chatContext.userId
      );
      if (!pendingRequest) {
        throw new Error('Confirmation request not found or expired');
      }

      // Remove pending confirmation
      await this.removePendingConfirmation(
        confirmationId,
        chatContext.tenantId,
        chatContext.userId
      );

      if (!confirmed) {
        const cancelledResult: ExecutionResult = {
          executionId: confirmationId,
          workflowId: pendingRequest.workflowId,
          status: 'cancelled',
          startTime: new Date(),
          endTime: new Date(),
          chatResponse: await this.responseHandler.generateCancellationResponse(
            pendingRequest.triggerMatch,
            chatContext
          )
        };

        this.emit('execution:cancelled', {
          executionResult: cancelledResult,
          chatContext
        });

        return cancelledResult;
      }

      // Execute the workflow with confirmation
      const confirmedRequest = {
        ...pendingRequest,
        userConfirmed: true,
        chatContext // Use updated chat context
      };

      return await this.executeWorkflow(confirmedRequest);

    } catch (error) {
      console.error('Error handling user confirmation:', error);
      throw error;
    }
  }

  // Cancel running execution
  async cancelExecution(
    executionId: string,
    userId: string,
    tenantId: string
  ): Promise<boolean> {
    try {
      const executionRecord = await this.prisma.workflowExecution.findFirst({
        where: {
          id: executionId,
          tenantId
        },
        select: {
          workflowId: true,
          triggeredBy: true
        }
      });

      if (!executionRecord) {
        return false;
      }

      if (executionRecord.triggeredBy && executionRecord.triggeredBy !== userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { role: true }
        });

        const permissions = await this.getRolePermissions(user?.role || 'user', tenantId);
        if (!permissions.canCancel) {
          return false;
        }
      }

      await this.workflowService.cancelExecution(executionId, tenantId);

      const execution = this.activeExecutions.get(executionId);
      if (execution) {
        execution.status = 'cancelled';
        execution.endTime = new Date();
        execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
      }

      this.emit('execution:cancelled', {
        executionId,
        userId,
        tenantId
      });

      return true;

    } catch (error) {
      console.error('Error cancelling execution:', error);
      return false;
    }
  }

  async retryExecution(
    executionId: string,
    userId: string,
    tenantId: string
  ): Promise<ExecutionResult | null> {
    try {
      const executionRecord = await this.prisma.workflowExecution.findFirst({
        where: {
          id: executionId,
          tenantId
        },
        select: {
          workflowId: true,
          triggeredBy: true
        }
      });

      if (!executionRecord) {
        return null;
      }

      if (executionRecord.triggeredBy && executionRecord.triggeredBy !== userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { role: true }
        });

        const permissions = await this.getRolePermissions(user?.role || 'user', tenantId);
        if (!permissions.canExecute) {
          return null;
        }
      }

      const newExecutionId = await this.workflowService.retryExecution(executionId, tenantId);

      const executionResult: ExecutionResult = {
        executionId: newExecutionId,
        workflowId: executionRecord.workflowId,
        status: 'started',
        startTime: new Date()
      };

      this.activeExecutions.set(newExecutionId, executionResult);

      this.emit('execution:started', {
        executionId: newExecutionId,
        workflowId: executionRecord.workflowId,
        retryOf: executionId
      });

      return executionResult;

    } catch (error) {
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (
          message.includes('not found') ||
          message.includes('cannot be retried') ||
          message.includes('only failed executions')
        ) {
          return null;
        }
      }

      console.error('Error retrying execution:', error);
      throw error;
    }
  }

  // Get execution status
  getExecutionStatus(executionId: string): ExecutionResult | null {
    return this.activeExecutions.get(executionId) || null;
  }

  // Get active executions for user/tenant
  getActiveExecutions(tenantId: string, userId?: string): ExecutionResult[] {
    const executions = Array.from(this.activeExecutions.values());
    return executions.filter(exec => {
      // Filter by tenant and optionally by user
      return exec.status === 'running' || exec.status === 'started';
    });
  }

  // Event handlers
  private async handleExecutionStarted(execution: any): Promise<void> {
    const executionResult = this.activeExecutions.get(execution.id);
    if (executionResult) {
      executionResult.status = 'running';
      
      this.emit('execution:progress', {
        executionId: execution.id,
        status: 'running',
        progress: 0
      });
    }
  }

  private async handleExecutionCompleted(execution: any): Promise<void> {
    const executionResult = this.activeExecutions.get(execution.id);
    if (executionResult) {
      executionResult.status = 'completed';
      executionResult.result = execution.resultData;
      executionResult.endTime = new Date();
      executionResult.duration = executionResult.endTime.getTime() - executionResult.startTime.getTime();

      // Generate chat response
      if (execution.metadata?.source === 'chat_integration') {
        const chatResponse = await this.responseHandler.generateSuccessResponse(
          execution,
          executionResult
        );
        executionResult.chatResponse = chatResponse;
      }

      this.emit('execution:completed', {
        executionResult,
        execution
      });

      // Clean up after some time
      setTimeout(() => {
        this.activeExecutions.delete(execution.id);
      }, 5 * 60 * 1000); // 5 minutes
    }
  }

  private async handleExecutionFailed(execution: any): Promise<void> {
    const executionResult = this.activeExecutions.get(execution.id);
    if (executionResult) {
      executionResult.status = 'failed';
      executionResult.error = execution.error;
      executionResult.endTime = new Date();
      executionResult.duration = executionResult.endTime.getTime() - executionResult.startTime.getTime();

      // Generate error response
      if (execution.metadata?.source === 'chat_integration') {
        const errorResponse = await this.responseHandler.generateErrorResponse(
          execution,
          executionResult
        );
        executionResult.chatResponse = errorResponse;
      }

      this.emit('execution:failed', {
        executionResult,
        execution
      });

      // Clean up after some time
      setTimeout(() => {
        this.activeExecutions.delete(execution.id);
      }, 5 * 60 * 1000); // 5 minutes
    }
  }

  private async handleExecutionProgress(execution: any): Promise<void> {
    this.emit('execution:progress', {
      executionId: execution.id,
      status: 'running',
      progress: execution.progress || 0,
      currentStep: execution.currentStep
    });
  }

  // Helper methods
  private async getRolePermissions(role: string, tenantId: string): Promise<any> {
    // Default role permissions - in production, this would come from database
    const defaultPermissions = {
      admin: { canExecute: true, canCancel: true, canView: true },
      editor: { canExecute: true, canCancel: false, canView: true },
      viewer: { canExecute: false, canCancel: false, canView: true },
      user: { canExecute: false, canCancel: false, canView: false }
    };

    return defaultPermissions[role as keyof typeof defaultPermissions] || defaultPermissions.user;
  }

  private async checkExecutionLimits(userId: string, tenantId: string): Promise<any> {
    // Check concurrent execution limits
    const activeCount = Array.from(this.activeExecutions.values())
      .filter(exec => exec.status === 'running' || exec.status === 'started').length;

    const maxConcurrent = 10; // Default limit
    if (activeCount >= maxConcurrent) {
      return {
        allowed: false,
        reason: `Maximum concurrent executions (${maxConcurrent}) reached`
      };
    }

    // Check daily execution limits
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayExecutions = await this.prisma.workflowExecution.count({
      where: {
        tenantId,
        triggeredBy: userId,
        startTime: { gte: today }
      }
    });

    const dailyLimit = 100; // Default limit
    if (todayExecutions >= dailyLimit) {
      return {
        allowed: false,
        reason: `Daily execution limit (${dailyLimit}) reached`
      };
    }

    return { allowed: true };
  }

  private async checkApprovalRequirement(workflow: any, userRole: string): Promise<any> {
    // Check if workflow requires approval based on risk level or user role
    const requiresApproval = workflow.riskLevel === 'high' && userRole !== 'admin';
    
    if (requiresApproval) {
      return {
        required: true,
        approvers: ['admin'] // In production, this would be more sophisticated
      };
    }

    return { required: false };
  }

  private async storePendingConfirmation(confirmationId: string, request: ExecutionRequest): Promise<void> {
    // Store in database or cache with expiration
    await this.prisma.workflowConfirmation.create({
      data: {
        id: confirmationId,
        workflowId: request.workflowId,
        userId: request.chatContext.userId,
        tenantId: request.chatContext.tenantId,
        requestData: request as any,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
      }
    });
  }

  private async getPendingConfirmation(
    confirmationId: string,
    tenantId: string,
    userId: string
  ): Promise<ExecutionRequest | null> {
    const confirmation = await this.prisma.workflowConfirmation.findFirst({
      where: {
        id: confirmationId,
        tenantId,
        userId
      }
    });

    if (!confirmation || confirmation.expiresAt < new Date()) {
      return null;
    }

    return confirmation.requestData as any;
  }

  private async removePendingConfirmation(
    confirmationId: string,
    tenantId: string,
    userId: string
  ): Promise<void> {
    await this.prisma.workflowConfirmation.deleteMany({
      where: {
        id: confirmationId,
        tenantId,
        userId
      }
    }).catch(() => {
      // Ignore errors if already deleted
    });
  }
}
