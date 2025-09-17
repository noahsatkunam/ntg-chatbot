import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

export interface Condition {
  id: string;
  type: 'comparison' | 'logical' | 'function' | 'custom';
  operator: string;
  left: any;
  right: any;
  children?: Condition[];
}

export interface Rule {
  id: string;
  name: string;
  description?: string;
  conditions: Condition;
  actions: RuleAction[];
  priority: number;
  isActive: boolean;
  metadata?: any;
}

export interface RuleAction {
  type: 'execute_workflow' | 'send_notification' | 'update_variable' | 'call_api' | 'stop_execution';
  parameters: any;
  condition?: Condition;
}

export interface ExecutionContext {
  userId: string;
  tenantId: string;
  conversationId?: string;
  workflowId?: string;
  executionId?: string;
  variables: Map<string, any>;
  metadata: any;
  timestamp: Date;
}

export interface EvaluationResult {
  success: boolean;
  value: any;
  error?: string;
  executedActions: string[];
  modifiedVariables: string[];
}

export class ConditionalEngine extends EventEmitter {
  private prisma: PrismaClient;
  private rules: Map<string, Rule> = new Map();
  private functions: Map<string, Function> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.registerBuiltInFunctions();
    this.loadRules();
  }

  // Evaluate conditions and execute actions
  async evaluate(
    ruleId: string,
    context: ExecutionContext
  ): Promise<EvaluationResult> {
    try {
      const rule = await this.getRule(ruleId, context.tenantId);
      if (!rule || !rule.isActive) {
        return {
          success: false,
          value: false,
          error: 'Rule not found or inactive',
          executedActions: [],
          modifiedVariables: []
        };
      }

      // Evaluate conditions
      const conditionResult = await this.evaluateCondition(rule.conditions, context);
      
      if (!conditionResult) {
        return {
          success: true,
          value: false,
          executedActions: [],
          modifiedVariables: []
        };
      }

      // Execute actions
      const executedActions: string[] = [];
      const modifiedVariables: string[] = [];

      for (const action of rule.actions) {
        // Check action-specific condition if exists
        if (action.condition) {
          const actionConditionResult = await this.evaluateCondition(action.condition, context);
          if (!actionConditionResult) {
            continue;
          }
        }

        const actionResult = await this.executeAction(action, context);
        if (actionResult.executed) {
          executedActions.push(action.type);
          modifiedVariables.push(...actionResult.modifiedVariables);
        }

        // Stop execution if action type is stop_execution
        if (action.type === 'stop_execution') {
          break;
        }
      }

      // Log rule execution
      await this.logRuleExecution(ruleId, context, true, executedActions);

      this.emit('rule:executed', {
        ruleId,
        ruleName: rule.name,
        context,
        executedActions,
        modifiedVariables
      });

      return {
        success: true,
        value: true,
        executedActions,
        modifiedVariables
      };

    } catch (error) {
      console.error('Error evaluating rule:', error);
      
      await this.logRuleExecution(ruleId, context, false, [], error.message);

      return {
        success: false,
        value: false,
        error: error.message,
        executedActions: [],
        modifiedVariables: []
      };
    }
  }

  // Evaluate multiple rules in priority order
  async evaluateRules(
    ruleIds: string[],
    context: ExecutionContext,
    stopOnFirst: boolean = false
  ): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];
    
    // Get rules and sort by priority
    const rules = await Promise.all(
      ruleIds.map(id => this.getRule(id, context.tenantId))
    );
    
    const sortedRules = rules
      .filter(rule => rule && rule.isActive)
      .sort((a, b) => b!.priority - a!.priority);

    for (const rule of sortedRules) {
      const result = await this.evaluate(rule!.id, context);
      results.push(result);

      // Stop on first successful execution if requested
      if (stopOnFirst && result.success && result.value) {
        break;
      }
    }

    return results;
  }

  // Create new rule
  async createRule(
    tenantId: string,
    ruleData: Omit<Rule, 'id'>
  ): Promise<string> {
    try {
      // Validate rule structure
      this.validateRule(ruleData);

      const rule = await this.prisma.conditionalRule.create({
        data: {
          tenantId,
          name: ruleData.name,
          description: ruleData.description,
          conditions: ruleData.conditions,
          actions: ruleData.actions,
          priority: ruleData.priority,
          isActive: ruleData.isActive,
          metadata: ruleData.metadata
        }
      });

      // Cache rule
      this.rules.set(rule.id, {
        id: rule.id,
        name: rule.name,
        description: rule.description,
        conditions: rule.conditions as Condition,
        actions: rule.actions as RuleAction[],
        priority: rule.priority,
        isActive: rule.isActive,
        metadata: rule.metadata
      });

      this.emit('rule:created', {
        ruleId: rule.id,
        tenantId,
        name: ruleData.name
      });

      return rule.id;

    } catch (error) {
      console.error('Error creating rule:', error);
      throw error;
    }
  }

  // Update rule
  async updateRule(
    ruleId: string,
    tenantId: string,
    updates: Partial<Rule>
  ): Promise<void> {
    if (updates.conditions || updates.actions) {
      this.validateRule(updates as Rule);
    }

    await this.prisma.conditionalRule.updateMany({
      where: { id: ruleId, tenantId },
      data: updates
    });

    // Update cache
    const cachedRule = this.rules.get(ruleId);
    if (cachedRule) {
      Object.assign(cachedRule, updates);
    }

    this.emit('rule:updated', {
      ruleId,
      tenantId,
      updates
    });
  }

  // Delete rule
  async deleteRule(ruleId: string, tenantId: string): Promise<void> {
    await this.prisma.conditionalRule.deleteMany({
      where: { id: ruleId, tenantId }
    });

    this.rules.delete(ruleId);

    this.emit('rule:deleted', {
      ruleId,
      tenantId
    });
  }

  // Register custom function
  registerFunction(name: string, func: Function): void {
    this.functions.set(name, func);
  }

  // Test rule with sample context
  async testRule(
    ruleId: string,
    tenantId: string,
    testContext: Partial<ExecutionContext>
  ): Promise<EvaluationResult> {
    const context: ExecutionContext = {
      userId: testContext.userId || 'test-user',
      tenantId,
      conversationId: testContext.conversationId,
      workflowId: testContext.workflowId,
      executionId: testContext.executionId,
      variables: testContext.variables || new Map(),
      metadata: testContext.metadata || {},
      timestamp: new Date()
    };

    return await this.evaluate(ruleId, context);
  }

  // Private methods
  private async evaluateCondition(
    condition: Condition,
    context: ExecutionContext
  ): Promise<boolean> {
    switch (condition.type) {
      case 'comparison':
        return this.evaluateComparison(condition, context);
      
      case 'logical':
        return this.evaluateLogical(condition, context);
      
      case 'function':
        return this.evaluateFunction(condition, context);
      
      case 'custom':
        return this.evaluateCustom(condition, context);
      
      default:
        throw new Error(`Unknown condition type: ${condition.type}`);
    }
  }

  private async evaluateComparison(
    condition: Condition,
    context: ExecutionContext
  ): Promise<boolean> {
    const leftValue = await this.resolveValue(condition.left, context);
    const rightValue = await this.resolveValue(condition.right, context);

    switch (condition.operator) {
      case '==':
      case 'equals':
        return leftValue == rightValue;
      
      case '===':
      case 'strict_equals':
        return leftValue === rightValue;
      
      case '!=':
      case 'not_equals':
        return leftValue != rightValue;
      
      case '!==':
      case 'strict_not_equals':
        return leftValue !== rightValue;
      
      case '>':
      case 'greater_than':
        return leftValue > rightValue;
      
      case '>=':
      case 'greater_than_or_equal':
        return leftValue >= rightValue;
      
      case '<':
      case 'less_than':
        return leftValue < rightValue;
      
      case '<=':
      case 'less_than_or_equal':
        return leftValue <= rightValue;
      
      case 'contains':
        return String(leftValue).includes(String(rightValue));
      
      case 'starts_with':
        return String(leftValue).startsWith(String(rightValue));
      
      case 'ends_with':
        return String(leftValue).endsWith(String(rightValue));
      
      case 'matches':
        return new RegExp(String(rightValue)).test(String(leftValue));
      
      case 'in':
        return Array.isArray(rightValue) && rightValue.includes(leftValue);
      
      default:
        throw new Error(`Unknown comparison operator: ${condition.operator}`);
    }
  }

  private async evaluateLogical(
    condition: Condition,
    context: ExecutionContext
  ): Promise<boolean> {
    if (!condition.children || condition.children.length === 0) {
      return true;
    }

    switch (condition.operator) {
      case 'and':
      case '&&':
        for (const child of condition.children) {
          const result = await this.evaluateCondition(child, context);
          if (!result) return false;
        }
        return true;
      
      case 'or':
      case '||':
        for (const child of condition.children) {
          const result = await this.evaluateCondition(child, context);
          if (result) return true;
        }
        return false;
      
      case 'not':
      case '!':
        const result = await this.evaluateCondition(condition.children[0], context);
        return !result;
      
      default:
        throw new Error(`Unknown logical operator: ${condition.operator}`);
    }
  }

  private async evaluateFunction(
    condition: Condition,
    context: ExecutionContext
  ): Promise<boolean> {
    const func = this.functions.get(condition.operator);
    if (!func) {
      throw new Error(`Unknown function: ${condition.operator}`);
    }

    const args = await Promise.all(
      (condition.children || []).map(child => this.resolveValue(child, context))
    );

    const result = await func(context, ...args);
    return Boolean(result);
  }

  private async evaluateCustom(
    condition: Condition,
    context: ExecutionContext
  ): Promise<boolean> {
    // Custom condition evaluation - can be extended
    // For now, treat as a simple function call
    return this.evaluateFunction(condition, context);
  }

  private async resolveValue(value: any, context: ExecutionContext): Promise<any> {
    if (typeof value === 'string' && value.startsWith('$')) {
      // Variable reference
      const varName = value.substring(1);
      
      if (varName.startsWith('context.')) {
        // Context property
        const prop = varName.substring(8);
        return this.getNestedProperty(context, prop);
      }
      
      if (varName.startsWith('var.')) {
        // Context variable
        const varKey = varName.substring(4);
        return context.variables.get(varKey);
      }
      
      // Direct context variable
      return context.variables.get(varName);
    }
    
    if (typeof value === 'object' && value.type === 'function') {
      // Function call
      return this.evaluateFunction(value, context);
    }
    
    return value;
  }

  private getNestedProperty(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private async executeAction(
    action: RuleAction,
    context: ExecutionContext
  ): Promise<{ executed: boolean; modifiedVariables: string[] }> {
    const modifiedVariables: string[] = [];

    try {
      switch (action.type) {
        case 'execute_workflow':
          await this.executeWorkflowAction(action, context);
          break;
        
        case 'send_notification':
          await this.sendNotificationAction(action, context);
          break;
        
        case 'update_variable':
          const varName = await this.updateVariableAction(action, context);
          if (varName) modifiedVariables.push(varName);
          break;
        
        case 'call_api':
          await this.callApiAction(action, context);
          break;
        
        case 'stop_execution':
          // No action needed, handled by caller
          break;
        
        default:
          console.warn(`Unknown action type: ${action.type}`);
          return { executed: false, modifiedVariables };
      }

      return { executed: true, modifiedVariables };

    } catch (error) {
      console.error(`Error executing action ${action.type}:`, error);
      return { executed: false, modifiedVariables };
    }
  }

  private async executeWorkflowAction(action: RuleAction, context: ExecutionContext): Promise<void> {
    // Emit event for workflow execution
    this.emit('action:execute_workflow', {
      workflowId: action.parameters.workflowId,
      context,
      parameters: action.parameters
    });
  }

  private async sendNotificationAction(action: RuleAction, context: ExecutionContext): Promise<void> {
    // Emit event for notification
    this.emit('action:send_notification', {
      type: action.parameters.type,
      recipient: action.parameters.recipient,
      message: action.parameters.message,
      context
    });
  }

  private async updateVariableAction(action: RuleAction, context: ExecutionContext): Promise<string | null> {
    const varName = action.parameters.name;
    const value = await this.resolveValue(action.parameters.value, context);
    
    context.variables.set(varName, value);
    
    return varName;
  }

  private async callApiAction(action: RuleAction, context: ExecutionContext): Promise<void> {
    // Emit event for API call
    this.emit('action:call_api', {
      connectionId: action.parameters.connectionId,
      request: action.parameters.request,
      context
    });
  }

  private validateRule(rule: Partial<Rule>): void {
    if (!rule.conditions) {
      throw new Error('Rule must have conditions');
    }
    
    if (!rule.actions || rule.actions.length === 0) {
      throw new Error('Rule must have at least one action');
    }

    // Validate condition structure
    this.validateCondition(rule.conditions);
    
    // Validate actions
    for (const action of rule.actions) {
      this.validateAction(action);
    }
  }

  private validateCondition(condition: Condition): void {
    if (!condition.type || !condition.operator) {
      throw new Error('Condition must have type and operator');
    }

    if (condition.type === 'logical' && (!condition.children || condition.children.length === 0)) {
      throw new Error('Logical condition must have children');
    }

    if (condition.children) {
      for (const child of condition.children) {
        this.validateCondition(child);
      }
    }
  }

  private validateAction(action: RuleAction): void {
    if (!action.type || !action.parameters) {
      throw new Error('Action must have type and parameters');
    }

    // Type-specific validation
    switch (action.type) {
      case 'execute_workflow':
        if (!action.parameters.workflowId) {
          throw new Error('execute_workflow action must have workflowId parameter');
        }
        break;
      
      case 'update_variable':
        if (!action.parameters.name) {
          throw new Error('update_variable action must have name parameter');
        }
        break;
      
      case 'call_api':
        if (!action.parameters.connectionId || !action.parameters.request) {
          throw new Error('call_api action must have connectionId and request parameters');
        }
        break;
    }
  }

  private registerBuiltInFunctions(): void {
    // Date/time functions
    this.registerFunction('now', () => new Date());
    this.registerFunction('today', () => new Date().toDateString());
    this.registerFunction('hour', () => new Date().getHours());
    this.registerFunction('day_of_week', () => new Date().getDay());
    
    // String functions
    this.registerFunction('length', (context, str) => String(str).length);
    this.registerFunction('upper', (context, str) => String(str).toUpperCase());
    this.registerFunction('lower', (context, str) => String(str).toLowerCase());
    
    // Array functions
    this.registerFunction('count', (context, arr) => Array.isArray(arr) ? arr.length : 0);
    this.registerFunction('empty', (context, arr) => !arr || (Array.isArray(arr) && arr.length === 0));
    
    // Math functions
    this.registerFunction('random', () => Math.random());
    this.registerFunction('round', (context, num) => Math.round(Number(num)));
    
    // Context functions
    this.registerFunction('has_variable', (context, varName) => context.variables.has(varName));
    this.registerFunction('user_role', (context) => context.metadata?.userRole || 'user');
  }

  private async getRule(ruleId: string, tenantId: string): Promise<Rule | null> {
    // Check cache first
    const cached = this.rules.get(ruleId);
    if (cached) {
      return cached;
    }

    // Load from database
    const rule = await this.prisma.conditionalRule.findFirst({
      where: { id: ruleId, tenantId }
    });

    if (!rule) {
      return null;
    }

    const ruleObj: Rule = {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      conditions: rule.conditions as Condition,
      actions: rule.actions as RuleAction[],
      priority: rule.priority,
      isActive: rule.isActive,
      metadata: rule.metadata
    };

    this.rules.set(ruleId, ruleObj);
    return ruleObj;
  }

  private async logRuleExecution(
    ruleId: string,
    context: ExecutionContext,
    success: boolean,
    executedActions: string[],
    error?: string
  ): Promise<void> {
    try {
      await this.prisma.ruleExecutionLog.create({
        data: {
          ruleId,
          tenantId: context.tenantId,
          userId: context.userId,
          success,
          executedActions,
          error,
          context: {
            conversationId: context.conversationId,
            workflowId: context.workflowId,
            executionId: context.executionId,
            variables: Object.fromEntries(context.variables),
            metadata: context.metadata
          },
          createdAt: new Date()
        }
      });
    } catch (logError) {
      console.error('Error logging rule execution:', logError);
    }
  }

  private async loadRules(): Promise<void> {
    try {
      const rules = await this.prisma.conditionalRule.findMany({
        where: { isActive: true }
      });

      for (const rule of rules) {
        this.rules.set(rule.id, {
          id: rule.id,
          name: rule.name,
          description: rule.description,
          conditions: rule.conditions as Condition,
          actions: rule.actions as RuleAction[],
          priority: rule.priority,
          isActive: rule.isActive,
          metadata: rule.metadata
        });
      }
    } catch (error) {
      console.error('Error loading rules:', error);
    }
  }
}
