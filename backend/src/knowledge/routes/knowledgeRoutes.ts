import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { validateRequest } from '../../middleware/validation';
import {
  initializeKnowledgeBase,
  uploadDocument,
  getDocuments,
  getDocument,
  deleteDocument,
  reindexDocument,
  searchKnowledgeBase,
  getKnowledgeBaseStats,
  submitFeedback,
  getRetrievalAnalytics,
  getQueryContext,
  healthCheck,
  knowledgeUpload,
} from '../controllers/knowledgeController';
import {
  documentUploadSchema,
  searchSchema,
  documentIdSchema,
  queryIdSchema,
  feedbackSchema,
  analyticsSchema,
  documentListSchema,
} from '../validators/knowledgeValidators';

const router = Router();

// Apply authentication and tenant middleware to all routes
router.use(authenticate);
router.use(tenantMiddleware);

// Initialize knowledge base for tenant
router.post('/initialize', initializeKnowledgeBase);

// Document management routes
router.post(
  '/documents/upload',
  knowledgeUpload,
  validateRequest(documentUploadSchema),
  uploadDocument
);

router.get(
  '/documents',
  validateRequest(documentListSchema, 'query'),
  getDocuments
);

router.get(
  '/documents/:documentId',
  validateRequest(documentIdSchema, 'params'),
  getDocument
);

router.delete(
  '/documents/:documentId',
  validateRequest(documentIdSchema, 'params'),
  deleteDocument
);

router.post(
  '/documents/:documentId/reindex',
  validateRequest(documentIdSchema, 'params'),
  reindexDocument
);

// Search routes
router.post(
  '/search',
  validateRequest(searchSchema),
  searchKnowledgeBase
);

// Feedback routes
router.post(
  '/feedback',
  validateRequest(feedbackSchema),
  submitFeedback
);

// Analytics routes
router.get(
  '/analytics',
  validateRequest(analyticsSchema, 'query'),
  getRetrievalAnalytics
);

router.get(
  '/queries/:queryId',
  validateRequest(queryIdSchema, 'params'),
  getQueryContext
);

// Statistics route
router.get('/stats', getKnowledgeBaseStats);

// Health check route
router.get('/health', healthCheck);

export default router;
