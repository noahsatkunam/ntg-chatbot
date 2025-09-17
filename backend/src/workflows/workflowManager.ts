import { PrismaClient } from '@prisma/client';
import { N8nClient } from './n8nClient';

export interface WorkflowFilters {
  status?: string;
  category?: string;
  tags?: string[];
  createdBy?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export class WorkflowManager {
  constructor(
    private prisma: PrismaClient,
    private n8nClient: N8nClient
  ) {}

  async getWorkflow(workflowId: string, tenantId: string): Promise<any> {
    const workflow = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        tenantId
      },
      include: {
        creator: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        },
        triggers: true,
        executions: {
          orderBy: { startTime: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            startTime: true,
            endTime: true,
            duration: true
          }
        }
      }
    });

    if (!workflow) {
      throw new Error('Workflow not found');
    }

    return workflow;
  }

  async listWorkflows(tenantId: string, filters: WorkflowFilters = {}): Promise<any[]> {
    const {
      status,
      category,
      tags,
      createdBy,
      search,
      limit = 20,
      offset = 0
    } = filters;

    const whereClause: any = { tenantId };

    if (status) {
      whereClause.status = status;
    }

    if (category) {
      whereClause.category = category;
    }

    if (createdBy) {
      whereClause.createdBy = createdBy;
    }

    if (tags && tags.length > 0) {
      whereClause.tags = {
        array_contains: tags
      };
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const workflows = await this.prisma.workflow.findMany({
      where: whereClause,
      include: {
        creator: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        },
        _count: {
          select: {
            executions: true,
            triggers: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset
    });

    return workflows;
  }

  async updateWorkflow(
    workflowId: string,
    tenantId: string,
    updates: any
  ): Promise<any> {
    // Verify workflow exists and belongs to tenant
    const existingWorkflow = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        tenantId
      }
    });

    if (!existingWorkflow) {
      throw new Error('Workflow not found');
    }

    // If updating definition, validate it
    if (updates.definition) {
      const validation = this.n8nClient.validateWorkflowDefinition(updates.definition);
      if (!validation.isValid) {
        throw new Error(`Workflow validation failed: ${validation.errors.join(', ')}`);
      }
    }

    // Update in database
    const updatedWorkflow = await this.prisma.workflow.update({
      where: { id: workflowId },
      data: {
        ...updates,
        updatedAt: new Date(),
        version: existingWorkflow.version + 1
      }
    });

    // Update in n8n if deployed
    if (existingWorkflow.n8nId && updates.definition) {
      try {
        await this.n8nClient.updateWorkflow(existingWorkflow.n8nId, {
          name: updates.name || existingWorkflow.name,
          nodes: updates.definition.nodes,
          connections: updates.definition.connections,
          settings: updates.definition.settings
        });
      } catch (error) {
        console.error('Failed to update workflow in n8n:', error);
        // Rollback database changes if n8n update fails
        await this.prisma.workflow.update({
          where: { id: workflowId },
          data: {
            definition: existingWorkflow.definition,
            version: existingWorkflow.version
          }
        });
        throw new Error('Failed to update workflow in n8n');
      }
    }

    return updatedWorkflow;
  }

  async deleteWorkflow(workflowId: string, tenantId: string): Promise<void> {
    // Verify workflow exists and belongs to tenant
    const workflow = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        tenantId
      }
    });

    if (!workflow) {
      throw new Error('Workflow not found');
    }

    // Delete from n8n if deployed
    if (workflow.n8nId) {
      try {
        await this.n8nClient.deleteWorkflow(workflow.n8nId);
      } catch (error) {
        console.error('Failed to delete workflow from n8n:', error);
        // Continue with database deletion even if n8n deletion fails
      }
    }

    // Delete from database (cascades to executions and triggers)
    await this.prisma.workflow.delete({
      where: { id: workflowId }
    });
  }

  async activateWorkflow(workflowId: string, tenantId: string): Promise<void> {
    const workflow = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        tenantId
      }
    });

    if (!workflow) {
      throw new Error('Workflow not found');
    }

    if (!workflow.n8nId) {
      throw new Error('Workflow not deployed to n8n');
    }

    // Activate in n8n
    await this.n8nClient.activateWorkflow(workflow.n8nId);

    // Update status in database
    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: { status: 'active' }
    });
  }

  async deactivateWorkflow(workflowId: string, tenantId: string): Promise<void> {
    const workflow = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        tenantId
      }
    });

    if (!workflow) {
      throw new Error('Workflow not found');
    }

    if (!workflow.n8nId) {
      throw new Error('Workflow not deployed to n8n');
    }

    // Deactivate in n8n
    await this.n8nClient.deactivateWorkflow(workflow.n8nId);

    // Update status in database
    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: { status: 'inactive' }
    });
  }

  async duplicateWorkflow(
    workflowId: string,
    tenantId: string,
    userId: string,
    newName?: string
  ): Promise<string> {
    const originalWorkflow = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        tenantId
      }
    });

    if (!originalWorkflow) {
      throw new Error('Workflow not found');
    }

    // Create duplicate workflow
    const duplicatedWorkflow = await this.prisma.workflow.create({
      data: {
        tenantId,
        createdBy: userId,
        name: newName || `${originalWorkflow.name} (Copy)`,
        description: originalWorkflow.description,
        definition: originalWorkflow.definition,
        category: originalWorkflow.category,
        tags: originalWorkflow.tags,
        status: 'draft'
      }
    });

    return duplicatedWorkflow.id;
  }

  async exportWorkflow(workflowId: string, tenantId: string): Promise<any> {
    const workflow = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        tenantId
      },
      include: {
        triggers: true
      }
    });

    if (!workflow) {
      throw new Error('Workflow not found');
    }

    return {
      name: workflow.name,
      description: workflow.description,
      definition: workflow.definition,
      category: workflow.category,
      tags: workflow.tags,
      triggers: workflow.triggers.map(trigger => ({
        type: trigger.triggerType,
        configuration: trigger.configuration
      })),
      exportedAt: new Date().toISOString(),
      version: workflow.version
    };
  }

  async importWorkflow(
    tenantId: string,
    userId: string,
    workflowData: any
  ): Promise<string> {
    // Validate imported workflow
    const validation = this.n8nClient.validateWorkflowDefinition(workflowData.definition);
    if (!validation.isValid) {
      throw new Error(`Invalid workflow definition: ${validation.errors.join(', ')}`);
    }

    // Create workflow from imported data
    const workflow = await this.prisma.workflow.create({
      data: {
        tenantId,
        createdBy: userId,
        name: workflowData.name,
        description: workflowData.description,
        definition: workflowData.definition,
        category: workflowData.category || 'general',
        tags: workflowData.tags || [],
        status: 'draft'
      }
    });

    // Create triggers if provided
    if (workflowData.triggers && Array.isArray(workflowData.triggers)) {
      for (const triggerData of workflowData.triggers) {
        await this.prisma.workflowTrigger.create({
          data: {
            workflowId: workflow.id,
            tenantId,
            triggerType: triggerData.type,
            configuration: triggerData.configuration
          }
        });
      }
    }

    return workflow.id;
  }

  async getWorkflowStats(tenantId: string): Promise<any> {
    const [totalWorkflows, activeWorkflows, categories, recentExecutions] = await Promise.all([
      this.prisma.workflow.count({
        where: { tenantId }
      }),
      this.prisma.workflow.count({
        where: { tenantId, status: 'active' }
      }),
      this.prisma.workflow.groupBy({
        by: ['category'],
        where: { tenantId },
        _count: { id: true }
      }),
      this.prisma.workflowExecution.count({
        where: {
          tenantId,
          startTime: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      })
    ]);

    return {
      totalWorkflows,
      activeWorkflows,
      inactiveWorkflows: totalWorkflows - activeWorkflows,
      categories: categories.reduce((acc, cat) => {
        acc[cat.category] = cat._count.id;
        return acc;
      }, {} as any),
      recentExecutions
    };
  }

  async validateWorkflowAccess(
    workflowId: string,
    tenantId: string,
    userId: string,
    requiredPermission: 'read' | 'write' | 'execute' = 'read'
  ): Promise<boolean> {
    const workflow = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        tenantId
      },
      include: {
        creator: true
      }
    });

    if (!workflow) {
      return false;
    }

    // For now, simple permission model - creator has all permissions
    // Can be extended with role-based access control
    switch (requiredPermission) {
      case 'read':
        return true; // All tenant users can read workflows
      case 'write':
        return workflow.createdBy === userId;
      case 'execute':
        return true; // All tenant users can execute workflows
      default:
        return false;
    }
  }
}
