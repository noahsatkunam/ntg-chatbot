import { Request, Response } from 'express';
import { SearchService } from '../searchService';
import { logger } from '../../utils/logger';
import { validateRequest } from '../../middleware/validation';

export class SearchController {
  private searchService: SearchService;

  constructor() {
    this.searchService = new SearchService();
  }

  // Search messages
  public searchMessages = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = req.user!;
      const {
        q: query,
        limit,
        offset,
        conversationId,
        userId,
        dateFrom,
        dateTo,
        sortBy,
        sortOrder,
      } = req.query;

      if (!query || typeof query !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Query parameter is required',
        });
        return;
      }

      const options = {
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
        conversationId: conversationId as string,
        userId: userId as string,
        dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
        dateTo: dateTo ? new Date(dateTo as string) : undefined,
        sortBy: sortBy as 'relevance' | 'date' | 'sender',
        sortOrder: sortOrder as 'asc' | 'desc',
      };

      const results = await this.searchService.searchMessages(query, tenantId, options);

      logger.info('Message search completed', {
        tenantId,
        query,
        resultCount: results.results.length,
        total: results.total,
      });

      res.status(200).json({
        success: true,
        data: results,
      });
    } catch (error) {
      logger.error('Message search failed', {
        error: error.message,
        tenantId: req.user?.tenantId,
        query: req.query.q,
      });

      res.status(500).json({
        success: false,
        error: 'Search failed',
      });
    }
  };

  // Search conversations
  public searchConversations = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = req.user!;
      const {
        q: query,
        limit,
        offset,
        dateFrom,
        dateTo,
      } = req.query;

      if (!query || typeof query !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Query parameter is required',
        });
        return;
      }

      const options = {
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
        dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
        dateTo: dateTo ? new Date(dateTo as string) : undefined,
      };

      const results = await this.searchService.searchConversations(query, tenantId, options);

      logger.info('Conversation search completed', {
        tenantId,
        query,
        resultCount: results.results.length,
        total: results.total,
      });

      res.status(200).json({
        success: true,
        data: results,
      });
    } catch (error) {
      logger.error('Conversation search failed', {
        error: error.message,
        tenantId: req.user?.tenantId,
        query: req.query.q,
      });

      res.status(500).json({
        success: false,
        error: 'Search failed',
      });
    }
  };

  // Get search suggestions
  public getSearchSuggestions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = req.user!;
      const { q: query, limit } = req.query;

      if (!query || typeof query !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Query parameter is required',
        });
        return;
      }

      const suggestions = await this.searchService.getSearchSuggestions(
        query,
        tenantId,
        limit ? parseInt(limit as string) : undefined
      );

      res.status(200).json({
        success: true,
        data: {
          suggestions,
        },
      });
    } catch (error) {
      logger.error('Search suggestions failed', {
        error: error.message,
        tenantId: req.user?.tenantId,
        query: req.query.q,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get search suggestions',
      });
    }
  };

  // Reindex content
  public reindexContent = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = req.user!;

      // Start reindexing in background
      const indexedCount = await this.searchService.reindexTenant(tenantId);

      logger.info('Content reindexing completed', {
        tenantId,
        indexedCount,
      });

      res.status(200).json({
        success: true,
        data: {
          message: 'Content reindexing completed',
          indexedCount,
        },
      });
    } catch (error) {
      logger.error('Content reindexing failed', {
        error: error.message,
        tenantId: req.user?.tenantId,
      });

      res.status(500).json({
        success: false,
        error: 'Reindexing failed',
      });
    }
  };

  // Index specific message
  public indexMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = req.user!;
      const { messageId } = req.params;

      await this.searchService.indexMessage(messageId, tenantId);

      logger.info('Message indexed successfully', {
        tenantId,
        messageId,
      });

      res.status(200).json({
        success: true,
        data: {
          message: 'Message indexed successfully',
        },
      });
    } catch (error) {
      logger.error('Message indexing failed', {
        error: error.message,
        tenantId: req.user?.tenantId,
        messageId: req.params.messageId,
      });

      res.status(500).json({
        success: false,
        error: 'Message indexing failed',
      });
    }
  };
}
