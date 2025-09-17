import express from 'express';
import { body, param, query } from 'express-validator';
import { authMiddleware } from '../../auth/middleware/authMiddleware';
import { validateRequest } from '../../shared/middleware/validateRequest';
import { RAGIntegrationController } from '../controllers/ragIntegrationController';

const router = express.Router();
const ragIntegrationController = new RAGIntegrationController();

// Suggest documents for query
router.get(
  '/suggest/:query',
  authMiddleware,
  [
    param('query').trim().isLength({ min: 1, max: 500 }).withMessage('Query is required'),
    query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Invalid limit'),
    query('threshold').optional().isFloat({ min: 0, max: 1 }).withMessage('Invalid threshold')
  ],
  validateRequest,
  ragIntegrationController.suggestDocuments.bind(ragIntegrationController)
);

// Explain document content
router.post(
  '/explain/:documentId',
  authMiddleware,
  [
    param('documentId').isUUID().withMessage('Invalid document ID'),
    body('question').optional().trim().isLength({ max: 500 }).withMessage('Question too long'),
    body('context').optional().trim().isLength({ max: 1000 }).withMessage('Context too long')
  ],
  validateRequest,
  ragIntegrationController.explainDocument.bind(ragIntegrationController)
);

// Find similar documents
router.get(
  '/similar/:documentId',
  authMiddleware,
  [
    param('documentId').isUUID().withMessage('Invalid document ID'),
    query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Invalid limit'),
    query('threshold').optional().isFloat({ min: 0, max: 1 }).withMessage('Invalid threshold')
  ],
  validateRequest,
  ragIntegrationController.findSimilarDocuments.bind(ragIntegrationController)
);

// Q&A about specific document
router.post(
  '/qa/:documentId',
  authMiddleware,
  [
    param('documentId').isUUID().withMessage('Invalid document ID'),
    body('question').trim().isLength({ min: 1, max: 500 }).withMessage('Question is required'),
    body('includeContext').optional().isBoolean().withMessage('Include context must be boolean')
  ],
  validateRequest,
  ragIntegrationController.documentQA.bind(ragIntegrationController)
);

// Get document insights and summary
router.get(
  '/insights/:documentId',
  authMiddleware,
  [
    param('documentId').isUUID().withMessage('Invalid document ID')
  ],
  validateRequest,
  ragIntegrationController.getDocumentInsights.bind(ragIntegrationController)
);

// Generate document-based chat suggestions
router.post(
  '/chat-suggestions',
  authMiddleware,
  [
    body('conversationContext').trim().isLength({ min: 1, max: 2000 }).withMessage('Context is required'),
    body('limit').optional().isInt({ min: 1, max: 10 }).withMessage('Invalid limit')
  ],
  validateRequest,
  ragIntegrationController.generateChatSuggestions.bind(ragIntegrationController)
);

// Analyze conversation for knowledge gaps
router.post(
  '/analyze-gaps',
  authMiddleware,
  [
    body('conversationId').isUUID().withMessage('Invalid conversation ID'),
    body('messageLimit').optional().isInt({ min: 5, max: 50 }).withMessage('Invalid message limit')
  ],
  validateRequest,
  ragIntegrationController.analyzeKnowledgeGaps.bind(ragIntegrationController)
);

// Get contextual document recommendations
router.post(
  '/recommend-docs',
  authMiddleware,
  [
    body('query').trim().isLength({ min: 1, max: 500 }).withMessage('Query is required'),
    body('conversationId').optional().isUUID().withMessage('Invalid conversation ID'),
    body('excludeDocuments').optional().isArray().withMessage('Exclude documents must be array'),
    body('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Invalid limit')
  ],
  validateRequest,
  ragIntegrationController.recommendDocuments.bind(ragIntegrationController)
);

// Validate source accuracy
router.post(
  '/validate-source',
  authMiddleware,
  [
    body('sourceId').isUUID().withMessage('Invalid source ID'),
    body('claim').trim().isLength({ min: 1, max: 1000 }).withMessage('Claim is required'),
    body('context').optional().trim().isLength({ max: 2000 }).withMessage('Context too long')
  ],
  validateRequest,
  ragIntegrationController.validateSourceAccuracy.bind(ragIntegrationController)
);

// Get knowledge base health metrics
router.get(
  '/health-metrics',
  authMiddleware,
  ragIntegrationController.getKnowledgeBaseHealth.bind(ragIntegrationController)
);

// Generate knowledge base summary
router.get(
  '/summary',
  authMiddleware,
  [
    query('includeStats').optional().isBoolean().withMessage('Include stats must be boolean'),
    query('includeTopics').optional().isBoolean().withMessage('Include topics must be boolean')
  ],
  validateRequest,
  ragIntegrationController.generateKnowledgeBaseSummary.bind(ragIntegrationController)
);

export default router;
