import express from 'express';
import { body, param, query } from 'express-validator';
import { authMiddleware } from '../../auth/middleware/authMiddleware';
import { validateRequest } from '../../shared/middleware/validateRequest';
import { RAGChatController } from '../controllers/ragChatController';

const router = express.Router();
const ragChatController = new RAGChatController();

// Enhanced chat message with RAG
router.post(
  '/conversations/:conversationId/messages/rag',
  authMiddleware,
  [
    param('conversationId').isUUID().withMessage('Invalid conversation ID'),
    body('content').trim().isLength({ min: 1, max: 10000 }).withMessage('Message content is required'),
    body('ragMode').optional().isIn(['knowledge_only', 'hybrid', 'general']).withMessage('Invalid RAG mode'),
    body('maxSources').optional().isInt({ min: 1, max: 20 }).withMessage('Invalid max sources'),
    body('includeConfidence').optional().isBoolean().withMessage('Include confidence must be boolean'),
    body('streamResponse').optional().isBoolean().withMessage('Stream response must be boolean')
  ],
  validateRequest,
  ragChatController.sendRAGMessage.bind(ragChatController)
);

// Stream RAG response
router.post(
  '/conversations/:conversationId/messages/rag/stream',
  authMiddleware,
  [
    param('conversationId').isUUID().withMessage('Invalid conversation ID'),
    body('content').trim().isLength({ min: 1, max: 10000 }).withMessage('Message content is required'),
    body('ragMode').optional().isIn(['knowledge_only', 'hybrid', 'general']).withMessage('Invalid RAG mode'),
    body('maxSources').optional().isInt({ min: 1, max: 20 }).withMessage('Invalid max sources')
  ],
  validateRequest,
  ragChatController.streamRAGResponse.bind(ragChatController)
);

// Toggle knowledge base mode for conversation
router.put(
  '/conversations/:conversationId/knowledge-mode',
  authMiddleware,
  [
    param('conversationId').isUUID().withMessage('Invalid conversation ID'),
    body('ragMode').isIn(['knowledge_only', 'hybrid', 'general']).withMessage('Invalid RAG mode'),
    body('maxSources').optional().isInt({ min: 1, max: 20 }).withMessage('Invalid max sources'),
    body('confidenceThreshold').optional().isFloat({ min: 0, max: 1 }).withMessage('Invalid confidence threshold'),
    body('citationStyle').optional().isIn(['numbered', 'inline', 'footnote']).withMessage('Invalid citation style')
  ],
  validateRequest,
  ragChatController.updateConversationRAGSettings.bind(ragChatController)
);

// Get conversation RAG settings
router.get(
  '/conversations/:conversationId/knowledge-mode',
  authMiddleware,
  [
    param('conversationId').isUUID().withMessage('Invalid conversation ID')
  ],
  validateRequest,
  ragChatController.getConversationRAGSettings.bind(ragChatController)
);

// Get conversation sources
router.get(
  '/conversations/:conversationId/sources',
  authMiddleware,
  [
    param('conversationId').isUUID().withMessage('Invalid conversation ID'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
    query('timeRange').optional().isIn(['1h', '24h', '7d', '30d']).withMessage('Invalid time range')
  ],
  validateRequest,
  ragChatController.getConversationSources.bind(ragChatController)
);

// Query knowledge base without chat
router.post(
  '/query-knowledge',
  authMiddleware,
  [
    body('query').trim().isLength({ min: 1, max: 1000 }).withMessage('Query is required'),
    body('maxResults').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid max results'),
    body('includeExcerpts').optional().isBoolean().withMessage('Include excerpts must be boolean')
  ],
  validateRequest,
  ragChatController.queryKnowledgeBase.bind(ragChatController)
);

// Get related documents for a message
router.get(
  '/messages/:messageId/related-docs',
  authMiddleware,
  [
    param('messageId').isUUID().withMessage('Invalid message ID'),
    query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Invalid limit')
  ],
  validateRequest,
  ragChatController.getRelatedDocuments.bind(ragChatController)
);

// Rate answer relevance
router.post(
  '/messages/:messageId/feedback/relevance',
  authMiddleware,
  [
    param('messageId').isUUID().withMessage('Invalid message ID'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    body('feedbackType').isIn(['accuracy', 'completeness', 'relevance', 'overall']).withMessage('Invalid feedback type'),
    body('comments').optional().trim().isLength({ max: 1000 }).withMessage('Comments too long'),
    body('suggestions').optional().isArray().withMessage('Suggestions must be an array')
  ],
  validateRequest,
  ragChatController.submitRelevanceFeedback.bind(ragChatController)
);

// Get message sources and citations
router.get(
  '/messages/:messageId/sources',
  authMiddleware,
  [
    param('messageId').isUUID().withMessage('Invalid message ID')
  ],
  validateRequest,
  ragChatController.getMessageSources.bind(ragChatController)
);

// Generate follow-up questions
router.post(
  '/conversations/:conversationId/follow-up-questions',
  authMiddleware,
  [
    param('conversationId').isUUID().withMessage('Invalid conversation ID'),
    body('messageId').optional().isUUID().withMessage('Invalid message ID'),
    body('context').optional().trim().isLength({ max: 2000 }).withMessage('Context too long')
  ],
  validateRequest,
  ragChatController.generateFollowUpQuestions.bind(ragChatController)
);

// Get RAG analytics for conversation
router.get(
  '/conversations/:conversationId/analytics',
  authMiddleware,
  [
    param('conversationId').isUUID().withMessage('Invalid conversation ID'),
    query('timeRange').optional().isIn(['1h', '24h', '7d', '30d']).withMessage('Invalid time range')
  ],
  validateRequest,
  ragChatController.getConversationAnalytics.bind(ragChatController)
);

// Suggest query improvements
router.post(
  '/query-suggestions',
  authMiddleware,
  [
    body('query').trim().isLength({ min: 1, max: 1000 }).withMessage('Query is required'),
    body('context').optional().trim().isLength({ max: 2000 }).withMessage('Context too long')
  ],
  validateRequest,
  ragChatController.suggestQueryImprovements.bind(ragChatController)
);

// Get conversation confidence trends
router.get(
  '/conversations/:conversationId/confidence-trends',
  authMiddleware,
  [
    param('conversationId').isUUID().withMessage('Invalid conversation ID'),
    query('timeRange').optional().isIn(['1h', '24h', '7d', '30d']).withMessage('Invalid time range')
  ],
  validateRequest,
  ragChatController.getConfidenceTrends.bind(ragChatController)
);

export default router;
