import { PrismaClient } from '@prisma/client';
import { VectorService } from './vectorService';
import { EmbeddingService } from './embeddingService';
import { DocumentProcessor } from './documentProcessor';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

export interface KnowledgeBaseDocument {
  id: string;
  filename: string;
  originalName: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PENDING';
  processingProgress: number;
  metadata?: any;
  createdAt: Date;
  chunkCount?: number;
}

export interface DocumentUploadResult {
  documentId: string;
  status: string;
  message: string;
}

export class KnowledgeBaseService {
  private vectorService: VectorService;
  private embeddingService: EmbeddingService;
  private documentProcessor: DocumentProcessor;

  constructor() {
    this.vectorService = new VectorService();
    this.embeddingService = new EmbeddingService();
    this.documentProcessor = new DocumentProcessor();
  }

  // Initialize knowledge base for tenant
  public async initializeTenantKnowledgeBase(tenantId: string): Promise<void> {
    try {
      const collectionName = this.getCollectionName(tenantId);
      
      // Check if collection already exists
      const exists = await this.vectorService.collectionExists(collectionName);
      if (exists) {
        logger.info('Knowledge base collection already exists', {
          tenantId,
          collectionName,
        });
        return;
      }

      // Create vector collection
      await this.vectorService.createCollection(collectionName);

      // Create knowledge collection record
      await prisma.knowledgeCollection.upsert({
        where: { tenantId },
        create: {
          tenantId,
          collectionName,
          vectorDimension: 1536,
          distanceMetric: 'cosine',
          settings: {
            chunkSize: 1000,
            chunkOverlap: 200,
            embeddingModel: 'text-embedding-ada-002',
          },
        },
        update: {
          collectionName,
          updatedAt: new Date(),
        },
      });

      logger.info('Knowledge base initialized for tenant', {
        tenantId,
        collectionName,
      });
    } catch (error) {
      logger.error('Failed to initialize knowledge base', {
        error: error.message,
        tenantId,
      });
      throw new Error(`Failed to initialize knowledge base: ${error.message}`);
    }
  }

  // Upload and process document
  public async uploadDocument(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    tenantId: string,
    userId: string
  ): Promise<DocumentUploadResult> {
    try {
      // Validate document
      const validation = this.documentProcessor.validateDocument(buffer, mimeType);
      if (!validation.isValid) {
        return {
          documentId: '',
          status: 'FAILED',
          message: validation.error || 'Document validation failed',
        };
      }

      // Create document record
      const document = await prisma.knowledgeDocument.create({
        data: {
          tenantId,
          filename: this.generateUniqueFilename(filename),
          originalName: filename,
          fileSize: buffer.length,
          mimeType,
          status: 'PROCESSING',
          processingProgress: 0,
          uploadedBy: userId,
          metadata: {},
        },
      });

      // Process document asynchronously
      this.processDocumentAsync(document.id, buffer, mimeType, tenantId);

      logger.info('Document upload initiated', {
        documentId: document.id,
        tenantId,
        userId,
        filename,
        fileSize: buffer.length,
      });

      return {
        documentId: document.id,
        status: 'PROCESSING',
        message: 'Document uploaded and processing started',
      };
    } catch (error) {
      logger.error('Document upload failed', {
        error: error.message,
        tenantId,
        userId,
        filename,
      });
      throw new Error(`Document upload failed: ${error.message}`);
    }
  }

  // Process document asynchronously
  private async processDocumentAsync(
    documentId: string,
    buffer: Buffer,
    mimeType: string,
    tenantId: string
  ): Promise<void> {
    try {
      // Update progress
      await this.updateProcessingProgress(documentId, 10, 'Extracting content...');

      // Process document
      const processed = await this.documentProcessor.processDocument(
        buffer,
        documentId,
        mimeType
      );

      await this.updateProcessingProgress(documentId, 30, 'Content extracted, generating embeddings...');

      // Generate embeddings for chunks
      const texts = processed.chunks.map(chunk => chunk.content);
      const embeddingResult = await this.embeddingService.generateBatchEmbeddings(
        texts,
        tenantId
      );

      await this.updateProcessingProgress(documentId, 70, 'Embeddings generated, storing in vector database...');

      // Store chunks and embeddings
      await this.storeDocumentChunks(
        documentId,
        tenantId,
        processed.chunks,
        embeddingResult.embeddings
      );

      await this.updateProcessingProgress(documentId, 90, 'Storing vectors...');

      // Store vectors in Qdrant
      await this.storeVectors(tenantId, documentId, processed.chunks, embeddingResult.embeddings);

      // Update document status
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          status: 'COMPLETED',
          processingProgress: 100,
          processedAt: new Date(),
          metadata: processed.metadata,
        },
      });

      // Update collection stats
      await this.updateCollectionStats(tenantId);

      logger.info('Document processing completed', {
        documentId,
        tenantId,
        chunkCount: processed.chunks.length,
        processingTime: processed.processingTime,
      });
    } catch (error) {
      logger.error('Document processing failed', {
        error: error.message,
        documentId,
        tenantId,
      });

      // Update document with error status
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          status: 'FAILED',
          errorMessage: error.message,
        },
      });
    }
  }

  // Store document chunks in database
  private async storeDocumentChunks(
    documentId: string,
    tenantId: string,
    chunks: any[],
    embeddings: number[][]
  ): Promise<void> {
    const chunkData = chunks.map((chunk, index) => ({
      documentId,
      tenantId,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      tokenCount: chunk.tokenCount,
      embeddingId: `${documentId}_${chunk.chunkIndex}`,
      metadata: chunk.metadata || {},
    }));

    await prisma.documentChunk.createMany({
      data: chunkData,
    });
  }

  // Store vectors in Qdrant
  private async storeVectors(
    tenantId: string,
    documentId: string,
    chunks: any[],
    embeddings: number[][]
  ): Promise<void> {
    const collectionName = this.getCollectionName(tenantId);
    
    const vectors = chunks.map((chunk, index) => ({
      id: `${documentId}_${chunk.chunkIndex}`,
      vector: embeddings[index],
      payload: {
        documentId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        metadata: chunk.metadata || {},
      },
    }));

    await this.vectorService.insertVectors(collectionName, vectors);
  }

  // Get documents for tenant
  public async getDocuments(
    tenantId: string,
    limit: number = 50,
    offset: number = 0,
    status?: string
  ): Promise<{
    documents: KnowledgeBaseDocument[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const whereClause: any = { tenantId };
      if (status) {
        whereClause.status = status;
      }

      const [documents, total] = await Promise.all([
        prisma.knowledgeDocument.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            _count: {
              select: { chunks: true },
            },
          },
        }),
        prisma.knowledgeDocument.count({ where: whereClause }),
      ]);

      const formattedDocuments: KnowledgeBaseDocument[] = documents.map(doc => ({
        id: doc.id,
        filename: doc.filename,
        originalName: doc.originalName,
        status: doc.status as any,
        processingProgress: doc.processingProgress,
        metadata: doc.metadata,
        createdAt: doc.createdAt,
        chunkCount: doc._count.chunks,
      }));

      return {
        documents: formattedDocuments,
        total,
        hasMore: offset + documents.length < total,
      };
    } catch (error) {
      logger.error('Failed to get documents', {
        error: error.message,
        tenantId,
      });
      throw new Error(`Failed to get documents: ${error.message}`);
    }
  }

  // Delete document
  public async deleteDocument(documentId: string, tenantId: string): Promise<void> {
    try {
      // Get document info
      const document = await prisma.knowledgeDocument.findFirst({
        where: { id: documentId, tenantId },
        include: { chunks: true },
      });

      if (!document) {
        throw new Error('Document not found');
      }

      // Delete vectors from Qdrant
      const collectionName = this.getCollectionName(tenantId);
      const vectorIds = document.chunks.map(chunk => `${documentId}_${chunk.chunkIndex}`);
      
      if (vectorIds.length > 0) {
        await this.vectorService.deleteVectors(collectionName, vectorIds);
      }

      // Delete from database (cascades to chunks)
      await prisma.knowledgeDocument.delete({
        where: { id: documentId },
      });

      // Update collection stats
      await this.updateCollectionStats(tenantId);

      logger.info('Document deleted successfully', {
        documentId,
        tenantId,
        chunkCount: document.chunks.length,
      });
    } catch (error) {
      logger.error('Failed to delete document', {
        error: error.message,
        documentId,
        tenantId,
      });
      throw new Error(`Failed to delete document: ${error.message}`);
    }
  }

  // Reindex document
  public async reindexDocument(documentId: string, tenantId: string): Promise<void> {
    try {
      const document = await prisma.knowledgeDocument.findFirst({
        where: { id: documentId, tenantId },
      });

      if (!document) {
        throw new Error('Document not found');
      }

      // Reset status to processing
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          status: 'PROCESSING',
          processingProgress: 0,
          errorMessage: null,
        },
      });

      // Delete existing chunks and vectors
      await this.deleteDocumentData(documentId, tenantId);

      // Note: In a real implementation, you'd need to store the original file
      // or have a way to re-fetch it for reprocessing
      logger.info('Document reindexing initiated', { documentId, tenantId });
    } catch (error) {
      logger.error('Failed to reindex document', {
        error: error.message,
        documentId,
        tenantId,
      });
      throw new Error(`Failed to reindex document: ${error.message}`);
    }
  }

  // Get knowledge base statistics
  public async getKnowledgeBaseStats(tenantId: string): Promise<{
    totalDocuments: number;
    totalChunks: number;
    processingDocuments: number;
    failedDocuments: number;
    totalSize: number;
    collectionInfo?: any;
  }> {
    try {
      const [
        totalDocuments,
        totalChunks,
        processingDocuments,
        failedDocuments,
        sizeResult,
        collectionInfo,
      ] = await Promise.all([
        prisma.knowledgeDocument.count({ where: { tenantId } }),
        prisma.documentChunk.count({ where: { tenantId } }),
        prisma.knowledgeDocument.count({
          where: { tenantId, status: 'PROCESSING' },
        }),
        prisma.knowledgeDocument.count({
          where: { tenantId, status: 'FAILED' },
        }),
        prisma.knowledgeDocument.aggregate({
          where: { tenantId },
          _sum: { fileSize: true },
        }),
        this.vectorService.getCollectionInfo(this.getCollectionName(tenantId)),
      ]);

      return {
        totalDocuments,
        totalChunks,
        processingDocuments,
        failedDocuments,
        totalSize: sizeResult._sum.fileSize || 0,
        collectionInfo,
      };
    } catch (error) {
      logger.error('Failed to get knowledge base stats', {
        error: error.message,
        tenantId,
      });
      throw new Error(`Failed to get knowledge base stats: ${error.message}`);
    }
  }

  // Private helper methods
  private getCollectionName(tenantId: string): string {
    return `tenant_${tenantId}_kb`;
  }

  private generateUniqueFilename(originalName: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2);
    const extension = originalName.split('.').pop();
    return `${timestamp}_${random}.${extension}`;
  }

  private async updateProcessingProgress(
    documentId: string,
    progress: number,
    message?: string
  ): Promise<void> {
    try {
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          processingProgress: progress,
          errorMessage: message,
        },
      });
    } catch (error) {
      logger.warn('Failed to update processing progress', {
        error: error.message,
        documentId,
        progress,
      });
    }
  }

  private async updateCollectionStats(tenantId: string): Promise<void> {
    try {
      const [documentCount, chunkCount] = await Promise.all([
        prisma.knowledgeDocument.count({
          where: { tenantId, status: 'COMPLETED' },
        }),
        prisma.documentChunk.count({ where: { tenantId } }),
      ]);

      await prisma.knowledgeCollection.update({
        where: { tenantId },
        data: {
          documentCount,
          totalChunks: chunkCount,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      logger.warn('Failed to update collection stats', {
        error: error.message,
        tenantId,
      });
    }
  }

  private async deleteDocumentData(documentId: string, tenantId: string): Promise<void> {
    // Delete chunks (will cascade delete from database)
    await prisma.documentChunk.deleteMany({
      where: { documentId },
    });

    // Delete vectors from Qdrant
    const collectionName = this.getCollectionName(tenantId);
    await this.vectorService.deleteVectorsByFilter(collectionName, {
      documentId,
    });
  }

  // Health check
  public async healthCheck(): Promise<{
    database: boolean;
    vectorDatabase: boolean;
    embedding: boolean;
  }> {
    try {
      const [dbHealth, vectorHealth, embeddingHealth] = await Promise.all([
        prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
        this.vectorService.healthCheck(),
        this.embeddingService.testEmbedding(),
      ]);

      return {
        database: dbHealth,
        vectorDatabase: vectorHealth,
        embedding: embeddingHealth,
      };
    } catch (error) {
      logger.error('Knowledge base health check failed', {
        error: error.message,
      });
      return {
        database: false,
        vectorDatabase: false,
        embedding: false,
      };
    }
  }
}
