import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

export interface ConversationContext {
  conversationId: string;
  tenantId: string;
  participants: string[];
  messageHistory: MessageContext[];
  metadata: any;
  variables: Map<string, any>;
  lastActivity: Date;
  workflowState?: any;
}

export interface MessageContext {
  messageId: string;
  content: string;
  userId: string;
  timestamp: Date;
  messageType: 'user' | 'bot' | 'system';
  metadata?: any;
  entities?: any[];
  intent?: string;
}

export interface UserContext {
  userId: string;
  tenantId: string;
  profile: any;
  preferences: any;
  permissions: any;
  activeWorkflows: string[];
  variables: Map<string, any>;
  lastActivity: Date;
}

export interface WorkflowContext {
  workflowId: string;
  executionId?: string;
  state: 'idle' | 'waiting_input' | 'running' | 'completed' | 'failed';
  currentStep?: string;
  variables: Map<string, any>;
  inputRequests: InputRequest[];
  approvalRequests: ApprovalRequest[];
  lastUpdate: Date;
}

export interface InputRequest {
  id: string;
  workflowId: string;
  executionId: string;
  tenantId?: string;
  conversationId?: string;
  stepId: string;
  type: 'text' | 'number' | 'date' | 'file' | 'choice' | 'confirmation';
  prompt: string;
  options?: string[];
  validation?: any;
  required: boolean;
  timeout?: number;
  createdAt: Date;
  expiresAt?: Date;
}

export interface ApprovalRequest {
  id: string;
  workflowId: string;
  executionId: string;
  tenantId?: string;
  title: string;
  description?: string;
  approvers: string[];
  requiredApprovals: number;
  currentApprovals: string[];
  data?: any;
  createdAt: Date;
  expiresAt?: Date;
}

export class ContextManager extends EventEmitter {
  private prisma: PrismaClient;
  private conversationContexts: Map<string, ConversationContext> = new Map();
  private userContexts: Map<string, UserContext> = new Map();
  private workflowContexts: Map<string, WorkflowContext> = new Map();
  private contextTimeout = 30 * 60 * 1000; // 30 minutes

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.startContextCleanup();
  }

  // Get conversation context with message history
  async getConversationContext(conversationId: string): Promise<ConversationContext> {
    // Check cache first
    let context = this.conversationContexts.get(conversationId);
    
    if (!context || this.isContextExpired(context.lastActivity)) {
      context = await this.loadConversationContext(conversationId);
      this.conversationContexts.set(conversationId, context);
    }

    return context;
  }

  // Get user context with profile and preferences
  async getUserContext(userId: string, tenantId: string): Promise<UserContext> {
    const contextKey = `${tenantId}:${userId}`;
    let context = this.userContexts.get(contextKey);

    if (!context || this.isContextExpired(context.lastActivity)) {
      context = await this.loadUserContext(userId, tenantId);
      this.userContexts.set(contextKey, context);
    }

    return context;
  }

  // Get workflow context for execution state
  async getWorkflowContext(workflowId: string, executionId?: string): Promise<WorkflowContext> {
    const contextKey = executionId || workflowId;
    let context = this.workflowContexts.get(contextKey);

    if (!context || this.isContextExpired(context.lastUpdate)) {
      context = await this.loadWorkflowContext(workflowId, executionId);
      this.workflowContexts.set(contextKey, context);
    }

    return context;
  }

  // Update conversation context with new message
  async updateConversationContext(
    conversationId: string,
    message: MessageContext
  ): Promise<void> {
    const context = await this.getConversationContext(conversationId);
    
    // Add message to history
    context.messageHistory.push(message);
    
    // Keep only recent messages (last 50)
    if (context.messageHistory.length > 50) {
      context.messageHistory = context.messageHistory.slice(-50);
    }

    // Update last activity
    context.lastActivity = new Date();

    // Extract and update entities/variables from message
    await this.extractContextFromMessage(context, message);

    // Persist to database
    await this.persistConversationContext(context);

    this.emit('context:conversation:updated', {
      conversationId,
      context,
      message
    });
  }

  // Set conversation variable
  async setConversationVariable(
    conversationId: string,
    key: string,
    value: any
  ): Promise<void> {
    const context = await this.getConversationContext(conversationId);
    context.variables.set(key, value);
    context.lastActivity = new Date();

    await this.persistConversationContext(context);

    this.emit('context:variable:set', {
      conversationId,
      key,
      value
    });
  }

  // Get conversation variable
  async getConversationVariable(
    conversationId: string,
    key: string
  ): Promise<any> {
    const context = await this.getConversationContext(conversationId);
    return context.variables.get(key);
  }

  // Set user variable
  async setUserVariable(
    userId: string,
    tenantId: string,
    key: string,
    value: any
  ): Promise<void> {
    const context = await this.getUserContext(userId, tenantId);
    context.variables.set(key, value);
    context.lastActivity = new Date();

    await this.persistUserContext(context);

    this.emit('context:user:variable:set', {
      userId,
      tenantId,
      key,
      value
    });
  }

  // Get user variable
  async getUserVariable(
    userId: string,
    tenantId: string,
    key: string
  ): Promise<any> {
    const context = await this.getUserContext(userId, tenantId);
    return context.variables.get(key);
  }

  // Update workflow context
  async updateWorkflowContext(
    workflowId: string,
    executionId: string,
    updates: Partial<WorkflowContext>
  ): Promise<void> {
    const context = await this.getWorkflowContext(workflowId, executionId);
    
    Object.assign(context, updates);
    context.lastUpdate = new Date();

    await this.persistWorkflowContext(context);

    this.emit('context:workflow:updated', {
      workflowId,
      executionId,
      context
    });
  }

  // Create input request for workflow
  async createInputRequest(
    workflowId: string,
    executionId: string,
    inputRequest: Omit<InputRequest, 'id' | 'createdAt' | 'expiresAt'>
  ): Promise<string> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      select: { tenantId: true }
    });

    if (!execution) {
      throw new Error(`Workflow execution not found: ${executionId}`);
    }

    const tenantId = inputRequest.tenantId ?? execution.tenantId;

    const request: InputRequest = {
      ...inputRequest,
      id: `input_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      workflowId,
      executionId,
      tenantId,
      createdAt: new Date(),
      expiresAt: inputRequest.timeout
        ? new Date(Date.now() + inputRequest.timeout * 1000)
        : undefined
    };

    // Store in workflow context
    const context = await this.getWorkflowContext(workflowId, executionId);
    context.inputRequests.push(request);
    context.state = 'waiting_input';
    
    await this.persistWorkflowContext(context);

    // Store in database
    await this.prisma.workflowInputRequest.create({
      data: {
        id: request.id,
        workflowId,
        executionId,
        tenantId,
        conversationId: request.conversationId,
        stepId: request.stepId,
        type: request.type,
        prompt: request.prompt,
        options: request.options,
        validation: request.validation as any,
        required: request.required,
        timeout: request.timeout,
        expiresAt: request.expiresAt
      }
    });

    this.emit('context:input:requested', {
      workflowId,
      executionId,
      request
    });

    return request.id;
  }

  // Handle input response
  async handleInputResponse(
    requestId: string,
    response: any,
    userId: string
  ): Promise<boolean> {
    try {
      // Get input request
      const inputRequest = await this.prisma.workflowInputRequest.findUnique({
        where: { id: requestId }
      });

      if (!inputRequest || (inputRequest.expiresAt && inputRequest.expiresAt < new Date())) {
        return false;
      }

      // Validate response
      const isValid = await this.validateInputResponse(inputRequest, response);
      if (!isValid) {
        return false;
      }

      // Update workflow context
      const context = await this.getWorkflowContext(
        inputRequest.workflowId,
        inputRequest.executionId
      );

      // Remove the request
      context.inputRequests = context.inputRequests.filter(r => r.id !== requestId);
      
      // Set the response as a variable
      context.variables.set(`input_${inputRequest.stepId}`, response);
      
      // Update state if no more pending inputs
      if (context.inputRequests.length === 0) {
        context.state = 'running';
      }

      await this.persistWorkflowContext(context);

      // Mark request as completed
      await this.prisma.workflowInputRequest.update({
        where: { id: requestId },
        data: {
          response: response as any,
          respondedBy: userId,
          respondedAt: new Date()
        }
      });

      this.emit('context:input:responded', {
        requestId,
        workflowId: inputRequest.workflowId,
        executionId: inputRequest.executionId,
        response,
        userId
      });

      return true;

    } catch (error) {
      console.error('Error handling input response:', error);
      return false;
    }
  }

  // Create approval request
  async createApprovalRequest(
    workflowId: string,
    executionId: string,
    approvalRequest: Omit<ApprovalRequest, 'id' | 'createdAt' | 'currentApprovals'>
  ): Promise<string> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      select: { tenantId: true }
    });

    if (!execution) {
      throw new Error(`Workflow execution not found: ${executionId}`);
    }

    const tenantId = approvalRequest.tenantId ?? execution.tenantId;

    const request: ApprovalRequest = {
      ...approvalRequest,
      id: `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      workflowId,
      executionId,
      tenantId,
      currentApprovals: [],
      createdAt: new Date()
    };

    // Store in workflow context
    const context = await this.getWorkflowContext(workflowId, executionId);
    context.approvalRequests.push(request);
    
    await this.persistWorkflowContext(context);

    // Store in database
    await this.prisma.workflowApprovalRequest.create({
      data: {
        id: request.id,
        workflowId,
        executionId,
        tenantId,
        title: request.title,
        description: request.description,
        approvers: request.approvers,
        requiredApprovals: request.requiredApprovals,
        data: request.data as any,
        expiresAt: request.expiresAt
      }
    });

    this.emit('context:approval:requested', {
      workflowId,
      executionId,
      request
    });

    return request.id;
  }

  // Handle approval response
  async handleApprovalResponse(
    requestId: string,
    approved: boolean,
    userId: string,
    comment?: string
  ): Promise<{ completed: boolean; approved: boolean }> {
    try {
      const approvalRequest = await this.prisma.workflowApprovalRequest.findUnique({
        where: { id: requestId }
      });

      if (!approvalRequest || (approvalRequest.expiresAt && approvalRequest.expiresAt < new Date())) {
        return { completed: false, approved: false };
      }

      // Check if user is authorized to approve
      if (!approvalRequest.approvers.includes(userId)) {
        return { completed: false, approved: false };
      }

      // Record the approval/rejection
      await this.prisma.workflowApprovalResponse.create({
        data: {
          approvalRequestId: requestId,
          userId,
          approved,
          comment,
          respondedAt: new Date()
        }
      });

      // Update workflow context
      const context = await this.getWorkflowContext(
        approvalRequest.workflowId,
        approvalRequest.executionId
      );

      const request = context.approvalRequests.find(r => r.id === requestId);
      if (request) {
        if (approved && !request.currentApprovals.includes(userId)) {
          request.currentApprovals.push(userId);
        }

        // Check if approval is complete
        const isApproved = request.currentApprovals.length >= request.requiredApprovals;
        const isCompleted = isApproved || !approved;

        if (isCompleted) {
          // Remove from pending approvals
          context.approvalRequests = context.approvalRequests.filter(r => r.id !== requestId);
          
          // Set approval result as variable
          context.variables.set(`approval_${requestId}`, {
            approved: isApproved,
            approvers: request.currentApprovals,
            completedAt: new Date()
          });

          // Update workflow state
          if (context.approvalRequests.length === 0 && context.inputRequests.length === 0) {
            context.state = 'running';
          }

          await this.persistWorkflowContext(context);

          this.emit('context:approval:completed', {
            requestId,
            workflowId: approvalRequest.workflowId,
            executionId: approvalRequest.executionId,
            approved: isApproved,
            userId
          });

          return { completed: true, approved: isApproved };
        }

        await this.persistWorkflowContext(context);
      }

      this.emit('context:approval:responded', {
        requestId,
        workflowId: approvalRequest.workflowId,
        executionId: approvalRequest.executionId,
        approved,
        userId
      });

      return { completed: false, approved: false };

    } catch (error) {
      console.error('Error handling approval response:', error);
      return { completed: false, approved: false };
    }
  }

  // Check if workflow has required context
  async hasRequiredContext(conversationId: string, workflowId: string): Promise<boolean> {
    // Get workflow requirements
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { configuration: true }
    });

    if (!workflow?.configuration) {
      return true; // No requirements
    }

    const requirements = (workflow.configuration as any).contextRequirements;
    if (!requirements) {
      return true;
    }

    const conversationContext = await this.getConversationContext(conversationId);

    // Check required variables
    if (requirements.variables) {
      for (const variable of requirements.variables) {
        if (!conversationContext.variables.has(variable)) {
          return false;
        }
      }
    }

    // Check message history requirements
    if (requirements.minMessages && conversationContext.messageHistory.length < requirements.minMessages) {
      return false;
    }

    return true;
  }

  // Get pending input requests for conversation
  async getPendingInputRequests(conversationId: string): Promise<InputRequest[]> {
    const requests = await this.prisma.workflowInputRequest.findMany({
      where: {
        conversationId,
        response: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });

    return requests.map(r => ({
      id: r.id,
      workflowId: r.workflowId,
      executionId: r.executionId,
      tenantId: r.tenantId,
      conversationId: r.conversationId || undefined,
      stepId: r.stepId,
      type: r.type as any,
      prompt: r.prompt,
      options: r.options || undefined,
      validation: r.validation as any,
      required: r.required,
      timeout: r.timeout,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt
    }));
  }

  // Get pending approval requests for user
  async getPendingApprovalRequests(userId: string, tenantId: string): Promise<ApprovalRequest[]> {
    const requests = await this.prisma.workflowApprovalRequest.findMany({
      where: {
        approvers: { has: userId },
        tenantId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      include: {
        responses: true
      },
      orderBy: { createdAt: 'asc' }
    });

    return requests
      .filter(r => {
        // Filter out already approved by this user
        return !r.responses.some(resp => resp.userId === userId);
      })
      .map(r => ({
        id: r.id,
        workflowId: r.workflowId,
        executionId: r.executionId,
        tenantId: r.tenantId,
        title: r.title,
        description: r.description,
        approvers: r.approvers,
        requiredApprovals: r.requiredApprovals,
        currentApprovals: r.responses.filter(resp => resp.approved).map(resp => resp.userId),
        data: r.data as any,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt
      }));
  }

  // Private helper methods
  private async loadConversationContext(conversationId: string): Promise<ConversationContext> {
    const [conversation, contextData] = await Promise.all([
      this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          participants: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 50
          }
        }
      }),
      this.prisma.conversationContext.findMany({
        where: { conversationId }
      })
    ]);

    const variables = new Map<string, any>();
    contextData.forEach(ctx => {
      variables.set(ctx.key, ctx.value);
    });

    if (!conversation) {
      const tenantId = contextData[0]?.tenantId ?? '';
      return {
        conversationId,
        tenantId,
        participants: [],
        messageHistory: [],
        metadata: {},
        variables,
        lastActivity: new Date()
      };
    }

    return {
      conversationId,
      tenantId: conversation.tenantId,
      participants: conversation.participants.map(p => p.userId),
      messageHistory: conversation.messages.reverse().map(m => ({
        messageId: m.id,
        content: m.content,
        userId: m.userId,
        timestamp: m.createdAt,
        messageType: m.type as any,
        metadata: m.metadata as any
      })),
      metadata: (conversation.metadata as any) || {},
      variables,
      lastActivity: new Date()
    };
  }

  private async loadUserContext(userId: string, tenantId: string): Promise<UserContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        fullName: true,
        avatar: true,
        avatarUrl: true,
        role: true
      }
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Load user variables
    const variables = new Map<string, any>();
    const contextData = await this.prisma.userContext.findMany({
      where: { userId, tenantId }
    });

    contextData.forEach(ctx => {
      variables.set(ctx.key, ctx.value);
    });

    // Get active workflows
    const activeWorkflows = await this.prisma.workflowExecution.findMany({
      where: {
        triggeredBy: userId,
        tenantId,
        status: { in: ['running', 'waiting'] }
      },
      select: { workflowId: true }
    });

    const profile = {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName:
        user.fullName || [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
      avatar: user.avatarUrl || user.avatar || undefined,
      role: user.role
    };

    return {
      userId,
      tenantId,
      profile,
      preferences: {},
      permissions: {}, // Load from role/permissions system
      activeWorkflows: activeWorkflows.map(w => w.workflowId),
      variables,
      lastActivity: new Date()
    };
  }

  private async loadWorkflowContext(workflowId: string, executionId?: string): Promise<WorkflowContext> {
    const variables = new Map();
    const inputRequests: InputRequest[] = [];
    const approvalRequests: ApprovalRequest[] = [];

    if (executionId) {
      // Load execution-specific context
      const execution = await this.prisma.workflowExecution.findUnique({
        where: { id: executionId }
      });

      if (execution?.metadata) {
        const metadata = execution.metadata as any;
        if (metadata.variables) {
          Object.entries(metadata.variables).forEach(([key, value]) => {
            variables.set(key, value);
          });
        }
      }

      // Load pending input requests
      const inputs = await this.prisma.workflowInputRequest.findMany({
        where: {
          executionId,
          response: null
        }
      });

      inputRequests.push(...inputs.map(i => ({
        id: i.id,
        workflowId: i.workflowId,
        executionId: i.executionId,
        tenantId: i.tenantId,
        conversationId: i.conversationId || undefined,
        stepId: i.stepId,
        type: i.type as any,
        prompt: i.prompt,
        options: i.options || undefined,
        validation: i.validation as any,
        required: i.required,
        timeout: i.timeout,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt
      })));

      // Load pending approval requests
      const approvals = await this.prisma.workflowApprovalRequest.findMany({
        where: {
          executionId
        },
        include: {
          responses: true
        }
      });

      approvalRequests.push(...approvals.map(a => ({
        id: a.id,
        workflowId: a.workflowId,
        executionId: a.executionId,
        tenantId: a.tenantId,
        title: a.title,
        description: a.description,
        approvers: a.approvers,
        requiredApprovals: a.requiredApprovals,
        currentApprovals: a.responses.filter(r => r.approved).map(r => r.userId),
        data: a.data as any,
        createdAt: a.createdAt,
        expiresAt: a.expiresAt
      })));
    }

    return {
      workflowId,
      executionId,
      state: inputRequests.length > 0 || approvalRequests.length > 0 ? 'waiting_input' : 'idle',
      variables,
      inputRequests,
      approvalRequests,
      lastUpdate: new Date()
    };
  }

  private async persistConversationContext(context: ConversationContext): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { tenantId: true }
    });

    if (!conversation?.tenantId) {
      return;
    }

    context.tenantId = conversation.tenantId;

    // Update conversation metadata
    await this.prisma.conversation
      .update({
        where: { id: context.conversationId },
        data: {
          metadata: context.metadata,
          updatedAt: new Date()
        }
      })
      .catch(() => {
        // Ignore if conversation doesn't exist yet
      });

    const operations = Array.from(context.variables.entries()).map(([key, value]) =>
      this.prisma.conversationContext.upsert({
        where: {
          conversationId_key: {
            conversationId: context.conversationId,
            key
          }
        },
        update: {
          value,
          tenantId: context.tenantId
        },
        create: {
          conversationId: context.conversationId,
          tenantId: context.tenantId,
          key,
          value
        }
      })
    );

    await Promise.all(operations);
  }

  private async persistUserContext(context: UserContext): Promise<void> {
    // Update variables
    for (const [key, value] of context.variables) {
      await this.prisma.userContext.upsert({
        where: {
          userId_tenantId_key: {
            userId: context.userId,
            tenantId: context.tenantId,
            key
          }
        },
        update: {
          value,
          tenantId: context.tenantId
        },
        create: {
          userId: context.userId,
          tenantId: context.tenantId,
          key,
          value
        }
      });
    }
  }

  private async persistWorkflowContext(context: WorkflowContext): Promise<void> {
    if (!context.executionId) return;

    // Update execution metadata with variables
    const metadata = {
      variables: Object.fromEntries(context.variables),
      state: context.state,
      currentStep: context.currentStep,
      lastUpdate: context.lastUpdate
    };

    await this.prisma.workflowExecution.update({
      where: { id: context.executionId },
      data: { metadata }
    }).catch(() => {
      // Ignore if execution doesn't exist
    });
  }

  private async extractContextFromMessage(
    context: ConversationContext,
    message: MessageContext
  ): Promise<void> {
    // Extract entities and update context variables
    if (message.entities) {
      for (const entity of message.entities) {
        context.variables.set(`entity_${entity.type}`, entity.value);
      }
    }

    // Extract intent
    if (message.intent) {
      context.variables.set('last_intent', message.intent);
    }

    // Update participant activity
    context.variables.set(`user_${message.userId}_last_message`, message.timestamp);
  }

  private async validateInputResponse(inputRequest: any, response: any): Promise<boolean> {
    // Basic type validation
    switch (inputRequest.type) {
      case 'number':
        return !isNaN(Number(response));
      case 'date':
        return !isNaN(Date.parse(response));
      case 'choice':
        return inputRequest.options?.includes(response);
      case 'confirmation':
        return typeof response === 'boolean' || ['yes', 'no', 'true', 'false'].includes(String(response).toLowerCase());
      default:
        return true;
    }
  }

  private isContextExpired(lastActivity: Date): boolean {
    return (Date.now() - lastActivity.getTime()) > this.contextTimeout;
  }

  private startContextCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      
      // Clean up expired conversation contexts
      for (const [key, context] of this.conversationContexts) {
        if ((now - context.lastActivity.getTime()) > this.contextTimeout) {
          this.conversationContexts.delete(key);
        }
      }

      // Clean up expired user contexts
      for (const [key, context] of this.userContexts) {
        if ((now - context.lastActivity.getTime()) > this.contextTimeout) {
          this.userContexts.delete(key);
        }
      }

      // Clean up expired workflow contexts
      for (const [key, context] of this.workflowContexts) {
        if ((now - context.lastUpdate.getTime()) > this.contextTimeout) {
          this.workflowContexts.delete(key);
        }
      }
    }, 5 * 60 * 1000); // Clean up every 5 minutes
  }
}
