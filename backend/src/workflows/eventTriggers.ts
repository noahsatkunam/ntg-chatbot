import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { WorkflowService } from './workflowService';
import { TenantIsolationService } from './security/tenantIsolation';

const prisma = new PrismaClient();

export interface EventTrigger {
  id: string;
  workflowId: string;
  tenantId: string;
  eventType: string;
  conditions: TriggerCondition[];
  enabled: boolean;
  priority: number;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TriggerCondition {
  field: string;
  operator: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'regex' | 'gt' | 'lt' | 'gte' | 'lte';
  value: any;
  caseSensitive?: boolean;
}

export interface EventData {
  type: string;
  source: string;
  tenantId: string;
  userId?: string;
  conversationId?: string;
  messageId?: string;
  data: Record<string, any>;
  timestamp: Date;
}

export class EventTriggerService extends EventEmitter {
  private workflowService: WorkflowService;
  private tenantIsolation: TenantIsolationService;
  private activeTriggers: Map<string, EventTrigger[]> = new Map();

  constructor() {
    super();
    this.workflowService = new WorkflowService();
    this.tenantIsolation = new TenantIsolationService();
    this.initializeTriggers();
  }

  private async initializeTriggers(): Promise<void> {
    try {
      const triggers = await prisma.workflowTrigger.findMany({
        where: { enabled: true },
        include: { workflow: true }
      });

      // Group triggers by event type for efficient lookup
      for (const trigger of triggers) {
        const eventType = trigger.eventType;
        if (!this.activeTriggers.has(eventType)) {
          this.activeTriggers.set(eventType, []);
        }
        this.activeTriggers.get(eventType)!.push(this.mapToEventTrigger(trigger));
      }

      console.log(`Initialized ${triggers.length} event triggers`);
    } catch (error) {
      console.error('Failed to initialize event triggers:', error);
    }
  }

  async createTrigger(
    tenantId: string,
    workflowId: string,
    eventType: string,
    conditions: TriggerCondition[],
    options: {
      enabled?: boolean;
      priority?: number;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<EventTrigger> {
    // Validate tenant access
    await this.tenantIsolation.validateWorkflowAccess(tenantId, workflowId);

    const trigger = await prisma.workflowTrigger.create({
      data: {
        workflowId,
        tenantId,
        eventType,
        conditions: JSON.stringify(conditions),
        enabled: options.enabled ?? true,
        priority: options.priority ?? 0,
        metadata: options.metadata || {}
      },
      include: { workflow: true }
    });

    const eventTrigger = this.mapToEventTrigger(trigger);

    // Add to active triggers if enabled
    if (eventTrigger.enabled) {
      if (!this.activeTriggers.has(eventType)) {
        this.activeTriggers.set(eventType, []);
      }
      this.activeTriggers.get(eventType)!.push(eventTrigger);
      this.sortTriggersByPriority(eventType);
    }

    return eventTrigger;
  }

  async updateTrigger(
    tenantId: string,
    triggerId: string,
    updates: {
      eventType?: string;
      conditions?: TriggerCondition[];
      enabled?: boolean;
      priority?: number;
      metadata?: Record<string, any>;
    }
  ): Promise<EventTrigger> {
    const existingTrigger = await prisma.workflowTrigger.findFirst({
      where: { id: triggerId, tenantId },
      include: { workflow: true }
    });

    if (!existingTrigger) {
      throw new Error('Trigger not found or access denied');
    }

    // Remove from current active triggers
    this.removeFromActiveTriggers(existingTrigger.eventType, triggerId);

    const updatedTrigger = await prisma.workflowTrigger.update({
      where: { id: triggerId },
      data: {
        eventType: updates.eventType,
        conditions: updates.conditions ? JSON.stringify(updates.conditions) : undefined,
        enabled: updates.enabled,
        priority: updates.priority,
        metadata: updates.metadata,
        updatedAt: new Date()
      },
      include: { workflow: true }
    });

    const eventTrigger = this.mapToEventTrigger(updatedTrigger);

    // Add to active triggers if enabled
    if (eventTrigger.enabled) {
      const eventType = eventTrigger.eventType;
      if (!this.activeTriggers.has(eventType)) {
        this.activeTriggers.set(eventType, []);
      }
      this.activeTriggers.get(eventType)!.push(eventTrigger);
      this.sortTriggersByPriority(eventType);
    }

    return eventTrigger;
  }

  async deleteTrigger(tenantId: string, triggerId: string): Promise<void> {
    const trigger = await prisma.workflowTrigger.findFirst({
      where: { id: triggerId, tenantId }
    });

    if (!trigger) {
      throw new Error('Trigger not found or access denied');
    }

    // Remove from active triggers
    this.removeFromActiveTriggers(trigger.eventType, triggerId);

    // Delete from database
    await prisma.workflowTrigger.delete({
      where: { id: triggerId }
    });
  }

  async getTriggers(tenantId: string): Promise<EventTrigger[]> {
    const triggers = await prisma.workflowTrigger.findMany({
      where: { tenantId },
      include: { workflow: true },
      orderBy: [{ eventType: 'asc' }, { priority: 'desc' }]
    });

    return triggers.map(this.mapToEventTrigger);
  }

  async getTrigger(tenantId: string, triggerId: string): Promise<EventTrigger | null> {
    const trigger = await prisma.workflowTrigger.findFirst({
      where: { id: triggerId, tenantId },
      include: { workflow: true }
    });

    return trigger ? this.mapToEventTrigger(trigger) : null;
  }

  async processEvent(event: EventData): Promise<void> {
    try {
      const triggers = this.activeTriggers.get(event.type) || [];
      const matchingTriggers = triggers.filter(trigger => 
        trigger.tenantId === event.tenantId && this.evaluateConditions(trigger.conditions, event)
      );

      // Execute workflows for matching triggers
      for (const trigger of matchingTriggers) {
        try {
          await this.workflowService.executeWorkflow(
            trigger.tenantId,
            trigger.workflowId,
            {
              trigger: 'event',
              eventType: event.type,
              eventData: event.data,
              eventSource: event.source,
              userId: event.userId,
              conversationId: event.conversationId,
              messageId: event.messageId,
              timestamp: event.timestamp,
              ...trigger.metadata
            }
          );

          console.log(`Triggered workflow ${trigger.workflowId} for event ${event.type}`);
        } catch (error) {
          console.error(`Failed to execute workflow ${trigger.workflowId} for event ${event.type}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to process event:', error);
    }
  }

  // Chat-specific event handlers
  async onMessageReceived(tenantId: string, conversationId: string, message: any): Promise<void> {
    const event: EventData = {
      type: 'chat.message.received',
      source: 'chat',
      tenantId,
      userId: message.userId,
      conversationId,
      messageId: message.id,
      data: {
        content: message.content,
        messageType: message.type,
        attachments: message.attachments,
        metadata: message.metadata
      },
      timestamp: new Date()
    };

    await this.processEvent(event);
  }

  async onMessageSent(tenantId: string, conversationId: string, message: any): Promise<void> {
    const event: EventData = {
      type: 'chat.message.sent',
      source: 'chat',
      tenantId,
      userId: message.userId,
      conversationId,
      messageId: message.id,
      data: {
        content: message.content,
        messageType: message.type,
        isAI: message.isAI
      },
      timestamp: new Date()
    };

    await this.processEvent(event);
  }

  async onUserJoined(tenantId: string, conversationId: string, userId: string): Promise<void> {
    const event: EventData = {
      type: 'chat.user.joined',
      source: 'chat',
      tenantId,
      userId,
      conversationId,
      data: { userId },
      timestamp: new Date()
    };

    await this.processEvent(event);
  }

  async onUserLeft(tenantId: string, conversationId: string, userId: string): Promise<void> {
    const event: EventData = {
      type: 'chat.user.left',
      source: 'chat',
      tenantId,
      userId,
      conversationId,
      data: { userId },
      timestamp: new Date()
    };

    await this.processEvent(event);
  }

  // Knowledge base event handlers
  async onDocumentUploaded(tenantId: string, document: any): Promise<void> {
    const event: EventData = {
      type: 'knowledge.document.uploaded',
      source: 'knowledge',
      tenantId,
      userId: document.uploadedBy,
      data: {
        documentId: document.id,
        fileName: document.fileName,
        fileType: document.fileType,
        fileSize: document.fileSize,
        collectionId: document.collectionId
      },
      timestamp: new Date()
    };

    await this.processEvent(event);
  }

  async onDocumentProcessed(tenantId: string, document: any): Promise<void> {
    const event: EventData = {
      type: 'knowledge.document.processed',
      source: 'knowledge',
      tenantId,
      data: {
        documentId: document.id,
        chunkCount: document.chunkCount,
        processingTime: document.processingTime,
        status: document.status
      },
      timestamp: new Date()
    };

    await this.processEvent(event);
  }

  // User behavior event handlers
  async onUserLogin(tenantId: string, userId: string, loginData: any): Promise<void> {
    const event: EventData = {
      type: 'user.login',
      source: 'auth',
      tenantId,
      userId,
      data: {
        loginMethod: loginData.method,
        ipAddress: loginData.ipAddress,
        userAgent: loginData.userAgent
      },
      timestamp: new Date()
    };

    await this.processEvent(event);
  }

  async onUserActivity(tenantId: string, userId: string, activity: any): Promise<void> {
    const event: EventData = {
      type: 'user.activity',
      source: 'platform',
      tenantId,
      userId,
      data: {
        action: activity.action,
        resource: activity.resource,
        metadata: activity.metadata
      },
      timestamp: new Date()
    };

    await this.processEvent(event);
  }

  // External webhook handler
  async onWebhookReceived(tenantId: string, webhookData: any): Promise<void> {
    const event: EventData = {
      type: 'webhook.received',
      source: 'external',
      tenantId,
      data: webhookData,
      timestamp: new Date()
    };

    await this.processEvent(event);
  }

  private evaluateConditions(conditions: TriggerCondition[], event: EventData): boolean {
    return conditions.every(condition => this.evaluateCondition(condition, event));
  }

  private evaluateCondition(condition: TriggerCondition, event: EventData): boolean {
    const fieldValue = this.getFieldValue(condition.field, event);
    const conditionValue = condition.value;

    if (fieldValue === undefined || fieldValue === null) {
      return false;
    }

    switch (condition.operator) {
      case 'equals':
        return this.compareValues(fieldValue, conditionValue, condition.caseSensitive);
      case 'contains':
        return this.stringContains(fieldValue, conditionValue, condition.caseSensitive);
      case 'startsWith':
        return this.stringStartsWith(fieldValue, conditionValue, condition.caseSensitive);
      case 'endsWith':
        return this.stringEndsWith(fieldValue, conditionValue, condition.caseSensitive);
      case 'regex':
        return this.regexMatch(fieldValue, conditionValue, condition.caseSensitive);
      case 'gt':
        return Number(fieldValue) > Number(conditionValue);
      case 'lt':
        return Number(fieldValue) < Number(conditionValue);
      case 'gte':
        return Number(fieldValue) >= Number(conditionValue);
      case 'lte':
        return Number(fieldValue) <= Number(conditionValue);
      default:
        return false;
    }
  }

  private getFieldValue(field: string, event: EventData): any {
    const parts = field.split('.');
    let value: any = event;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private compareValues(value1: any, value2: any, caseSensitive: boolean = true): boolean {
    if (typeof value1 === 'string' && typeof value2 === 'string') {
      return caseSensitive ? value1 === value2 : value1.toLowerCase() === value2.toLowerCase();
    }
    return value1 === value2;
  }

  private stringContains(str: any, substring: any, caseSensitive: boolean = true): boolean {
    const strValue = String(str);
    const substrValue = String(substring);
    return caseSensitive 
      ? strValue.includes(substrValue)
      : strValue.toLowerCase().includes(substrValue.toLowerCase());
  }

  private stringStartsWith(str: any, prefix: any, caseSensitive: boolean = true): boolean {
    const strValue = String(str);
    const prefixValue = String(prefix);
    return caseSensitive
      ? strValue.startsWith(prefixValue)
      : strValue.toLowerCase().startsWith(prefixValue.toLowerCase());
  }

  private stringEndsWith(str: any, suffix: any, caseSensitive: boolean = true): boolean {
    const strValue = String(str);
    const suffixValue = String(suffix);
    return caseSensitive
      ? strValue.endsWith(suffixValue)
      : strValue.toLowerCase().endsWith(suffixValue.toLowerCase());
  }

  private regexMatch(str: any, pattern: any, caseSensitive: boolean = true): boolean {
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(pattern, flags);
      return regex.test(String(str));
    } catch (error) {
      console.error('Invalid regex pattern:', pattern);
      return false;
    }
  }

  private removeFromActiveTriggers(eventType: string, triggerId: string): void {
    const triggers = this.activeTriggers.get(eventType);
    if (triggers) {
      const index = triggers.findIndex(t => t.id === triggerId);
      if (index !== -1) {
        triggers.splice(index, 1);
      }
    }
  }

  private sortTriggersByPriority(eventType: string): void {
    const triggers = this.activeTriggers.get(eventType);
    if (triggers) {
      triggers.sort((a, b) => b.priority - a.priority);
    }
  }

  private mapToEventTrigger(trigger: any): EventTrigger {
    return {
      id: trigger.id,
      workflowId: trigger.workflowId,
      tenantId: trigger.tenantId,
      eventType: trigger.eventType,
      conditions: JSON.parse(trigger.conditions),
      enabled: trigger.enabled,
      priority: trigger.priority,
      metadata: trigger.metadata,
      createdAt: trigger.createdAt,
      updatedAt: trigger.updatedAt
    };
  }

  // Utility methods for common trigger patterns
  static createChatMessageTrigger(patterns: string[]): TriggerCondition[] {
    return patterns.map(pattern => ({
      field: 'data.content',
      operator: 'contains' as const,
      value: pattern,
      caseSensitive: false
    }));
  }

  static createUserBehaviorTrigger(action: string, resource?: string): TriggerCondition[] {
    const conditions: TriggerCondition[] = [
      {
        field: 'data.action',
        operator: 'equals',
        value: action
      }
    ];

    if (resource) {
      conditions.push({
        field: 'data.resource',
        operator: 'equals',
        value: resource
      });
    }

    return conditions;
  }

  static createTimeBasedTrigger(timeField: string, operator: 'gt' | 'lt' | 'gte' | 'lte', value: number): TriggerCondition[] {
    return [{
      field: timeField,
      operator,
      value
    }];
  }
}
