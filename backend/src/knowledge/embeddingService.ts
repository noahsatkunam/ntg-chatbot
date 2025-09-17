import { OpenAI } from 'openai';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
  cached: boolean;
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  tokenCounts: number[];
  totalTokens: number;
  cacheHits: number;
  cacheMisses: number;
}

export class EmbeddingService {
  private openai: OpenAI;
  private model: string;
  private maxTokens: number;
  private batchSize: number;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.model = process.env.EMBEDDING_MODEL || 'text-embedding-ada-002';
    this.maxTokens = 8191; // Max tokens for text-embedding-ada-002
    this.batchSize = 100; // Max batch size for OpenAI embeddings
  }

  // Generate embedding for single text
  public async generateEmbedding(
    text: string,
    tenantId: string,
    useCache: boolean = true
  ): Promise<EmbeddingResult> {
    try {
      // Validate input
      if (!text || text.trim().length === 0) {
        throw new Error('Text cannot be empty');
      }

      // Truncate text if too long
      const truncatedText = this.truncateText(text);
      const contentHash = this.generateContentHash(truncatedText);

      // Check cache first
      if (useCache) {
        const cached = await this.getCachedEmbedding(tenantId, contentHash);
        if (cached) {
          return {
            embedding: cached.embedding,
            tokenCount: cached.tokenCount,
            cached: true,
          };
        }
      }

      // Generate embedding using OpenAI
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: truncatedText,
      });

      const embedding = response.data[0].embedding;
      const tokenCount = response.usage.total_tokens;

      // Cache the result
      if (useCache) {
        await this.cacheEmbedding(tenantId, contentHash, embedding, tokenCount);
      }

      logger.info('Embedding generated', {
        tenantId,
        model: this.model,
        tokenCount,
        textLength: truncatedText.length,
        cached: false,
      });

      return {
        embedding,
        tokenCount,
        cached: false,
      };
    } catch (error) {
      logger.error('Embedding generation failed', {
        error: error.message,
        tenantId,
        textLength: text?.length,
      });
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  // Generate embeddings for multiple texts in batches
  public async generateBatchEmbeddings(
    texts: string[],
    tenantId: string,
    useCache: boolean = true
  ): Promise<BatchEmbeddingResult> {
    try {
      if (!texts || texts.length === 0) {
        throw new Error('Texts array cannot be empty');
      }

      const embeddings: number[][] = [];
      const tokenCounts: number[] = [];
      let totalTokens = 0;
      let cacheHits = 0;
      let cacheMisses = 0;

      // Process in batches
      for (let i = 0; i < texts.length; i += this.batchSize) {
        const batch = texts.slice(i, i + this.batchSize);
        const batchResult = await this.processBatch(batch, tenantId, useCache);
        
        embeddings.push(...batchResult.embeddings);
        tokenCounts.push(...batchResult.tokenCounts);
        totalTokens += batchResult.totalTokens;
        cacheHits += batchResult.cacheHits;
        cacheMisses += batchResult.cacheMisses;

        // Add delay between batches to respect rate limits
        if (i + this.batchSize < texts.length) {
          await this.delay(100); // 100ms delay
        }
      }

      logger.info('Batch embedding generation completed', {
        tenantId,
        totalTexts: texts.length,
        totalTokens,
        cacheHits,
        cacheMisses,
        cacheHitRate: (cacheHits / (cacheHits + cacheMisses)) * 100,
      });

      return {
        embeddings,
        tokenCounts,
        totalTokens,
        cacheHits,
        cacheMisses,
      };
    } catch (error) {
      logger.error('Batch embedding generation failed', {
        error: error.message,
        tenantId,
        textCount: texts?.length,
      });
      throw new Error(`Failed to generate batch embeddings: ${error.message}`);
    }
  }

  // Process a single batch
  private async processBatch(
    texts: string[],
    tenantId: string,
    useCache: boolean
  ): Promise<{
    embeddings: number[][];
    tokenCounts: number[];
    totalTokens: number;
    cacheHits: number;
    cacheMisses: number;
  }> {
    const embeddings: number[][] = [];
    const tokenCounts: number[] = [];
    let totalTokens = 0;
    let cacheHits = 0;
    let cacheMisses = 0;

    // Prepare texts and check cache
    const processedTexts: string[] = [];
    const textIndices: number[] = [];
    const cachedResults: (EmbeddingResult | null)[] = [];

    for (let i = 0; i < texts.length; i++) {
      const truncatedText = this.truncateText(texts[i]);
      const contentHash = this.generateContentHash(truncatedText);

      let cached: EmbeddingResult | null = null;
      if (useCache) {
        const cachedEmbedding = await this.getCachedEmbedding(tenantId, contentHash);
        if (cachedEmbedding) {
          cached = {
            embedding: cachedEmbedding.embedding,
            tokenCount: cachedEmbedding.tokenCount,
            cached: true,
          };
          cacheHits++;
        }
      }

      cachedResults[i] = cached;
      
      if (!cached) {
        processedTexts.push(truncatedText);
        textIndices.push(i);
        cacheMisses++;
      }
    }

    // Generate embeddings for non-cached texts
    if (processedTexts.length > 0) {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: processedTexts,
      });

      // Cache new embeddings
      for (let i = 0; i < processedTexts.length; i++) {
        const embedding = response.data[i].embedding;
        const originalIndex = textIndices[i];
        
        embeddings[originalIndex] = embedding;
        tokenCounts[originalIndex] = Math.ceil(response.usage.total_tokens / processedTexts.length);
        
        if (useCache) {
          const contentHash = this.generateContentHash(processedTexts[i]);
          await this.cacheEmbedding(
            tenantId,
            contentHash,
            embedding,
            tokenCounts[originalIndex]
          );
        }
      }

      totalTokens += response.usage.total_tokens;
    }

    // Fill in cached results
    for (let i = 0; i < texts.length; i++) {
      const cached = cachedResults[i];
      if (cached) {
        embeddings[i] = cached.embedding;
        tokenCounts[i] = cached.tokenCount;
        totalTokens += cached.tokenCount;
      }
    }

    return {
      embeddings,
      tokenCounts,
      totalTokens,
      cacheHits,
      cacheMisses,
    };
  }

  // Get cached embedding
  private async getCachedEmbedding(
    tenantId: string,
    contentHash: string
  ): Promise<{ embedding: number[]; tokenCount: number } | null> {
    try {
      const cached = await prisma.embeddingCache.findUnique({
        where: {
          tenantId_contentHash_model: {
            tenantId,
            contentHash,
            model: this.model,
          },
        },
      });

      if (cached) {
        // Update access time
        await prisma.embeddingCache.update({
          where: { id: cached.id },
          data: { accessedAt: new Date() },
        });

        return {
          embedding: JSON.parse(cached.embedding),
          tokenCount: this.estimateTokenCount(cached.embedding),
        };
      }

      return null;
    } catch (error) {
      logger.warn('Failed to get cached embedding', {
        error: error.message,
        tenantId,
        contentHash,
      });
      return null;
    }
  }

  // Cache embedding
  private async cacheEmbedding(
    tenantId: string,
    contentHash: string,
    embedding: number[],
    tokenCount: number
  ): Promise<void> {
    try {
      await prisma.embeddingCache.upsert({
        where: {
          tenantId_contentHash_model: {
            tenantId,
            contentHash,
            model: this.model,
          },
        },
        create: {
          tenantId,
          contentHash,
          embedding: JSON.stringify(embedding),
          model: this.model,
        },
        update: {
          embedding: JSON.stringify(embedding),
          accessedAt: new Date(),
        },
      });
    } catch (error) {
      logger.warn('Failed to cache embedding', {
        error: error.message,
        tenantId,
        contentHash,
      });
      // Don't throw error for caching failures
    }
  }

  // Clean up old cache entries
  public async cleanupCache(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await prisma.embeddingCache.deleteMany({
        where: {
          accessedAt: {
            lt: cutoffDate,
          },
        },
      });

      logger.info('Embedding cache cleanup completed', {
        deletedCount: result.count,
        olderThanDays,
      });

      return result.count;
    } catch (error) {
      logger.error('Embedding cache cleanup failed', {
        error: error.message,
        olderThanDays,
      });
      return 0;
    }
  }

  // Get cache statistics
  public async getCacheStats(tenantId?: string): Promise<{
    totalEntries: number;
    tenantEntries?: number;
    totalSizeBytes: number;
    oldestEntry: Date | null;
    newestEntry: Date | null;
  }> {
    try {
      const whereClause = tenantId ? { tenantId } : {};

      const [totalCount, tenantCount, sizeResult, oldestEntry, newestEntry] = await Promise.all([
        prisma.embeddingCache.count(),
        tenantId ? prisma.embeddingCache.count({ where: { tenantId } }) : Promise.resolve(0),
        prisma.embeddingCache.aggregate({
          where: whereClause,
          _sum: {
            id: true, // Approximate size calculation
          },
        }),
        prisma.embeddingCache.findFirst({
          where: whereClause,
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        prisma.embeddingCache.findFirst({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

      return {
        totalEntries: totalCount,
        tenantEntries: tenantId ? tenantCount : undefined,
        totalSizeBytes: (sizeResult._sum.id || 0) * 1536 * 4, // Approximate size
        oldestEntry: oldestEntry?.createdAt || null,
        newestEntry: newestEntry?.createdAt || null,
      };
    } catch (error) {
      logger.error('Failed to get cache stats', {
        error: error.message,
        tenantId,
      });
      return {
        totalEntries: 0,
        totalSizeBytes: 0,
        oldestEntry: null,
        newestEntry: null,
      };
    }
  }

  // Estimate token count for text
  public estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  // Private helper methods
  private truncateText(text: string): string {
    const estimatedTokens = this.estimateTokenCount(text);
    if (estimatedTokens <= this.maxTokens) {
      return text;
    }

    // Truncate to approximate max tokens
    const maxChars = this.maxTokens * 4;
    return text.substring(0, maxChars);
  }

  private generateContentHash(text: string): string {
    return crypto.createHash('sha256').update(text + this.model).digest('hex');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get embedding model info
  public getModelInfo(): {
    model: string;
    dimensions: number;
    maxTokens: number;
    batchSize: number;
  } {
    return {
      model: this.model,
      dimensions: 1536, // text-embedding-ada-002 dimensions
      maxTokens: this.maxTokens,
      batchSize: this.batchSize,
    };
  }

  // Test embedding generation
  public async testEmbedding(): Promise<boolean> {
    try {
      const testText = 'This is a test embedding';
      const result = await this.generateEmbedding(testText, 'test-tenant', false);
      return result.embedding.length === 1536;
    } catch (error) {
      logger.error('Embedding test failed', { error: error.message });
      return false;
    }
  }
}
