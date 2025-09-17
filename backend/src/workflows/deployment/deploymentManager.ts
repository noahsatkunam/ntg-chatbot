import { PrismaClient } from '@prisma/client';
import { N8nClient } from '../n8nClient';
import { WorkflowSecurityService } from '../security/workflowSecurity';
import { TenantIsolationService, TenantContext } from '../security/tenantIsolation';
import { EventEmitter } from 'events';

export interface DeploymentConfig {
  environment: 'development' | 'staging' | 'production';
  activate: boolean;
  validateOnly: boolean;
  rollbackOnFailure: boolean;
  healthCheckTimeout: number;
  retryAttempts: number;
}

export interface DeploymentResult {
  success: boolean;
  workflowId: string;
  n8nId?: string;
  webhookUrl?: string;
  version: number;
  deploymentId: string;
  errors?: string[];
  warnings?: string[];
}

export interface RollbackOptions {
  targetVersion?: number;
  reason: string;
  preserveData: boolean;
}

export class DeploymentManager extends EventEmitter {
  private prisma: PrismaClient;
  private n8nClient: N8nClient;
  private securityService: WorkflowSecurityService;
  private tenantIsolation: TenantIsolationService;

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.n8nClient = new N8nClient();
    this.securityService = new WorkflowSecurityService();
    this.tenantIsolation = new TenantIsolationService();
  }

  // Deploy workflow with comprehensive validation and rollback support
  async deployWorkflow(
    workflowDefinition: any,
    tenantContext: TenantContext,
    config: DeploymentConfig = {
      environment: 'production',
      activate: false,
      validateOnly: false,
      rollbackOnFailure: true,
      healthCheckTimeout: 30000,
      retryAttempts: 3
    }
  ): Promise<DeploymentResult> {
    const deploymentId = this.generateDeploymentId();
    
    try {
      this.emit('deployment:started', {
        deploymentId,
        tenantId: tenantContext.tenantId,
        environment: config.environment
      });

      // Phase 1: Pre-deployment validation
      const validationResult = await this.validateDeployment(
        workflowDefinition,
        tenantContext,
        config
      );

      if (!validationResult.isValid) {
        return {
          success: false,
          workflowId: '',
          deploymentId,
          version: 0,
          errors: validationResult.errors,
          warnings: validationResult.warnings
        };
      }

      if (config.validateOnly) {
        return {
          success: true,
          workflowId: 'validation-only',
          deploymentId,
          version: 0,
          warnings: validationResult.warnings
        };
      }

      // Phase 2: Create workflow record
      const workflow = await this.createWorkflowRecord(
        workflowDefinition,
        tenantContext,
        config
      );

      // Phase 3: Deploy to n8n with retry logic
      const n8nDeployment = await this.deployToN8n(
        workflow,
        workflowDefinition,
        config
      );

      // Phase 4: Post-deployment validation
      const healthCheck = await this.performHealthCheck(
        n8nDeployment.n8nId,
        config.healthCheckTimeout
      );

      if (!healthCheck.healthy && config.rollbackOnFailure) {
        await this.rollbackDeployment(workflow.id, {
          reason: 'Health check failed',
          preserveData: true
        });
        
        return {
          success: false,
          workflowId: workflow.id,
          deploymentId,
          version: workflow.version,
          errors: ['Deployment failed health check and was rolled back']
        };
      }

      // Phase 5: Finalize deployment
      await this.finalizeDeployment(workflow.id, n8nDeployment, config);

      const result: DeploymentResult = {
        success: true,
        workflowId: workflow.id,
        n8nId: n8nDeployment.n8nId,
        webhookUrl: n8nDeployment.webhookUrl,
        version: workflow.version,
        deploymentId,
        warnings: validationResult.warnings
      };

      this.emit('deployment:completed', {
        deploymentId,
        workflowId: workflow.id,
        tenantId: tenantContext.tenantId,
        result
      });

      return result;

    } catch (error) {
      console.error('Deployment failed:', error);
      
      this.emit('deployment:failed', {
        deploymentId,
        tenantId: tenantContext.tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        workflowId: '',
        deploymentId,
        version: 0,
        errors: [error instanceof Error ? error.message : 'Deployment failed']
      };
    }
  }

  // Comprehensive deployment validation
  private async validateDeployment(
    definition: any,
    tenantContext: TenantContext,
    config: DeploymentConfig
  ): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic structure validation
    if (!definition.name || !definition.nodes || !Array.isArray(definition.nodes)) {
      errors.push('Invalid workflow definition structure');
    }

    if (definition.nodes && definition.nodes.length === 0) {
      errors.push('Workflow must contain at least one node');
    }

    // Security validation
    const securityValidation = await this.securityService.validateWorkflowSecurity(
      definition,
      tenantContext
    );

    if (!securityValidation.isValid) {
      errors.push(...securityValidation.violations);
    }

    if (securityValidation.riskLevel === 'high') {
      errors.push('Workflow contains high-risk operations and cannot be deployed');
    } else if (securityValidation.riskLevel === 'medium') {
      warnings.push('Workflow contains medium-risk operations');
    }

    // n8n-specific validation
    const n8nValidation = this.n8nClient.validateWorkflowDefinition(definition);
    if (!n8nValidation.isValid) {
      errors.push(...n8nValidation.errors);
    }

    // Environment-specific validation
    if (config.environment === 'production') {
      if (!definition.description) {
        warnings.push('Production workflows should have descriptions');
      }

      if (!definition.tags || definition.tags.length === 0) {
        warnings.push('Production workflows should have tags for organization');
      }
    }

    // Resource validation
    const resourceValidation = await this.validateResourceRequirements(
      definition,
      tenantContext
    );

    if (!resourceValidation.canDeploy) {
      errors.push(...resourceValidation.issues);
    }

    warnings.push(...resourceValidation.warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  // Create workflow database record
  private async createWorkflowRecord(
    definition: any,
    tenantContext: TenantContext,
    config: DeploymentConfig
  ): Promise<any> {
    // Get next version number
    const existingWorkflow = await this.prisma.workflow.findFirst({
      where: {
        name: definition.name,
        tenantId: tenantContext.tenantId
      },
      orderBy: { version: 'desc' }
    });

    const version = existingWorkflow ? existingWorkflow.version + 1 : 1;

    // Sanitize definition for tenant isolation
    const sanitizedDefinition = this.tenantIsolation.sanitizeWorkflowDefinition(
      definition,
      tenantContext.tenantId
    );

    return this.prisma.workflow.create({
      data: {
        tenantId: tenantContext.tenantId,
        createdBy: tenantContext.userId,
        name: definition.name,
        description: definition.description,
        definition: sanitizedDefinition,
        category: definition.category || 'general',
        tags: definition.tags || [],
        version,
        status: 'deploying',
        environment: config.environment
      }
    });
  }

  // Deploy to n8n with retry logic
  private async deployToN8n(
    workflow: any,
    definition: any,
    config: DeploymentConfig
  ): Promise<{ n8nId: string; webhookUrl?: string }> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
      try {
        // Create workflow in n8n
        const n8nWorkflow = await this.n8nClient.createWorkflow({
          name: `${workflow.tenantId}_${workflow.id}_${definition.name}`,
          nodes: definition.nodes,
          connections: definition.connections,
          active: config.activate,
          settings: {
            ...definition.settings,
            tenantId: workflow.tenantId,
            workflowId: workflow.id,
            environment: config.environment
          }
        });

        // Create webhook if needed
        let webhookUrl: string | undefined;
        const hasWebhookTrigger = definition.nodes.some((node: any) => 
          node.type === 'n8n-nodes-base.webhook'
        );

        if (hasWebhookTrigger) {
          const webhookPath = this.tenantIsolation.generateTenantWebhookPath(
            workflow.tenantId,
            workflow.id
          );
          webhookUrl = await this.n8nClient.createWebhook(n8nWorkflow.id!, webhookPath);
        }

        return {
          n8nId: n8nWorkflow.id!,
          webhookUrl
        };

      } catch (error) {
        lastError = error as Error;
        console.error(`n8n deployment attempt ${attempt} failed:`, error);
        
        if (attempt < config.retryAttempts) {
          // Wait before retry with exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
        }
      }
    }

    throw new Error(`n8n deployment failed after ${config.retryAttempts} attempts: ${lastError?.message}`);
  }

  // Perform post-deployment health check
  private async performHealthCheck(
    n8nId: string,
    timeout: number
  ): Promise<{ healthy: boolean; issues: string[] }> {
    const issues: string[] = [];

    try {
      // Check if workflow exists in n8n
      const workflow = await this.n8nClient.getWorkflow(n8nId);
      if (!workflow) {
        issues.push('Workflow not found in n8n');
        return { healthy: false, issues };
      }

      // Check workflow status
      if (workflow.active === undefined) {
        issues.push('Workflow activation status unclear');
      }

      // Test webhook if present
      if (workflow.nodes?.some((node: any) => node.type === 'n8n-nodes-base.webhook')) {
        try {
          // Perform a test webhook call (implementation would depend on webhook setup)
          // This is a placeholder for actual webhook testing
          console.log('Webhook health check would be performed here');
        } catch (error) {
          issues.push('Webhook health check failed');
        }
      }

      return { healthy: issues.length === 0, issues };

    } catch (error) {
      issues.push(`Health check failed: ${error}`);
      return { healthy: false, issues };
    }
  }

  // Finalize deployment
  private async finalizeDeployment(
    workflowId: string,
    n8nDeployment: { n8nId: string; webhookUrl?: string },
    config: DeploymentConfig
  ): Promise<void> {
    // Update workflow with n8n details
    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: {
        n8nId: n8nDeployment.n8nId,
        status: config.activate ? 'active' : 'inactive',
        deployedAt: new Date()
      }
    });

    // Create webhook trigger if applicable
    if (n8nDeployment.webhookUrl) {
      const workflow = await this.prisma.workflow.findUnique({
        where: { id: workflowId }
      });

      if (workflow) {
        const webhookPath = this.tenantIsolation.generateTenantWebhookPath(
          workflow.tenantId,
          workflowId
        );

        await this.prisma.workflowTrigger.create({
          data: {
            workflowId,
            tenantId: workflow.tenantId,
            triggerType: 'webhook',
            configuration: {
              webhookUrl: n8nDeployment.webhookUrl,
              path: webhookPath
            },
            webhookPath,
            isActive: config.activate
          }
        });
      }
    }
  }

  // Rollback deployment
  async rollbackDeployment(
    workflowId: string,
    options: RollbackOptions
  ): Promise<{ success: boolean; message: string }> {
    try {
      const workflow = await this.prisma.workflow.findUnique({
        where: { id: workflowId }
      });

      if (!workflow) {
        return { success: false, message: 'Workflow not found' };
      }

      // If target version specified, rollback to that version
      if (options.targetVersion) {
        const targetWorkflow = await this.prisma.workflow.findFirst({
          where: {
            name: workflow.name,
            tenantId: workflow.tenantId,
            version: options.targetVersion
          }
        });

        if (!targetWorkflow) {
          return { success: false, message: 'Target version not found' };
        }

        // Deploy the target version
        const rollbackResult = await this.deployWorkflow(
          targetWorkflow.definition,
          {
            tenantId: workflow.tenantId,
            userId: workflow.createdBy,
            permissions: []
          },
          {
            environment: workflow.environment as any,
            activate: workflow.status === 'active',
            validateOnly: false,
            rollbackOnFailure: false,
            healthCheckTimeout: 30000,
            retryAttempts: 3
          }
        );

        if (!rollbackResult.success) {
          return { success: false, message: 'Rollback deployment failed' };
        }
      }

      // Deactivate current workflow in n8n
      if (workflow.n8nId) {
        try {
          await this.n8nClient.deactivateWorkflow(workflow.n8nId);
        } catch (error) {
          console.error('Failed to deactivate workflow in n8n:', error);
        }
      }

      // Update workflow status
      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: {
          status: 'rolled_back',
          metadata: {
            rollback: {
              reason: options.reason,
              timestamp: new Date(),
              preserveData: options.preserveData
            }
          }
        }
      });

      this.emit('deployment:rolled_back', {
        workflowId,
        reason: options.reason,
        targetVersion: options.targetVersion
      });

      return { success: true, message: 'Rollback completed successfully' };

    } catch (error) {
      console.error('Rollback failed:', error);
      return { 
        success: false, 
        message: error instanceof Error ? error.message : 'Rollback failed' 
      };
    }
  }

  // Validate resource requirements
  private async validateResourceRequirements(
    definition: any,
    tenantContext: TenantContext
  ): Promise<{
    canDeploy: boolean;
    issues: string[];
    warnings: string[];
  }> {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Check tenant quotas
    const quota = await this.tenantIsolation.getTenantSecurityConfig(tenantContext.tenantId);
    
    // Count existing active workflows
    const activeWorkflows = await this.prisma.workflow.count({
      where: {
        tenantId: tenantContext.tenantId,
        status: 'active'
      }
    });

    // Estimate resource usage
    const estimatedComplexity = this.estimateWorkflowComplexity(definition);
    
    if (estimatedComplexity > 100) {
      warnings.push('High complexity workflow may impact performance');
    }

    if (estimatedComplexity > 200) {
      issues.push('Workflow complexity exceeds recommended limits');
    }

    // Check for resource-intensive nodes
    const resourceIntensiveNodes = definition.nodes?.filter((node: any) => 
      ['n8n-nodes-base.splitInBatches', 'n8n-nodes-base.httpRequest'].includes(node.type)
    ).length || 0;

    if (resourceIntensiveNodes > 10) {
      warnings.push('High number of resource-intensive nodes detected');
    }

    return {
      canDeploy: issues.length === 0,
      issues,
      warnings
    };
  }

  // Estimate workflow complexity
  private estimateWorkflowComplexity(definition: any): number {
    let complexity = 0;
    
    if (definition.nodes) {
      complexity += definition.nodes.length * 10;
      
      // Add complexity for specific node types
      for (const node of definition.nodes) {
        switch (node.type) {
          case 'n8n-nodes-base.splitInBatches':
            complexity += 20;
            break;
          case 'n8n-nodes-base.httpRequest':
            complexity += 15;
            break;
          case 'n8n-nodes-base.function':
          case 'n8n-nodes-base.code':
            complexity += 25;
            break;
          default:
            complexity += 5;
        }
      }
    }

    if (definition.connections) {
      complexity += Object.keys(definition.connections).length * 5;
    }

    return complexity;
  }

  // Generate unique deployment ID
  private generateDeploymentId(): string {
    return `deploy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get deployment history
  async getDeploymentHistory(
    tenantId: string,
    workflowName?: string
  ): Promise<any[]> {
    const whereClause: any = { tenantId };
    
    if (workflowName) {
      whereClause.name = workflowName;
    }

    return this.prisma.workflow.findMany({
      where: whereClause,
      orderBy: [
        { name: 'asc' },
        { version: 'desc' }
      ],
      select: {
        id: true,
        name: true,
        version: true,
        status: true,
        environment: true,
        deployedAt: true,
        createdAt: true,
        creator: {
          select: {
            email: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });
  }

  // Get deployment statistics
  async getDeploymentStats(tenantId: string): Promise<any> {
    const [total, active, failed, byEnvironment] = await Promise.all([
      this.prisma.workflow.count({ where: { tenantId } }),
      this.prisma.workflow.count({ where: { tenantId, status: 'active' } }),
      this.prisma.workflow.count({ where: { tenantId, status: 'error' } }),
      this.prisma.workflow.groupBy({
        by: ['environment'],
        where: { tenantId },
        _count: { id: true }
      })
    ]);

    return {
      total,
      active,
      failed,
      inactive: total - active - failed,
      byEnvironment: byEnvironment.reduce((acc, env) => {
        acc[env.environment || 'unknown'] = env._count.id;
        return acc;
      }, {} as any)
    };
  }
}
