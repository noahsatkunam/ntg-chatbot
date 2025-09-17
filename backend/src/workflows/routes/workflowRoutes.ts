import { Router } from 'express';
import { WorkflowController } from '../controllers/workflowController';
import { authMiddleware } from '../../auth/middleware/authMiddleware';
import { tenantMiddleware } from '../../auth/middleware/tenantMiddleware';
import { validateRequest } from '../../common/middleware/validateRequest';
import { workflowValidators } from '../validators/workflowValidators';

const router = Router();
const workflowController = new WorkflowController();

// Apply authentication and tenant middleware to all routes
router.use(authMiddleware);
router.use(tenantMiddleware);

// Workflow Management Routes
router.post(
  '/',
  validateRequest(workflowValidators.createWorkflow),
  workflowController.createWorkflow.bind(workflowController)
);

router.get(
  '/',
  validateRequest(workflowValidators.listWorkflows),
  workflowController.listWorkflows.bind(workflowController)
);

router.get(
  '/:workflowId',
  validateRequest(workflowValidators.getWorkflow),
  workflowController.getWorkflow.bind(workflowController)
);

router.put(
  '/:workflowId',
  validateRequest(workflowValidators.updateWorkflow),
  workflowController.updateWorkflow.bind(workflowController)
);

router.delete(
  '/:workflowId',
  validateRequest(workflowValidators.deleteWorkflow),
  workflowController.deleteWorkflow.bind(workflowController)
);

// Workflow Deployment Routes
router.post(
  '/:workflowId/deploy',
  validateRequest(workflowValidators.deployWorkflow),
  workflowController.deployWorkflow.bind(workflowController)
);

router.post(
  '/:workflowId/activate',
  validateRequest(workflowValidators.activateWorkflow),
  workflowController.activateWorkflow.bind(workflowController)
);

router.post(
  '/:workflowId/deactivate',
  validateRequest(workflowValidators.deactivateWorkflow),
  workflowController.deactivateWorkflow.bind(workflowController)
);

// Workflow Execution Routes
router.post(
  '/:workflowId/execute',
  validateRequest(workflowValidators.executeWorkflow),
  workflowController.executeWorkflow.bind(workflowController)
);

router.get(
  '/:workflowId/executions',
  validateRequest(workflowValidators.listExecutions),
  workflowController.listExecutions.bind(workflowController)
);

// Workflow Duplication and Import/Export
router.post(
  '/:workflowId/duplicate',
  validateRequest(workflowValidators.duplicateWorkflow),
  workflowController.duplicateWorkflow.bind(workflowController)
);

router.get(
  '/:workflowId/export',
  validateRequest(workflowValidators.exportWorkflow),
  workflowController.exportWorkflow.bind(workflowController)
);

router.post(
  '/import',
  validateRequest(workflowValidators.importWorkflow),
  workflowController.importWorkflow.bind(workflowController)
);

// Workflow Validation
router.post(
  '/validate',
  validateRequest(workflowValidators.validateWorkflow),
  workflowController.validateWorkflow.bind(workflowController)
);

// Workflow Statistics
router.get(
  '/stats/overview',
  workflowController.getWorkflowStats.bind(workflowController)
);

router.get(
  '/stats/analytics',
  validateRequest(workflowValidators.getAnalytics),
  workflowController.getWorkflowAnalytics.bind(workflowController)
);

export { router as workflowRoutes };
