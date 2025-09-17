import path from 'path';
// @ts-ignore - pdf-parse types may not be available
import pdfParse from 'pdf-parse';
// @ts-ignore - mammoth types may not be available
import mammoth from 'mammoth';
import { logger } from '../utils/logger';
import { sanitizeInput } from '../utils/sanitizer';

export interface DocumentChunk {
  content: string;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
  metadata?: Record<string, any>;
}

export interface ProcessedDocument {
  content: string;
  chunks: DocumentChunk[];
  metadata: {
    title?: string;
    author?: string;
    creationDate?: Date;
    pageCount?: number;
    wordCount: number;
    language?: string;
  };
  processingTime: number;
}

export interface ChunkingOptions {
  chunkSize: number;
  chunkOverlap: number;
  preserveParagraphs: boolean;
  minChunkSize: number;
  maxChunkSize: number;
}

export class DocumentProcessor {
  private defaultChunkingOptions: ChunkingOptions = {
    chunkSize: 1000, // tokens
    chunkOverlap: 200, // tokens
    preserveParagraphs: true,
    minChunkSize: 100,
    maxChunkSize: 2000,
  };

  // Process document from file buffer
  public async processDocument(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    options?: Partial<ChunkingOptions>
  ): Promise<ProcessedDocument> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting document processing', {
        filename,
        mimeType,
        size: buffer.length,
      });

      let content: string;
      let metadata: any = {};

      // Extract content based on file type
      switch (mimeType) {
        case 'application/pdf':
          const pdfResult = await this.processPDF(buffer);
          content = pdfResult.content;
          metadata = pdfResult.metadata;
          break;
          
        case 'application/msword':
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
          const docResult = await this.processWordDocument(buffer);
          content = docResult.content;
          metadata = docResult.metadata;
          break;
          
        case 'text/plain':
        case 'text/markdown':
        case 'application/json':
          content = buffer.toString('utf-8');
          metadata = this.extractTextMetadata(content, filename);
          break;
          
        default:
          throw new Error(`Unsupported document type: ${mimeType}`);
      }

      // Clean and sanitize content
      content = this.cleanContent(content);
      
      // Generate chunks
      const chunkingOpts = { ...this.defaultChunkingOptions, ...options };
      const chunks = await this.chunkDocument(content, chunkingOpts);

      // Calculate processing time
      const processingTime = Date.now() - startTime;

      const result: ProcessedDocument = {
        content,
        chunks,
        metadata: {
          ...metadata,
          wordCount: this.countWords(content),
        },
        processingTime,
      };

      logger.info('Document processing completed', {
        filename,
        contentLength: content.length,
        chunkCount: chunks.length,
        processingTime,
        wordCount: result.metadata.wordCount,
      });

      return result;
    } catch (error) {
      logger.error('Document processing failed', {
        error: (error as Error).message,
        filename,
        mimeType,
      });
      throw new Error(`Failed to process document: ${(error as Error).message}`);
    }
  }

  // Process PDF document
  private async processPDF(buffer: Buffer): Promise<{
    content: string;
    metadata: Record<string, any>;
  }> {
    try {
      const data = await pdfParse(buffer);
      
      return {
        content: data.text,
        metadata: {
          title: data.info?.Title || undefined,
          author: data.info?.Author || undefined,
          creationDate: data.info?.CreationDate ? new Date(data.info.CreationDate) : undefined,
          pageCount: data.numpages,
          producer: data.info?.Producer,
          creator: data.info?.Creator,
        },
      };
    } catch (error) {
      logger.error('PDF processing failed', { error: (error as Error).message });
      throw new Error(`Failed to process PDF: ${(error as Error).message}`);
    }
  }

  // Process Word document
  private async processWordDocument(buffer: Buffer): Promise<{
    content: string;
    metadata: Record<string, any>;
  }> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      
      return {
        content: result.value,
        metadata: {
          // Word documents don't provide easy metadata access through mammoth
          // Could be extended with other libraries for more metadata
        },
      };
    } catch (error) {
      logger.error('Word document processing failed', { error: (error as Error).message });
      throw new Error(`Failed to process Word document: ${(error as Error).message}`);
    }
  }

  // Extract metadata from text files
  private extractTextMetadata(content: string, filename: string): Record<string, any> {
    const metadata: Record<string, any> = {};
    
    // Try to detect language (simple heuristic)
    metadata.language = this.detectLanguage(content);
    
    // Extract title from filename or first line
    metadata.title = this.extractTitle(content, filename);
    
    return metadata;
  }

  // Clean and normalize content
  private cleanContent(content: string): string {
    // Remove excessive whitespace
    content = content.replace(/\s+/g, ' ');
    
    // Remove control characters except newlines and tabs
    content = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    // Normalize line endings
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Remove excessive newlines
    content = content.replace(/\n{3,}/g, '\n\n');
    
    // Sanitize content
    content = sanitizeInput(content);
    
    return content.trim();
  }

  // Chunk document into smaller pieces
  private async chunkDocument(
    content: string,
    options: ChunkingOptions
  ): Promise<DocumentChunk[]> {
    if (options.preserveParagraphs) {
      return this.chunkByParagraphs(content, options);
    } else {
      return this.chunkByTokens(content, options);
    }
  }

  // Chunk by paragraphs while respecting token limits
  private chunkByParagraphs(
    content: string,
    options: ChunkingOptions
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const paragraphs = content.split(/\n\s*\n/);
    
    let currentChunk = '';
    let currentTokenCount = 0;
    let chunkIndex = 0;
    let startOffset = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i].trim();
      if (!paragraph) continue;

      const paragraphTokens = this.estimateTokenCount(paragraph);
      
      // If adding this paragraph would exceed chunk size, finalize current chunk
      if (currentTokenCount + paragraphTokens > options.chunkSize && currentChunk) {
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIndex++,
          startOffset,
          endOffset: startOffset + currentChunk.length,
          tokenCount: currentTokenCount,
        });

        // Start new chunk with overlap
        const overlapContent = this.getOverlapContent(currentChunk, options.chunkOverlap);
        currentChunk = overlapContent + (overlapContent ? '\n\n' : '') + paragraph;
        currentTokenCount = this.estimateTokenCount(currentChunk);
        startOffset += currentChunk.length - overlapContent.length - (overlapContent ? 2 : 0);
      } else {
        // Add paragraph to current chunk
        if (currentChunk) {
          currentChunk += '\n\n' + paragraph;
        } else {
          currentChunk = paragraph;
        }
        currentTokenCount += paragraphTokens;
      }

      // Handle very large paragraphs
      if (paragraphTokens > options.maxChunkSize) {
        const subChunks = this.splitLargeParagraph(paragraph, options);
        chunks.push(...subChunks.map((chunk, idx) => ({
          ...chunk,
          chunkIndex: chunkIndex++,
          startOffset: startOffset + idx * chunk.content.length,
          endOffset: startOffset + (idx + 1) * chunk.content.length,
        })));
        currentChunk = '';
        currentTokenCount = 0;
        startOffset += paragraph.length;
      }
    }

    // Add final chunk
    if (currentChunk && currentTokenCount >= options.minChunkSize) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        startOffset,
        endOffset: startOffset + currentChunk.length,
        tokenCount: currentTokenCount,
      });
    }

    return chunks;
  }

  // Chunk by fixed token counts
  private chunkByTokens(
    content: string,
    options: ChunkingOptions
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const words = content.split(/\s+/);
    const tokensPerWord = 1.3; // Average tokens per word
    
    let currentChunk = '';
    let currentTokenCount = 0;
    let chunkIndex = 0;
    let wordIndex = 0;

    while (wordIndex < words.length) {
      const word = words[wordIndex];
      const wordTokens = Math.ceil(word.length / 4); // Rough estimation

      if (currentTokenCount + wordTokens > options.chunkSize && currentChunk) {
        // Finalize current chunk
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIndex++,
          startOffset: 0, // Would need more complex tracking for exact offsets
          endOffset: currentChunk.length,
          tokenCount: currentTokenCount,
        });

        // Start new chunk with overlap
        const overlapWords = Math.floor(options.chunkOverlap / tokensPerWord);
        const startIndex = Math.max(0, wordIndex - overlapWords);
        currentChunk = words.slice(startIndex, wordIndex + 1).join(' ');
        currentTokenCount = this.estimateTokenCount(currentChunk);
      } else {
        // Add word to current chunk
        if (currentChunk) {
          currentChunk += ' ' + word;
        } else {
          currentChunk = word;
        }
        currentTokenCount += wordTokens;
      }

      wordIndex++;
    }

    // Add final chunk
    if (currentChunk && currentTokenCount >= options.minChunkSize) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        startOffset: 0,
        endOffset: currentChunk.length,
        tokenCount: currentTokenCount,
      });
    }

    return chunks;
  }

  // Split large paragraphs that exceed max chunk size
  private splitLargeParagraph(
    paragraph: string,
    options: ChunkingOptions
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const sentences = paragraph.split(/[.!?]+/);
    
    let currentChunk = '';
    let currentTokenCount = 0;
    let chunkIndex = 0;

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) continue;

      const sentenceTokens = this.estimateTokenCount(trimmedSentence);
      
      if (currentTokenCount + sentenceTokens > options.chunkSize && currentChunk) {
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIndex++,
          startOffset: 0,
          endOffset: currentChunk.length,
          tokenCount: currentTokenCount,
        });

        currentChunk = trimmedSentence;
        currentTokenCount = sentenceTokens;
      } else {
        if (currentChunk) {
          currentChunk += '. ' + trimmedSentence;
        } else {
          currentChunk = trimmedSentence;
        }
        currentTokenCount += sentenceTokens;
      }
    }

    if (currentChunk) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        startOffset: 0,
        endOffset: currentChunk.length,
        tokenCount: currentTokenCount,
      });
    }

    return chunks;
  }

  // Get overlap content from the end of current chunk
  private getOverlapContent(content: string, overlapTokens: number): string {
    const words = content.split(/\s+/);
    const overlapWords = Math.floor(overlapTokens / 1.3); // Rough conversion
    
    if (overlapWords >= words.length) {
      return content;
    }
    
    return words.slice(-overlapWords).join(' ');
  }

  // Estimate token count for text
  private estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  // Count words in text
  private countWords(text: string): number {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }

  // Simple language detection
  private detectLanguage(content: string): string {
    // Very basic language detection - could be improved with proper libraries
    const sample = content.substring(0, 1000).toLowerCase();
    
    // English indicators
    if (/\b(the|and|or|but|in|on|at|to|for|of|with|by)\b/.test(sample)) {
      return 'en';
    }
    
    // Spanish indicators
    if (/\b(el|la|los|las|y|o|pero|en|con|por|para|de)\b/.test(sample)) {
      return 'es';
    }
    
    // French indicators
    if (/\b(le|la|les|et|ou|mais|dans|avec|par|pour|de)\b/.test(sample)) {
      return 'fr';
    }
    
    return 'unknown';
  }

  // Extract title from content or filename
  private extractTitle(content: string, filename: string): string {
    // Try to get title from first line
    const firstLine = content.split('\n')[0].trim();
    if (firstLine.length > 0 && firstLine.length < 200) {
      return firstLine;
    }
    
    // Fallback to filename without extension
    return path.basename(filename, path.extname(filename));
  }

  // Validate document before processing
  public validateDocument(buffer: Buffer, mimeType: string): {
    isValid: boolean;
    error?: string;
  } {
    // Check file size (max 50MB)
    if (buffer.length > 50 * 1024 * 1024) {
      return {
        isValid: false,
        error: 'Document size exceeds 50MB limit',
      };
    }

    // Check if buffer is not empty
    if (buffer.length === 0) {
      return {
        isValid: false,
        error: 'Document is empty',
      };
    }

    // Check supported MIME types
    const supportedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
      'application/json',
    ];

    if (!supportedTypes.includes(mimeType)) {
      return {
        isValid: false,
        error: `Unsupported document type: ${mimeType}`,
      };
    }

    return { isValid: true };
  }

  // Get processing statistics
  public getProcessingStats(): {
    supportedFormats: string[];
    maxFileSize: number;
    defaultChunkSize: number;
    defaultOverlap: number;
  } {
    return {
      supportedFormats: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'text/markdown',
        'application/json',
      ],
      maxFileSize: 50 * 1024 * 1024, // 50MB
      defaultChunkSize: this.defaultChunkingOptions.chunkSize,
      defaultOverlap: this.defaultChunkingOptions.chunkOverlap,
    };
  }
}
