import { Request, Response } from 'express';
import { WorkflowService } from '../workflowService';
import { AuthenticatedRequest } from '../../auth/types/authTypes';

export class TemplateController {
  private workflowService: WorkflowService;

  constructor() {
    this.workflowService = new WorkflowService();
  }

  async listTemplates(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const {
        category,
        tags,
        search,
        limit = 20,
        offset = 0
      } = req.query;

      const filters = {
        category: category as string,
        tags: tags ? (tags as string).split(',') : undefined,
        search: search as string,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      };

      const templates = await this.workflowService.getTemplates(category as string, filters);

      res.json({
        success: true,
        data: templates
      });
    } catch (error) {
      console.error('List templates error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list templates'
      });
    }
  }

  async getTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { templateId } = req.params;

      // Get template through the template manager
      const templateManager = (this.workflowService as any).templateManager;
      const template = await templateManager.getTemplate(templateId);

      res.json({
        success: true,
        data: template
      });
    } catch (error) {
      console.error('Get template error:', error);
      res.status(404).json({
        success: false,
        error: error instanceof Error ? error.message : 'Template not found'
      });
    }
  }

  async createTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.user!;
      const { name, description, definition, category, tags } = req.body;

      const templateData = {
        name,
        description,
        definition,
        category: category || 'general',
        tags: tags || [],
        createdBy: userId
      };

      // Create template through the template manager
      const templateManager = (this.workflowService as any).templateManager;
      const templateId = await templateManager.createTemplate(templateData);

      res.status(201).json({
        success: true,
        data: {
          templateId,
          message: 'Template created successfully'
        }
      });
    } catch (error) {
      console.error('Create template error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create template'
      });
    }
  }

  async updateTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { templateId } = req.params;
      const updates = req.body;

      // Update template through the template manager
      const templateManager = (this.workflowService as any).templateManager;
      const template = await templateManager.updateTemplate(templateId, updates);

      res.json({
        success: true,
        data: template
      });
    } catch (error) {
      console.error('Update template error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update template'
      });
    }
  }

  async deleteTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { templateId } = req.params;

      // Delete template through the template manager
      const templateManager = (this.workflowService as any).templateManager;
      await templateManager.deleteTemplate(templateId);

      res.json({
        success: true,
        message: 'Template deleted successfully'
      });
    } catch (error) {
      console.error('Delete template error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete template'
      });
    }
  }

  async createFromTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId, userId } = req.user!;
      const { templateId } = req.params;
      const { name, description, customizations } = req.body;

      const workflowId = await this.workflowService.createFromTemplate(
        templateId,
        tenantId,
        userId,
        {
          name,
          description,
          ...customizations
        }
      );

      res.json({
        success: true,
        data: {
          workflowId,
          message: 'Workflow created from template successfully'
        }
      });
    } catch (error) {
      console.error('Create from template error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create workflow from template'
      });
    }
  }

  async getPopularTemplates(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { limit = 10 } = req.query;

      // Get popular templates through the template manager
      const templateManager = (this.workflowService as any).templateManager;
      const templates = await templateManager.getPopularTemplates(parseInt(limit as string));

      res.json({
        success: true,
        data: templates
      });
    } catch (error) {
      console.error('Get popular templates error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get popular templates'
      });
    }
  }

  async getTemplatesByCategory(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      // Get templates by category through the template manager
      const templateManager = (this.workflowService as any).templateManager;
      const categories = await templateManager.getTemplatesByCategory();

      res.json({
        success: true,
        data: categories
      });
    } catch (error) {
      console.error('Get templates by category error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get templates by category'
      });
    }
  }
}
