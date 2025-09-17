import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { TriggerMatch, ChatTriggerContext } from './chatTriggerService';
import { ExecutionResult } from './workflowExecutor';

export interface ChatResponse {
  type: 'message' | 'card' | 'buttons' | 'form' | 'progress' | 'confirmation' | 'error';
  content: any;
  metadata?: any;
  actions?: ResponseAction[];
  timestamp: Date;
}

export interface ResponseAction {
  id: string;
  type: 'button' | 'link' | 'command' | 'input';
  label: string;
  value?: any;
  style?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  icon?: string;
}

export interface ResponseTemplate {
  id: string;
  name: string;
  type: string;
  template: string;
  variables: string[];
  conditions?: any;
}

export class ResponseHandler extends EventEmitter {
  private prisma: PrismaClient;
  private templates: Map<string, ResponseTemplate> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.loadResponseTemplates();
  }

  // Generate confirmation request for workflow execution
  async generateConfirmationRequest(
    triggerMatch: TriggerMatch,
    chatContext: ChatTriggerContext,
    confirmationId: string
  ): Promise<ChatResponse> {
    const workflow = await this.getWorkflowInfo(triggerMatch.workflowId);
    
    const response: ChatResponse = {
      type: 'confirmation',
      content: {
        title: 'Confirm Workflow Execution',
        message: `Do you want to execute the workflow "${triggerMatch.workflowName}"?`,
        details: {
          trigger: triggerMatch.matchedText,
          confidence: `${Math.round(triggerMatch.confidence * 100)}%`,
          workflow: workflow?.description || 'No description available'
        }
      },
      actions: [
        {
          id: `confirm_${confirmationId}`,
          type: 'button',
          label: 'Yes, Execute',
          value: { action: 'confirm', confirmationId },
          style: 'primary',
          icon: 'play_arrow'
        },
        {
          id: `cancel_${confirmationId}`,
          type: 'button',
          label: 'Cancel',
          value: { action: 'cancel', confirmationId },
          style: 'secondary',
          icon: 'cancel'
        }
      ],
      timestamp: new Date()
    };

    return response;
  }

  // Generate cancellation response
  async generateCancellationResponse(
    triggerMatch: TriggerMatch,
    chatContext: ChatTriggerContext
  ): Promise<ChatResponse> {
    return {
      type: 'message',
      content: {
        text: `Workflow execution cancelled.`,
        details: `The "${triggerMatch.workflowName}" workflow was not executed.`
      },
      metadata: {
        workflowId: triggerMatch.workflowId,
        cancelled: true
      },
      timestamp: new Date()
    };
  }

  // Generate success response for completed workflow
  async generateSuccessResponse(
    execution: any,
    executionResult: ExecutionResult
  ): Promise<ChatResponse> {
    const workflow = await this.getWorkflowInfo(execution.workflowId);
    const resultData = execution.resultData || {};

    // Check if workflow has custom response template
    const customResponse = await this.generateCustomResponse(
      execution.workflowId,
      'success',
      resultData,
      execution
    );

    if (customResponse) {
      return customResponse;
    }

    // Generate default success response
    const response: ChatResponse = {
      type: 'card',
      content: {
        title: '✅ Workflow Completed Successfully',
        subtitle: workflow?.name || 'Unknown Workflow',
        description: this.formatExecutionSummary(executionResult),
        fields: this.extractResultFields(resultData),
        footer: `Completed in ${this.formatDuration(executionResult.duration || 0)}`
      },
      actions: this.generateResultActions(execution, resultData),
      metadata: {
        executionId: execution.id,
        workflowId: execution.workflowId,
        status: 'success'
      },
      timestamp: new Date()
    };

    return response;
  }

  // Generate error response for failed workflow
  async generateErrorResponse(
    execution: any,
    executionResult: ExecutionResult
  ): Promise<ChatResponse> {
    const workflow = await this.getWorkflowInfo(execution.workflowId);

    // Check if workflow has custom error template
    const customResponse = await this.generateCustomResponse(
      execution.workflowId,
      'error',
      { error: execution.error },
      execution
    );

    if (customResponse) {
      return customResponse;
    }

    // Generate default error response
    const response: ChatResponse = {
      type: 'error',
      content: {
        title: '❌ Workflow Failed',
        subtitle: workflow?.name || 'Unknown Workflow',
        message: this.formatErrorMessage(execution.error),
        details: {
          executionId: execution.id,
          duration: this.formatDuration(executionResult.duration || 0),
          error: execution.error
        }
      },
      actions: [
        {
          id: `retry_${execution.id}`,
          type: 'button',
          label: 'Retry Workflow',
          value: { action: 'retry', executionId: execution.id },
          style: 'primary',
          icon: 'refresh'
        },
        {
          id: `details_${execution.id}`,
          type: 'button',
          label: 'View Details',
          value: { action: 'details', executionId: execution.id },
          style: 'secondary',
          icon: 'info'
        }
      ],
      metadata: {
        executionId: execution.id,
        workflowId: execution.workflowId,
        status: 'error'
      },
      timestamp: new Date()
    };

    return response;
  }

  // Generate progress response for running workflow
  async generateProgressResponse(
    execution: any,
    progress: number,
    currentStep?: string
  ): Promise<ChatResponse> {
    const workflow = await this.getWorkflowInfo(execution.workflowId);

    const response: ChatResponse = {
      type: 'progress',
      content: {
        title: '⏳ Workflow Running',
        subtitle: workflow?.name || 'Unknown Workflow',
        progress: Math.round(progress),
        currentStep: currentStep || 'Processing...',
        message: `${Math.round(progress)}% complete`
      },
      actions: [
        {
          id: `cancel_${execution.id}`,
          type: 'button',
          label: 'Cancel',
          value: { action: 'cancel', executionId: execution.id },
          style: 'danger',
          icon: 'stop'
        }
      ],
      metadata: {
        executionId: execution.id,
        workflowId: execution.workflowId,
        status: 'running',
        progress
      },
      timestamp: new Date()
    };

    return response;
  }

  // Generate input request response
  async generateInputRequest(
    inputRequest: any,
    chatContext: ChatTriggerContext
  ): Promise<ChatResponse> {
    const response: ChatResponse = {
      type: 'form',
      content: {
        title: 'Input Required',
        message: inputRequest.prompt,
        fields: [
          {
            id: inputRequest.id,
            type: inputRequest.type,
            label: inputRequest.prompt,
            required: inputRequest.required,
            options: inputRequest.options,
            validation: inputRequest.validation
          }
        ]
      },
      actions: [
        {
          id: `submit_${inputRequest.id}`,
          type: 'button',
          label: 'Submit',
          value: { action: 'submit_input', requestId: inputRequest.id },
          style: 'primary',
          icon: 'send'
        },
        {
          id: `cancel_${inputRequest.id}`,
          type: 'button',
          label: 'Cancel',
          value: { action: 'cancel_input', requestId: inputRequest.id },
          style: 'secondary',
          icon: 'cancel'
        }
      ],
      metadata: {
        inputRequestId: inputRequest.id,
        workflowId: inputRequest.workflowId,
        executionId: inputRequest.executionId,
        type: 'input_request'
      },
      timestamp: new Date()
    };

    return response;
  }

  // Generate approval request response
  async generateApprovalRequest(
    approvalRequest: any,
    chatContext: ChatTriggerContext
  ): Promise<ChatResponse> {
    const response: ChatResponse = {
      type: 'card',
      content: {
        title: '📋 Approval Required',
        subtitle: approvalRequest.title,
        description: approvalRequest.description,
        fields: approvalRequest.data ? this.extractResultFields(approvalRequest.data) : [],
        footer: `Requires ${approvalRequest.requiredApprovals} approval(s)`
      },
      actions: [
        {
          id: `approve_${approvalRequest.id}`,
          type: 'button',
          label: 'Approve',
          value: { action: 'approve', requestId: approvalRequest.id },
          style: 'success',
          icon: 'check'
        },
        {
          id: `reject_${approvalRequest.id}`,
          type: 'button',
          label: 'Reject',
          value: { action: 'reject', requestId: approvalRequest.id },
          style: 'danger',
          icon: 'close'
        }
      ],
      metadata: {
        approvalRequestId: approvalRequest.id,
        workflowId: approvalRequest.workflowId,
        executionId: approvalRequest.executionId,
        type: 'approval_request'
      },
      timestamp: new Date()
    };

    return response;
  }

  // Generate workflow list response
  async generateWorkflowListResponse(
    workflows: any[],
    chatContext: ChatTriggerContext
  ): Promise<ChatResponse> {
    const workflowButtons = workflows.slice(0, 10).map((workflow, index) => ({
      id: `execute_${workflow.id}`,
      type: 'button' as const,
      label: `${index + 1}. ${workflow.name}`,
      value: { action: 'execute_workflow', workflowId: workflow.id },
      style: 'secondary' as const
    }));

    const response: ChatResponse = {
      type: 'buttons',
      content: {
        title: 'Available Workflows',
        message: 'Select a workflow to execute:',
        description: `Found ${workflows.length} available workflows`
      },
      actions: workflowButtons,
      metadata: {
        type: 'workflow_list',
        count: workflows.length
      },
      timestamp: new Date()
    };

    return response;
  }

  // Generate execution history response
  async generateExecutionHistoryResponse(
    executions: any[],
    chatContext: ChatTriggerContext
  ): Promise<ChatResponse> {
    const executionItems = executions.slice(0, 10).map(execution => ({
      title: execution.workflow?.name || 'Unknown Workflow',
      subtitle: `${execution.status} • ${this.formatDate(execution.startTime)}`,
      description: execution.error || 'Completed successfully',
      status: execution.status,
      duration: execution.endTime 
        ? this.formatDuration(execution.endTime.getTime() - execution.startTime.getTime())
        : 'Running...'
    }));

    const response: ChatResponse = {
      type: 'card',
      content: {
        title: '📊 Recent Executions',
        items: executionItems,
        footer: `Showing ${executionItems.length} of ${executions.length} executions`
      },
      actions: [
        {
          id: 'view_all_executions',
          type: 'link',
          label: 'View All',
          value: { action: 'view_executions' },
          style: 'secondary'
        }
      ],
      metadata: {
        type: 'execution_history',
        count: executions.length
      },
      timestamp: new Date()
    };

    return response;
  }

  // Generate custom response using templates
  private async generateCustomResponse(
    workflowId: string,
    responseType: string,
    data: any,
    execution: any
  ): Promise<ChatResponse | null> {
    try {
      // Get workflow-specific response template
      const workflow = await this.prisma.workflow.findUnique({
        where: { id: workflowId },
        select: { configuration: true }
      });

      const config = workflow?.configuration as any;
      const responseTemplates = config?.responseTemplates;

      if (!responseTemplates || !responseTemplates[responseType]) {
        return null;
      }

      const template = responseTemplates[responseType];
      
      // Process template with data
      const processedContent = this.processTemplate(template, {
        ...data,
        execution,
        workflow: { id: workflowId, name: workflow?.name }
      });

      return {
        type: template.type || 'message',
        content: processedContent,
        actions: template.actions || [],
        metadata: {
          executionId: execution.id,
          workflowId,
          templateType: responseType,
          custom: true
        },
        timestamp: new Date()
      };

    } catch (error) {
      console.error('Error generating custom response:', error);
      return null;
    }
  }

  // Process template with variables
  private processTemplate(template: any, variables: any): any {
    const templateStr = JSON.stringify(template);
    const processedStr = templateStr.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      const value = this.getNestedValue(variables, path);
      return value !== undefined ? String(value) : match;
    });

    try {
      return JSON.parse(processedStr);
    } catch {
      return template;
    }
  }

  // Get nested object value by path
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  // Format execution summary
  private formatExecutionSummary(executionResult: ExecutionResult): string {
    const duration = executionResult.duration || 0;
    const durationStr = this.formatDuration(duration);
    
    return `Workflow executed successfully in ${durationStr}`;
  }

  // Extract result fields for display
  private extractResultFields(resultData: any): any[] {
    if (!resultData || typeof resultData !== 'object') {
      return [];
    }

    const fields = [];
    const maxFields = 5;
    let fieldCount = 0;

    for (const [key, value] of Object.entries(resultData)) {
      if (fieldCount >= maxFields) break;
      
      // Skip internal fields
      if (key.startsWith('_') || key === 'metadata') continue;

      fields.push({
        name: this.formatFieldName(key),
        value: this.formatFieldValue(value),
        inline: true
      });
      
      fieldCount++;
    }

    return fields;
  }

  // Generate result actions based on workflow output
  private generateResultActions(execution: any, resultData: any): ResponseAction[] {
    const actions: ResponseAction[] = [];

    // Add view details action
    actions.push({
      id: `details_${execution.id}`,
      type: 'button',
      label: 'View Details',
      value: { action: 'view_details', executionId: execution.id },
      style: 'secondary',
      icon: 'info'
    });

    // Add actions based on result data
    if (resultData?.actions) {
      for (const action of resultData.actions) {
        actions.push({
          id: `result_action_${action.id}`,
          type: action.type || 'button',
          label: action.label,
          value: action.value,
          style: action.style || 'secondary',
          icon: action.icon
        });
      }
    }

    // Add common actions
    if (resultData?.url) {
      actions.push({
        id: `open_url_${execution.id}`,
        type: 'link',
        label: 'Open Link',
        value: { action: 'open_url', url: resultData.url },
        style: 'primary',
        icon: 'open_in_new'
      });
    }

    return actions;
  }

  // Format error message for display
  private formatErrorMessage(error: string): string {
    if (!error) return 'An unknown error occurred';
    
    // Clean up technical error messages
    const cleanError = error
      .replace(/Error: /g, '')
      .replace(/at .+/g, '')
      .trim();

    return cleanError || 'An unknown error occurred';
  }

  // Format duration in human-readable format
  private formatDuration(milliseconds: number): string {
    if (milliseconds < 1000) {
      return `${milliseconds}ms`;
    }
    
    const seconds = Math.floor(milliseconds / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  // Format date for display
  private formatDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  }

  // Format field name for display
  private formatFieldName(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .replace(/_/g, ' ');
  }

  // Format field value for display
  private formatFieldValue(value: any): string {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    if (typeof value === 'string' && value.length > 100) {
      return value.substring(0, 100) + '...';
    }
    return String(value);
  }

  // Get workflow information
  private async getWorkflowInfo(workflowId: string): Promise<any> {
    return await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: {
        id: true,
        name: true,
        description: true,
        configuration: true
      }
    });
  }

  // Load response templates from database
  private async loadResponseTemplates(): Promise<void> {
    try {
      const templates = await this.prisma.responseTemplate.findMany({
        where: { isActive: true }
      });

      for (const template of templates) {
        this.templates.set(template.id, {
          id: template.id,
          name: template.name,
          type: template.type,
          template: template.template as string,
          variables: template.variables as string[],
          conditions: template.conditions as any
        });
      }
    } catch (error) {
      console.error('Error loading response templates:', error);
    }
  }

  // Create response template
  async createResponseTemplate(
    name: string,
    type: string,
    template: any,
    variables: string[],
    tenantId: string
  ): Promise<string> {
    const responseTemplate = await this.prisma.responseTemplate.create({
      data: {
        name,
        type,
        template,
        variables,
        tenantId,
        isActive: true
      }
    });

    this.templates.set(responseTemplate.id, {
      id: responseTemplate.id,
      name,
      type,
      template: template as string,
      variables,
      conditions: null
    });

    return responseTemplate.id;
  }

  // Update response template
  async updateResponseTemplate(
    templateId: string,
    updates: Partial<ResponseTemplate>,
    tenantId: string
  ): Promise<void> {
    await this.prisma.responseTemplate.updateMany({
      where: {
        id: templateId,
        tenantId
      },
      data: updates
    });

    // Update cache
    const existing = this.templates.get(templateId);
    if (existing) {
      this.templates.set(templateId, { ...existing, ...updates });
    }
  }

  // Delete response template
  async deleteResponseTemplate(templateId: string, tenantId: string): Promise<void> {
    await this.prisma.responseTemplate.deleteMany({
      where: {
        id: templateId,
        tenantId
      }
    });

    this.templates.delete(templateId);
  }

  // Get response templates for tenant
  async getResponseTemplates(tenantId: string): Promise<ResponseTemplate[]> {
    const templates = await this.prisma.responseTemplate.findMany({
      where: {
        tenantId,
        isActive: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return templates.map(t => ({
      id: t.id,
      name: t.name,
      type: t.type,
      template: t.template as string,
      variables: t.variables as string[],
      conditions: t.conditions as any
    }));
  }
}
