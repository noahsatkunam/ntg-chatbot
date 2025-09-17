import { VectorService } from './vectorService';
import { EmbeddingService } from './embeddingService';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

export interface RetrievalQuery {
  query: string;
  tenantId: string;
  userId?: string;
  limit?: number;
  scoreThreshold?: number;
  filters?: Record<string, any>;
}

export interface RetrievedContext {
  id: string;
  content: string;
  score: number;
  documentId: string;
  chunkIndex: number;
  metadata?: Record<string, any>;
  source?: {
    filename: string;
    originalName: string;
    pageNumber?: number;
  };
}

export interface RetrievalResult {
  queryId: string;
  contexts: RetrievedContext[];
  totalResults: number;
  processingTime: number;
  embeddingTime: number;
  searchTime: number;
}

export interface HybridSearchOptions {
  semanticWeight: number; // 0-1, weight for semantic search
  keywordWeight: number;  // 0-1, weight for keyword search
  useReranking: boolean;
  maxResults: number;
}

export class RetrievalService {
  private vectorService: VectorService;
  private embeddingService: EmbeddingService;

  constructor() {
    this.vectorService = new VectorService();
    this.embeddingService = new EmbeddingService();
  }

  // Retrieve relevant context for a query
  public async retrieveContext(query: RetrievalQuery): Promise<RetrievalResult> {
    const startTime = Date.now();
    const queryId = uuidv4();

    try {
      logger.info('Starting context retrieval', {
        queryId,
        tenantId: query.tenantId,
        query: query.query.substring(0, 100),
      });

      // Generate embedding for query
      const embeddingStartTime = Date.now();
      const embeddingResult = await this.embeddingService.generateEmbedding(
        query.query,
        query.tenantId
      );
      const embeddingTime = Date.now() - embeddingStartTime;

      // Search vectors
      const searchStartTime = Date.now();
      const collectionName = this.getCollectionName(query.tenantId);
      const searchResults = await this.vectorService.searchSimilar(
        collectionName,
        embeddingResult.embedding,
        query.limit || 10,
        query.scoreThreshold || 0.7,
        query.filters
      );
      const searchTime = Date.now() - searchStartTime;

      // Enrich results with document metadata
      const contexts = await this.enrichSearchResults(searchResults, query.tenantId);

      // Log retrieval for analytics
      await this.logRetrieval(queryId, query, contexts, Date.now() - startTime);

      const result: RetrievalResult = {
        queryId,
        contexts,
        totalResults: searchResults.length,
        processingTime: Date.now() - startTime,
        embeddingTime,
        searchTime,
      };

      logger.info('Context retrieval completed', {
        queryId,
        tenantId: query.tenantId,
        resultCount: contexts.length,
        processingTime: result.processingTime,
      });

      return result;
    } catch (error) {
      logger.error('Context retrieval failed', {
        error: (error as Error).message,
        queryId,
        tenantId: query.tenantId,
      });
      throw new Error(`Context retrieval failed: ${(error as Error).message}`);
    }
  }

  // Hybrid search combining semantic and keyword search
  public async hybridSearch(
    query: RetrievalQuery,
    options: HybridSearchOptions = {
      semanticWeight: 0.7,
      keywordWeight: 0.3,
      useReranking: true,
      maxResults: 20,
    }
  ): Promise<RetrievalResult> {
    const startTime = Date.now();
    const queryId = uuidv4();

    try {
      logger.info('Starting hybrid search', {
        queryId,
        tenantId: query.tenantId,
        options,
      });

      // Perform semantic search
      const semanticResults = await this.retrieveContext({
        ...query,
        limit: options.maxResults,
      });

      // Perform keyword search
      const keywordResults = await this.keywordSearch(query, options.maxResults);

      // Combine and rerank results
      const combinedResults = this.combineSearchResults(
        semanticResults.contexts,
        keywordResults,
        options
      );

      // Apply reranking if enabled
      const finalResults = options.useReranking
        ? await this.rerankResults(combinedResults, query.query)
        : combinedResults;

      // Take top results
      const topResults = finalResults.slice(0, query.limit || 10);

      // Log hybrid retrieval
      await this.logRetrieval(queryId, query, topResults, Date.now() - startTime);

      const result: RetrievalResult = {
        queryId,
        contexts: topResults,
        totalResults: finalResults.length,
        processingTime: Date.now() - startTime,
        embeddingTime: semanticResults.embeddingTime,
        searchTime: semanticResults.searchTime,
      };

      logger.info('Hybrid search completed', {
        queryId,
        tenantId: query.tenantId,
        resultCount: topResults.length,
        processingTime: result.processingTime,
      });

      return result;
    } catch (error) {
      logger.error('Hybrid search failed', {
        error: (error as Error).message,
        queryId,
        tenantId: query.tenantId,
      });
      throw new Error(`Hybrid search failed: ${(error as Error).message}`);
    }
  }

  // Keyword-based search in document content
  private async keywordSearch(
    query: RetrievalQuery,
    limit: number
  ): Promise<RetrievedContext[]> {
    try {
      const searchTerms = this.extractKeywords(query.query);
      
      if (searchTerms.length === 0) {
        return [];
      }

      // Search in document chunks
      const chunks = await prisma.documentChunk.findMany({
        where: {
          tenantId: query.tenantId,
          OR: searchTerms.map(term => ({
            content: {
              contains: term,
              mode: 'insensitive',
            },
          })),
        },
        include: {
          document: {
            select: {
              filename: true,
              originalName: true,
              metadata: true,
            },
          },
        },
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Convert to RetrievedContext format
      return chunks.map((chunk: any) => ({
        id: chunk.embeddingId || `${chunk.documentId}_${chunk.chunkIndex}`,
        content: chunk.content,
        score: this.calculateKeywordScore(chunk.content, searchTerms),
        documentId: chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        metadata: chunk.metadata as Record<string, any>,
        source: {
          filename: chunk.document.filename,
          originalName: chunk.document.originalName,
        },
      }));
    } catch (error) {
      logger.error('Keyword search failed', {
        error: (error as Error).message,
        tenantId: query.tenantId,
      });
      return [];
    }
  }

  // Extract keywords from query
  private extractKeywords(query: string): string[] {
    // Simple keyword extraction - could be enhanced with NLP libraries
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
      'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    ]);

    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .slice(0, 10); // Limit to top 10 keywords
  }

  // Calculate keyword relevance score
  private calculateKeywordScore(content: string, keywords: string[]): number {
    const contentLower = content.toLowerCase();
    let score = 0;

    keywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = (contentLower.match(regex) || []).length;
      score += matches * (1 / Math.log(content.length + 1));
    });

    return Math.min(score, 1.0); // Normalize to 0-1 range
  }

  // Combine semantic and keyword search results
  private combineSearchResults(
    semanticResults: RetrievedContext[],
    keywordResults: RetrievedContext[],
    options: HybridSearchOptions
  ): RetrievedContext[] {
    const combinedMap = new Map<string, RetrievedContext>();

    // Add semantic results
    semanticResults.forEach(result => {
      const combinedScore = result.score * options.semanticWeight;
      combinedMap.set(result.id, {
        ...result,
        score: combinedScore,
      });
    });

    // Add or merge keyword results
    keywordResults.forEach(result => {
      const keywordScore = result.score * options.keywordWeight;
      
      if (combinedMap.has(result.id)) {
        // Merge scores
        const existing = combinedMap.get(result.id)!;
        existing.score += keywordScore;
      } else {
        // Add new result
        combinedMap.set(result.id, {
          ...result,
          score: keywordScore,
        });
      }
    });

    // Sort by combined score
    return Array.from(combinedMap.values()).sort((a, b) => b.score - a.score);
  }

  // Rerank results based on query relevance
  private async rerankResults(
    results: RetrievedContext[],
    query: string
  ): Promise<RetrievedContext[]> {
    // Simple reranking based on content similarity
    // In production, you might use a dedicated reranking model
    return results.map(result => ({
      ...result,
      score: result.score * this.calculateContentSimilarity(result.content, query),
    })).sort((a, b) => b.score - a.score);
  }

  // Calculate content similarity (simple implementation)
  private calculateContentSimilarity(content: string, query: string): number {
    const queryWords = query.toLowerCase().split(/\s+/);
    const contentWords = content.toLowerCase().split(/\s+/);
    
    let matches = 0;
    queryWords.forEach(queryWord => {
      if (contentWords.some(contentWord => 
        contentWord.includes(queryWord) || queryWord.includes(contentWord)
      )) {
        matches++;
      }
    });

    return queryWords.length > 0 ? matches / queryWords.length : 0;
  }

  // Enrich search results with document metadata
  private async enrichSearchResults(
    searchResults: any[],
    tenantId: string
  ): Promise<RetrievedContext[]> {
    if (searchResults.length === 0) {
      return [];
    }

    // Extract document IDs from search results
    const documentIds = [...new Set(
      searchResults.map(result => result.payload?.documentId).filter(Boolean)
    )];

    // Get document metadata
    const documents = await prisma.knowledgeDocument.findMany({
      where: {
        id: { in: documentIds },
        tenantId,
      },
      select: {
        id: true,
        filename: true,
        originalName: true,
        metadata: true,
      },
    });

    const documentMap = new Map(documents.map((doc: any) => [doc.id, doc]));

    // Enrich search results
    return searchResults.map(result => {
      const document = documentMap.get(result.payload?.documentId);
      
      return {
        id: result.id,
        content: result.payload?.content || '',
        score: result.score,
        documentId: result.payload?.documentId || '',
        chunkIndex: result.payload?.chunkIndex || 0,
        metadata: result.payload?.metadata || {},
        source: document ? {
          filename: document.filename || '',
          originalName: document.originalName || '',
          pageNumber: result.payload?.metadata?.pageNumber,
        } : undefined,
      };
    });
  }

  // Log retrieval for analytics and feedback
  private async logRetrieval(
    queryId: string,
    query: RetrievalQuery,
    contexts: RetrievedContext[],
    responseTime: number
  ): Promise<void> {
    try {
      await prisma.retrievalLog.create({
        data: {
          queryId,
          tenantId: query.tenantId,
          userId: query.userId,
          query: query.query,
          documentIds: contexts.map(c => c.documentId),
          chunkIds: contexts.map(c => c.id),
          scores: contexts.map(c => c.score),
          contextUsed: contexts.map(c => c.content).join('\n\n'),
          responseTime,
        },
      });
    } catch (error) {
      logger.warn('Failed to log retrieval', {
        error: (error as Error).message,
        queryId,
      });
    }
  }

  // Submit feedback on retrieval quality
  public async submitFeedback(
    queryId: string,
    feedback: 'helpful' | 'not_helpful' | 'partially_helpful',
    tenantId: string
  ): Promise<void> {
    try {
      await prisma.retrievalLog.update({
        where: {
          queryId,
          tenantId,
        },
        data: {
          feedback,
        },
      });

      logger.info('Retrieval feedback submitted', {
        queryId,
        feedback,
        tenantId,
      });
    } catch (error) {
      logger.error('Failed to submit feedback', {
        error: (error as Error).message,
        queryId,
        tenantId,
      });
      throw new Error(`Failed to submit feedback: ${(error as Error).message}`);
    }
  }

  // Get retrieval analytics
  public async getRetrievalAnalytics(
    tenantId: string,
    dateFrom?: Date,
    dateTo?: Date
  ): Promise<{
    totalQueries: number;
    averageResponseTime: number;
    feedbackStats: Record<string, number>;
    topDocuments: Array<{ documentId: string; filename: string; queryCount: number }>;
    queryTrends: Array<{ date: string; count: number }>;
  }> {
    try {
      const whereClause: any = { tenantId };
      if (dateFrom || dateTo) {
        whereClause.createdAt = {};
        if (dateFrom) whereClause.createdAt.gte = dateFrom;
        if (dateTo) whereClause.createdAt.lte = dateTo;
      }

      const [
        totalQueries,
        avgResponseTime,
        feedbackStats,
        documentStats,
      ] = await Promise.all([
        prisma.retrievalLog.count({ where: whereClause }),
        prisma.retrievalLog.aggregate({
          where: whereClause,
          _avg: { responseTime: true },
        }),
        prisma.retrievalLog.groupBy({
          by: ['feedback'],
          where: { ...whereClause, feedback: { not: null } },
          _count: { feedback: true },
        }),
        prisma.retrievalLog.findMany({
          where: whereClause,
          select: {
            documentIds: true,
            documents: {
              select: {
                id: true,
                filename: true,
              },
            },
          },
        }),
      ]);

      // Process feedback stats
      const feedbackMap: Record<string, number> = {};
      feedbackStats.forEach((stat: any) => {
        if (stat.feedback) {
          feedbackMap[stat.feedback] = stat._count.feedback;
        }
      });

      // Process document stats
      const docCountMap = new Map<string, { filename: string; count: number }>();
      documentStats.forEach((log: any) => {
        log.documentIds.forEach((docId: string) => {
          const doc = log.documents.find((d: any) => d.id === docId);
          if (doc) {
            const existing = docCountMap.get(docId);
            docCountMap.set(docId, {
              filename: doc.filename,
              count: (existing?.count || 0) + 1,
            });
          }
        });
      });

      const topDocuments = Array.from(docCountMap.entries())
        .map(([documentId, data]) => ({
          documentId,
          filename: data.filename,
          queryCount: data.count,
        }))
        .sort((a, b) => b.queryCount - a.queryCount)
        .slice(0, 10);

      return {
        totalQueries,
        averageResponseTime: avgResponseTime._avg.responseTime || 0,
        feedbackStats: feedbackMap,
        topDocuments,
        queryTrends: [], // Could be implemented with time-based grouping
      };
    } catch (error) {
      logger.error('Failed to get retrieval analytics', {
        error: (error as Error).message,
        tenantId,
      });
      throw new Error(`Failed to get retrieval analytics: ${(error as Error).message}`);
    }
  }

  // Get context for specific query ID
  public async getQueryContext(queryId: string, tenantId: string): Promise<{
    query: string;
    contexts: RetrievedContext[];
    createdAt: Date;
    responseTime: number;
  } | null> {
    try {
      const log = await prisma.retrievalLog.findFirst({
        where: { queryId, tenantId },
        include: {
          documents: {
            select: {
              id: true,
              filename: true,
              originalName: true,
            },
          },
        },
      });

      if (!log) {
        return null;
      }

      // Reconstruct contexts from log
      const contexts: RetrievedContext[] = log.chunkIds.map((chunkId: string, index: number) => {
        const documentId = log.documentIds[index];
        const document = log.documents.find((d: any) => d.id === documentId);
        
        return {
          id: chunkId,
          content: '', // Content not stored in log for space efficiency
          score: log.scores[index] || 0,
          documentId,
          chunkIndex: parseInt(chunkId.split('_').pop() || '0'),
          source: document ? {
            filename: document.filename,
            originalName: document.originalName,
          } : undefined,
        };
      });

      return {
        query: log.query,
        contexts,
        createdAt: log.createdAt,
        responseTime: log.responseTime,
      };
    } catch (error) {
      logger.error('Failed to get query context', {
        error: (error as Error).message,
        queryId,
        tenantId,
      });
      return null;
    }
  }

  // Private helper methods
  private getCollectionName(tenantId: string): string {
    return `tenant_${tenantId}_kb`;
  }

  // Health check
  public async healthCheck(): Promise<boolean> {
    try {
      return await this.vectorService.healthCheck();
    } catch (error) {
      logger.error('Retrieval service health check failed', {
        error: (error as Error).message,
      });
      return false;
    }
  }
}
