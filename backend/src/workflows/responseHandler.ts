import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

export interface WorkflowResponseContext {
  executionId: string;
  workflowId: string;
  tenantId: string;
  conversationId?: string;
  userId?: string;
  responseData: any;
  responseType: 'success' | 'error' | 'partial';
}

export interface ChatResponseOptions {
  immediate?: boolean;
  delay?: number;
  typing?: boolean;
  format?: 'text' | 'markdown' | 'html' | 'json';
}

export class ResponseHandler extends EventEmitter {
  private prisma: PrismaClient;

  constructor() {
    super();
    this.prisma = new PrismaClient();
  }

  // Process workflow response and determine appropriate action
  async processWorkflowResponse(context: WorkflowResponseContext): Promise<void> {
    try {
      const { executionId, workflowId, tenantId, responseData, responseType } = context;

      // Get workflow configuration to determine response handling
      const workflow = await this.prisma.workflow.findFirst({
        where: {
          id: workflowId,
          tenantId
        }
      });

      if (!workflow) {
        throw new Error('Workflow not found');
      }

      // Process based on response type
      switch (responseType) {
        case 'success':
          await this.handleSuccessResponse(context, workflow);
          break;
        case 'error':
          await this.handleErrorResponse(context, workflow);
          break;
        case 'partial':
          await this.handlePartialResponse(context, workflow);
          break;
      }

      // Update execution with response handling status
      await this.updateExecutionResponse(executionId, {
        responseHandled: true,
        responseHandledAt: new Date(),
        responseType
      });

    } catch (error) {
      console.error('Failed to process workflow response:', error);
      this.emit('response:error', {
        executionId: context.executionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Handle successful workflow responses
  private async handleSuccessResponse(
    context: WorkflowResponseContext,
    workflow: any
  ): Promise<void> {
    const { responseData, conversationId, executionId } = context;

    // Check if response contains chat message
    if (responseData.chatMessage && conversationId) {
      await this.sendChatMessage(conversationId, {
        content: responseData.chatMessage.content,
        type: responseData.chatMessage.type || 'bot',
        metadata: {
          executionId,
          workflowId: workflow.id,
          source: 'workflow'
        }
      });
    }

    // Handle action responses
    if (responseData.actions && Array.isArray(responseData.actions)) {
      for (const action of responseData.actions) {
        await this.executeAction(action, context);
      }
    }

    // Handle data updates
    if (responseData.dataUpdates) {
      await this.processDataUpdates(responseData.dataUpdates, context);
    }

    // Handle notifications
    if (responseData.notifications) {
      await this.sendNotifications(responseData.notifications, context);
    }

    // Handle webhooks
    if (responseData.webhooks) {
      await this.triggerWebhooks(responseData.webhooks, context);
    }

    this.emit('response:success', {
      executionId,
      workflowId: workflow.id,
      responseData
    });
  }

  // Handle error responses
  private async handleErrorResponse(
    context: WorkflowResponseContext,
    workflow: any
  ): Promise<void> {
    const { responseData, conversationId, executionId } = context;

    // Send error message to chat if conversation exists
    if (conversationId) {
      const errorMessage = responseData.errorMessage || 
        'I encountered an issue while processing your request. Please try again later.';

      await this.sendChatMessage(conversationId, {
        content: errorMessage,
        type: 'bot',
        metadata: {
          executionId,
          workflowId: workflow.id,
          source: 'workflow',
          error: true
        }
      });
    }

    // Log error for monitoring
    await this.logError(context, responseData);

    // Send error notifications if configured
    if (workflow.definition?.errorHandling?.notifications) {
      await this.sendErrorNotifications(context, workflow);
    }

    this.emit('response:error', {
      executionId,
      workflowId: workflow.id,
      error: responseData
    });
  }

  // Handle partial responses (streaming or multi-step)
  private async handlePartialResponse(
    context: WorkflowResponseContext,
    workflow: any
  ): Promise<void> {
    const { responseData, conversationId, executionId } = context;

    // Handle streaming responses
    if (responseData.streaming && conversationId) {
      this.emit('response:streaming', {
        conversationId,
        executionId,
        chunk: responseData.chunk,
        isComplete: responseData.isComplete
      });
    }

    // Handle progress updates
    if (responseData.progress) {
      this.emit('response:progress', {
        executionId,
        progress: responseData.progress,
        message: responseData.progressMessage
      });
    }

    // Continue processing if not complete
    if (!responseData.isComplete) {
      // Schedule next check or wait for more data
      setTimeout(() => {
        this.emit('response:continue', { executionId });
      }, 1000);
    }
  }

  // Send chat message
  private async sendChatMessage(
    conversationId: string,
    message: any,
    options: ChatResponseOptions = {}
  ): Promise<void> {
    try {
      // Add typing indicator if requested
      if (options.typing) {
        this.emit('chat:typing:start', { conversationId });
        
        // Simulate typing delay
        if (options.delay) {
          await new Promise(resolve => setTimeout(resolve, options.delay));
        }
      }

      // Format message content based on format option
      let formattedContent = message.content;
      if (options.format && options.format !== 'text') {
        formattedContent = this.formatMessageContent(message.content, options.format);
      }

      // Create message in database
      const chatMessage = await this.prisma.message.create({
        data: {
          conversationId,
          content: formattedContent,
          type: message.type || 'bot',
          metadata: message.metadata || {}
        }
      });

      // Stop typing indicator
      if (options.typing) {
        this.emit('chat:typing:stop', { conversationId });
      }

      // Emit message event for real-time delivery
      this.emit('chat:message', {
        conversationId,
        message: chatMessage
      });

    } catch (error) {
      console.error('Failed to send chat message:', error);
      throw error;
    }
  }

  // Execute workflow actions
  private async executeAction(action: any, context: WorkflowResponseContext): Promise<void> {
    try {
      switch (action.type) {
        case 'create_ticket':
          await this.createSupportTicket(action.data, context);
          break;
        case 'update_user':
          await this.updateUserData(action.data, context);
          break;
        case 'send_email':
          await this.sendEmail(action.data, context);
          break;
        case 'create_lead':
          await this.createLead(action.data, context);
          break;
        case 'schedule_followup':
          await this.scheduleFollowup(action.data, context);
          break;
        default:
          console.warn(`Unknown action type: ${action.type}`);
      }
    } catch (error) {
      console.error(`Failed to execute action ${action.type}:`, error);
    }
  }

  // Process data updates
  private async processDataUpdates(updates: any, context: WorkflowResponseContext): Promise<void> {
    try {
      for (const update of updates) {
        switch (update.target) {
          case 'user_profile':
            await this.updateUserProfile(update.data, context);
            break;
          case 'conversation_metadata':
            await this.updateConversationMetadata(update.data, context);
            break;
          case 'custom_fields':
            await this.updateCustomFields(update.data, context);
            break;
        }
      }
    } catch (error) {
      console.error('Failed to process data updates:', error);
    }
  }

  // Send notifications
  private async sendNotifications(notifications: any[], context: WorkflowResponseContext): Promise<void> {
    for (const notification of notifications) {
      try {
        switch (notification.type) {
          case 'email':
            await this.sendEmailNotification(notification, context);
            break;
          case 'slack':
            await this.sendSlackNotification(notification, context);
            break;
          case 'webhook':
            await this.sendWebhookNotification(notification, context);
            break;
          case 'in_app':
            await this.sendInAppNotification(notification, context);
            break;
        }
      } catch (error) {
        console.error(`Failed to send ${notification.type} notification:`, error);
      }
    }
  }

  // Trigger external webhooks
  private async triggerWebhooks(webhooks: any[], context: WorkflowResponseContext): Promise<void> {
    for (const webhook of webhooks) {
      try {
        const response = await fetch(webhook.url, {
          method: webhook.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...webhook.headers
          },
          body: JSON.stringify({
            executionId: context.executionId,
            workflowId: context.workflowId,
            tenantId: context.tenantId,
            data: webhook.data,
            timestamp: new Date().toISOString()
          })
        });

        if (!response.ok) {
          throw new Error(`Webhook failed with status ${response.status}`);
        }

      } catch (error) {
        console.error(`Failed to trigger webhook ${webhook.url}:`, error);
      }
    }
  }

  // Helper methods for specific actions
  private async createSupportTicket(data: any, context: WorkflowResponseContext): Promise<void> {
    // Implementation would integrate with support system
    console.log('Creating support ticket:', data);
  }

  private async updateUserData(data: any, context: WorkflowResponseContext): Promise<void> {
    if (context.userId) {
      await this.prisma.user.update({
        where: { id: context.userId },
        data: data
      });
    }
  }

  private async sendEmail(data: any, context: WorkflowResponseContext): Promise<void> {
    // Implementation would integrate with email service
    console.log('Sending email:', data);
  }

  private async createLead(data: any, context: WorkflowResponseContext): Promise<void> {
    // Implementation would integrate with CRM
    console.log('Creating lead:', data);
  }

  private async scheduleFollowup(data: any, context: WorkflowResponseContext): Promise<void> {
    // Implementation would schedule future workflow execution
    console.log('Scheduling followup:', data);
  }

  private async updateUserProfile(data: any, context: WorkflowResponseContext): Promise<void> {
    if (context.userId) {
      // Update user profile fields
      await this.prisma.user.update({
        where: { id: context.userId },
        data: {
          metadata: {
            ...data
          }
        }
      });
    }
  }

  private async updateConversationMetadata(data: any, context: WorkflowResponseContext): Promise<void> {
    if (context.conversationId) {
      await this.prisma.conversation.update({
        where: { id: context.conversationId },
        data: {
          metadata: data
        }
      });
    }
  }

  private async updateCustomFields(data: any, context: WorkflowResponseContext): Promise<void> {
    // Implementation for custom field updates
    console.log('Updating custom fields:', data);
  }

  private async sendEmailNotification(notification: any, context: WorkflowResponseContext): Promise<void> {
    // Email notification implementation
    console.log('Sending email notification:', notification);
  }

  private async sendSlackNotification(notification: any, context: WorkflowResponseContext): Promise<void> {
    // Slack notification implementation
    console.log('Sending Slack notification:', notification);
  }

  private async sendWebhookNotification(notification: any, context: WorkflowResponseContext): Promise<void> {
    // Webhook notification implementation
    console.log('Sending webhook notification:', notification);
  }

  private async sendInAppNotification(notification: any, context: WorkflowResponseContext): Promise<void> {
    // In-app notification implementation
    this.emit('notification:in_app', {
      tenantId: context.tenantId,
      userId: context.userId,
      notification
    });
  }

  private formatMessageContent(content: string, format: string): string {
    switch (format) {
      case 'markdown':
        return content; // Already markdown
      case 'html':
        // Convert markdown to HTML if needed
        return content;
      case 'json':
        return JSON.stringify({ message: content });
      default:
        return content;
    }
  }

  private async logError(context: WorkflowResponseContext, errorData: any): Promise<void> {
    console.error('Workflow execution error:', {
      executionId: context.executionId,
      workflowId: context.workflowId,
      tenantId: context.tenantId,
      error: errorData
    });
  }

  private async sendErrorNotifications(context: WorkflowResponseContext, workflow: any): Promise<void> {
    const notifications = workflow.definition?.errorHandling?.notifications || [];
    
    for (const notification of notifications) {
      await this.sendNotifications([{
        ...notification,
        data: {
          ...notification.data,
          executionId: context.executionId,
          workflowId: context.workflowId,
          error: context.responseData
        }
      }], context);
    }
  }

  private async updateExecutionResponse(executionId: string, updates: any): Promise<void> {
    await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        metadata: updates
      }
    });
  }

  // Get response handling statistics
  async getResponseStats(tenantId: string): Promise<any> {
    const [totalResponses, successfulResponses, errorResponses] = await Promise.all([
      this.prisma.workflowExecution.count({
        where: {
          tenantId,
          metadata: {
            path: ['responseHandled'],
            equals: true
          }
        }
      }),
      this.prisma.workflowExecution.count({
        where: {
          tenantId,
          metadata: {
            path: ['responseType'],
            equals: 'success'
          }
        }
      }),
      this.prisma.workflowExecution.count({
        where: {
          tenantId,
          metadata: {
            path: ['responseType'],
            equals: 'error'
          }
        }
      })
    ]);

    return {
      totalResponses,
      successfulResponses,
      errorResponses,
      successRate: totalResponses > 0 ? successfulResponses / totalResponses : 0
    };
  }
}
