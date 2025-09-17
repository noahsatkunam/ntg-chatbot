import { Request, Response } from 'express';
import { WorkflowService } from '../workflowService';
import { AuthenticatedRequest } from '../../auth/types/authTypes';

export class WorkflowController {
  private workflowService: WorkflowService;

  constructor() {
    this.workflowService = new WorkflowService();
  }

  async createWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId, userId } = req.user!;
      const { name, description, definition, category, tags } = req.body;

      const workflowData = {
        name,
        description,
        definition,
        category: category || 'general',
        tags: tags || []
      };

      const result = await this.workflowService.deployWorkflow(
        tenantId,
        userId,
        workflowData,
        { validateOnly: false, activate: false }
      );

      res.status(201).json({
        success: true,
        data: {
          workflowId: result.workflowId,
          n8nId: result.n8nId,
          webhookUrl: result.webhookUrl
        }
      });
    } catch (error) {
      console.error('Create workflow error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create workflow'
      });
    }
  }

  async listWorkflows(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const {
        status,
        category,
        tags,
        createdBy,
        search,
        limit = 20,
        offset = 0
      } = req.query;

      const filters = {
        status: status as string,
        category: category as string,
        tags: tags ? (tags as string).split(',') : undefined,
        createdBy: createdBy as string,
        search: search as string,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      };

      const workflows = await this.workflowService.listWorkflows(tenantId, filters);

      res.json({
        success: true,
        data: workflows
      });
    } catch (error) {
      console.error('List workflows error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list workflows'
      });
    }
  }

  async getWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { workflowId } = req.params;

      const workflow = await this.workflowService.getWorkflow(workflowId, tenantId);

      res.json({
        success: true,
        data: workflow
      });
    } catch (error) {
      console.error('Get workflow error:', error);
      res.status(404).json({
        success: false,
        error: error instanceof Error ? error.message : 'Workflow not found'
      });
    }
  }

  async updateWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { workflowId } = req.params;
      const updates = req.body;

      const workflow = await this.workflowService.updateWorkflow(workflowId, tenantId, updates);

      res.json({
        success: true,
        data: workflow
      });
    } catch (error) {
      console.error('Update workflow error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update workflow'
      });
    }
  }

  async deleteWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { workflowId } = req.params;

      await this.workflowService.deleteWorkflow(workflowId, tenantId);

      res.json({
        success: true,
        message: 'Workflow deleted successfully'
      });
    } catch (error) {
      console.error('Delete workflow error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete workflow'
      });
    }
  }

  async deployWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId, userId } = req.user!;
      const { workflowId } = req.params;
      const { activate = false, environment = 'production' } = req.body;

      // Get existing workflow
      const workflow = await this.workflowService.getWorkflow(workflowId, tenantId);
      
      const result = await this.workflowService.deployWorkflow(
        tenantId,
        userId,
        workflow.definition,
        { activate, environment }
      );

      res.json({
        success: true,
        data: {
          workflowId: result.workflowId,
          n8nId: result.n8nId,
          webhookUrl: result.webhookUrl,
          status: activate ? 'active' : 'inactive'
        }
      });
    } catch (error) {
      console.error('Deploy workflow error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to deploy workflow'
      });
    }
  }

  async activateWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { workflowId } = req.params;

      await this.workflowService.activateWorkflow(workflowId, tenantId);

      res.json({
        success: true,
        message: 'Workflow activated successfully'
      });
    } catch (error) {
      console.error('Activate workflow error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to activate workflow'
      });
    }
  }

  async deactivateWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { workflowId } = req.params;

      await this.workflowService.deactivateWorkflow(workflowId, tenantId);

      res.json({
        success: true,
        message: 'Workflow deactivated successfully'
      });
    } catch (error) {
      console.error('Deactivate workflow error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to deactivate workflow'
      });
    }
  }

  async executeWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId, userId } = req.user!;
      const { workflowId } = req.params;
      const { triggerData, metadata } = req.body;

      const executionId = await this.workflowService.executeWorkflow(workflowId, {
        tenantId,
        userId,
        triggerData: triggerData || {},
        metadata
      });

      res.json({
        success: true,
        data: {
          executionId,
          status: 'started'
        }
      });
    } catch (error) {
      console.error('Execute workflow error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute workflow'
      });
    }
  }

  async listExecutions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { workflowId } = req.params;
      const {
        status,
        startTime,
        triggeredBy,
        limit = 20,
        offset = 0
      } = req.query;

      const filters = {
        status: status as string,
        startTime: startTime ? { gte: new Date(startTime as string) } : undefined,
        triggeredBy: triggeredBy as string,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      };

      const executions = await this.workflowService.listExecutions(
        tenantId,
        workflowId,
        filters
      );

      res.json({
        success: true,
        data: executions
      });
    } catch (error) {
      console.error('List executions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list executions'
      });
    }
  }

  async duplicateWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId, userId } = req.user!;
      const { workflowId } = req.params;
      const { name } = req.body;

      // Get original workflow
      const originalWorkflow = await this.workflowService.getWorkflow(workflowId, tenantId);
      
      // Create duplicate with new name
      const duplicateData = {
        ...originalWorkflow.definition,
        name: name || `${originalWorkflow.name} (Copy)`
      };

      const result = await this.workflowService.deployWorkflow(
        tenantId,
        userId,
        duplicateData,
        { activate: false }
      );

      res.json({
        success: true,
        data: {
          workflowId: result.workflowId,
          name: duplicateData.name
        }
      });
    } catch (error) {
      console.error('Duplicate workflow error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to duplicate workflow'
      });
    }
  }

  async exportWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { workflowId } = req.params;

      const workflow = await this.workflowService.getWorkflow(workflowId, tenantId);
      
      const exportData = {
        name: workflow.name,
        description: workflow.description,
        definition: workflow.definition,
        category: workflow.category,
        tags: workflow.tags,
        exportedAt: new Date().toISOString(),
        version: workflow.version
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${workflow.name}.json"`);
      res.json(exportData);
    } catch (error) {
      console.error('Export workflow error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export workflow'
      });
    }
  }

  async importWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId, userId } = req.user!;
      const workflowData = req.body;

      const result = await this.workflowService.deployWorkflow(
        tenantId,
        userId,
        workflowData,
        { activate: false }
      );

      res.json({
        success: true,
        data: {
          workflowId: result.workflowId,
          message: 'Workflow imported successfully'
        }
      });
    } catch (error) {
      console.error('Import workflow error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to import workflow'
      });
    }
  }

  async validateWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId, userId } = req.user!;
      const { definition } = req.body;

      const result = await this.workflowService.deployWorkflow(
        tenantId,
        userId,
        definition,
        { validateOnly: true }
      );

      res.json({
        success: true,
        data: {
          valid: true,
          message: 'Workflow definition is valid'
        }
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        data: {
          valid: false,
          error: error instanceof Error ? error.message : 'Workflow validation failed'
        }
      });
    }
  }

  async getWorkflowStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;

      const stats = await this.workflowService.getWorkflowAnalytics(tenantId);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Get workflow stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get workflow statistics'
      });
    }
  }

  async getWorkflowAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { startDate, endDate } = req.query;

      const timeRange = startDate && endDate ? {
        start: new Date(startDate as string),
        end: new Date(endDate as string)
      } : undefined;

      const analytics = await this.workflowService.getWorkflowAnalytics(tenantId, timeRange);

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      console.error('Get workflow analytics error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get workflow analytics'
      });
    }
  }
}
