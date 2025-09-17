import { Router } from 'express';
import { Request, Response } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { JobQueue, jobQueue } from '../batch/jobQueue';
import { BatchProcessor } from '../batch/batchProcessor';
import { DocumentAnalyzer } from '../analysis/documentAnalyzer';
import { ChunkingService } from '../chunking/chunkingService';
import { VersioningService } from '../versioning/versioningService';
import { AppError } from '../../middlewares/errorHandler';
import { body, param, query } from 'express-validator';
import * as fs from 'fs/promises';
import * as path from 'path';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 10 // Max 10 files per request
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.docx', '.doc', '.txt', '.md', '.json', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not supported`));
    }
  }
});

const batchProcessor = new BatchProcessor(jobQueue);
const documentAnalyzer = new DocumentAnalyzer();
const chunkingService = new ChunkingService();
const versioningService = new VersioningService();

/**
 * Upload and process single document
 */
router.post('/upload',
  authMiddleware,
  upload.single('document'),
  [
    body('title').optional().isString().isLength({ max: 255 }),
    body('collectionId').optional().isUUID(),
    body('tags').optional().isArray(),
    body('chunkingStrategy').optional().isIn(['semantic', 'hierarchical', 'overlapping', 'hybrid']),
    body('chunkSize').optional().isInt({ min: 100, max: 5000 }),
    body('chunkOverlap').optional().isInt({ min: 0, max: 1000 }),
    body('enableOCR').optional().isBoolean(),
    body('extractMetadata').optional().isBoolean()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        throw new AppError('No file uploaded', 400);
      }

      const {
        title,
        collectionId,
        tags,
        chunkingStrategy = 'semantic',
        chunkSize = 1000,
        chunkOverlap = 200,
        enableOCR = false,
        extractMetadata = true
      } = req.body;

      // Add processing job to queue
      const jobId = await jobQueue.addJob(
        'DOCUMENT_UPLOAD',
        req.tenantId!,
        req.userId!,
        {
          filePath: req.file.path,
          options: {
            title: title || req.file.originalname,
            collectionId,
            tags: tags || [],
            chunking: {
              strategy: chunkingStrategy,
              chunkSize: parseInt(chunkSize),
              chunkOverlap: parseInt(chunkOverlap)
            },
            processing: {
              enableOCR,
              extractMetadata
            }
          },
          metadata: {
            originalName: req.file.originalname,
            fileSize: req.file.size,
            mimeType: req.file.mimetype
          }
        }
      );

      res.status(202).json({
        success: true,
        message: 'Document upload queued for processing',
        data: {
          jobId,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          status: 'queued'
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Upload failed'
      });
    }
  }
);

/**
 * Bulk upload documents
 */
router.post('/bulk-upload',
  authMiddleware,
  upload.array('documents', 10),
  [
    body('collectionId').optional().isUUID(),
    body('tags').optional().isArray(),
    body('chunkingStrategy').optional().isIn(['semantic', 'hierarchical', 'overlapping', 'hybrid']),
    body('priority').optional().isInt({ min: 0, max: 10 })
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        throw new AppError('No files uploaded', 400);
      }

      const {
        collectionId,
        tags,
        chunkingStrategy = 'semantic',
        priority = 0
      } = req.body;

      const result = await batchProcessor.processBatchUpload(
        files.map(f => f.path),
        req.tenantId!,
        req.userId!,
        {
          collectionId,
          tags: tags || [],
          chunkingStrategy,
          priority: parseInt(priority)
        }
      );

      res.status(202).json({
        success: true,
        message: 'Bulk upload queued for processing',
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Bulk upload failed'
      });
    }
  }
);

/**
 * Process URL content
 */
router.post('/process-url',
  authMiddleware,
  [
    body('url').isURL(),
    body('title').optional().isString().isLength({ max: 255 }),
    body('collectionId').optional().isUUID(),
    body('tags').optional().isArray(),
    body('extractImages').optional().isBoolean(),
    body('extractLinks').optional().isBoolean(),
    body('removeAds').optional().isBoolean()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const {
        url,
        title,
        collectionId,
        tags,
        extractImages = true,
        extractLinks = true,
        removeAds = true
      } = req.body;

      const jobId = await jobQueue.addJob(
        'URL_CRAWL',
        req.tenantId!,
        req.userId!,
        {
          url,
          options: {
            title,
            collectionId,
            tags: tags || [],
            web: {
              extractImages,
              extractLinks,
              removeAds,
              preserveFormatting: true
            }
          }
        }
      );

      res.status(202).json({
        success: true,
        message: 'URL processing queued',
        data: {
          jobId,
          url,
          status: 'queued'
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'URL processing failed'
      });
    }
  }
);

/**
 * Reprocess document with new settings
 */
router.post('/reprocess/:documentId',
  authMiddleware,
  [
    param('documentId').isUUID(),
    body('chunkingStrategy').optional().isIn(['semantic', 'hierarchical', 'overlapping', 'hybrid']),
    body('chunkSize').optional().isInt({ min: 100, max: 5000 }),
    body('chunkOverlap').optional().isInt({ min: 0, max: 1000 }),
    body('preserveStructure').optional().isBoolean()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;
      const {
        chunkingStrategy,
        chunkSize,
        chunkOverlap,
        preserveStructure
      } = req.body;

      const jobId = await jobQueue.addJob(
        'DOCUMENT_REPROCESS',
        req.tenantId!,
        req.userId!,
        {
          documentId,
          options: {
            chunking: {
              strategy: chunkingStrategy,
              chunkSize: chunkSize ? parseInt(chunkSize) : undefined,
              chunkOverlap: chunkOverlap ? parseInt(chunkOverlap) : undefined,
              preserveStructure
            }
          }
        }
      );

      res.status(202).json({
        success: true,
        message: 'Document reprocessing queued',
        data: {
          jobId,
          documentId,
          status: 'queued'
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Reprocessing failed'
      });
    }
  }
);

/**
 * Get processing job status
 */
router.get('/jobs/:jobId',
  authMiddleware,
  [param('jobId').isUUID()],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const status = await jobQueue.getJobStatus(jobId);

      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get job status'
      });
    }
  }
);

/**
 * Cancel processing job
 */
router.delete('/jobs/:jobId',
  authMiddleware,
  [param('jobId').isUUID()],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      await jobQueue.cancelJob(jobId);

      res.json({
        success: true,
        message: 'Job cancelled successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to cancel job'
      });
    }
  }
);

/**
 * Get queue statistics
 */
router.get('/queue/stats',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const stats = await jobQueue.getQueueStats(req.tenantId);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get queue stats'
      });
    }
  }
);

/**
 * Analyze document quality and content
 */
router.post('/analyze/:documentId',
  authMiddleware,
  [param('documentId').isUUID()],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;
      
      // Get document content (would need to implement content retrieval)
      const document = await prisma.knowledgeDocument.findFirst({
        where: { id: documentId, tenantId: req.tenantId }
      });

      if (!document) {
        throw new AppError('Document not found', 404);
      }

      const analysis = await documentAnalyzer.analyzeDocument(
        documentId,
        document.content || '',
        req.tenantId!
      );

      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Analysis failed'
      });
    }
  }
);

/**
 * Get document chunks
 */
router.get('/chunks/:documentId',
  authMiddleware,
  [
    param('documentId').isUUID(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 })
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const [chunks, total] = await Promise.all([
        prisma.documentChunk.findMany({
          where: { documentId, tenantId: req.tenantId },
          orderBy: { chunkIndex: 'asc' },
          skip,
          take: limit
        }),
        prisma.documentChunk.count({
          where: { documentId, tenantId: req.tenantId }
        })
      ]);

      res.json({
        success: true,
        data: {
          chunks,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get chunks'
      });
    }
  }
);

/**
 * Re-chunk document with new strategy
 */
router.post('/rechunk/:documentId',
  authMiddleware,
  [
    param('documentId').isUUID(),
    body('strategy').isIn(['semantic', 'hierarchical', 'overlapping', 'hybrid']),
    body('chunkSize').optional().isInt({ min: 100, max: 5000 }),
    body('chunkOverlap').optional().isInt({ min: 0, max: 1000 })
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;
      const { strategy, chunkSize, chunkOverlap } = req.body;

      const result = await chunkingService.rechunkDocument(
        documentId,
        req.tenantId!,
        {
          strategy,
          chunkSize: chunkSize ? parseInt(chunkSize) : 1000,
          chunkOverlap: chunkOverlap ? parseInt(chunkOverlap) : 200
        }
      );

      res.json({
        success: true,
        message: 'Document re-chunked successfully',
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Re-chunking failed'
      });
    }
  }
);

/**
 * Get optimal chunking strategy for document
 */
router.get('/chunking/optimal/:documentId',
  authMiddleware,
  [param('documentId').isUUID()],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;
      
      const document = await prisma.knowledgeDocument.findFirst({
        where: { id: documentId, tenantId: req.tenantId }
      });

      if (!document) {
        throw new AppError('Document not found', 404);
      }

      const optimalStrategy = await chunkingService.getOptimalStrategy(
        document.content || '',
        document.fileType || 'text'
      );

      res.json({
        success: true,
        data: optimalStrategy
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get optimal strategy'
      });
    }
  }
);

/**
 * Create document version
 */
router.post('/versions/:documentId',
  authMiddleware,
  [
    param('documentId').isUUID(),
    body('content').isString(),
    body('changeLog').isString().isLength({ min: 1, max: 1000 }),
    body('tags').optional().isArray(),
    body('isMinor').optional().isBoolean(),
    body('branchName').optional().isString().matches(/^[a-zA-Z0-9_-]+$/)
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;
      const { content, changeLog, tags, isMinor, branchName } = req.body;

      const result = await versioningService.createVersion(
        documentId,
        content,
        req.tenantId!,
        req.userId!,
        {
          author: req.userId!,
          changeLog,
          tags,
          isMinor,
          branchName
        }
      );

      res.status(201).json({
        success: true,
        message: 'Version created successfully',
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Version creation failed'
      });
    }
  }
);

/**
 * Get document version history
 */
router.get('/versions/:documentId',
  authMiddleware,
  [
    param('documentId').isUUID(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
    query('branchName').optional().isString(),
    query('includeContent').optional().isBoolean()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const branchName = req.query.branchName as string;
      const includeContent = req.query.includeContent === 'true';

      const history = await versioningService.getVersionHistory(
        documentId,
        req.tenantId!,
        { limit, offset, branchName, includeContent }
      );

      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get version history'
      });
    }
  }
);

/**
 * Compare document versions
 */
router.get('/versions/compare/:versionId1/:versionId2',
  authMiddleware,
  [
    param('versionId1').isUUID(),
    param('versionId2').isUUID()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { versionId1, versionId2 } = req.params;

      const [version1, version2] = await Promise.all([
        versioningService.getVersion(versionId1, req.tenantId!),
        versioningService.getVersion(versionId2, req.tenantId!)
      ]);

      if (!version1 || !version2) {
        throw new AppError('One or both versions not found', 404);
      }

      const comparison = await versioningService.compareVersions(
        version1.content,
        version2.content
      );

      res.json({
        success: true,
        data: {
          version1: {
            id: version1.id,
            versionNumber: version1.versionNumber,
            author: version1.author,
            createdAt: version1.createdAt
          },
          version2: {
            id: version2.id,
            versionNumber: version2.versionNumber,
            author: version2.author,
            createdAt: version2.createdAt
          },
          comparison
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Version comparison failed'
      });
    }
  }
);

/**
 * Restore document to specific version
 */
router.post('/versions/restore/:documentId/:versionId',
  authMiddleware,
  [
    param('documentId').isUUID(),
    param('versionId').isUUID(),
    body('createBackup').optional().isBoolean()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { documentId, versionId } = req.params;
      const { createBackup = true } = req.body;

      const result = await versioningService.restoreToVersion(
        documentId,
        versionId,
        req.tenantId!,
        req.userId!,
        createBackup
      );

      res.json({
        success: true,
        message: 'Document restored successfully',
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Restore failed'
      });
    }
  }
);

export default router;
