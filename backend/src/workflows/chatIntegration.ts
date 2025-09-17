import { PrismaClient } from '@prisma/client';
import { WorkflowService } from './workflowService';
import { EventEmitter } from 'events';

export interface ChatWorkflowContext {
  conversationId: string;
  messageId: string;
  messageContent: string;
  userId: string;
  tenantId: string;
  messageType: 'user' | 'bot';
  timestamp: Date;
  metadata?: any;
}

export interface WorkflowResponse {
  executionId: string;
  workflowId: string;
  response?: {
    type: 'message' | 'action' | 'data';
    content: any;
    metadata?: any;
  };
}

export class ChatIntegration extends EventEmitter {
  private prisma: PrismaClient;
  private workflowService: WorkflowService;

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.workflowService = new WorkflowService();

    // Listen to workflow execution events
    this.setupWorkflowEventListeners();
  }

  private setupWorkflowEventListeners(): void {
    this.workflowService.on('workflow:execution:completed', async (execution) => {
      await this.handleWorkflowCompletion(execution);
    });

    this.workflowService.on('workflow:execution:failed', async (execution) => {
      await this.handleWorkflowFailure(execution);
    });
  }

  // Process incoming chat message for workflow triggers
  async processMessage(context: ChatWorkflowContext): Promise<WorkflowResponse[]> {
    try {
      const responses: WorkflowResponse[] = [];

      // Find active chat message triggers for this tenant
      const triggers = await this.prisma.workflowTrigger.findMany({
        where: {
          tenantId: context.tenantId,
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

      for (const trigger of triggers) {
        if (!trigger.workflow) continue;

        // Evaluate trigger conditions
        const shouldTrigger = await this.evaluateTriggerConditions(
          trigger,
          context
        );

        if (shouldTrigger) {
          try {
            const executionId = await this.workflowService.executeWorkflow(
              trigger.workflowId,
              {
                tenantId: context.tenantId,
                userId: context.userId,
                triggerData: {
                  messageContent: context.messageContent,
                  conversationId: context.conversationId,
                  messageId: context.messageId,
                  messageType: context.messageType,
                  timestamp: context.timestamp.toISOString(),
                  ...context.metadata
                },
                metadata: {
                  triggerType: 'chat_message',
                  triggerId: trigger.id,
                  source: 'chat_integration'
                }
              }
            );

            responses.push({
              executionId,
              workflowId: trigger.workflowId
            });

            // Emit event for real-time updates
            this.emit('workflow:triggered', {
              executionId,
              workflowId: trigger.workflowId,
              conversationId: context.conversationId,
              triggeredBy: 'chat_message'
            });

          } catch (error) {
            console.error(`Failed to execute workflow ${trigger.workflowId}:`, error);
            
            // Emit error event
            this.emit('workflow:trigger:failed', {
              workflowId: trigger.workflowId,
              conversationId: context.conversationId,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      }

      return responses;

    } catch (error) {
      console.error('Chat integration processing failed:', error);
      throw new Error(`Failed to process chat message: ${error}`);
    }
  }

  // Handle workflow completion and generate chat responses
  private async handleWorkflowCompletion(execution: any): Promise<void> {
    try {
      // Check if this execution was triggered by chat
      if (execution.metadata?.triggerType !== 'chat_message') {
        return;
      }

      const conversationId = execution.triggerData?.conversationId;
      if (!conversationId) {
        return;
      }

      // Process workflow result and generate chat response
      const chatResponse = await this.generateChatResponse(execution);
      
      if (chatResponse) {
        // Emit chat response event for WebSocket handling
        this.emit('chat:response', {
          conversationId,
          executionId: execution.id,
          response: chatResponse
        });

        // Store workflow response in database
        await this.storeWorkflowResponse(execution, chatResponse);
      }

    } catch (error) {
      console.error('Failed to handle workflow completion:', error);
    }
  }

  // Handle workflow failure and generate error responses
  private async handleWorkflowFailure(execution: any): Promise<void> {
    try {
      if (execution.metadata?.triggerType !== 'chat_message') {
        return;
      }

      const conversationId = execution.triggerData?.conversationId;
      if (!conversationId) {
        return;
      }

      // Generate error response
      const errorResponse = {
        type: 'message' as const,
        content: 'I encountered an issue while processing your request. Please try again later.',
        metadata: {
          executionId: execution.id,
          workflowId: execution.workflowId,
          error: true
        }
      };

      this.emit('chat:response', {
        conversationId,
        executionId: execution.id,
        response: errorResponse
      });

    } catch (error) {
      console.error('Failed to handle workflow failure:', error);
    }
  }

  // Evaluate trigger conditions based on message content and context
  private async evaluateTriggerConditions(
    trigger: any,
    context: ChatWorkflowContext
  ): Promise<boolean> {
    const config = trigger.configuration || {};

    // Check message type filter
    if (config.messageTypes && Array.isArray(config.messageTypes)) {
      if (!config.messageTypes.includes(context.messageType)) {
        return false;
      }
    }

    // Check keywords
    if (config.keywords && Array.isArray(config.keywords)) {
      const hasKeyword = config.keywords.some((keyword: string) =>
        context.messageContent.toLowerCase().includes(keyword.toLowerCase())
      );
      if (!hasKeyword) return false;
    }

    // Check regex patterns
    if (config.patterns && Array.isArray(config.patterns)) {
      const hasPattern = config.patterns.some((pattern: string) => {
        try {
          const regex = new RegExp(pattern, 'i');
          return regex.test(context.messageContent);
        } catch {
          return false;
        }
      });
      if (!hasPattern) return false;
    }

    // Check user restrictions
    if (config.userIds && Array.isArray(config.userIds) && config.userIds.length > 0) {
      if (!config.userIds.includes(context.userId)) return false;
    }

    // Check conversation restrictions
    if (config.conversationIds && Array.isArray(config.conversationIds) && config.conversationIds.length > 0) {
      if (!config.conversationIds.includes(context.conversationId)) return false;
    }

    // Check time-based conditions
    if (config.timeRestrictions) {
      const now = new Date();
      const hour = now.getHours();
      
      if (config.timeRestrictions.startHour !== undefined && hour < config.timeRestrictions.startHour) {
        return false;
      }
      
      if (config.timeRestrictions.endHour !== undefined && hour > config.timeRestrictions.endHour) {
        return false;
      }
      
      if (config.timeRestrictions.days && Array.isArray(config.timeRestrictions.days)) {
        const dayOfWeek = now.getDay();
        if (!config.timeRestrictions.days.includes(dayOfWeek)) {
          return false;
        }
      }
    }

    // Check rate limiting
    if (config.rateLimiting) {
      const isRateLimited = await this.checkRateLimit(
        trigger.id,
        context.userId,
        config.rateLimiting
      );
      if (isRateLimited) return false;
    }

    return true;
  }

  // Generate chat response from workflow execution result
  private async generateChatResponse(execution: any): Promise<any> {
    const resultData = execution.resultData;
    
    if (!resultData) {
      return null;
    }

    // Check if workflow explicitly returned a chat response
    if (resultData.chatResponse) {
      return {
        type: resultData.chatResponse.type || 'message',
        content: resultData.chatResponse.content,
        metadata: {
          executionId: execution.id,
          workflowId: execution.workflowId,
          ...resultData.chatResponse.metadata
        }
      };
    }

    // Check for common response patterns in workflow output
    if (resultData.message || resultData.text || resultData.response) {
      return {
        type: 'message' as const,
        content: resultData.message || resultData.text || resultData.response,
        metadata: {
          executionId: execution.id,
          workflowId: execution.workflowId
        }
      };
    }

    // Check for action responses
    if (resultData.action) {
      return {
        type: 'action' as const,
        content: resultData.action,
        metadata: {
          executionId: execution.id,
          workflowId: execution.workflowId
        }
      };
    }

    // Default: return structured data
    return {
      type: 'data' as const,
      content: resultData,
      metadata: {
        executionId: execution.id,
        workflowId: execution.workflowId
      }
    };
  }

  // Store workflow response for analytics and history
  private async storeWorkflowResponse(execution: any, response: any): Promise<void> {
    try {
      // Update execution with response data
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: {
          metadata: {
            ...execution.metadata,
            chatResponse: response
          }
        }
      });

      // Create analytics record
      await this.prisma.workflowAnalytics.upsert({
        where: {
          tenantId_date: {
            tenantId: execution.tenantId,
            date: new Date(new Date().setHours(0, 0, 0, 0))
          }
        },
        update: {
          chatTriggeredExecutions: { increment: 1 },
          chatResponsesGenerated: { increment: 1 }
        },
        create: {
          tenantId: execution.tenantId,
          date: new Date(new Date().setHours(0, 0, 0, 0)),
          totalExecutions: 1,
          chatTriggeredExecutions: 1,
          chatResponsesGenerated: 1,
          successfulExecutions: execution.status === 'success' ? 1 : 0,
          failedExecutions: execution.status === 'error' ? 1 : 0
        }
      });

    } catch (error) {
      console.error('Failed to store workflow response:', error);
    }
  }

  // Check rate limiting for triggers
  private async checkRateLimit(
    triggerId: string,
    userId: string,
    rateLimitConfig: any
  ): Promise<boolean> {
    const { maxExecutions, timeWindowMinutes } = rateLimitConfig;
    
    if (!maxExecutions || !timeWindowMinutes) {
      return false;
    }

    const timeWindow = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

    const recentExecutions = await this.prisma.workflowExecution.count({
      where: {
        triggeredBy: userId,
        metadata: {
          path: ['triggerId'],
          equals: triggerId
        },
        startTime: {
          gte: timeWindow
        }
      }
    });

    return recentExecutions >= maxExecutions;
  }

  // Get chat integration statistics
  async getChatIntegrationStats(tenantId: string): Promise<any> {
    const [totalTriggers, activeTriggers, recentExecutions] = await Promise.all([
      this.prisma.workflowTrigger.count({
        where: {
          tenantId,
          triggerType: 'chat_message'
        }
      }),
      this.prisma.workflowTrigger.count({
        where: {
          tenantId,
          triggerType: 'chat_message',
          isActive: true
        }
      }),
      this.prisma.workflowExecution.count({
        where: {
          tenantId,
          metadata: {
            path: ['triggerType'],
            equals: 'chat_message'
          },
          startTime: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      })
    ]);

    return {
      totalTriggers,
      activeTriggers,
      inactiveTriggers: totalTriggers - activeTriggers,
      recentExecutions
    };
  }

  // Create chat message trigger
  async createChatTrigger(
    workflowId: string,
    tenantId: string,
    configuration: any
  ): Promise<string> {
    const trigger = await this.prisma.workflowTrigger.create({
      data: {
        workflowId,
        tenantId,
        triggerType: 'chat_message',
        configuration,
        isActive: true
      }
    });

    return trigger.id;
  }

  // Update chat message trigger
  async updateChatTrigger(
    triggerId: string,
    tenantId: string,
    updates: any
  ): Promise<void> {
    await this.prisma.workflowTrigger.updateMany({
      where: {
        id: triggerId,
        tenantId,
        triggerType: 'chat_message'
      },
      data: updates
    });
  }

  // Delete chat message trigger
  async deleteChatTrigger(triggerId: string, tenantId: string): Promise<void> {
    await this.prisma.workflowTrigger.deleteMany({
      where: {
        id: triggerId,
        tenantId,
        triggerType: 'chat_message'
      }
    });
  }

  // List chat triggers for a tenant
  async listChatTriggers(tenantId: string): Promise<any[]> {
    return this.prisma.workflowTrigger.findMany({
      where: {
        tenantId,
        triggerType: 'chat_message'
      },
      include: {
        workflow: {
          select: {
            id: true,
            name: true,
            status: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }
}
