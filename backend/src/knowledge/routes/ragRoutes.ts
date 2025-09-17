import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { validateRequest } from '../../middleware/validation';
import {
  generateRAGResponse,
  streamRAGResponse,
  getConversationContext,
  suggestFollowUpQuestions,
  ragHealthCheck,
} from '../controllers/ragController';
import {
  ragRequestSchema,
  conversationContextSchema,
  queryContextSchema,
  followUpQuestionsSchema,
} from '../validators/ragValidators';

const router = Router();

// Apply authentication and tenant middleware to all routes
router.use(authenticate);
router.use(tenantMiddleware);

// RAG response generation
router.post(
  '/generate',
  validateRequest(ragRequestSchema),
  generateRAGResponse
);

// RAG streaming response
router.post(
  '/stream',
  validateRequest(ragRequestSchema),
  streamRAGResponse
);

// Get conversation context with RAG
router.get(
  '/conversations/:conversationId/context',
  validateRequest(conversationContextSchema, 'params'),
  validateRequest(queryContextSchema, 'query'),
  getConversationContext
);

// Suggest follow-up questions
router.get(
  '/queries/:queryId/follow-up',
  validateRequest(followUpQuestionsSchema, 'params'),
  suggestFollowUpQuestions
);

// Health check
router.get('/health', ragHealthCheck);

export default router;
