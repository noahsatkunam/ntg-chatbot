import { Router } from 'express';
import { ExecutionController } from '../controllers/executionController';
import { authMiddleware } from '../../auth/middleware/authMiddleware';
import { tenantMiddleware } from '../../auth/middleware/tenantMiddleware';
import { validateRequest } from '../../common/middleware/validateRequest';
import { executionValidators } from '../validators/executionValidators';

const router = Router();
const executionController = new ExecutionController();

// Apply authentication and tenant middleware to all routes
router.use(authMiddleware);
router.use(tenantMiddleware);

// Execution Management Routes
router.get(
  '/',
  validateRequest(executionValidators.listExecutions),
  executionController.listExecutions.bind(executionController)
);

router.get(
  '/:executionId',
  validateRequest(executionValidators.getExecution),
  executionController.getExecution.bind(executionController)
);

router.get(
  '/:executionId/logs',
  validateRequest(executionValidators.getExecutionLogs),
  executionController.getExecutionLogs.bind(executionController)
);

router.post(
  '/:executionId/cancel',
  validateRequest(executionValidators.cancelExecution),
  executionController.cancelExecution.bind(executionController)
);

router.post(
  '/:executionId/retry',
  validateRequest(executionValidators.retryExecution),
  executionController.retryExecution.bind(executionController)
);

// Execution Statistics
router.get(
  '/stats/overview',
  validateRequest(executionValidators.getExecutionStats),
  executionController.getExecutionStats.bind(executionController)
);

// Advanced Execution Management
router.post(
  '/bulk/cancel',
  validateRequest(executionValidators.bulkCancelExecutions),
  executionController.bulkCancelExecutions.bind(executionController)
);

router.post(
  '/bulk/retry',
  validateRequest(executionValidators.bulkRetryExecutions),
  executionController.bulkRetryExecutions.bind(executionController)
);

router.delete(
  '/bulk/delete',
  validateRequest(executionValidators.bulkDeleteExecutions),
  executionController.bulkDeleteExecutions.bind(executionController)
);

// Execution Monitoring
router.get(
  '/monitor/active',
  executionController.getActiveExecutions.bind(executionController)
);

router.get(
  '/monitor/performance',
  validateRequest(executionValidators.getPerformanceMetrics),
  executionController.getPerformanceMetrics.bind(executionController)
);

router.get(
  '/monitor/resource-usage',
  validateRequest(executionValidators.getResourceUsage),
  executionController.getResourceUsage.bind(executionController)
);

// Execution Testing
router.post(
  '/test/:workflowId',
  validateRequest(executionValidators.testExecution),
  executionController.testExecution.bind(executionController)
);

router.post(
  '/dry-run/:workflowId',
  validateRequest(executionValidators.dryRunExecution),
  executionController.dryRunExecution.bind(executionController)
);

// Execution Scheduling
router.get(
  '/scheduled',
  validateRequest(executionValidators.getScheduledExecutions),
  executionController.getScheduledExecutions.bind(executionController)
);

router.post(
  '/schedule/:workflowId',
  validateRequest(executionValidators.scheduleExecution),
  executionController.scheduleExecution.bind(executionController)
);

router.delete(
  '/schedule/:scheduleId',
  validateRequest(executionValidators.cancelScheduledExecution),
  executionController.cancelScheduledExecution.bind(executionController)
);

// Execution Analytics
router.get(
  '/analytics/trends',
  validateRequest(executionValidators.getExecutionTrends),
  executionController.getExecutionTrends.bind(executionController)
);

router.get(
  '/analytics/errors',
  validateRequest(executionValidators.getErrorAnalytics),
  executionController.getErrorAnalytics.bind(executionController)
);

router.get(
  '/analytics/performance',
  validateRequest(executionValidators.getPerformanceAnalytics),
  executionController.getPerformanceAnalytics.bind(executionController)
);

export { router as executionRoutes };
