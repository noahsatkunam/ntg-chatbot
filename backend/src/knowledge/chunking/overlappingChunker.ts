import { ChunkingOptions, ChunkingResult } from './chunkingService';
import { AppError } from '../../middlewares/errorHandler';

export class OverlappingChunker {
  /**
   * Chunk content with configurable overlap between chunks
   */
  async chunk(content: string, options: ChunkingOptions): Promise<ChunkingResult> {
    try {
      const chunks = [];
      let chunkIndex = 0;
      let currentOffset = 0;

      while (currentOffset < content.length) {
        const chunkResult = await this.createChunkWithOverlap(
          content,
          currentOffset,
          options,
          chunkIndex
        );

        if (!chunkResult) break;

        chunks.push(chunkResult.chunk);
        currentOffset = chunkResult.nextOffset;
        chunkIndex++;

        // Prevent infinite loops
        if (chunkResult.nextOffset <= currentOffset) {
          break;
        }
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
          strategy: 'overlapping',
          processingTime: 0
        }
      };
    } catch (error) {
      throw new AppError(`Overlapping chunking failed: ${error}`, 500);
    }
  }

  /**
   * Create a single chunk with proper overlap
   */
  private async createChunkWithOverlap(
    content: string,
    startOffset: number,
    options: ChunkingOptions,
    chunkIndex: number
  ): Promise<{ chunk: any; nextOffset: number } | null> {
    
    if (startOffset >= content.length) {
      return null;
    }

    // Extract content for this chunk
    let chunkContent = '';
    let currentTokens = 0;
    let endOffset = startOffset;

    // If respecting sentences, split by sentences
    if (options.respectSentences) {
      const remainingContent = content.slice(startOffset);
      const sentences = this.splitIntoSentences(remainingContent);
      
      for (const sentence of sentences) {
        const sentenceTokens = this.estimateTokenCount(sentence);
        
        if (currentTokens + sentenceTokens > options.chunkSize && chunkContent.length > 0) {
          break;
        }
        
        chunkContent += (chunkContent ? ' ' : '') + sentence;
        currentTokens += sentenceTokens;
        endOffset = startOffset + chunkContent.length;
      }
    } else if (options.respectParagraphs) {
      const remainingContent = content.slice(startOffset);
      const paragraphs = this.splitIntoParagraphs(remainingContent);
      
      for (const paragraph of paragraphs) {
        const paragraphTokens = this.estimateTokenCount(paragraph);
        
        if (currentTokens + paragraphTokens > options.chunkSize && chunkContent.length > 0) {
          break;
        }
        
        chunkContent += (chunkContent ? '\n\n' : '') + paragraph;
        currentTokens += paragraphTokens;
        endOffset = startOffset + chunkContent.length;
      }
    } else {
      // Simple character-based chunking
      const maxChars = options.chunkSize * 4; // Rough character estimate
      chunkContent = content.slice(startOffset, startOffset + maxChars);
      currentTokens = this.estimateTokenCount(chunkContent);
      endOffset = startOffset + chunkContent.length;
    }

    // Ensure we have some content
    if (chunkContent.trim().length === 0) {
      return null;
    }

    // Calculate next chunk start position with overlap
    const overlapChars = Math.floor(options.chunkOverlap * 4); // Convert tokens to chars
    let nextOffset = Math.max(
      startOffset + 1, // Ensure progress
      endOffset - overlapChars
    );

    // Adjust next offset to respect boundaries if configured
    if (options.respectSentences || options.respectParagraphs) {
      nextOffset = this.findOptimalOverlapBoundary(
        content,
        endOffset,
        overlapChars,
        options
      );
    }

    const chunk = {
      content: chunkContent.trim(),
      startOffset,
      endOffset,
      chunkIndex,
      tokenCount: currentTokens,
      metadata: {
        type: this.determineChunkType(chunkContent) as any,
        hasOverlap: chunkIndex > 0,
        overlapSize: chunkIndex > 0 ? this.calculateActualOverlap(content, startOffset, endOffset) : 0,
        structure: this.analyzeChunkStructure(chunkContent)
      }
    };

    return { chunk, nextOffset };
  }

  /**
   * Find optimal boundary for overlap that respects content structure
   */
  private findOptimalOverlapBoundary(
    content: string,
    endOffset: number,
    overlapChars: number,
    options: ChunkingOptions
  ): number {
    const targetOffset = endOffset - overlapChars;
    
    if (targetOffset <= 0) {
      return 0;
    }

    // Look for sentence boundaries near target offset
    if (options.respectSentences) {
      const searchStart = Math.max(0, targetOffset - 100);
      const searchEnd = Math.min(content.length, targetOffset + 100);
      const searchContent = content.slice(searchStart, searchEnd);
      
      const sentenceBoundaries = this.findSentenceBoundaries(searchContent);
      
      // Find closest sentence boundary to target
      let bestBoundary = targetOffset;
      let minDistance = Infinity;
      
      for (const boundary of sentenceBoundaries) {
        const absoluteBoundary = searchStart + boundary;
        const distance = Math.abs(absoluteBoundary - targetOffset);
        
        if (distance < minDistance) {
          minDistance = distance;
          bestBoundary = absoluteBoundary;
        }
      }
      
      return bestBoundary;
    }

    // Look for paragraph boundaries
    if (options.respectParagraphs) {
      const searchStart = Math.max(0, targetOffset - 200);
      const searchEnd = Math.min(content.length, targetOffset + 200);
      const searchContent = content.slice(searchStart, searchEnd);
      
      const paragraphBoundaries = this.findParagraphBoundaries(searchContent);
      
      let bestBoundary = targetOffset;
      let minDistance = Infinity;
      
      for (const boundary of paragraphBoundaries) {
        const absoluteBoundary = searchStart + boundary;
        const distance = Math.abs(absoluteBoundary - targetOffset);
        
        if (distance < minDistance) {
          minDistance = distance;
          bestBoundary = absoluteBoundary;
        }
      }
      
      return bestBoundary;
    }

    return targetOffset;
  }

  /**
   * Find sentence boundaries in text
   */
  private findSentenceBoundaries(text: string): number[] {
    const boundaries = [0];
    const sentenceRegex = /[.!?]+\s+/g;
    let match;

    while ((match = sentenceRegex.exec(text)) !== null) {
      boundaries.push(match.index + match[0].length);
    }

    return boundaries;
  }

  /**
   * Find paragraph boundaries in text
   */
  private findParagraphBoundaries(text: string): number[] {
    const boundaries = [0];
    const paragraphRegex = /\n\s*\n/g;
    let match;

    while ((match = paragraphRegex.exec(text)) !== null) {
      boundaries.push(match.index + match[0].length);
    }

    return boundaries;
  }

  /**
   * Calculate actual overlap between chunks
   */
  private calculateActualOverlap(content: string, startOffset: number, endOffset: number): number {
    // This would compare with previous chunk to calculate actual overlap
    // For now, return estimated overlap
    return 0;
  }

  /**
   * Split content into sentences
   */
  private splitIntoSentences(content: string): string[] {
    const sentences = [];
    const parts = content.split(/([.!?]+(?:\s|$))/);
    
    let currentSentence = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      
      if (/[.!?]+(?:\s|$)/.test(part)) {
        currentSentence += part;
        if (currentSentence.trim().length > 0) {
          sentences.push(currentSentence.trim());
          currentSentence = '';
        }
      } else {
        currentSentence += part;
      }
    }
    
    if (currentSentence.trim().length > 0) {
      sentences.push(currentSentence.trim());
    }

    return sentences.filter(s => s.length > 0);
  }

  /**
   * Split content into paragraphs
   */
  private splitIntoParagraphs(content: string): string[] {
    return content
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  /**
   * Determine chunk type based on content
   */
  private determineChunkType(content: string): string {
    const trimmed = content.trim();

    if (/^#{1,6}\s+/.test(trimmed)) return 'heading';
    if (/^\s*[-*+]\s+|^\s*\d+\.\s+/.test(trimmed)) return 'list';
    if (/^```|^\s{4,}/.test(trimmed)) return 'code';
    if (/\|.*\|/.test(trimmed)) return 'table';
    
    return 'paragraph';
  }

  /**
   * Analyze chunk structure
   */
  private analyzeChunkStructure(content: string): any {
    return {
      sentences: this.splitIntoSentences(content).length,
      paragraphs: this.splitIntoParagraphs(content).length,
      hasQuestions: /\?/.test(content),
      hasEmphasis: /\*\*.*\*\*|\*.*\*/.test(content),
      hasLinks: /https?:\/\/|www\./.test(content),
      hasNumbers: /\d+/.test(content)
    };
  }

  /**
   * Post-process chunks to ensure quality
   */
  private async postProcessChunks(chunks: any[], options: ChunkingOptions): Promise<any[]> {
    const processedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Validate chunk size
      if (chunk.tokenCount < options.minChunkSize && i < chunks.length - 1) {
        // Try to extend chunk by reducing overlap with next chunk
        const nextChunk = chunks[i + 1];
        const additionalContent = this.getAdditionalContent(
          chunk,
          nextChunk,
          options.minChunkSize - chunk.tokenCount
        );

        if (additionalContent) {
          chunk.content += ' ' + additionalContent;
          chunk.tokenCount = this.estimateTokenCount(chunk.content);
          chunk.endOffset += additionalContent.length;
        }
      }

      // Handle oversized chunks
      if (chunk.tokenCount > options.maxChunkSize) {
        const subChunks = await this.splitOversizedChunk(chunk, options);
        processedChunks.push(...subChunks);
      } else {
        processedChunks.push(chunk);
      }
    }

    // Re-index and calculate overlaps
    for (let i = 0; i < processedChunks.length; i++) {
      processedChunks[i].chunkIndex = i;
      
      if (i > 0) {
        processedChunks[i].metadata.actualOverlap = this.calculateOverlapBetweenChunks(
          processedChunks[i - 1],
          processedChunks[i]
        );
      }
    }

    return processedChunks;
  }

  /**
   * Get additional content to meet minimum chunk size
   */
  private getAdditionalContent(currentChunk: any, nextChunk: any, neededTokens: number): string | null {
    const overlapStart = Math.max(currentChunk.endOffset, nextChunk.startOffset);
    const maxAdditional = Math.min(neededTokens * 4, nextChunk.content.length / 2);
    
    if (maxAdditional <= 0) return null;
    
    return nextChunk.content.slice(0, maxAdditional);
  }

  /**
   * Split oversized chunk into smaller pieces
   */
  private async splitOversizedChunk(chunk: any, options: ChunkingOptions): Promise<any[]> {
    const subChunks = [];
    const sentences = this.splitIntoSentences(chunk.content);
    
    let currentContent = '';
    let currentTokens = 0;

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokenCount(sentence);
      
      if (currentTokens + sentenceTokens > options.chunkSize && currentContent.length > 0) {
        subChunks.push({
          ...chunk,
          content: currentContent.trim(),
          tokenCount: currentTokens,
          metadata: {
            ...chunk.metadata,
            isSubChunk: true,
            parentChunk: chunk.chunkIndex,
            subChunkIndex: subChunks.length
          }
        });

        currentContent = sentence;
        currentTokens = sentenceTokens;
      } else {
        currentContent += (currentContent ? ' ' : '') + sentence;
        currentTokens += sentenceTokens;
      }
    }

    if (currentContent.trim().length > 0) {
      subChunks.push({
        ...chunk,
        content: currentContent.trim(),
        tokenCount: currentTokens,
        metadata: {
          ...chunk.metadata,
          isSubChunk: true,
          parentChunk: chunk.chunkIndex,
          subChunkIndex: subChunks.length
        }
      });
    }

    return subChunks;
  }

  /**
   * Calculate overlap between two adjacent chunks
   */
  private calculateOverlapBetweenChunks(chunk1: any, chunk2: any): number {
    const overlap1End = Math.min(chunk1.endOffset, chunk2.endOffset);
    const overlap2Start = Math.max(chunk1.startOffset, chunk2.startOffset);
    
    return Math.max(0, overlap1End - overlap2Start);
  }

  /**
   * Estimate token count
   */
  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Analyze overlap quality and effectiveness
   */
  async analyzeOverlapQuality(chunks: any[]): Promise<{
    averageOverlap: number;
    overlapConsistency: number;
    contextPreservation: number;
    qualityScore: number;
  }> {
    if (chunks.length < 2) {
      return {
        averageOverlap: 0,
        overlapConsistency: 1,
        contextPreservation: 1,
        qualityScore: 1
      };
    }

    const overlaps = [];
    for (let i = 1; i < chunks.length; i++) {
      const overlap = chunks[i].metadata.actualOverlap || 0;
      overlaps.push(overlap);
    }

    const averageOverlap = overlaps.reduce((sum, o) => sum + o, 0) / overlaps.length;
    
    // Calculate consistency (lower variance = higher consistency)
    const variance = overlaps.reduce((sum, o) => sum + Math.pow(o - averageOverlap, 2), 0) / overlaps.length;
    const overlapConsistency = Math.max(0, 1 - (variance / (averageOverlap + 1)));

    // Estimate context preservation (simplified)
    const contextPreservation = Math.min(1, averageOverlap / 100);

    // Overall quality score
    const qualityScore = (overlapConsistency + contextPreservation) / 2;

    return {
      averageOverlap,
      overlapConsistency,
      contextPreservation,
      qualityScore
    };
  }

  /**
   * Optimize overlap size based on content analysis
   */
  async optimizeOverlapSize(content: string, baseOverlap: number): Promise<number> {
    const sentences = this.splitIntoSentences(content);
    const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
    
    // Adjust overlap based on sentence length
    if (avgSentenceLength > 100) {
      return Math.max(baseOverlap, avgSentenceLength * 1.5);
    } else if (avgSentenceLength < 50) {
      return Math.max(baseOverlap, avgSentenceLength * 3);
    }
    
    return baseOverlap;
  }
}
