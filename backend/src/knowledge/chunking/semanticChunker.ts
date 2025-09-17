import { ChunkingOptions, ChunkingResult } from './chunkingService';
import { AppError } from '../../middlewares/errorHandler';

export class SemanticChunker {
  /**
   * Chunk content using semantic boundaries
   */
  async chunk(content: string, options: ChunkingOptions): Promise<ChunkingResult> {
    try {
      const chunks = [];
      let currentOffset = 0;
      let chunkIndex = 0;

      // Split content into sentences for semantic analysis
      const sentences = this.splitIntoSentences(content);
      const sentenceOffsets = this.calculateSentenceOffsets(content, sentences);

      let currentChunk = '';
      let currentChunkStart = 0;
      let currentTokenCount = 0;

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const sentenceTokens = this.estimateTokenCount(sentence);

        // Check if adding this sentence would exceed chunk size
        if (currentTokenCount + sentenceTokens > options.chunkSize && currentChunk.length > 0) {
          // Finalize current chunk
          const chunk = {
            content: currentChunk.trim(),
            startOffset: currentChunkStart,
            endOffset: sentenceOffsets[i - 1].end,
            chunkIndex: chunkIndex++,
            tokenCount: currentTokenCount,
            metadata: {
              type: this.determineChunkType(currentChunk) as any,
              structure: this.analyzeChunkStructure(currentChunk)
            }
          };

          chunks.push(chunk);

          // Start new chunk with overlap if configured
          if (options.chunkOverlap > 0) {
            const overlapContent = this.getOverlapContent(sentences, i, options.chunkOverlap);
            currentChunk = overlapContent + ' ' + sentence;
            currentChunkStart = sentenceOffsets[Math.max(0, i - Math.floor(options.chunkOverlap / 100))].start;
            currentTokenCount = this.estimateTokenCount(currentChunk);
          } else {
            currentChunk = sentence;
            currentChunkStart = sentenceOffsets[i].start;
            currentTokenCount = sentenceTokens;
          }
        } else {
          // Add sentence to current chunk
          if (currentChunk.length === 0) {
            currentChunk = sentence;
            currentChunkStart = sentenceOffsets[i].start;
          } else {
            currentChunk += ' ' + sentence;
          }
          currentTokenCount += sentenceTokens;
        }
      }

      // Add final chunk if it has content
      if (currentChunk.trim().length > 0) {
        chunks.push({
          content: currentChunk.trim(),
          startOffset: currentChunkStart,
          endOffset: content.length,
          chunkIndex: chunkIndex++,
          tokenCount: currentTokenCount,
          metadata: {
            type: this.determineChunkType(currentChunk) as any,
            structure: this.analyzeChunkStructure(currentChunk)
          }
        });
      }

      // Post-process chunks to ensure quality
      const processedChunks = await this.postProcessChunks(chunks, options);

      return {
        chunks: processedChunks,
        metadata: {
          totalChunks: processedChunks.length,
          totalTokens: processedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
          averageChunkSize: processedChunks.length > 0 
            ? processedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / processedChunks.length 
            : 0,
          strategy: 'semantic',
          processingTime: 0
        }
      };
    } catch (error) {
      throw new AppError(`Semantic chunking failed: ${error}`, 500);
    }
  }

  /**
   * Split content into sentences using multiple delimiters
   */
  private splitIntoSentences(content: string): string[] {
    // Enhanced sentence splitting that handles various cases
    const sentences = [];
    
    // Split on sentence endings, but preserve them
    const parts = content.split(/([.!?]+(?:\s|$))/);
    
    let currentSentence = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      
      if (/[.!?]+(?:\s|$)/.test(part)) {
        // This is a sentence ending
        currentSentence += part;
        if (currentSentence.trim().length > 0) {
          sentences.push(currentSentence.trim());
          currentSentence = '';
        }
      } else {
        // This is sentence content
        currentSentence += part;
      }
    }
    
    // Add any remaining content
    if (currentSentence.trim().length > 0) {
      sentences.push(currentSentence.trim());
    }

    return sentences.filter(s => s.length > 0);
  }

  /**
   * Calculate byte offsets for each sentence
   */
  private calculateSentenceOffsets(content: string, sentences: string[]): Array<{start: number, end: number}> {
    const offsets = [];
    let currentOffset = 0;

    for (const sentence of sentences) {
      const start = content.indexOf(sentence, currentOffset);
      const end = start + sentence.length;
      offsets.push({ start, end });
      currentOffset = end;
    }

    return offsets;
  }

  /**
   * Get overlap content from previous sentences
   */
  private getOverlapContent(sentences: string[], currentIndex: number, overlapSize: number): string {
    const overlapSentences = [];
    let totalLength = 0;
    
    // Work backwards from current sentence to get overlap
    for (let i = currentIndex - 1; i >= 0 && totalLength < overlapSize; i--) {
      const sentence = sentences[i];
      if (totalLength + sentence.length <= overlapSize) {
        overlapSentences.unshift(sentence);
        totalLength += sentence.length;
      } else {
        break;
      }
    }

    return overlapSentences.join(' ');
  }

  /**
   * Determine the type of content in a chunk
   */
  private determineChunkType(content: string): string {
    const trimmed = content.trim();

    // Check for headings
    if (/^#{1,6}\s+/.test(trimmed) || /^.+\n[=-]+/.test(trimmed)) {
      return 'heading';
    }

    // Check for lists
    if (/^\s*[-*+]\s+|^\s*\d+\.\s+/.test(trimmed)) {
      return 'list';
    }

    // Check for code blocks
    if (/^```|^\s{4,}/.test(trimmed)) {
      return 'code';
    }

    // Check for tables
    if (/\|.*\|/.test(trimmed)) {
      return 'table';
    }

    // Default to paragraph
    return 'paragraph';
  }

  /**
   * Analyze the structure within a chunk
   */
  private analyzeChunkStructure(content: string): any {
    const structure: any = {};

    // Count sentences
    structure.sentences = this.splitIntoSentences(content).length;

    // Check for questions
    structure.hasQuestions = /\?/.test(content);

    // Check for emphasis
    structure.hasEmphasis = /\*\*.*\*\*|\*.*\*|__.*__|_.*_/.test(content);

    // Check for links
    structure.hasLinks = /https?:\/\/|www\.|\.com|\.org/.test(content);

    // Check for numbers/statistics
    structure.hasNumbers = /\d+%|\d+\.\d+|\$\d+/.test(content);

    return structure;
  }

  /**
   * Post-process chunks to ensure quality and consistency
   */
  private async postProcessChunks(
    chunks: any[], 
    options: ChunkingOptions
  ): Promise<any[]> {
    const processedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Skip chunks that are too small
      if (chunk.tokenCount < options.minChunkSize) {
        // Try to merge with next chunk if possible
        if (i < chunks.length - 1) {
          const nextChunk = chunks[i + 1];
          if (chunk.tokenCount + nextChunk.tokenCount <= options.maxChunkSize) {
            // Merge chunks
            nextChunk.content = chunk.content + ' ' + nextChunk.content;
            nextChunk.startOffset = chunk.startOffset;
            nextChunk.tokenCount = chunk.tokenCount + nextChunk.tokenCount;
            continue; // Skip current chunk as it's merged
          }
        }
        
        // If can't merge and chunk is too small, still include it
        // but mark it in metadata
        chunk.metadata.isTooSmall = true;
      }

      // Ensure chunk doesn't exceed maximum size
      if (chunk.tokenCount > options.maxChunkSize) {
        // Split large chunk further
        const subChunks = await this.splitLargeChunk(chunk, options);
        processedChunks.push(...subChunks);
      } else {
        processedChunks.push(chunk);
      }
    }

    // Re-index chunks
    processedChunks.forEach((chunk, index) => {
      chunk.chunkIndex = index;
    });

    return processedChunks;
  }

  /**
   * Split a chunk that's too large into smaller chunks
   */
  private async splitLargeChunk(chunk: any, options: ChunkingOptions): Promise<any[]> {
    const sentences = this.splitIntoSentences(chunk.content);
    const subChunks = [];
    
    let currentContent = '';
    let currentTokens = 0;
    let startOffset = chunk.startOffset;

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokenCount(sentence);
      
      if (currentTokens + sentenceTokens > options.chunkSize && currentContent.length > 0) {
        // Create sub-chunk
        subChunks.push({
          content: currentContent.trim(),
          startOffset,
          endOffset: startOffset + currentContent.length,
          chunkIndex: chunk.chunkIndex,
          tokenCount: currentTokens,
          metadata: {
            ...chunk.metadata,
            isSubChunk: true,
            parentChunk: chunk.chunkIndex
          }
        });

        currentContent = sentence;
        currentTokens = sentenceTokens;
        startOffset = startOffset + currentContent.length;
      } else {
        currentContent += (currentContent ? ' ' : '') + sentence;
        currentTokens += sentenceTokens;
      }
    }

    // Add final sub-chunk
    if (currentContent.trim().length > 0) {
      subChunks.push({
        content: currentContent.trim(),
        startOffset,
        endOffset: chunk.endOffset,
        chunkIndex: chunk.chunkIndex,
        tokenCount: currentTokens,
        metadata: {
          ...chunk.metadata,
          isSubChunk: true,
          parentChunk: chunk.chunkIndex
        }
      });
    }

    return subChunks;
  }

  /**
   * Estimate token count for text
   */
  private estimateTokenCount(text: string): number {
    // More accurate token estimation
    // Roughly 4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Check semantic similarity between sentences
   */
  private async calculateSemanticSimilarity(sentence1: string, sentence2: string): Promise<number> {
    // This would integrate with embedding service for actual semantic similarity
    // For now, use simple word overlap as approximation
    const words1 = new Set(sentence1.toLowerCase().split(/\s+/));
    const words2 = new Set(sentence2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  /**
   * Find optimal sentence boundaries for chunks
   */
  private async findOptimalBoundaries(
    sentences: string[], 
    targetSize: number
  ): Promise<number[]> {
    const boundaries = [0];
    let currentSize = 0;
    let currentStart = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentenceSize = this.estimateTokenCount(sentences[i]);
      
      if (currentSize + sentenceSize > targetSize && i > currentStart) {
        // Find best boundary point
        let bestBoundary = i;
        let bestScore = 0;

        // Look back a few sentences to find semantic boundary
        for (let j = Math.max(currentStart + 1, i - 3); j <= i; j++) {
          const similarity = await this.calculateSemanticSimilarity(
            sentences[j - 1], 
            sentences[j]
          );
          
          // Lower similarity indicates better boundary
          const score = 1 - similarity;
          if (score > bestScore) {
            bestScore = score;
            bestBoundary = j;
          }
        }

        boundaries.push(bestBoundary);
        currentStart = bestBoundary;
        currentSize = sentenceSize;
      } else {
        currentSize += sentenceSize;
      }
    }

    // Add final boundary
    if (boundaries[boundaries.length - 1] !== sentences.length) {
      boundaries.push(sentences.length);
    }

    return boundaries;
  }
}
