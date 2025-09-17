import { Request, Response } from 'express';
import { WorkflowService } from '../workflowService';
import { AuthenticatedRequest } from '../../auth/types/authTypes';

export class ExecutionController {
  private workflowService: WorkflowService;

  constructor() {
    this.workflowService = new WorkflowService();
  }

  async listExecutions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const {
        workflowId,
        status,
        startTime,
        endTime,
        triggeredBy,
        limit = 20,
        offset = 0
      } = req.query;

      const filters = {
        status: status as string,
        startTime: startTime || endTime ? {
          gte: startTime ? new Date(startTime as string) : undefined,
          lte: endTime ? new Date(endTime as string) : undefined
        } : undefined,
        triggeredBy: triggeredBy as string,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      };

      const executions = await this.workflowService.listExecutions(
        tenantId,
        workflowId as string,
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

  async getExecution(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { executionId } = req.params;

      const execution = await this.workflowService.getExecution(executionId, tenantId);

      res.json({
        success: true,
        data: execution
      });
    } catch (error) {
      console.error('Get execution error:', error);
      res.status(404).json({
        success: false,
        error: error instanceof Error ? error.message : 'Execution not found'
      });
    }
  }

  async getExecutionLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { executionId } = req.params;

      // Get execution logs through the execution monitor
      const executionMonitor = (this.workflowService as any).executionMonitor;
      const logs = await executionMonitor.getExecutionLogs(executionId, tenantId);

      res.json({
        success: true,
        data: logs
      });
    } catch (error) {
      console.error('Get execution logs error:', error);
      res.status(404).json({
        success: false,
        error: error instanceof Error ? error.message : 'Execution logs not found'
      });
    }
  }

  async cancelExecution(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { executionId } = req.params;

      await this.workflowService.cancelExecution(executionId, tenantId);

      res.json({
        success: true,
        message: 'Execution cancelled successfully'
      });
    } catch (error) {
      console.error('Cancel execution error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel execution'
      });
    }
  }

  async retryExecution(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { executionId } = req.params;

      const newExecutionId = await this.workflowService.retryExecution(executionId, tenantId);

      res.json({
        success: true,
        data: {
          newExecutionId,
          message: 'Execution retry started successfully'
        }
      });
    } catch (error) {
      console.error('Retry execution error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retry execution'
      });
    }
  }

  async getExecutionStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.user!;
      const { startDate, endDate } = req.query;

      const timeRange = startDate && endDate ? {
        start: new Date(startDate as string),
        end: new Date(endDate as string)
      } : undefined;

      // Get execution stats through the execution monitor
      const executionMonitor = (this.workflowService as any).executionMonitor;
      const stats = await executionMonitor.getExecutionStats(tenantId, timeRange);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Get execution stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get execution statistics'
      });
    }
  }
}
