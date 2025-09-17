import { PrismaClient } from '@prisma/client';
import { SemanticChunker } from './semanticChunker';
import { HierarchicalChunker } from './hierarchicalChunker';
import { OverlappingChunker } from './overlappingChunker';
import { MetadataExtractor } from './metadataExtractor';
import { AppError } from '../../middlewares/errorHandler';

const prisma = new PrismaClient();

export interface ChunkingOptions {
  strategy: 'semantic' | 'hierarchical' | 'overlapping' | 'hybrid';
  chunkSize: number;
  chunkOverlap: number;
  preserveStructure: boolean;
  minChunkSize: number;
  maxChunkSize: number;
  respectSentences: boolean;
  respectParagraphs: boolean;
  customDelimiters?: string[];
}

export interface ChunkingResult {
  chunks: Array<{
    content: string;
    startOffset: number;
    endOffset: number;
    chunkIndex: number;
    tokenCount: number;
    metadata: {
      type: 'paragraph' | 'heading' | 'list' | 'table' | 'code' | 'mixed';
      level?: number;
      title?: string;
      structure?: any;
    };
  }>;
  metadata: {
    totalChunks: number;
    totalTokens: number;
    averageChunkSize: number;
    strategy: string;
    processingTime: number;
  };
}

export class ChunkingService {
  private semanticChunker: SemanticChunker;
  private hierarchicalChunker: HierarchicalChunker;
  private overlappingChunker: OverlappingChunker;
  private metadataExtractor: MetadataExtractor;

  constructor() {
    this.semanticChunker = new SemanticChunker();
    this.hierarchicalChunker = new HierarchicalChunker();
    this.overlappingChunker = new OverlappingChunker();
    this.metadataExtractor = new MetadataExtractor();
  }

  /**
   * Chunk document content using specified strategy
   */
  async chunkDocument(
    content: string,
    documentId: string,
    tenantId: string,
    options?: Partial<ChunkingOptions>
  ): Promise<ChunkingResult> {
    const startTime = Date.now();
    
    try {
      // Get chunking settings for tenant
      const settings = await this.getChunkingSettings(tenantId);
      const finalOptions: ChunkingOptions = {
        ...settings,
        ...options
      };

      // Extract document structure and metadata
      const documentMetadata = await this.metadataExtractor.extractMetadata(content);

      let result: ChunkingResult;

      switch (finalOptions.strategy) {
        case 'semantic':
          result = await this.semanticChunker.chunk(content, finalOptions);
          break;
        case 'hierarchical':
          result = await this.hierarchicalChunker.chunk(content, finalOptions, documentMetadata);
          break;
        case 'overlapping':
          result = await this.overlappingChunker.chunk(content, finalOptions);
          break;
        case 'hybrid':
          result = await this.hybridChunking(content, finalOptions, documentMetadata);
          break;
        default:
          throw new AppError(`Unsupported chunking strategy: ${finalOptions.strategy}`, 400);
      }

      // Add processing metadata
      result.metadata.processingTime = Date.now() - startTime;
      result.metadata.strategy = finalOptions.strategy;

      // Validate chunks
      await this.validateChunks(result, finalOptions);

      return result;
    } catch (error) {
      throw new AppError(
        `Failed to chunk document: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Re-chunk existing document with new settings
   */
  async rechunkDocument(
    documentId: string,
    tenantId: string,
    newOptions: Partial<ChunkingOptions>
  ): Promise<ChunkingResult> {
    try {
      // Get original document content
      const document = await prisma.knowledgeDocument.findFirst({
        where: { id: documentId, tenantId }
      });

      if (!document) {
        throw new AppError('Document not found', 404);
      }

      // Delete existing chunks
      await prisma.documentChunk.deleteMany({
        where: { documentId, tenantId }
      });

      // Re-read document content (this would need to be implemented based on storage)
      const content = await this.getDocumentContent(documentId);

      // Chunk with new options
      return await this.chunkDocument(content, documentId, tenantId, newOptions);
    } catch (error) {
      throw new AppError(`Failed to re-chunk document: ${error}`, 500);
    }
  }

  /**
   * Get optimal chunking strategy for document type
   */
  async getOptimalStrategy(content: string, documentType: string): Promise<ChunkingOptions> {
    const baseOptions: ChunkingOptions = {
      strategy: 'semantic',
      chunkSize: 1000,
      chunkOverlap: 200,
      preserveStructure: true,
      minChunkSize: 100,
      maxChunkSize: 2000,
      respectSentences: true,
      respectParagraphs: true
    };

    // Analyze content characteristics
    const analysis = await this.analyzeContent(content);

    // Adjust strategy based on document type and content
    switch (documentType.toLowerCase()) {
      case 'pdf':
      case 'word':
        if (analysis.hasStructure) {
          baseOptions.strategy = 'hierarchical';
          baseOptions.preserveStructure = true;
        }
        break;
      case 'markdown':
      case 'text':
        if (analysis.hasHeadings) {
          baseOptions.strategy = 'hierarchical';
        } else {
          baseOptions.strategy = 'semantic';
        }
        break;
      case 'code':
        baseOptions.strategy = 'semantic';
        baseOptions.respectSentences = false;
        baseOptions.customDelimiters = ['\n\n', '\n', ';', '{', '}'];
        break;
      case 'web':
        baseOptions.strategy = 'hybrid';
        baseOptions.preserveStructure = true;
        break;
    }

    // Adjust chunk size based on content length
    if (content.length < 5000) {
      baseOptions.chunkSize = 500;
      baseOptions.chunkOverlap = 100;
    } else if (content.length > 50000) {
      baseOptions.chunkSize = 1500;
      baseOptions.chunkOverlap = 300;
    }

    return baseOptions;
  }

  /**
   * Hybrid chunking combining multiple strategies
   */
  private async hybridChunking(
    content: string,
    options: ChunkingOptions,
    documentMetadata: any
  ): Promise<ChunkingResult> {
    // Start with hierarchical chunking to respect document structure
    const hierarchicalResult = await this.hierarchicalChunker.chunk(
      content, 
      { ...options, strategy: 'hierarchical' }, 
      documentMetadata
    );

    // Apply semantic chunking to large chunks
    const refinedChunks = [];
    for (const chunk of hierarchicalResult.chunks) {
      if (chunk.tokenCount > options.maxChunkSize) {
        // Re-chunk large chunks semantically
        const semanticResult = await this.semanticChunker.chunk(
          chunk.content,
          { ...options, strategy: 'semantic' }
        );
        
        // Adjust offsets and indices
        for (const subChunk of semanticResult.chunks) {
          refinedChunks.push({
            ...subChunk,
            startOffset: chunk.startOffset + subChunk.startOffset,
            endOffset: chunk.startOffset + subChunk.endOffset,
            chunkIndex: refinedChunks.length,
            metadata: {
              ...subChunk.metadata,
              parentChunk: chunk.chunkIndex
            }
          });
        }
      } else {
        refinedChunks.push({
          ...chunk,
          chunkIndex: refinedChunks.length
        });
      }
    }

    return {
      chunks: refinedChunks,
      metadata: {
        totalChunks: refinedChunks.length,
        totalTokens: refinedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
        averageChunkSize: refinedChunks.length > 0 
          ? refinedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / refinedChunks.length 
          : 0,
        strategy: 'hybrid',
        processingTime: 0 // Will be set by caller
      }
    };
  }

  /**
   * Validate chunks meet quality requirements
   */
  private async validateChunks(result: ChunkingResult, options: ChunkingOptions): Promise<void> {
    const issues: string[] = [];

    for (const chunk of result.chunks) {
      // Check minimum size
      if (chunk.tokenCount < options.minChunkSize) {
        issues.push(`Chunk ${chunk.chunkIndex} is too small (${chunk.tokenCount} tokens)`);
      }

      // Check maximum size
      if (chunk.tokenCount > options.maxChunkSize) {
        issues.push(`Chunk ${chunk.chunkIndex} is too large (${chunk.tokenCount} tokens)`);
      }

      // Check content quality
      if (chunk.content.trim().length === 0) {
        issues.push(`Chunk ${chunk.chunkIndex} is empty`);
      }

      // Check for incomplete sentences if required
      if (options.respectSentences && !this.endsWithSentence(chunk.content)) {
        issues.push(`Chunk ${chunk.chunkIndex} doesn't end with complete sentence`);
      }
    }

    if (issues.length > 0) {
      console.warn('Chunking validation issues:', issues);
    }
  }

  /**
   * Analyze content characteristics
   */
  private async analyzeContent(content: string): Promise<{
    hasStructure: boolean;
    hasHeadings: boolean;
    hasLists: boolean;
    hasTables: boolean;
    hasCode: boolean;
    language?: string;
  }> {
    return {
      hasStructure: /^#{1,6}\s+|\n\s*\d+\.\s+|\n\s*[-*+]\s+/.test(content),
      hasHeadings: /^#{1,6}\s+|^.+\n[=-]+\n/.test(content),
      hasLists: /^\s*[-*+]\s+|^\s*\d+\.\s+/.test(content),
      hasTables: /\|.*\|/.test(content),
      hasCode: /```|`[^`]+`/.test(content)
    };
  }

  /**
   * Get chunking settings for tenant
   */
  private async getChunkingSettings(tenantId: string): Promise<ChunkingOptions> {
    try {
      const settings = await prisma.knowledgeBaseSettings.findUnique({
        where: { tenantId }
      });

      if (settings) {
        return {
          strategy: settings.chunkingStrategy as any,
          chunkSize: settings.chunkSize,
          chunkOverlap: settings.chunkOverlap,
          preserveStructure: true,
          minChunkSize: 100,
          maxChunkSize: settings.chunkSize * 2,
          respectSentences: true,
          respectParagraphs: true
        };
      }
    } catch (error) {
      console.warn('Failed to get chunking settings:', error);
    }

    // Default settings
    return {
      strategy: 'semantic',
      chunkSize: 1000,
      chunkOverlap: 200,
      preserveStructure: true,
      minChunkSize: 100,
      maxChunkSize: 2000,
      respectSentences: true,
      respectParagraphs: true
    };
  }

  /**
   * Get document content (placeholder - would integrate with storage)
   */
  private async getDocumentContent(documentId: string): Promise<string> {
    // This would integrate with your document storage system
    // For now, return empty string as placeholder
    return '';
  }

  /**
   * Check if text ends with complete sentence
   */
  private endsWithSentence(text: string): boolean {
    const trimmed = text.trim();
    return /[.!?]$/.test(trimmed);
  }

  /**
   * Estimate token count for text
   */
  estimateTokenCount(text: string): number {
    // Simple estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Get chunking statistics for tenant
   */
  async getChunkingStats(tenantId: string): Promise<{
    totalDocuments: number;
    totalChunks: number;
    averageChunksPerDocument: number;
    averageChunkSize: number;
    strategyDistribution: Record<string, number>;
  }> {
    try {
      const documents = await prisma.knowledgeDocument.findMany({
        where: { tenantId },
        include: { chunks: true }
      });

      const totalDocuments = documents.length;
      const totalChunks = documents.reduce((sum, doc) => sum + doc.chunks.length, 0);
      const averageChunksPerDocument = totalDocuments > 0 ? totalChunks / totalDocuments : 0;
      
      const allChunks = documents.flatMap(doc => doc.chunks);
      const averageChunkSize = allChunks.length > 0 
        ? allChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / allChunks.length
        : 0;

      return {
        totalDocuments,
        totalChunks,
        averageChunksPerDocument,
        averageChunkSize,
        strategyDistribution: { semantic: totalDocuments } // Simplified
      };
    } catch (error) {
      throw new AppError(`Failed to get chunking stats: ${error}`, 500);
    }
  }
}
