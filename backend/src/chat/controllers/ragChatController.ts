import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { RAGProcessorService } from '../../ai/rag/ragProcessor';
import { ContextRetrievalService } from '../../ai/rag/contextRetrieval';
import { SourceManagerService } from '../../ai/rag/sourceManager';
import { ConfidenceScorerService } from '../../ai/rag/confidenceScorer';
import { FallbackHandlerService } from '../../ai/rag/fallbackHandler';
import { FacetedSearchService } from '../../knowledge/search/facetedSearchService';
import { VectorService } from '../../knowledge/vector/vectorService';
import { EmbeddingService } from '../../knowledge/embedding/embeddingService';
import { AIService } from '../../ai/aiService';
import { AppError } from '../../shared/utils/AppError';

export class RAGChatController {
  private prisma: PrismaClient;
  private ragProcessor: RAGProcessorService;
  private contextRetrieval: ContextRetrievalService;
  private sourceManager: SourceManagerService;
  private confidenceScorer: ConfidenceScorerService;
  private fallbackHandler: FallbackHandlerService;

  constructor() {
    this.prisma = new PrismaClient();
    
    // Initialize services
    const facetedSearch = new FacetedSearchService(this.prisma);
    const vectorService = new VectorService();
    const embeddingService = new EmbeddingService();
    const aiService = new AIService();
    
    this.contextRetrieval = new ContextRetrievalService(
      this.prisma,
      facetedSearch,
      vectorService,
      embeddingService
    );
    
    this.sourceManager = new SourceManagerService(this.prisma);
    this.confidenceScorer = new ConfidenceScorerService();
    this.fallbackHandler = new FallbackHandlerService(aiService, this.contextRetrieval);
    
    this.ragProcessor = new RAGProcessorService(
      this.contextRetrieval,
      this.sourceManager,
      this.confidenceScorer,
      aiService
    );
  }

  async sendRAGMessage(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const { content, ragMode = 'hybrid', maxSources = 5, includeConfidence = true } = req.body;
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        throw new AppError('Authentication required', 401);
      }

      // Verify conversation access
      const conversation = await this.prisma.conversation.findFirst({
        where: {
          id: conversationId,
          tenantId,
          participants: {
            some: { userId }
          }
        }
      });

      if (!conversation) {
        throw new AppError('Conversation not found', 404);
      }

      // Get conversation history for context
      const recentMessages = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { content: true }
      });

      const conversationHistory = recentMessages.reverse().map(m => m.content);

      // Process RAG query
      const ragResponse = await this.ragProcessor.processRAGQuery({
        query: content,
        conversationId,
        tenantId,
        userId,
        conversationHistory,
        ragMode,
        maxSources,
        includeConfidence,
        streamResponse: false
      });

      // Save user message
      const userMessage = await this.prisma.message.create({
        data: {
          conversationId,
          userId,
          tenantId,
          content,
          type: 'text'
        }
      });

      // Save AI response
      const aiMessage = await this.prisma.message.create({
        data: {
          conversationId,
          userId: 'ai-assistant', // Special AI user ID
          tenantId,
          content: ragResponse.content,
          type: 'text',
          metadata: {
            ragMode: ragResponse.mode,
            confidence: ragResponse.confidence,
            sourcesUsed: ragResponse.sources.length,
            processingTime: ragResponse.processingTime,
            hasKnowledgeBase: ragResponse.hasKnowledgeBase
          }
        }
      });

      // Log RAG query for analytics
      const ragQuery = await this.prisma.ragQuery.create({
        data: {
          tenantId,
          userId,
          conversationId,
          query: content,
          queryHash: this.generateQueryHash(content),
          sourcesUsed: ragResponse.sources.length,
          confidence: ragResponse.confidence.overall,
          retrievalStrategy: ragResponse.mode,
          queryExpansions: ragResponse.followUpQuestions,
          responseTime: ragResponse.processingTime
        }
      });

      // Save source citations
      if (ragResponse.sources.length > 0) {
        await this.sourceManager.trackSourceCitations(aiMessage.id, tenantId, ragResponse.sources);
      }

      res.json({
        success: true,
        data: {
          userMessage,
          aiMessage,
          ragResponse: {
            ...ragResponse,
            ragQueryId: ragQuery.id
          }
        }
      });

    } catch (error) {
      console.error('RAG message error:', error);
      res.status(error instanceof AppError ? error.statusCode : 500).json({
        success: false,
        message: error instanceof AppError ? error.message : 'Failed to process RAG message'
      });
    }
  }

  async streamRAGResponse(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const { content, ragMode = 'hybrid', maxSources = 5 } = req.body;
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        throw new AppError('Authentication required', 401);
      }

      // Set up SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      // Get conversation history
      const recentMessages = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { content: true }
      });

      const conversationHistory = recentMessages.reverse().map(m => m.content);

      let fullResponse = '';
      let sources: any[] = [];

      await this.ragProcessor.streamRAGResponse(
        {
          query: content,
          conversationId,
          tenantId,
          userId,
          conversationHistory,
          ragMode,
          maxSources,
          streamResponse: true
        },
        (chunk: string) => {
          // Send content chunk
          res.write(`data: ${JSON.stringify({ type: 'content', data: chunk })}\n\n`);
          fullResponse += chunk;
        },
        (sourcesData: any[]) => {
          // Send sources early
          sources = sourcesData;
          res.write(`data: ${JSON.stringify({ type: 'sources', data: sourcesData })}\n\n`);
        },
        async (finalResponse: any) => {
          // Send final response with metadata
          res.write(`data: ${JSON.stringify({ type: 'complete', data: finalResponse })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();

          // Save messages after streaming completes
          try {
            const userMessage = await this.prisma.message.create({
              data: {
                conversationId,
                userId,
                tenantId,
                content,
                type: 'text'
              }
            });

            const aiMessage = await this.prisma.message.create({
              data: {
                conversationId,
                userId: 'ai-assistant',
                tenantId,
                content: fullResponse,
                type: 'text',
                metadata: {
                  ragMode: finalResponse.mode,
                  confidence: finalResponse.confidence,
                  sourcesUsed: sources.length,
                  processingTime: finalResponse.processingTime
                }
              }
            });

            // Log analytics
            await this.prisma.ragQuery.create({
              data: {
                tenantId,
                userId,
                conversationId,
                query: content,
                queryHash: this.generateQueryHash(content),
                sourcesUsed: sources.length,
                confidence: finalResponse.confidence.overall,
                retrievalStrategy: finalResponse.mode,
                responseTime: finalResponse.processingTime
              }
            });
          } catch (saveError) {
            console.error('Error saving streamed messages:', saveError);
          }
        }
      );

    } catch (error) {
      console.error('Stream RAG error:', error);
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: 'Stream failed' } })}\n\n`);
      res.end();
    }
  }

  async updateConversationRAGSettings(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const { ragMode, maxSources, confidenceThreshold, citationStyle } = req.body;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const settings = await this.prisma.conversationSettings.upsert({
        where: { conversationId },
        update: {
          ragMode,
          maxSources,
          confidenceThreshold,
          citationStyle,
          updatedAt: new Date()
        },
        create: {
          conversationId,
          tenantId,
          ragMode,
          maxSources,
          confidenceThreshold,
          citationStyle
        }
      });

      res.json({
        success: true,
        data: settings
      });

    } catch (error) {
      console.error('Update RAG settings error:', error);
      res.status(error instanceof AppError ? error.statusCode : 500).json({
        success: false,
        message: error instanceof AppError ? error.message : 'Failed to update RAG settings'
      });
    }
  }

  async getConversationRAGSettings(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const settings = await this.prisma.conversationSettings.findUnique({
        where: { conversationId }
      });

      res.json({
        success: true,
        data: settings || {
          ragMode: 'hybrid',
          maxSources: 5,
          confidenceThreshold: 0.3,
          citationStyle: 'numbered',
          includeConfidence: true,
          autoSuggestQuestions: true
        }
      });

    } catch (error) {
      console.error('Get RAG settings error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get RAG settings'
      });
    }
  }

  async getConversationSources(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const { limit = 20, timeRange = '24h' } = req.query;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const timeRangeHours = this.parseTimeRange(timeRange as string);
      const startDate = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000);

      const sources = await this.prisma.sourceCitation.findMany({
        where: {
          tenantId,
          ragQuery: {
            conversationId
          },
          createdAt: {
            gte: startDate
          }
        },
        include: {
          document: {
            select: {
              id: true,
              filename: true,
              originalName: true,
              mimeType: true,
              createdAt: true
            }
          }
        },
        orderBy: {
          relevanceScore: 'desc'
        },
        take: parseInt(limit as string)
      });

      res.json({
        success: true,
        data: sources
      });

    } catch (error) {
      console.error('Get conversation sources error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get conversation sources'
      });
    }
  }

  async queryKnowledgeBase(req: Request, res: Response): Promise<void> {
    try {
      const { query, maxResults = 10, includeExcerpts = true } = req.body;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const context = await this.contextRetrieval.retrieveContext(
        query,
        tenantId,
        [],
        {
          maxChunks: maxResults,
          includeMetadata: includeExcerpts
        }
      );

      res.json({
        success: true,
        data: {
          query,
          results: context.chunks,
          sources: context.sources,
          totalScore: context.totalScore,
          retrievalStrategy: context.retrievalStrategy
        }
      });

    } catch (error) {
      console.error('Query knowledge base error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to query knowledge base'
      });
    }
  }

  async getRelatedDocuments(req: Request, res: Response): Promise<void> {
    try {
      const { messageId } = req.params;
      const { limit = 5 } = req.query;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const message = await this.prisma.message.findFirst({
        where: {
          id: messageId,
          tenantId
        }
      });

      if (!message) {
        throw new AppError('Message not found', 404);
      }

      // Get related documents based on message content
      const context = await this.contextRetrieval.retrieveContext(
        message.content,
        tenantId,
        [],
        {
          maxChunks: parseInt(limit as string) * 2
        }
      );

      const relatedDocs = context.sources.slice(0, parseInt(limit as string));

      res.json({
        success: true,
        data: relatedDocs
      });

    } catch (error) {
      console.error('Get related documents error:', error);
      res.status(error instanceof AppError ? error.statusCode : 500).json({
        success: false,
        message: error instanceof AppError ? error.message : 'Failed to get related documents'
      });
    }
  }

  async submitRelevanceFeedback(req: Request, res: Response): Promise<void> {
    try {
      const { messageId } = req.params;
      const { rating, feedbackType, comments, suggestions } = req.body;
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const feedback = await this.prisma.knowledgeFeedback.create({
        data: {
          tenantId,
          userId,
          messageId,
          rating,
          feedbackType,
          comments,
          suggestions
        }
      });

      res.json({
        success: true,
        data: feedback
      });

    } catch (error) {
      console.error('Submit feedback error:', error);
      res.status(error instanceof AppError ? error.statusCode : 500).json({
        success: false,
        message: error instanceof AppError ? error.message : 'Failed to submit feedback'
      });
    }
  }

  async getMessageSources(req: Request, res: Response): Promise<void> {
    try {
      const { messageId } = req.params;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const sources = await this.prisma.sourceCitation.findMany({
        where: {
          messageId,
          tenantId
        },
        include: {
          document: {
            select: {
              id: true,
              filename: true,
              originalName: true,
              mimeType: true,
              metadata: true
            }
          }
        },
        orderBy: {
          citationNumber: 'asc'
        }
      });

      res.json({
        success: true,
        data: sources
      });

    } catch (error) {
      console.error('Get message sources error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get message sources'
      });
    }
  }

  async generateFollowUpQuestions(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const { messageId, context } = req.body;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('Authentication required', 401);
      }

      // Get recent conversation context
      const recentMessages = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { content: true }
      });

      const conversationContext = recentMessages.reverse().map(m => m.content).join(' ');
      const queryContext = context || conversationContext;

      // Generate follow-up questions using fallback handler
      const suggestions = await this.fallbackHandler.suggestQueryImprovements(
        queryContext,
        tenantId,
        null
      );

      res.json({
        success: true,
        data: {
          followUpQuestions: suggestions.improvedQueries,
          searchTips: suggestions.searchTips,
          explanations: suggestions.explanations
        }
      });

    } catch (error) {
      console.error('Generate follow-up questions error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate follow-up questions'
      });
    }
  }

  async getConversationAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const { timeRange = '24h' } = req.query;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const timeRangeHours = this.parseTimeRange(timeRange as string);
      const startDate = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000);

      const analytics = await this.prisma.ragQuery.aggregate({
        where: {
          conversationId,
          tenantId,
          createdAt: {
            gte: startDate
          }
        },
        _count: {
          id: true
        },
        _avg: {
          confidence: true,
          sourcesUsed: true,
          responseTime: true
        }
      });

      const topSources = await this.sourceManager.getMostCitedSources(
        tenantId,
        5,
        { start: startDate, end: new Date() }
      );

      res.json({
        success: true,
        data: {
          totalQueries: analytics._count.id,
          averageConfidence: analytics._avg.confidence,
          averageSourcesUsed: analytics._avg.sourcesUsed,
          averageResponseTime: analytics._avg.responseTime,
          topSources
        }
      });

    } catch (error) {
      console.error('Get conversation analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get conversation analytics'
      });
    }
  }

  async suggestQueryImprovements(req: Request, res: Response): Promise<void> {
    try {
      const { query, context } = req.body;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const suggestions = await this.fallbackHandler.suggestQueryImprovements(
        query,
        tenantId,
        null
      );

      res.json({
        success: true,
        data: suggestions
      });

    } catch (error) {
      console.error('Suggest query improvements error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to suggest query improvements'
      });
    }
  }

  async getConfidenceTrends(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const { timeRange = '24h' } = req.query;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const timeRangeHours = this.parseTimeRange(timeRange as string);
      const startDate = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000);

      const trends = await this.prisma.ragQuery.findMany({
        where: {
          conversationId,
          tenantId,
          createdAt: {
            gte: startDate
          }
        },
        select: {
          confidence: true,
          sourcesUsed: true,
          createdAt: true,
          retrievalStrategy: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      });

      res.json({
        success: true,
        data: trends
      });

    } catch (error) {
      console.error('Get confidence trends error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get confidence trends'
      });
    }
  }

  private generateQueryHash(query: string): string {
    // Simple hash function - in production, use a proper hash library
    return Buffer.from(query.toLowerCase().trim()).toString('base64');
  }

  private parseTimeRange(timeRange: string): number {
    const ranges: Record<string, number> = {
      '1h': 1,
      '24h': 24,
      '7d': 168,
      '30d': 720
    };
    return ranges[timeRange] || 24;
  }
}
