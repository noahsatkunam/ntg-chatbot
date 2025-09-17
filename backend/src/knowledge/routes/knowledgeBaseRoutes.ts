import { Router } from 'express';
import { Request, Response } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { AdminService } from '../admin/adminService';
import { FacetedSearchService } from '../search/facetedSearchService';
import { DocumentAnalyzer } from '../analysis/documentAnalyzer';
import { jobQueue } from '../batch/jobQueue';
import { AppError } from '../../middlewares/errorHandler';
import { body, param, query } from 'express-validator';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const adminService = new AdminService(jobQueue);
const facetedSearchService = new FacetedSearchService();
const documentAnalyzer = new DocumentAnalyzer();

/**
 * Get admin dashboard statistics
 */
router.get('/admin/dashboard',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const stats = await adminService.getDashboardStats(req.tenantId!);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get dashboard stats'
      });
    }
  }
);

/**
 * Get knowledge base settings
 */
router.get('/admin/settings',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const settings = await adminService.getSettings(req.tenantId!);

      res.json({
        success: true,
        data: settings
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get settings'
      });
    }
  }
);

/**
 * Update knowledge base settings
 */
router.put('/admin/settings',
  authMiddleware,
  [
    body('chunkingStrategy').optional().isIn(['semantic', 'hierarchical', 'overlapping', 'hybrid']),
    body('chunkSize').optional().isInt({ min: 100, max: 5000 }),
    body('chunkOverlap').optional().isInt({ min: 0, max: 1000 }),
    body('enableOCR').optional().isBoolean(),
    body('autoReprocess').optional().isBoolean(),
    body('maxFileSize').optional().isInt({ min: 1024, max: 100 * 1024 * 1024 }),
    body('allowedFileTypes').optional().isArray(),
    body('searchSettings').optional().isObject()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const settings = await adminService.updateSettings(req.tenantId!, req.body);

      res.json({
        success: true,
        message: 'Settings updated successfully',
        data: settings
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update settings'
      });
    }
  }
);

/**
 * Bulk delete documents
 */
router.delete('/admin/documents/bulk',
  authMiddleware,
  [body('documentIds').isArray().notEmpty()],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { documentIds } = req.body;

      const result = await adminService.bulkDelete(
        documentIds,
        req.tenantId!,
        req.userId!
      );

      res.json({
        success: true,
        message: 'Bulk delete operation completed',
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Bulk delete failed'
      });
    }
  }
);

/**
 * Bulk move documents to collection
 */
router.post('/admin/documents/bulk-move',
  authMiddleware,
  [
    body('documentIds').isArray().notEmpty(),
    body('targetCollectionId').isUUID()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { documentIds, targetCollectionId } = req.body;

      const result = await adminService.bulkMoveToCollection(
        documentIds,
        targetCollectionId,
        req.tenantId!,
        req.userId!
      );

      res.json({
        success: true,
        message: 'Documents moved successfully',
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Bulk move failed'
      });
    }
  }
);

/**
 * Get bulk operation status
 */
router.get('/admin/operations/:operationId',
  authMiddleware,
  [param('operationId').isString()],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { operationId } = req.params;
      const status = await adminService.getOperationStatus(operationId);

      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get operation status'
      });
    }
  }
);

/**
 * Get system health
 */
router.get('/admin/health',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const health = await adminService.getSystemHealth();

      res.json({
        success: true,
        data: health
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get system health'
      });
    }
  }
);

/**
 * Cleanup old data
 */
router.post('/admin/cleanup',
  authMiddleware,
  [
    body('deleteOldJobs').optional().isBoolean(),
    body('deleteOldLogs').optional().isBoolean(),
    body('deleteOldAnalytics').optional().isBoolean(),
    body('olderThanDays').optional().isInt({ min: 1, max: 365 })
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const result = await adminService.cleanupOldData(req.tenantId!, req.body);

      res.json({
        success: true,
        message: 'Cleanup completed successfully',
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Cleanup failed'
      });
    }
  }
);

/**
 * Export knowledge base data
 */
router.post('/admin/export',
  authMiddleware,
  [
    body('includeDocuments').optional().isBoolean(),
    body('includeChunks').optional().isBoolean(),
    body('includeAnalytics').optional().isBoolean(),
    body('format').optional().isIn(['json', 'csv'])
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const exportInfo = await adminService.exportData(req.tenantId!, req.body);

      res.json({
        success: true,
        message: 'Export initiated successfully',
        data: exportInfo
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Export failed'
      });
    }
  }
);

/**
 * Faceted search
 */
router.post('/search/faceted',
  authMiddleware,
  [
    body('query').optional().isString(),
    body('facets').optional().isObject(),
    body('filters').optional().isObject(),
    body('sort').optional().isObject(),
    body('pagination').optional().isObject()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const searchQuery = req.body;
      const results = await facetedSearchService.search(req.tenantId!, searchQuery);

      res.json({
        success: true,
        data: results
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Search failed'
      });
    }
  }
);

/**
 * Get available search facets
 */
router.get('/search/facets',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const facets = await facetedSearchService.getAvailableFacets(req.tenantId!);

      res.json({
        success: true,
        data: facets
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get facets'
      });
    }
  }
);

/**
 * Get search suggestions
 */
router.get('/search/suggestions',
  authMiddleware,
  [
    query('q').isString().isLength({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 20 })
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;

      const suggestions = await facetedSearchService.getSearchSuggestions(
        req.tenantId!,
        query,
        limit
      );

      res.json({
        success: true,
        data: suggestions
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get suggestions'
      });
    }
  }
);

/**
 * Multi-modal search
 */
router.post('/search/multimodal',
  authMiddleware,
  [
    body('text').optional().isString(),
    body('semantic').optional().isString(),
    body('filters').optional().isObject(),
    body('includeImages').optional().isBoolean(),
    body('includeTables').optional().isBoolean(),
    body('includeCode').optional().isBoolean()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const results = await facetedSearchService.multiModalSearch(req.tenantId!, req.body);

      res.json({
        success: true,
        data: results
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Multi-modal search failed'
      });
    }
  }
);

/**
 * Get all collections
 */
router.get('/collections',
  authMiddleware,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('search').optional().isString()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = req.query.search as string;
      const skip = (page - 1) * limit;

      const where: any = { tenantId: req.tenantId };
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } }
        ];
      }

      const [collections, total] = await Promise.all([
        prisma.knowledgeCollection.findMany({
          where,
          include: {
            _count: {
              select: { documents: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        }),
        prisma.knowledgeCollection.count({ where })
      ]);

      res.json({
        success: true,
        data: {
          collections,
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
        message: error instanceof Error ? error.message : 'Failed to get collections'
      });
    }
  }
);

/**
 * Create collection
 */
router.post('/collections',
  authMiddleware,
  [
    body('name').isString().isLength({ min: 1, max: 255 }),
    body('description').optional().isString().isLength({ max: 1000 }),
    body('tags').optional().isArray(),
    body('isPublic').optional().isBoolean()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { name, description, tags, isPublic } = req.body;

      const collection = await prisma.knowledgeCollection.create({
        data: {
          name,
          description,
          tags: tags || [],
          isPublic: isPublic || false,
          tenantId: req.tenantId!,
          createdBy: req.userId!,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      res.status(201).json({
        success: true,
        message: 'Collection created successfully',
        data: collection
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create collection'
      });
    }
  }
);

/**
 * Get collection by ID
 */
router.get('/collections/:collectionId',
  authMiddleware,
  [param('collectionId').isUUID()],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { collectionId } = req.params;

      const collection = await prisma.knowledgeCollection.findFirst({
        where: { id: collectionId, tenantId: req.tenantId },
        include: {
          _count: {
            select: { documents: true }
          }
        }
      });

      if (!collection) {
        throw new AppError('Collection not found', 404);
      }

      res.json({
        success: true,
        data: collection
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get collection'
      });
    }
  }
);

/**
 * Update collection
 */
router.put('/collections/:collectionId',
  authMiddleware,
  [
    param('collectionId').isUUID(),
    body('name').optional().isString().isLength({ min: 1, max: 255 }),
    body('description').optional().isString().isLength({ max: 1000 }),
    body('tags').optional().isArray(),
    body('isPublic').optional().isBoolean()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { collectionId } = req.params;
      const updates = req.body;

      const collection = await prisma.knowledgeCollection.update({
        where: { id: collectionId },
        data: {
          ...updates,
          updatedAt: new Date()
        }
      });

      res.json({
        success: true,
        message: 'Collection updated successfully',
        data: collection
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update collection'
      });
    }
  }
);

/**
 * Delete collection
 */
router.delete('/collections/:collectionId',
  authMiddleware,
  [param('collectionId').isUUID()],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { collectionId } = req.params;

      // Check if collection has documents
      const documentCount = await prisma.knowledgeDocument.count({
        where: { collectionId, tenantId: req.tenantId }
      });

      if (documentCount > 0) {
        throw new AppError('Cannot delete collection with documents. Move or delete documents first.', 400);
      }

      await prisma.knowledgeCollection.delete({
        where: { id: collectionId }
      });

      res.json({
        success: true,
        message: 'Collection deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to delete collection'
      });
    }
  }
);

/**
 * Get documents in collection
 */
router.get('/collections/:collectionId/documents',
  authMiddleware,
  [
    param('collectionId').isUUID(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('search').optional().isString(),
    query('sortBy').optional().isIn(['title', 'createdAt', 'updatedAt', 'size']),
    query('sortOrder').optional().isIn(['asc', 'desc'])
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { collectionId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = req.query.search as string;
      const sortBy = req.query.sortBy as string || 'createdAt';
      const sortOrder = req.query.sortOrder as string || 'desc';
      const skip = (page - 1) * limit;

      const where: any = { collectionId, tenantId: req.tenantId };
      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { content: { contains: search, mode: 'insensitive' } }
        ];
      }

      const [documents, total] = await Promise.all([
        prisma.knowledgeDocument.findMany({
          where,
          select: {
            id: true,
            title: true,
            fileType: true,
            fileSize: true,
            createdAt: true,
            updatedAt: true,
            createdBy: true,
            tags: true,
            qualityScore: true
          },
          orderBy: { [sortBy]: sortOrder },
          skip,
          take: limit
        }),
        prisma.knowledgeDocument.count({ where })
      ]);

      res.json({
        success: true,
        data: {
          documents,
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
        message: error instanceof Error ? error.message : 'Failed to get collection documents'
      });
    }
  }
);

/**
 * Get analytics summary
 */
router.get('/analytics/summary',
  authMiddleware,
  [
    query('days').optional().isInt({ min: 1, max: 365 }),
    query('includeSearches').optional().isBoolean(),
    query('includeDocuments').optional().isBoolean()
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const includeSearches = req.query.includeSearches !== 'false';
      const includeDocuments = req.query.includeDocuments !== 'false';

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const summary: any = {};

      if (includeDocuments) {
        const [totalDocs, recentDocs, docsByType] = await Promise.all([
          prisma.knowledgeDocument.count({ where: { tenantId: req.tenantId } }),
          prisma.knowledgeDocument.count({
            where: { tenantId: req.tenantId, createdAt: { gte: startDate } }
          }),
          prisma.knowledgeDocument.groupBy({
            by: ['fileType'],
            where: { tenantId: req.tenantId },
            _count: { fileType: true }
          })
        ]);

        summary.documents = {
          total: totalDocs,
          recent: recentDocs,
          byType: Object.fromEntries(
            docsByType.map(d => [d.fileType || 'unknown', d._count.fileType])
          )
        };
      }

      if (includeSearches) {
        const [totalSearches, recentSearches, topQueries] = await Promise.all([
          prisma.searchAnalytics.count({ where: { tenantId: req.tenantId } }),
          prisma.searchAnalytics.count({
            where: { tenantId: req.tenantId, createdAt: { gte: startDate } }
          }),
          prisma.searchAnalytics.groupBy({
            by: ['query'],
            where: { tenantId: req.tenantId, createdAt: { gte: startDate } },
            _count: { query: true },
            orderBy: { _count: { query: 'desc' } },
            take: 10
          })
        ]);

        summary.searches = {
          total: totalSearches,
          recent: recentSearches,
          topQueries: topQueries.map(q => ({
            query: q.query,
            count: q._count.query
          }))
        };
      }

      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get analytics summary'
      });
    }
  }
);

/**
 * Get document analysis summary
 */
router.get('/analytics/documents/analysis',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const summary = await documentAnalyzer.getAnalysisSummary(req.tenantId!);

      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get analysis summary'
      });
    }
  }
);

export default router;
