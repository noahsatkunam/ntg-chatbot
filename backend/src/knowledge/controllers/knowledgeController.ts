import { Request, Response } from 'express';
import { KnowledgeBaseService } from '../knowledgeBaseService';
import { RetrievalService } from '../retrievalService';
import { logger } from '../../utils/logger';
import multer from 'multer';
import { fileValidation } from '../../upload/fileValidation';

const knowledgeBaseService = new KnowledgeBaseService();
const retrievalService = new RetrievalService();

// Configure multer for document uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
      'application/json',
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

export const knowledgeUpload = upload.single('document');

// Initialize knowledge base for tenant
export const initializeKnowledgeBase = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;

    await knowledgeBaseService.initializeTenantKnowledgeBase(tenantId);

    logger.info('Knowledge base initialized', {
      tenantId,
      userId: req.user!.id,
    });

    res.status(200).json({
      success: true,
      message: 'Knowledge base initialized successfully',
    });
  } catch (error) {
    logger.error('Failed to initialize knowledge base', {
      error: error.message,
      tenantId: req.tenant?.id,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to initialize knowledge base',
      error: error.message,
    });
  }
};

// Upload document to knowledge base
export const uploadDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { id: userId } = req.user!;

    if (!req.file) {
      res.status(400).json({
        success: false,
        message: 'No document file provided',
      });
      return;
    }

    // Validate file
    const validation = await fileValidation.validateFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      tenantId
    );

    if (!validation.isValid) {
      res.status(400).json({
        success: false,
        message: validation.error,
      });
      return;
    }

    const result = await knowledgeBaseService.uploadDocument(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      tenantId,
      userId
    );

    logger.info('Document uploaded to knowledge base', {
      documentId: result.documentId,
      tenantId,
      userId,
      filename: req.file.originalname,
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Document upload failed', {
      error: error.message,
      tenantId: req.tenant?.id,
      userId: req.user?.id,
      filename: req.file?.originalname,
    });

    res.status(500).json({
      success: false,
      message: 'Document upload failed',
      error: error.message,
    });
  }
};

// Get documents in knowledge base
export const getDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { 
      limit = 50, 
      offset = 0, 
      status 
    } = req.query;

    const result = await knowledgeBaseService.getDocuments(
      tenantId,
      parseInt(limit as string),
      parseInt(offset as string),
      status as string
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Failed to get documents', {
      error: error.message,
      tenantId: req.tenant?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to get documents',
      error: error.message,
    });
  }
};

// Get document by ID
export const getDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { documentId } = req.params;

    const documents = await knowledgeBaseService.getDocuments(tenantId, 1, 0);
    const document = documents.documents.find(doc => doc.id === documentId);

    if (!document) {
      res.status(404).json({
        success: false,
        message: 'Document not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: document,
    });
  } catch (error) {
    logger.error('Failed to get document', {
      error: error.message,
      documentId: req.params.documentId,
      tenantId: req.tenant?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to get document',
      error: error.message,
    });
  }
};

// Delete document from knowledge base
export const deleteDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { documentId } = req.params;

    await knowledgeBaseService.deleteDocument(documentId, tenantId);

    logger.info('Document deleted from knowledge base', {
      documentId,
      tenantId,
      userId: req.user!.id,
    });

    res.status(200).json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete document', {
      error: error.message,
      documentId: req.params.documentId,
      tenantId: req.tenant?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to delete document',
      error: error.message,
    });
  }
};

// Reindex document
export const reindexDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { documentId } = req.params;

    await knowledgeBaseService.reindexDocument(documentId, tenantId);

    logger.info('Document reindexing initiated', {
      documentId,
      tenantId,
      userId: req.user!.id,
    });

    res.status(200).json({
      success: true,
      message: 'Document reindexing initiated',
    });
  } catch (error) {
    logger.error('Failed to reindex document', {
      error: error.message,
      documentId: req.params.documentId,
      tenantId: req.tenant?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to reindex document',
      error: error.message,
    });
  }
};

// Search knowledge base
export const searchKnowledgeBase = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { id: userId } = req.user!;
    const { 
      query, 
      limit = 10, 
      scoreThreshold = 0.7,
      useHybrid = false 
    } = req.body;

    if (!query || typeof query !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Query is required and must be a string',
      });
      return;
    }

    const searchQuery = {
      query,
      tenantId,
      userId,
      limit: parseInt(limit as string),
      scoreThreshold: parseFloat(scoreThreshold as string),
    };

    const result = useHybrid
      ? await retrievalService.hybridSearch(searchQuery)
      : await retrievalService.retrieveContext(searchQuery);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Knowledge base search failed', {
      error: error.message,
      tenantId: req.tenant?.id,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Knowledge base search failed',
      error: error.message,
    });
  }
};

// Get knowledge base statistics
export const getKnowledgeBaseStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;

    const stats = await knowledgeBaseService.getKnowledgeBaseStats(tenantId);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Failed to get knowledge base stats', {
      error: error.message,
      tenantId: req.tenant?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to get knowledge base stats',
      error: error.message,
    });
  }
};

// Submit feedback on search results
export const submitFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { queryId, feedback } = req.body;

    if (!queryId || !feedback) {
      res.status(400).json({
        success: false,
        message: 'Query ID and feedback are required',
      });
      return;
    }

    const validFeedback = ['helpful', 'not_helpful', 'partially_helpful'];
    if (!validFeedback.includes(feedback)) {
      res.status(400).json({
        success: false,
        message: 'Invalid feedback value',
      });
      return;
    }

    await retrievalService.submitFeedback(queryId, feedback, tenantId);

    logger.info('Search feedback submitted', {
      queryId,
      feedback,
      tenantId,
      userId: req.user!.id,
    });

    res.status(200).json({
      success: true,
      message: 'Feedback submitted successfully',
    });
  } catch (error) {
    logger.error('Failed to submit feedback', {
      error: error.message,
      tenantId: req.tenant?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to submit feedback',
      error: error.message,
    });
  }
};

// Get retrieval analytics
export const getRetrievalAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { dateFrom, dateTo } = req.query;

    const analytics = await retrievalService.getRetrievalAnalytics(
      tenantId,
      dateFrom ? new Date(dateFrom as string) : undefined,
      dateTo ? new Date(dateTo as string) : undefined
    );

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    logger.error('Failed to get retrieval analytics', {
      error: error.message,
      tenantId: req.tenant?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to get retrieval analytics',
      error: error.message,
    });
  }
};

// Get query context by ID
export const getQueryContext = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { queryId } = req.params;

    const context = await retrievalService.getQueryContext(queryId, tenantId);

    if (!context) {
      res.status(404).json({
        success: false,
        message: 'Query context not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: context,
    });
  } catch (error) {
    logger.error('Failed to get query context', {
      error: error.message,
      queryId: req.params.queryId,
      tenantId: req.tenant?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to get query context',
      error: error.message,
    });
  }
};

// Health check for knowledge base services
export const healthCheck = async (req: Request, res: Response): Promise<void> => {
  try {
    const health = await knowledgeBaseService.healthCheck();

    const status = Object.values(health).every(Boolean) ? 200 : 503;

    res.status(status).json({
      success: status === 200,
      data: health,
    });
  } catch (error) {
    logger.error('Knowledge base health check failed', {
      error: error.message,
    });

    res.status(503).json({
      success: false,
      message: 'Health check failed',
      error: error.message,
    });
  }
};
