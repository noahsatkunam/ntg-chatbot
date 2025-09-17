import { PrismaClient } from '@prisma/client';
import { N8nClient, N8nWorkflow, N8nExecution } from './n8nClient';
import { WorkflowManager } from './workflowManager';
import { ExecutionMonitor } from './executionMonitor';
import { TemplateManager } from './templateManager';
import { EventEmitter } from 'events';

export interface WorkflowExecutionContext {
  tenantId: string;
  userId?: string;
  triggerData: any;
  metadata?: any;
}

export interface WorkflowDeploymentOptions {
  activate?: boolean;
  validateOnly?: boolean;
  environment?: 'development' | 'staging' | 'production';
}

export class WorkflowService extends EventEmitter {
  private prisma: PrismaClient;
  private n8nClient: N8nClient;
  private workflowManager: WorkflowManager;
  private executionMonitor: ExecutionMonitor;
  private templateManager: TemplateManager;

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.n8nClient = new N8nClient();
    this.workflowManager = new WorkflowManager(this.prisma, this.n8nClient);
    this.executionMonitor = new ExecutionMonitor(this.prisma, this.n8nClient);
    this.templateManager = new TemplateManager(this.prisma);

    // Set up event listeners
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.executionMonitor.on('execution:started', (execution) => {
      this.emit('workflow:execution:started', execution);
    });

    this.executionMonitor.on('execution:completed', (execution) => {
      this.emit('workflow:execution:completed', execution);
    });

    this.executionMonitor.on('execution:failed', (execution) => {
      this.emit('workflow:execution:failed', execution);
    });

    this.executionMonitor.on('execution:cancelled', (execution) => {
      this.emit('workflow:execution:cancelled', execution);
    });
  }

  // Workflow Deployment
  async deployWorkflow(
    tenantId: string,
    userId: string,
    workflowDefinition: any,
    options: WorkflowDeploymentOptions = {}
  ): Promise<{ workflowId: string; n8nId?: string; webhookUrl?: string }> {
    try {
      // Validate workflow definition
      const validation = this.n8nClient.validateWorkflowDefinition(workflowDefinition);
      if (!validation.isValid) {
        throw new Error(`Workflow validation failed: ${validation.errors.join(', ')}`);
      }

      if (options.validateOnly) {
        return { workflowId: 'validation-only' };
      }

      // Create workflow in database
      const workflow = await this.prisma.workflow.create({
        data: {
          tenantId,
          createdBy: userId,
          name: workflowDefinition.name,
          description: workflowDefinition.description,
          definition: workflowDefinition,
          category: workflowDefinition.category || 'general',
          tags: workflowDefinition.tags || [],
          status: 'draft'
        }
      });

      // Deploy to n8n
      const n8nWorkflow = await this.n8nClient.createWorkflow({
        name: `${tenantId}_${workflow.id}_${workflowDefinition.name}`,
        nodes: workflowDefinition.nodes,
        connections: workflowDefinition.connections,
        active: options.activate || false,
        settings: {
          ...workflowDefinition.settings,
          tenantId,
          workflowId: workflow.id
        }
      });

      // Update workflow with n8n ID
      await this.prisma.workflow.update({
        where: { id: workflow.id },
        data: {
          n8nId: n8nWorkflow.id,
          status: options.activate ? 'active' : 'inactive'
        }
      });

      // Create webhook if workflow has webhook trigger
      let webhookUrl: string | undefined;
      const hasWebhookTrigger = workflowDefinition.nodes.some((node: any) => 
        node.type === 'n8n-nodes-base.webhook'
      );

      if (hasWebhookTrigger) {
        const webhookPath = this.n8nClient.generateTenantWebhookPath(tenantId, workflow.id);
        webhookUrl = await this.n8nClient.createWebhook(n8nWorkflow.id!, webhookPath);

        // Create webhook trigger record
        await this.prisma.workflowTrigger.create({
          data: {
            workflowId: workflow.id,
            tenantId,
            triggerType: 'webhook',
            configuration: { webhookUrl, path: webhookPath },
            webhookPath
          }
        });
      }

      // Create other triggers
      await this.createWorkflowTriggers(workflow.id, tenantId, workflowDefinition.nodes);

      this.emit('workflow:deployed', {
        workflowId: workflow.id,
        tenantId,
        userId,
        n8nId: n8nWorkflow.id
      });

      return {
        workflowId: workflow.id,
        n8nId: n8nWorkflow.id,
        webhookUrl
      };

    } catch (error) {
      console.error('Workflow deployment failed:', error);
      throw new Error(`Failed to deploy workflow: ${error}`);
    }
  }

  // Workflow Execution
  async executeWorkflow(
    workflowId: string,
    context: WorkflowExecutionContext
  ): Promise<string> {
    try {
      // Verify tenant access
      const workflow = await this.prisma.workflow.findFirst({
        where: {
          id: workflowId,
          tenantId: context.tenantId
        }
      });

      if (!workflow) {
        throw new Error('Workflow not found or access denied');
      }

      if (!workflow.n8nId) {
        throw new Error('Workflow not deployed to n8n');
      }

      // Create execution record
      const execution = await this.prisma.workflowExecution.create({
        data: {
          workflowId,
          tenantId: context.tenantId,
          triggerData: context.triggerData,
          triggeredBy: context.userId || 'system',
          metadata: context.metadata,
          status: 'running'
        }
      });

      // Execute in n8n
      const n8nExecution = await this.n8nClient.executeWorkflow(
        workflow.n8nId,
        {
          ...context.triggerData,
          tenantId: context.tenantId,
          executionId: execution.id
        }
      );

      // Update execution with n8n execution ID
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { n8nExecutionId: n8nExecution.id }
      });

      // Start monitoring execution
      this.executionMonitor.startMonitoring(execution.id, n8nExecution.id);

      // Update workflow last executed time
      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: { lastExecuted: new Date() }
      });

      this.emit('workflow:execution:started', {
        executionId: execution.id,
        workflowId,
        tenantId: context.tenantId
      });

      return execution.id;

    } catch (error) {
      console.error('Workflow execution failed:', error);
      throw new Error(`Failed to execute workflow: ${error}`);
    }
  }

  // Trigger Workflow from Chat
  async triggerFromChat(
    tenantId: string,
    userId: string,
    messageContent: string,
    conversationId: string,
    messageId: string
  ): Promise<string[]> {
    try {
      // Find workflows with chat message triggers
      const triggers = await this.prisma.workflowTrigger.findMany({
        where: {
          tenantId,
          triggerType: 'chat_message',
          isActive: true
        },
        include: {
          workflow: {
            where: {
              status: 'active'
            }
          }
        }
      });

      const executionIds: string[] = [];

      for (const trigger of triggers) {
        if (!trigger.workflow) continue;

        // Check trigger conditions
        const shouldTrigger = this.evaluateChatTrigger(
          trigger.configuration,
          messageContent,
          userId
        );

        if (shouldTrigger) {
          const executionId = await this.executeWorkflow(trigger.workflowId, {
            tenantId,
            userId,
            triggerData: {
              messageContent,
              conversationId,
              messageId,
              userId,
              timestamp: new Date().toISOString()
            },
            metadata: {
              triggerType: 'chat_message',
              triggerId: trigger.id
            }
          });

          executionIds.push(executionId);
        }
      }

      return executionIds;

    } catch (error) {
      console.error('Chat trigger failed:', error);
      throw new Error(`Failed to trigger workflows from chat: ${error}`);
    }
  }

  // Webhook Trigger
  async triggerFromWebhook(
    tenantId: string,
    webhookPath: string,
    data: any,
    headers: any
  ): Promise<string | null> {
    try {
      // Find workflow trigger by webhook path
      const trigger = await this.prisma.workflowTrigger.findFirst({
        where: {
          tenantId,
          webhookPath,
          triggerType: 'webhook',
          isActive: true
        },
        include: {
          workflow: {
            where: {
              status: 'active'
            }
          }
        }
      });

      if (!trigger || !trigger.workflow) {
        throw new Error('Webhook trigger not found or inactive');
      }

      // Execute workflow
      const executionId = await this.executeWorkflow(trigger.workflowId, {
        tenantId,
        triggerData: {
          body: data,
          headers,
          webhookPath,
          timestamp: new Date().toISOString()
        },
        metadata: {
          triggerType: 'webhook',
          triggerId: trigger.id
        }
      });

      return executionId;

    } catch (error) {
      console.error('Webhook trigger failed:', error);
      throw new Error(`Failed to trigger workflow from webhook: ${error}`);
    }
  }

  // Workflow Management
  async getWorkflow(workflowId: string, tenantId: string): Promise<any> {
    return this.workflowManager.getWorkflow(workflowId, tenantId);
  }

  async listWorkflows(tenantId: string, filters?: any): Promise<any[]> {
    return this.workflowManager.listWorkflows(tenantId, filters);
  }

  async updateWorkflow(
    workflowId: string,
    tenantId: string,
    updates: any
  ): Promise<any> {
    return this.workflowManager.updateWorkflow(workflowId, tenantId, updates);
  }

  async deleteWorkflow(workflowId: string, tenantId: string): Promise<void> {
    return this.workflowManager.deleteWorkflow(workflowId, tenantId);
  }

  async activateWorkflow(workflowId: string, tenantId: string): Promise<void> {
    return this.workflowManager.activateWorkflow(workflowId, tenantId);
  }

  async deactivateWorkflow(workflowId: string, tenantId: string): Promise<void> {
    return this.workflowManager.deactivateWorkflow(workflowId, tenantId);
  }

  // Execution Management
  async getExecution(executionId: string, tenantId: string): Promise<any> {
    return this.executionMonitor.getExecution(executionId, tenantId);
  }

  async listExecutions(
    tenantId: string,
    workflowId?: string,
    filters?: any
  ): Promise<any[]> {
    return this.executionMonitor.listExecutions(tenantId, workflowId, filters);
  }

  async cancelExecution(executionId: string, tenantId: string): Promise<void> {
    return this.executionMonitor.cancelExecution(executionId, tenantId);
  }

  async retryExecution(executionId: string, tenantId: string): Promise<string> {
    return this.executionMonitor.retryExecution(executionId, tenantId);
  }

  // Template Management
  async getTemplates(category?: string): Promise<any[]> {
    return this.templateManager.getTemplates(category);
  }

  async createFromTemplate(
    templateId: string,
    tenantId: string,
    userId: string,
    customizations?: any
  ): Promise<string> {
    const template = await this.templateManager.getTemplate(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    // Apply customizations to template
    const workflowDefinition = {
      ...template.definition,
      name: customizations?.name || template.name,
      description: customizations?.description || template.description,
      ...customizations
    };

    const result = await this.deployWorkflow(tenantId, userId, workflowDefinition);
    
    // Update template usage count
    await this.templateManager.incrementUsage(templateId);

    return result.workflowId;
  }

  // Analytics
  async getWorkflowAnalytics(
    tenantId: string,
    timeRange?: { start: Date; end: Date }
  ): Promise<any> {
    const whereClause: any = { tenantId };
    
    if (timeRange) {
      whereClause.createdAt = {
        gte: timeRange.start,
        lte: timeRange.end
      };
    }

    const [executions, workflows] = await Promise.all([
      this.prisma.workflowExecution.groupBy({
        by: ['status'],
        where: whereClause,
        _count: { id: true },
        _avg: { duration: true }
      }),
      this.prisma.workflow.count({
        where: { tenantId, status: 'active' }
      })
    ]);

    return {
      totalWorkflows: workflows,
      executions: executions.reduce((acc, exec) => {
        acc[exec.status] = {
          count: exec._count.id,
          averageDuration: exec._avg.duration
        };
        return acc;
      }, {} as any)
    };
  }

  // Health Check
  async healthCheck(): Promise<{ status: string; n8n: boolean; database: boolean }> {
    try {
      const [n8nHealth, dbHealth] = await Promise.all([
        this.n8nClient.healthCheck(),
        this.prisma.$queryRaw`SELECT 1`
      ]);

      return {
        status: n8nHealth && dbHealth ? 'healthy' : 'unhealthy',
        n8n: n8nHealth,
        database: !!dbHealth
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        n8n: false,
        database: false
      };
    }
  }

  // Private Helper Methods
  private async createWorkflowTriggers(
    workflowId: string,
    tenantId: string,
    nodes: any[]
  ): Promise<void> {
    for (const node of nodes) {
      let triggerType: string | null = null;
      let configuration: any = {};

      // Determine trigger type based on node type
      if (node.type === 'n8n-nodes-base.cron') {
        triggerType = 'schedule';
        configuration = {
          cronExpression: node.parameters?.rule,
          timezone: node.parameters?.timezone
        };
      } else if (node.type === 'n8n-nodes-base.manualTrigger') {
        triggerType = 'manual';
      }

      if (triggerType) {
        await this.prisma.workflowTrigger.create({
          data: {
            workflowId,
            tenantId,
            triggerType,
            configuration
          }
        });
      }
    }
  }

  private evaluateChatTrigger(
    configuration: any,
    messageContent: string,
    userId: string
  ): boolean {
    // Simple trigger evaluation - can be enhanced with more complex logic
    const { keywords, patterns, userIds } = configuration;

    // Check keywords
    if (keywords && Array.isArray(keywords)) {
      const hasKeyword = keywords.some((keyword: string) =>
        messageContent.toLowerCase().includes(keyword.toLowerCase())
      );
      if (!hasKeyword) return false;
    }

    // Check patterns (regex)
    if (patterns && Array.isArray(patterns)) {
      const hasPattern = patterns.some((pattern: string) => {
        try {
          const regex = new RegExp(pattern, 'i');
          return regex.test(messageContent);
        } catch {
          return false;
        }
      });
      if (!hasPattern) return false;
    }

    // Check user restrictions
    if (userIds && Array.isArray(userIds) && userIds.length > 0) {
      if (!userIds.includes(userId)) return false;
    }

    return true;
  }
}
