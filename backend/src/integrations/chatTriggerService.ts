import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { IntentDetector } from './intentDetector';
import { ContextManager } from './contextManager';

export interface ChatTriggerContext {
  conversationId: string;
  messageId: string;
  messageContent: string;
  userId: string;
  tenantId: string;
  messageType: 'user' | 'bot';
  timestamp: Date;
  metadata?: any;
  previousMessages?: any[];
}

export interface TriggerMatch {
  workflowId: string;
  workflowName: string;
  confidence: number;
  triggerType: 'keyword' | 'intent' | 'pattern' | 'command';
  matchedText: string;
  parameters?: any;
  requiresConfirmation: boolean;
}

export interface TriggerRule {
  id: string;
  workflowId: string;
  tenantId: string;
  triggerType: 'keyword' | 'intent' | 'pattern' | 'command';
  configuration: {
    keywords?: string[];
    patterns?: string[];
    intents?: string[];
    commands?: string[];
    caseSensitive?: boolean;
    requireExactMatch?: boolean;
    contextRequired?: boolean;
    userRoles?: string[];
    timeRestrictions?: {
      startHour?: number;
      endHour?: number;
      days?: number[];
    };
    rateLimiting?: {
      maxExecutions: number;
      timeWindowMinutes: number;
    };
  };
  isActive: boolean;
  priority: number;
  requiresConfirmation: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class ChatTriggerService extends EventEmitter {
  private prisma: PrismaClient;
  private intentDetector: IntentDetector;
  private contextManager: ContextManager;
  private triggerCache: Map<string, TriggerRule[]> = new Map();
  private lastCacheUpdate: Date = new Date(0);
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.intentDetector = new IntentDetector();
    this.contextManager = new ContextManager();
  }

  // Main method to detect workflow triggers in chat messages
  async detectTriggers(context: ChatTriggerContext): Promise<TriggerMatch[]> {
    try {
      // Only process user messages
      if (context.messageType !== 'user') {
        return [];
      }

      // Get active trigger rules for tenant
      const triggerRules = await this.getTriggerRules(context.tenantId);
      const matches: TriggerMatch[] = [];

      // Process each trigger rule
      for (const rule of triggerRules) {
        const match = await this.evaluateTriggerRule(rule, context);
        if (match) {
          matches.push(match);
        }
      }

      // Sort matches by confidence and priority
      matches.sort((a, b) => {
        const priorityA = triggerRules.find(r => r.workflowId === a.workflowId)?.priority || 0;
        const priorityB = triggerRules.find(r => r.workflowId === b.workflowId)?.priority || 0;
        
        if (priorityA !== priorityB) {
          return priorityB - priorityA; // Higher priority first
        }
        return b.confidence - a.confidence; // Higher confidence first
      });

      // Emit trigger detection event
      if (matches.length > 0) {
        this.emit('triggers:detected', {
          context,
          matches,
          timestamp: new Date()
        });
      }

      return matches;

    } catch (error) {
      console.error('Error detecting triggers:', error);
      this.emit('triggers:error', {
        context,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  // Evaluate a specific trigger rule against chat context
  private async evaluateTriggerRule(
    rule: TriggerRule, 
    context: ChatTriggerContext
  ): Promise<TriggerMatch | null> {
    try {
      // Check basic conditions first
      if (!await this.checkBasicConditions(rule, context)) {
        return null;
      }

      let match: TriggerMatch | null = null;

      switch (rule.triggerType) {
        case 'keyword':
          match = await this.evaluateKeywordTrigger(rule, context);
          break;
        case 'pattern':
          match = await this.evaluatePatternTrigger(rule, context);
          break;
        case 'intent':
          match = await this.evaluateIntentTrigger(rule, context);
          break;
        case 'command':
          match = await this.evaluateCommandTrigger(rule, context);
          break;
      }

      return match;

    } catch (error) {
      console.error(`Error evaluating trigger rule ${rule.id}:`, error);
      return null;
    }
  }

  // Check basic conditions like user permissions, time restrictions, etc.
  private async checkBasicConditions(
    rule: TriggerRule, 
    context: ChatTriggerContext
  ): Promise<boolean> {
    const config = rule.configuration;

    // Check user role restrictions
    if (config.userRoles && config.userRoles.length > 0) {
      const userRole = await this.getUserRole(context.userId, context.tenantId);
      if (!config.userRoles.includes(userRole)) {
        return false;
      }
    }

    // Check time restrictions
    if (config.timeRestrictions) {
      const now = new Date();
      const hour = now.getHours();
      const dayOfWeek = now.getDay();

      if (config.timeRestrictions.startHour !== undefined && 
          hour < config.timeRestrictions.startHour) {
        return false;
      }

      if (config.timeRestrictions.endHour !== undefined && 
          hour > config.timeRestrictions.endHour) {
        return false;
      }

      if (config.timeRestrictions.days && 
          !config.timeRestrictions.days.includes(dayOfWeek)) {
        return false;
      }
    }

    // Check rate limiting
    if (config.rateLimiting) {
      const isRateLimited = await this.checkRateLimit(
        rule.id,
        context.userId,
        config.rateLimiting
      );
      if (isRateLimited) {
        return false;
      }
    }

    // Check context requirements
    if (config.contextRequired) {
      const hasRequiredContext = await this.contextManager.hasRequiredContext(
        context.conversationId,
        rule.workflowId
      );
      if (!hasRequiredContext) {
        return false;
      }
    }

    return true;
  }

  // Evaluate keyword-based triggers
  private async evaluateKeywordTrigger(
    rule: TriggerRule, 
    context: ChatTriggerContext
  ): Promise<TriggerMatch | null> {
    const config = rule.configuration;
    const keywords = config.keywords || [];
    
    if (keywords.length === 0) return null;

    const messageText = config.caseSensitive 
      ? context.messageContent 
      : context.messageContent.toLowerCase();

    for (const keyword of keywords) {
      const searchKeyword = config.caseSensitive ? keyword : keyword.toLowerCase();
      
      let isMatch = false;
      let matchedText = '';

      if (config.requireExactMatch) {
        const words = messageText.split(/\s+/);
        isMatch = words.includes(searchKeyword);
        matchedText = searchKeyword;
      } else {
        isMatch = messageText.includes(searchKeyword);
        matchedText = searchKeyword;
      }

      if (isMatch) {
        const workflow = await this.getWorkflowInfo(rule.workflowId);
        return {
          workflowId: rule.workflowId,
          workflowName: workflow?.name || 'Unknown Workflow',
          confidence: 0.8,
          triggerType: 'keyword',
          matchedText,
          requiresConfirmation: rule.requiresConfirmation
        };
      }
    }

    return null;
  }

  // Evaluate pattern-based triggers (regex)
  private async evaluatePatternTrigger(
    rule: TriggerRule, 
    context: ChatTriggerContext
  ): Promise<TriggerMatch | null> {
    const config = rule.configuration;
    const patterns = config.patterns || [];
    
    if (patterns.length === 0) return null;

    const messageText = context.messageContent;

    for (const patternStr of patterns) {
      try {
        const flags = config.caseSensitive ? 'g' : 'gi';
        const pattern = new RegExp(patternStr, flags);
        const match = pattern.exec(messageText);

        if (match) {
          const workflow = await this.getWorkflowInfo(rule.workflowId);
          return {
            workflowId: rule.workflowId,
            workflowName: workflow?.name || 'Unknown Workflow',
            confidence: 0.9,
            triggerType: 'pattern',
            matchedText: match[0],
            parameters: match.groups || {},
            requiresConfirmation: rule.requiresConfirmation
          };
        }
      } catch (error) {
        console.error(`Invalid regex pattern: ${patternStr}`, error);
      }
    }

    return null;
  }

  // Evaluate intent-based triggers using AI
  private async evaluateIntentTrigger(
    rule: TriggerRule, 
    context: ChatTriggerContext
  ): Promise<TriggerMatch | null> {
    const config = rule.configuration;
    const intents = config.intents || [];
    
    if (intents.length === 0) return null;

    try {
      const detectedIntent = await this.intentDetector.detectIntent(
        context.messageContent,
        {
          conversationHistory: context.previousMessages,
          userId: context.userId,
          tenantId: context.tenantId
        }
      );

      if (detectedIntent && intents.includes(detectedIntent.intent)) {
        const workflow = await this.getWorkflowInfo(rule.workflowId);
        return {
          workflowId: rule.workflowId,
          workflowName: workflow?.name || 'Unknown Workflow',
          confidence: detectedIntent.confidence,
          triggerType: 'intent',
          matchedText: detectedIntent.intent,
          parameters: detectedIntent.entities || {},
          requiresConfirmation: rule.requiresConfirmation
        };
      }
    } catch (error) {
      console.error('Error detecting intent:', error);
    }

    return null;
  }

  // Evaluate command-based triggers (e.g., /command)
  private async evaluateCommandTrigger(
    rule: TriggerRule, 
    context: ChatTriggerContext
  ): Promise<TriggerMatch | null> {
    const config = rule.configuration;
    const commands = config.commands || [];
    
    if (commands.length === 0) return null;

    const messageText = context.messageContent.trim();
    
    // Check if message starts with a command
    if (!messageText.startsWith('/')) return null;

    const commandParts = messageText.split(/\s+/);
    const command = commandParts[0].substring(1); // Remove the '/' prefix
    const args = commandParts.slice(1);

    if (commands.includes(command)) {
      const workflow = await this.getWorkflowInfo(rule.workflowId);
      return {
        workflowId: rule.workflowId,
        workflowName: workflow?.name || 'Unknown Workflow',
        confidence: 1.0,
        triggerType: 'command',
        matchedText: `/${command}`,
        parameters: { command, args },
        requiresConfirmation: rule.requiresConfirmation
      };
    }

    return null;
  }

  // Get trigger rules for a tenant (with caching)
  private async getTriggerRules(tenantId: string): Promise<TriggerRule[]> {
    const now = new Date();
    
    // Check cache
    if (this.triggerCache.has(tenantId) && 
        (now.getTime() - this.lastCacheUpdate.getTime()) < this.cacheTimeout) {
      return this.triggerCache.get(tenantId) || [];
    }

    // Fetch from database
    const rules = await this.prisma.workflowTrigger.findMany({
      where: {
        tenantId,
        triggerType: {
          in: ['keyword', 'pattern', 'intent', 'command']
        },
        isActive: true
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
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' }
      ]
    });

    // Convert to TriggerRule format
    const triggerRules: TriggerRule[] = rules
      .filter(rule => rule.workflow?.status === 'active')
      .map(rule => ({
        id: rule.id,
        workflowId: rule.workflowId,
        tenantId: rule.tenantId,
        triggerType: rule.triggerType as any,
        configuration: rule.configuration as any,
        isActive: rule.isActive,
        priority: rule.priority || 0,
        requiresConfirmation: rule.requiresConfirmation || false,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt
      }));

    // Update cache
    this.triggerCache.set(tenantId, triggerRules);
    this.lastCacheUpdate = now;

    return triggerRules;
  }

  // Get workflow information
  private async getWorkflowInfo(workflowId: string): Promise<any> {
    return await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true
      }
    });
  }

  // Get user role
  private async getUserRole(userId: string, tenantId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { role: true }
    });
    return user?.role || 'user';
  }

  // Check rate limiting
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

  // Create a new trigger rule
  async createTriggerRule(
    workflowId: string,
    tenantId: string,
    triggerData: Partial<TriggerRule>
  ): Promise<string> {
    const rule = await this.prisma.workflowTrigger.create({
      data: {
        workflowId,
        tenantId,
        triggerType: triggerData.triggerType || 'keyword',
        configuration: triggerData.configuration || {},
        isActive: triggerData.isActive !== false,
        priority: triggerData.priority || 0,
        requiresConfirmation: triggerData.requiresConfirmation || false
      }
    });

    // Clear cache for this tenant
    this.triggerCache.delete(tenantId);

    return rule.id;
  }

  // Update trigger rule
  async updateTriggerRule(
    triggerId: string,
    tenantId: string,
    updates: Partial<TriggerRule>
  ): Promise<void> {
    await this.prisma.workflowTrigger.updateMany({
      where: {
        id: triggerId,
        tenantId
      },
      data: {
        triggerType: updates.triggerType,
        configuration: updates.configuration,
        isActive: updates.isActive,
        priority: updates.priority,
        requiresConfirmation: updates.requiresConfirmation
      }
    });

    // Clear cache for this tenant
    this.triggerCache.delete(tenantId);
  }

  // Delete trigger rule
  async deleteTriggerRule(triggerId: string, tenantId: string): Promise<void> {
    await this.prisma.workflowTrigger.deleteMany({
      where: {
        id: triggerId,
        tenantId
      }
    });

    // Clear cache for this tenant
    this.triggerCache.delete(tenantId);
  }

  // Get trigger statistics
  async getTriggerStats(tenantId: string): Promise<any> {
    const [totalTriggers, activeTriggers, recentExecutions] = await Promise.all([
      this.prisma.workflowTrigger.count({
        where: { tenantId }
      }),
      this.prisma.workflowTrigger.count({
        where: {
          tenantId,
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

  // Clear cache (useful for testing or manual refresh)
  clearCache(tenantId?: string): void {
    if (tenantId) {
      this.triggerCache.delete(tenantId);
    } else {
      this.triggerCache.clear();
      this.lastCacheUpdate = new Date(0);
    }
  }
}
