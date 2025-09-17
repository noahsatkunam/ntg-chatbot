import { Router } from 'express';
import { WebhookController } from '../controllers/webhookController';
import { validateRequest } from '../../common/middleware/validateRequest';
import { webhookValidators } from '../validators/webhookValidators';

const router = Router();
const webhookController = new WebhookController();

// Webhook trigger routes - no auth middleware as these are called by external systems
router.post(
  '/trigger/:tenantId/:workflowId',
  validateRequest(webhookValidators.triggerWebhook),
  webhookController.triggerWebhook.bind(webhookController)
);

router.get(
  '/trigger/:tenantId/:workflowId',
  validateRequest(webhookValidators.triggerWebhook),
  webhookController.triggerWebhook.bind(webhookController)
);

// Health check for webhook endpoint
router.get('/health', webhookController.healthCheck.bind(webhookController));

export { router as webhookRoutes };
