import { ChunkingOptions, ChunkingResult } from './chunkingService';
import { AppError } from '../../middlewares/errorHandler';

interface DocumentStructure {
  headings: Array<{
    level: number;
    text: string;
    startOffset: number;
    endOffset: number;
  }>;
  sections: Array<{
    heading?: any;
    content: string;
    startOffset: number;
    endOffset: number;
    level: number;
  }>;
}

export class HierarchicalChunker {
  /**
   * Chunk content respecting document hierarchy
   */
  async chunk(
    content: string, 
    options: ChunkingOptions, 
    documentMetadata?: any
  ): Promise<ChunkingResult> {
    try {
      // Parse document structure
      const structure = this.parseDocumentStructure(content);
      
      // Create chunks based on hierarchy
      const chunks = await this.createHierarchicalChunks(content, structure, options);
      
      // Post-process to ensure size constraints
      const processedChunks = await this.enforceChunkSizeConstraints(chunks, options);

      return {
        chunks: processedChunks,
        metadata: {
          totalChunks: processedChunks.length,
          totalTokens: processedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
          averageChunkSize: processedChunks.length > 0 
            ? processedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / processedChunks.length 
            : 0,
          strategy: 'hierarchical',
          processingTime: 0
        }
      };
    } catch (error) {
      throw new AppError(`Hierarchical chunking failed: ${error}`, 500);
    }
  }

  /**
   * Parse document structure to identify headings and sections
   */
  private parseDocumentStructure(content: string): DocumentStructure {
    const headings: any[] = [];
    const sections: any[] = [];
    
    // Find markdown headings
    const markdownHeadingRegex = /^(#{1,6})\s+(.+)$/gm;
    let match;
    
    while ((match = markdownHeadingRegex.exec(content)) !== null) {
      const level = match[1].length;
      const text = match[2].trim();
      const startOffset = match.index;
      const endOffset = match.index + match[0].length;
      
      headings.push({
        level,
        text,
        startOffset,
        endOffset
      });
    }

    // Find underlined headings (Setext-style)
    const setextHeadingRegex = /^(.+)\n([=-]+)\n/gm;
    while ((match = setextHeadingRegex.exec(content)) !== null) {
      const text = match[1].trim();
      const underline = match[2];
      const level = underline[0] === '=' ? 1 : 2;
      const startOffset = match.index;
      const endOffset = match.index + match[0].length;
      
      headings.push({
        level,
        text,
        startOffset,
        endOffset
      });
    }

    // Sort headings by position
    headings.sort((a, b) => a.startOffset - b.startOffset);

    // Create sections based on headings
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      const nextHeading = headings[i + 1];
      
      const sectionStart = heading.endOffset;
      const sectionEnd = nextHeading ? nextHeading.startOffset : content.length;
      const sectionContent = content.slice(sectionStart, sectionEnd).trim();
      
      if (sectionContent.length > 0) {
        sections.push({
          heading,
          content: sectionContent,
          startOffset: sectionStart,
          endOffset: sectionEnd,
          level: heading.level
        });
      }
    }

    // If no headings found, treat entire content as one section
    if (sections.length === 0) {
      sections.push({
        content: content.trim(),
        startOffset: 0,
        endOffset: content.length,
        level: 0
      });
    }

    return { headings, sections };
  }

  /**
   * Create chunks based on document hierarchy
   */
  private async createHierarchicalChunks(
    content: string,
    structure: DocumentStructure,
    options: ChunkingOptions
  ): Promise<any[]> {
    const chunks = [];
    let chunkIndex = 0;

    for (const section of structure.sections) {
      const sectionChunks = await this.chunkSection(section, options, chunkIndex);
      chunks.push(...sectionChunks);
      chunkIndex += sectionChunks.length;
    }

    return chunks;
  }

  /**
   * Chunk a single section
   */
  private async chunkSection(section: any, options: ChunkingOptions, startIndex: number): Promise<any[]> {
    const chunks = [];
    const sectionTokens = this.estimateTokenCount(section.content);

    // If section fits in one chunk, return as single chunk
    if (sectionTokens <= options.chunkSize) {
      const chunkContent = section.heading 
        ? `${section.heading.text}\n\n${section.content}`
        : section.content;

      chunks.push({
        content: chunkContent,
        startOffset: section.heading ? section.heading.startOffset : section.startOffset,
        endOffset: section.endOffset,
        chunkIndex: startIndex,
        tokenCount: this.estimateTokenCount(chunkContent),
        metadata: {
          type: 'section' as any,
          level: section.level,
          title: section.heading?.text,
          structure: {
            hasHeading: !!section.heading,
            sectionLevel: section.level
          }
        }
      });

      return chunks;
    }

    // Section is too large, need to split it
    return await this.splitLargeSection(section, options, startIndex);
  }

  /**
   * Split a large section into smaller chunks
   */
  private async splitLargeSection(section: any, options: ChunkingOptions, startIndex: number): Promise<any[]> {
    const chunks = [];
    
    // Split section content into paragraphs
    const paragraphs = this.splitIntoParagraphs(section.content);
    
    let currentChunk = '';
    let currentTokens = 0;
    let chunkStartOffset = section.startOffset;
    let chunkIndex = startIndex;

    // Include heading in first chunk if present
    if (section.heading) {
      currentChunk = `${section.heading.text}\n\n`;
      currentTokens = this.estimateTokenCount(currentChunk);
      chunkStartOffset = section.heading.startOffset;
    }

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];
      const paragraphTokens = this.estimateTokenCount(paragraph);

      // Check if adding this paragraph would exceed chunk size
      if (currentTokens + paragraphTokens > options.chunkSize && currentChunk.trim().length > 0) {
        // Finalize current chunk
        chunks.push({
          content: currentChunk.trim(),
          startOffset: chunkStartOffset,
          endOffset: this.calculateEndOffset(section, currentChunk),
          chunkIndex: chunkIndex++,
          tokenCount: currentTokens,
          metadata: {
            type: 'section' as any,
            level: section.level,
            title: section.heading?.text,
            structure: {
              hasHeading: section.heading && chunkIndex === startIndex,
              sectionLevel: section.level,
              isPartial: true,
              partIndex: chunkIndex - startIndex
            }
          }
        });

        // Start new chunk with overlap if configured
        if (options.chunkOverlap > 0 && options.preserveStructure) {
          const overlapContent = this.getContextualOverlap(paragraphs, i, options.chunkOverlap);
          currentChunk = overlapContent + paragraph;
          currentTokens = this.estimateTokenCount(currentChunk);
        } else {
          currentChunk = paragraph;
          currentTokens = paragraphTokens;
        }
        
        chunkStartOffset = this.calculateStartOffset(section, currentChunk);
      } else {
        // Add paragraph to current chunk
        if (currentChunk.trim().length === 0) {
          currentChunk = paragraph;
        } else {
          currentChunk += '\n\n' + paragraph;
        }
        currentTokens += paragraphTokens;
      }
    }

    // Add final chunk if it has content
    if (currentChunk.trim().length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        startOffset: chunkStartOffset,
        endOffset: section.endOffset,
        chunkIndex: chunkIndex++,
        tokenCount: currentTokens,
        metadata: {
          type: 'section' as any,
          level: section.level,
          title: section.heading?.text,
          structure: {
            hasHeading: section.heading && chunks.length === 0,
            sectionLevel: section.level,
            isPartial: chunks.length > 0,
            partIndex: chunks.length
          }
        }
      });
    }

    return chunks;
  }

  /**
   * Split content into paragraphs
   */
  private splitIntoParagraphs(content: string): string[] {
    // Split on double newlines, but preserve single newlines within paragraphs
    return content
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  /**
   * Get contextual overlap that preserves meaning
   */
  private getContextualOverlap(paragraphs: string[], currentIndex: number, overlapSize: number): string {
    const overlapParagraphs = [];
    let totalLength = 0;
    
    // Work backwards to get meaningful context
    for (let i = currentIndex - 1; i >= 0 && totalLength < overlapSize; i--) {
      const paragraph = paragraphs[i];
      if (totalLength + paragraph.length <= overlapSize) {
        overlapParagraphs.unshift(paragraph);
        totalLength += paragraph.length;
      } else {
        // Take partial paragraph if it provides important context
        const remainingSpace = overlapSize - totalLength;
        if (remainingSpace > 100) { // Only if we have meaningful space
          const sentences = this.splitIntoSentences(paragraph);
          for (let j = sentences.length - 1; j >= 0; j--) {
            if (totalLength + sentences[j].length <= overlapSize) {
              overlapParagraphs.unshift(sentences[j]);
              totalLength += sentences[j].length;
            }
          }
        }
        break;
      }
    }

    return overlapParagraphs.join('\n\n') + (overlapParagraphs.length > 0 ? '\n\n' : '');
  }

  /**
   * Enforce chunk size constraints
   */
  private async enforceChunkSizeConstraints(chunks: any[], options: ChunkingOptions): Promise<any[]> {
    const processedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Handle chunks that are too small
      if (chunk.tokenCount < options.minChunkSize) {
        // Try to merge with next chunk if they're from the same section
        if (i < chunks.length - 1) {
          const nextChunk = chunks[i + 1];
          const canMerge = this.canMergeChunks(chunk, nextChunk, options);
          
          if (canMerge && chunk.tokenCount + nextChunk.tokenCount <= options.maxChunkSize) {
            // Merge chunks
            nextChunk.content = chunk.content + '\n\n' + nextChunk.content;
            nextChunk.startOffset = chunk.startOffset;
            nextChunk.tokenCount = chunk.tokenCount + nextChunk.tokenCount;
            nextChunk.metadata.isMerged = true;
            continue; // Skip current chunk as it's merged
          }
        }
      }

      // Handle chunks that are too large
      if (chunk.tokenCount > options.maxChunkSize) {
        const subChunks = await this.splitOversizedChunk(chunk, options);
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
   * Check if two chunks can be merged
   */
  private canMergeChunks(chunk1: any, chunk2: any, options: ChunkingOptions): boolean {
    // Can merge if they're from the same section and level
    return chunk1.metadata.level === chunk2.metadata.level &&
           chunk1.metadata.title === chunk2.metadata.title;
  }

  /**
   * Split an oversized chunk
   */
  private async splitOversizedChunk(chunk: any, options: ChunkingOptions): Promise<any[]> {
    const sentences = this.splitIntoSentences(chunk.content);
    const subChunks = [];
    
    let currentContent = '';
    let currentTokens = 0;

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokenCount(sentence);
      
      if (currentTokens + sentenceTokens > options.chunkSize && currentContent.length > 0) {
        // Create sub-chunk
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

    // Add final sub-chunk
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
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    return text
      .split(/[.!?]+\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Estimate token count
   */
  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate end offset for chunk content
   */
  private calculateEndOffset(section: any, chunkContent: string): number {
    // This is a simplified calculation
    return section.startOffset + chunkContent.length;
  }

  /**
   * Calculate start offset for chunk content
   */
  private calculateStartOffset(section: any, chunkContent: string): number {
    // This is a simplified calculation
    return section.startOffset;
  }

  /**
   * Analyze hierarchical structure quality
   */
  async analyzeStructureQuality(content: string): Promise<{
    hasHeadings: boolean;
    headingLevels: number[];
    averageSectionLength: number;
    structureScore: number;
  }> {
    const structure = this.parseDocumentStructure(content);
    
    const hasHeadings = structure.headings.length > 0;
    const headingLevels = [...new Set(structure.headings.map(h => h.level))].sort();
    const averageSectionLength = structure.sections.length > 0
      ? structure.sections.reduce((sum, s) => sum + s.content.length, 0) / structure.sections.length
      : 0;

    // Calculate structure score (0-1, higher is better)
    let structureScore = 0;
    if (hasHeadings) {
      structureScore += 0.4;
      
      // Bonus for proper heading hierarchy
      if (headingLevels.length > 1) {
        structureScore += 0.3;
      }
      
      // Bonus for consistent section lengths
      if (averageSectionLength > 100 && averageSectionLength < 2000) {
        structureScore += 0.3;
      }
    }

    return {
      hasHeadings,
      headingLevels,
      averageSectionLength,
      structureScore
    };
  }
}
