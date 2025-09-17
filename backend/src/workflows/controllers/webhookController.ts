import { Request, Response } from 'express';
import { WorkflowService } from '../workflowService';

export class WebhookController {
  private workflowService: WorkflowService;

  constructor() {
    this.workflowService = new WorkflowService();
  }

  async triggerWebhook(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId, workflowId } = req.params;
      const webhookPath = `${tenantId}/${workflowId}`;
      const data = req.method === 'GET' ? req.query : req.body;
      const headers = req.headers;

      const executionId = await this.workflowService.triggerFromWebhook(
        tenantId,
        webhookPath,
        data,
        headers
      );

      if (executionId) {
        res.json({
          success: true,
          data: {
            executionId,
            message: 'Workflow triggered successfully'
          }
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Webhook trigger not found or inactive'
        });
      }
    } catch (error) {
      console.error('Webhook trigger error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to trigger webhook'
      });
    }
  }

  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      const health = await this.workflowService.healthCheck();
      
      res.status(health.status === 'healthy' ? 200 : 503).json({
        success: health.status === 'healthy',
        data: health
      });
    } catch (error) {
      res.status(503).json({
        success: false,
        error: 'Health check failed'
      });
    }
  }
}
