import { PrismaClient } from '@prisma/client';
import { VectorService, SearchResult } from '../../knowledge/vectorService';
import { EmbeddingService } from '../../knowledge/embeddingService';
import { FacetedSearchService } from '../../knowledge/search/facetedSearchService';

export interface ContextChunk {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, any>;
  documentId?: string;
}

export interface RetrievedSource {
  id: string;
  documentId: string;
  score: number;
  excerpt: string;
}

export interface RetrieveContextOptions {
  maxChunks?: number;
  includeMetadata?: boolean;
}

export interface ContextRetrievalResult {
  chunks: ContextChunk[];
  sources: RetrievedSource[];
  totalScore: number;
  retrievalStrategy: string;
}

export class ContextRetrievalService {
  constructor(
    private prisma: PrismaClient,
    private facetedSearch: FacetedSearchService,
    private vectorService: VectorService,
    private embeddingService: EmbeddingService
  ) {}

  async retrieveContext(
    query: string,
    tenantId: string,
    conversationHistory: string[],
    options: RetrieveContextOptions = {}
  ): Promise<ContextRetrievalResult> {
    const start = Date.now();

    // Generate embedding for the query
    const embedding = await this.embeddingService.generateEmbedding(query, tenantId);

    // Search similar chunks using vector service
    const results: SearchResult[] = await this.vectorService.searchSimilar(
      tenantId,
      embedding.embedding,
      options.maxChunks || 5
    );

    const chunks: ContextChunk[] = results.map(r => ({
      id: r.id,
      text: (r.payload as any)?.content || '',
      score: r.score,
      metadata: options.includeMetadata ? r.payload : undefined,
      documentId: (r.payload as any)?.documentId,
    }));

    const sources: RetrievedSource[] = chunks.map(c => ({
      id: c.id,
      documentId: c.documentId || c.id,
      score: c.score,
      excerpt: c.text,
    }));

    // Log retrieval for analytics
    await this.prisma.retrievalLog.create({
      data: {
        tenantId,
        userId: undefined,
        query,
        queryType: 'semantic',
        resultsCount: results.length,
        responseTime: Date.now() - start,
        metadata: { historySize: conversationHistory.length },
      },
    }).catch(() => {});

    return {
      chunks,
      sources,
      totalScore: results.reduce((sum, r) => sum + r.score, 0),
      retrievalStrategy: 'semantic',
    };
  }
}

