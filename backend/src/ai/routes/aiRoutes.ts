import { Router } from 'express';
import { aiController } from '../controllers/aiController';
import { authenticate } from '../../auth/middleware/authMiddleware';
import { validateRequest } from '../../middlewares/validation.middleware';
import { aiValidators } from '../validators/aiValidators';
import { multiTenantMiddleware } from '../../tenant/middleware/tenantMiddleware';

const router = Router();

// Apply authentication and multi-tenant middleware to all routes
router.use(authenticate);
router.use(multiTenantMiddleware);

// AI Chat endpoints
router.post(
  '/chat',
  validateRequest(aiValidators.generateResponse),
  aiController.generateResponse
);

router.post(
  '/stream',
  validateRequest(aiValidators.generateResponse),
  aiController.generateResponse
);

// Configuration endpoints
router.get(
  '/config',
  aiController.getConfiguration
);

router.put(
  '/config',
  validateRequest(aiValidators.updateConfiguration),
  aiController.updateConfiguration
);

// Model management
router.get(
  '/models',
  aiController.getModels
);

// Provider credentials
router.post(
  '/credentials',
  validateRequest(aiValidators.setProviderCredentials),
  aiController.setProviderCredentials
);

// Usage statistics
router.get(
  '/usage',
  validateRequest(aiValidators.getUsageStats, 'query'),
  aiController.getUsageStats
);

router.get(
  '/usage/conversations',
  validateRequest(aiValidators.getTopConversations, 'query'),
  aiController.getTopConversations
);

// Health and testing
router.get(
  '/health',
  aiController.getHealthStatus
);

router.post(
  '/test',
  validateRequest(aiValidators.testConnection),
  aiController.testConnection
);

export default router;
