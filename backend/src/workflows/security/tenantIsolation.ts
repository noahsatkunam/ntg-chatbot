import { PrismaClient } from '@prisma/client';
import { Request } from 'express';

export interface TenantContext {
  tenantId: string;
  userId: string;
  permissions: string[];
}

export interface WorkflowSecurityConfig {
  allowCrossTenanAccess: boolean;
  requireOwnershipForModification: boolean;
  allowedExecutionSources: string[];
  rateLimits: {
    executionsPerHour: number;
    executionsPerDay: number;
    maxConcurrentExecutions: number;
  };
}

export class TenantIsolationService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  // Validate tenant access to workflow
  async validateWorkflowAccess(
    workflowId: string,
    tenantContext: TenantContext,
    operation: 'read' | 'write' | 'execute' | 'delete'
  ): Promise<boolean> {
    try {
      const workflow = await this.prisma.workflow.findFirst({
        where: {
          id: workflowId,
          tenantId: tenantContext.tenantId
        },
        include: {
          creator: true
        }
      });

      if (!workflow) {
        return false;
      }

      // Check operation-specific permissions
      switch (operation) {
        case 'read':
          return true; // All tenant users can read workflows
        
        case 'write':
          // Only creator or users with workflow:write permission can modify
          return workflow.createdBy === tenantContext.userId || 
                 tenantContext.permissions.includes('workflow:write');
        
        case 'execute':
          // Check if workflow is active and user has execute permission
          if (workflow.status !== 'active') {
            return false;
          }
          return tenantContext.permissions.includes('workflow:execute') ||
                 workflow.createdBy === tenantContext.userId;
        
        case 'delete':
          // Only creator or users with workflow:delete permission can delete
          return workflow.createdBy === tenantContext.userId ||
                 tenantContext.permissions.includes('workflow:delete');
        
        default:
          return false;
      }

    } catch (error) {
      console.error('Error validating workflow access:', error);
      return false;
    }
  }

  // Validate tenant access to execution
  async validateExecutionAccess(
    executionId: string,
    tenantContext: TenantContext,
    operation: 'read' | 'cancel' | 'retry'
  ): Promise<boolean> {
    try {
      const execution = await this.prisma.workflowExecution.findFirst({
        where: {
          id: executionId,
          tenantId: tenantContext.tenantId
        },
        include: {
          workflow: true
        }
      });

      if (!execution) {
        return false;
      }

      switch (operation) {
        case 'read':
          return true; // All tenant users can read executions
        
        case 'cancel':
          // Only execution triggerer or users with execution:cancel permission
          return execution.triggeredBy === tenantContext.userId ||
                 tenantContext.permissions.includes('execution:cancel');
        
        case 'retry':
          // Only execution triggerer or users with execution:retry permission
          return execution.triggeredBy === tenantContext.userId ||
                 tenantContext.permissions.includes('execution:retry');
        
        default:
          return false;
      }

    } catch (error) {
      console.error('Error validating execution access:', error);
      return false;
    }
  }

  // Validate tenant access to template
  async validateTemplateAccess(
    templateId: string,
    tenantContext: TenantContext,
    operation: 'read' | 'write' | 'delete' | 'use'
  ): Promise<boolean> {
    try {
      const template = await this.prisma.workflowTemplate.findUnique({
        where: { id: templateId }
      });

      if (!template) {
        return false;
      }

      // System templates are accessible to all tenants
      if (template.createdBy === 'system') {
        return operation === 'read' || operation === 'use';
      }

      // For user-created templates, check permissions
      switch (operation) {
        case 'read':
        case 'use':
          return true; // All users can read and use templates
        
        case 'write':
          return template.createdBy === tenantContext.userId ||
                 tenantContext.permissions.includes('template:write');
        
        case 'delete':
          return template.createdBy === tenantContext.userId ||
                 tenantContext.permissions.includes('template:delete');
        
        default:
          return false;
      }

    } catch (error) {
      console.error('Error validating template access:', error);
      return false;
    }
  }

  // Filter workflows based on tenant context
  async filterWorkflowsByTenant(
    workflows: any[],
    tenantContext: TenantContext
  ): Promise<any[]> {
    return workflows.filter(workflow => workflow.tenantId === tenantContext.tenantId);
  }

  // Filter executions based on tenant context
  async filterExecutionsByTenant(
    executions: any[],
    tenantContext: TenantContext
  ): Promise<any[]> {
    return executions.filter(execution => execution.tenantId === tenantContext.tenantId);
  }

  // Generate tenant-specific webhook path
  generateTenantWebhookPath(tenantId: string, workflowId: string): string {
    return `tenant/${tenantId}/workflow/${workflowId}`;
  }

  // Validate webhook access
  async validateWebhookAccess(
    tenantId: string,
    workflowId: string,
    webhookPath: string
  ): Promise<boolean> {
    const expectedPath = this.generateTenantWebhookPath(tenantId, workflowId);
    
    if (webhookPath !== expectedPath) {
      return false;
    }

    // Check if workflow exists and is active
    const workflow = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        tenantId,
        status: 'active'
      }
    });

    return !!workflow;
  }

  // Check rate limits for tenant
  async checkTenantRateLimit(
    tenantId: string,
    userId: string,
    operation: 'execution' | 'deployment' | 'api_call'
  ): Promise<{ allowed: boolean; remaining: number; resetTime: Date }> {
    const now = new Date();
    const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Get tenant configuration
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }
    });

    if (!tenant) {
      return { allowed: false, remaining: 0, resetTime: now };
    }

    // Default rate limits (can be configured per tenant)
    const limits = {
      execution: { hourly: 100, daily: 1000 },
      deployment: { hourly: 10, daily: 50 },
      api_call: { hourly: 1000, daily: 10000 }
    };

    const currentLimits = limits[operation];

    // Count recent operations
    const [hourlyCount, dailyCount] = await Promise.all([
      this.countRecentOperations(tenantId, userId, operation, hourStart),
      this.countRecentOperations(tenantId, userId, operation, dayStart)
    ]);

    const hourlyAllowed = hourlyCount < currentLimits.hourly;
    const dailyAllowed = dailyCount < currentLimits.daily;
    const allowed = hourlyAllowed && dailyAllowed;

    const remaining = Math.min(
      currentLimits.hourly - hourlyCount,
      currentLimits.daily - dailyCount
    );

    const resetTime = new Date(hourStart.getTime() + 60 * 60 * 1000); // Next hour

    return { allowed, remaining, resetTime };
  }

  // Count recent operations for rate limiting
  private async countRecentOperations(
    tenantId: string,
    userId: string,
    operation: string,
    since: Date
  ): Promise<number> {
    switch (operation) {
      case 'execution':
        return this.prisma.workflowExecution.count({
          where: {
            tenantId,
            triggeredBy: userId,
            startTime: { gte: since }
          }
        });
      
      case 'deployment':
        return this.prisma.workflow.count({
          where: {
            tenantId,
            createdBy: userId,
            createdAt: { gte: since }
          }
        });
      
      case 'api_call':
        // This would require an API call log table
        return 0;
      
      default:
        return 0;
    }
  }

  // Sanitize workflow definition for tenant isolation
  sanitizeWorkflowDefinition(definition: any, tenantId: string): any {
    const sanitized = JSON.parse(JSON.stringify(definition));

    // Add tenant context to all nodes
    if (sanitized.nodes) {
      sanitized.nodes = sanitized.nodes.map((node: any) => ({
        ...node,
        parameters: {
          ...node.parameters,
          tenantId,
          // Remove any cross-tenant references
          ...(node.parameters?.tenantId && node.parameters.tenantId !== tenantId ? 
            { tenantId } : {})
        }
      }));
    }

    // Sanitize webhook paths
    if (sanitized.settings?.webhookPath) {
      sanitized.settings.webhookPath = this.generateTenantWebhookPath(
        tenantId,
        sanitized.settings.workflowId || 'unknown'
      );
    }

    return sanitized;
  }

  // Validate workflow definition for security
  validateWorkflowSecurity(definition: any, tenantId: string): {
    isValid: boolean;
    violations: string[];
  } {
    const violations: string[] = [];

    // Check for dangerous node types
    const dangerousNodes = ['n8n-nodes-base.executeCommand', 'n8n-nodes-base.function'];
    
    if (definition.nodes) {
      for (const node of definition.nodes) {
        if (dangerousNodes.includes(node.type)) {
          violations.push(`Dangerous node type not allowed: ${node.type}`);
        }

        // Check for cross-tenant references
        if (node.parameters?.tenantId && node.parameters.tenantId !== tenantId) {
          violations.push(`Cross-tenant reference detected in node: ${node.name}`);
        }

        // Check for external URL access (if restricted)
        if (node.type === 'n8n-nodes-base.httpRequest' && node.parameters?.url) {
          const url = node.parameters.url;
          if (this.isRestrictedUrl(url)) {
            violations.push(`Restricted URL access: ${url}`);
          }
        }
      }
    }

    return {
      isValid: violations.length === 0,
      violations
    };
  }

  // Check if URL is restricted
  private isRestrictedUrl(url: string): boolean {
    const restrictedPatterns = [
      /localhost/i,
      /127\.0\.0\.1/,
      /192\.168\./,
      /10\./,
      /172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /metadata\.google\.internal/i,
      /169\.254\./
    ];

    return restrictedPatterns.some(pattern => pattern.test(url));
  }

  // Get tenant security configuration
  async getTenantSecurityConfig(tenantId: string): Promise<WorkflowSecurityConfig> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }
    });

    // Default security configuration
    const defaultConfig: WorkflowSecurityConfig = {
      allowCrossTenanAccess: false,
      requireOwnershipForModification: true,
      allowedExecutionSources: ['manual', 'webhook', 'chat', 'schedule'],
      rateLimits: {
        executionsPerHour: 100,
        executionsPerDay: 1000,
        maxConcurrentExecutions: 10
      }
    };

    // Merge with tenant-specific configuration if available
    if (tenant?.metadata?.workflowSecurity) {
      return {
        ...defaultConfig,
        ...tenant.metadata.workflowSecurity
      };
    }

    return defaultConfig;
  }

  // Log security event
  async logSecurityEvent(
    tenantId: string,
    userId: string,
    event: string,
    details: any
  ): Promise<void> {
    console.log('Security Event:', {
      tenantId,
      userId,
      event,
      details,
      timestamp: new Date().toISOString()
    });

    // In production, this would write to a security audit log
    // await this.prisma.securityAuditLog.create({
    //   data: {
    //     tenantId,
    //     userId,
    //     event,
    //     details,
    //     timestamp: new Date()
    //   }
    // });
  }

  // Middleware for tenant isolation
  createTenantIsolationMiddleware() {
    return async (req: Request & { tenantContext?: TenantContext }, res: any, next: any) => {
      try {
        const tenantId = req.headers['x-tenant-id'] as string;
        const userId = (req as any).user?.userId;

        if (!tenantId || !userId) {
          return res.status(401).json({
            success: false,
            error: 'Missing tenant context'
          });
        }

        // Get user permissions
        const user = await this.prisma.user.findFirst({
          where: {
            id: userId,
            tenantId
          }
        });

        if (!user) {
          return res.status(403).json({
            success: false,
            error: 'Access denied'
          });
        }

        // Set tenant context
        req.tenantContext = {
          tenantId,
          userId,
          permissions: user.metadata?.permissions || []
        };

        next();
      } catch (error) {
        console.error('Tenant isolation middleware error:', error);
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    };
  }
}
