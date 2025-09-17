import { AppError } from '../../middlewares/errorHandler';

export interface DocumentMetadata {
  structure: {
    headings: Array<{
      level: number;
      text: string;
      position: number;
    }>;
    sections: Array<{
      title?: string;
      content: string;
      level: number;
      startOffset: number;
      endOffset: number;
    }>;
    lists: Array<{
      type: 'ordered' | 'unordered';
      items: string[];
      position: number;
    }>;
    tables: Array<{
      headers: string[];
      rows: string[][];
      position: number;
    }>;
    codeBlocks: Array<{
      language?: string;
      content: string;
      position: number;
    }>;
  };
  content: {
    language?: string;
    wordCount: number;
    sentenceCount: number;
    paragraphCount: number;
    readingTime: number;
    complexity: number;
  };
  formatting: {
    hasEmphasis: boolean;
    hasLinks: boolean;
    hasImages: boolean;
    hasQuotes: boolean;
    hasFootnotes: boolean;
  };
  quality: {
    completeness: number;
    coherence: number;
    readability: number;
    structureScore: number;
  };
}

export class MetadataExtractor {
  /**
   * Extract comprehensive metadata from document content
   */
  async extractMetadata(content: string): Promise<DocumentMetadata> {
    try {
      const metadata: DocumentMetadata = {
        structure: {
          headings: [],
          sections: [],
          lists: [],
          tables: [],
          codeBlocks: []
        },
        content: {
          wordCount: 0,
          sentenceCount: 0,
          paragraphCount: 0,
          readingTime: 0,
          complexity: 0
        },
        formatting: {
          hasEmphasis: false,
          hasLinks: false,
          hasImages: false,
          hasQuotes: false,
          hasFootnotes: false
        },
        quality: {
          completeness: 0,
          coherence: 0,
          readability: 0,
          structureScore: 0
        }
      };

      // Extract structural elements
      await this.extractStructuralElements(content, metadata);
      
      // Analyze content characteristics
      await this.analyzeContentCharacteristics(content, metadata);
      
      // Detect formatting elements
      await this.detectFormattingElements(content, metadata);
      
      // Calculate quality metrics
      await this.calculateQualityMetrics(content, metadata);

      return metadata;
    } catch (error) {
      throw new AppError(`Failed to extract metadata: ${error}`, 500);
    }
  }

  /**
   * Extract structural elements like headings, lists, tables
   */
  private async extractStructuralElements(content: string, metadata: DocumentMetadata): Promise<void> {
    // Extract headings
    await this.extractHeadings(content, metadata);
    
    // Extract lists
    await this.extractLists(content, metadata);
    
    // Extract tables
    await this.extractTables(content, metadata);
    
    // Extract code blocks
    await this.extractCodeBlocks(content, metadata);
    
    // Create sections based on headings
    await this.createSections(content, metadata);
  }

  /**
   * Extract headings from content
   */
  private async extractHeadings(content: string, metadata: DocumentMetadata): Promise<void> {
    // Markdown-style headings
    const markdownHeadingRegex = /^(#{1,6})\s+(.+)$/gm;
    let match;

    while ((match = markdownHeadingRegex.exec(content)) !== null) {
      metadata.structure.headings.push({
        level: match[1].length,
        text: match[2].trim(),
        position: match.index
      });
    }

    // Setext-style headings
    const setextRegex = /^(.+)\n([=-]+)$/gm;
    while ((match = setextRegex.exec(content)) !== null) {
      const level = match[2][0] === '=' ? 1 : 2;
      metadata.structure.headings.push({
        level,
        text: match[1].trim(),
        position: match.index
      });
    }

    // Sort headings by position
    metadata.structure.headings.sort((a, b) => a.position - b.position);
  }

  /**
   * Extract lists from content
   */
  private async extractLists(content: string, metadata: DocumentMetadata): Promise<void> {
    // Unordered lists
    const unorderedListRegex = /^(\s*[-*+]\s+.+(?:\n\s*[-*+]\s+.+)*)/gm;
    let match;

    while ((match = unorderedListRegex.exec(content)) !== null) {
      const listContent = match[1];
      const items = listContent
        .split(/\n\s*[-*+]\s+/)
        .map(item => item.trim())
        .filter(item => item.length > 0);

      if (items.length > 0) {
        metadata.structure.lists.push({
          type: 'unordered',
          items,
          position: match.index
        });
      }
    }

    // Ordered lists
    const orderedListRegex = /^(\s*\d+\.\s+.+(?:\n\s*\d+\.\s+.+)*)/gm;
    while ((match = orderedListRegex.exec(content)) !== null) {
      const listContent = match[1];
      const items = listContent
        .split(/\n\s*\d+\.\s+/)
        .map(item => item.trim())
        .filter(item => item.length > 0);

      if (items.length > 0) {
        metadata.structure.lists.push({
          type: 'ordered',
          items,
          position: match.index
        });
      }
    }
  }

  /**
   * Extract tables from content
   */
  private async extractTables(content: string, metadata: DocumentMetadata): Promise<void> {
    // Markdown tables
    const tableRegex = /(\|.+\|(?:\n\|.+\|)*)/g;
    let match;

    while ((match = tableRegex.exec(content)) !== null) {
      const tableContent = match[1];
      const lines = tableContent.split('\n').map(line => line.trim());
      
      if (lines.length >= 2) {
        const headers = this.parseTableRow(lines[0]);
        const rows: string[][] = [];

        // Skip separator line (usually contains dashes)
        for (let i = 2; i < lines.length; i++) {
          const row = this.parseTableRow(lines[i]);
          if (row.length > 0) {
            rows.push(row);
          }
        }

        if (headers.length > 0 && rows.length > 0) {
          metadata.structure.tables.push({
            headers,
            rows,
            position: match.index
          });
        }
      }
    }
  }

  /**
   * Parse a table row
   */
  private parseTableRow(line: string): string[] {
    return line
      .split('|')
      .map(cell => cell.trim())
      .filter(cell => cell.length > 0);
  }

  /**
   * Extract code blocks from content
   */
  private async extractCodeBlocks(content: string, metadata: DocumentMetadata): Promise<void> {
    // Fenced code blocks
    const fencedCodeRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;

    while ((match = fencedCodeRegex.exec(content)) !== null) {
      metadata.structure.codeBlocks.push({
        language: match[1] || undefined,
        content: match[2].trim(),
        position: match.index
      });
    }

    // Indented code blocks
    const indentedCodeRegex = /^(    .+(?:\n    .+)*)/gm;
    while ((match = indentedCodeRegex.exec(content)) !== null) {
      const codeContent = match[1]
        .split('\n')
        .map(line => line.slice(4)) // Remove 4-space indent
        .join('\n')
        .trim();

      if (codeContent.length > 0) {
        metadata.structure.codeBlocks.push({
          content: codeContent,
          position: match.index
        });
      }
    }
  }

  /**
   * Create sections based on headings
   */
  private async createSections(content: string, metadata: DocumentMetadata): Promise<void> {
    const headings = metadata.structure.headings;

    if (headings.length === 0) {
      // No headings, treat entire content as one section
      metadata.structure.sections.push({
        content: content.trim(),
        level: 0,
        startOffset: 0,
        endOffset: content.length
      });
      return;
    }

    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      const nextHeading = headings[i + 1];

      const sectionStart = heading.position;
      const sectionEnd = nextHeading ? nextHeading.position : content.length;
      const sectionContent = content.slice(sectionStart, sectionEnd).trim();

      if (sectionContent.length > 0) {
        metadata.structure.sections.push({
          title: heading.text,
          content: sectionContent,
          level: heading.level,
          startOffset: sectionStart,
          endOffset: sectionEnd
        });
      }
    }
  }

  /**
   * Analyze content characteristics
   */
  private async analyzeContentCharacteristics(content: string, metadata: DocumentMetadata): Promise<void> {
    // Word count
    metadata.content.wordCount = this.countWords(content);
    
    // Sentence count
    metadata.content.sentenceCount = this.countSentences(content);
    
    // Paragraph count
    metadata.content.paragraphCount = this.countParagraphs(content);
    
    // Reading time (average 200 words per minute)
    metadata.content.readingTime = Math.ceil(metadata.content.wordCount / 200);
    
    // Language detection (simplified)
    metadata.content.language = await this.detectLanguage(content);
    
    // Complexity score
    metadata.content.complexity = await this.calculateComplexity(content, metadata);
  }

  /**
   * Count words in content
   */
  private countWords(content: string): number {
    return content
      .trim()
      .split(/\s+/)
      .filter(word => word.length > 0 && /\w/.test(word))
      .length;
  }

  /**
   * Count sentences in content
   */
  private countSentences(content: string): number {
    return content
      .split(/[.!?]+/)
      .filter(sentence => sentence.trim().length > 0)
      .length;
  }

  /**
   * Count paragraphs in content
   */
  private countParagraphs(content: string): number {
    return content
      .split(/\n\s*\n/)
      .filter(paragraph => paragraph.trim().length > 0)
      .length;
  }

  /**
   * Detect content language (simplified)
   */
  private async detectLanguage(content: string): Promise<string> {
    // Simple heuristic-based language detection
    const sample = content.slice(0, 1000).toLowerCase();
    
    // Common English words
    const englishWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
    const englishCount = englishWords.reduce((count, word) => {
      return count + (sample.split(word).length - 1);
    }, 0);

    // Simple scoring
    if (englishCount > 10) return 'en';
    
    return 'unknown';
  }

  /**
   * Calculate content complexity
   */
  private async calculateComplexity(content: string, metadata: DocumentMetadata): Promise<number> {
    let complexity = 0;

    // Base complexity from word count
    complexity += Math.min(metadata.content.wordCount / 1000, 1) * 0.3;

    // Sentence length complexity
    const avgSentenceLength = metadata.content.wordCount / Math.max(metadata.content.sentenceCount, 1);
    if (avgSentenceLength > 20) complexity += 0.2;
    if (avgSentenceLength > 30) complexity += 0.2;

    // Structure complexity
    if (metadata.structure.headings.length > 5) complexity += 0.1;
    if (metadata.structure.tables.length > 0) complexity += 0.1;
    if (metadata.structure.codeBlocks.length > 0) complexity += 0.1;

    return Math.min(complexity, 1);
  }

  /**
   * Detect formatting elements
   */
  private async detectFormattingElements(content: string, metadata: DocumentMetadata): Promise<void> {
    // Emphasis (bold, italic)
    metadata.formatting.hasEmphasis = /\*\*.*\*\*|\*.*\*|__.*__|_.*_/.test(content);
    
    // Links
    metadata.formatting.hasLinks = /\[.*\]\(.*\)|https?:\/\/\S+/.test(content);
    
    // Images
    metadata.formatting.hasImages = /!\[.*\]\(.*\)/.test(content);
    
    // Quotes
    metadata.formatting.hasQuotes = /^>\s+/m.test(content);
    
    // Footnotes
    metadata.formatting.hasFootnotes = /\[\^.*\]/.test(content);
  }

  /**
   * Calculate quality metrics
   */
  private async calculateQualityMetrics(content: string, metadata: DocumentMetadata): Promise<void> {
    // Completeness (based on structure and content length)
    metadata.quality.completeness = this.calculateCompleteness(content, metadata);
    
    // Coherence (based on structure and flow)
    metadata.quality.coherence = this.calculateCoherence(content, metadata);
    
    // Readability (based on sentence structure and complexity)
    metadata.quality.readability = this.calculateReadability(content, metadata);
    
    // Structure score (based on heading hierarchy and organization)
    metadata.quality.structureScore = this.calculateStructureScore(metadata);
  }

  /**
   * Calculate completeness score
   */
  private calculateCompleteness(content: string, metadata: DocumentMetadata): number {
    let score = 0;

    // Base score from content length
    if (metadata.content.wordCount > 100) score += 0.3;
    if (metadata.content.wordCount > 500) score += 0.2;

    // Structure completeness
    if (metadata.structure.headings.length > 0) score += 0.2;
    if (metadata.structure.sections.length > 1) score += 0.2;

    // Content variety
    if (metadata.structure.lists.length > 0) score += 0.1;

    return Math.min(score, 1);
  }

  /**
   * Calculate coherence score
   */
  private calculateCoherence(content: string, metadata: DocumentMetadata): number {
    let score = 0.5; // Base score

    // Proper heading hierarchy
    const headingLevels = metadata.structure.headings.map(h => h.level);
    if (this.hasProperHierarchy(headingLevels)) score += 0.3;

    // Consistent section lengths
    const sectionLengths = metadata.structure.sections.map(s => s.content.length);
    if (this.hasConsistentLengths(sectionLengths)) score += 0.2;

    return Math.min(score, 1);
  }

  /**
   * Calculate readability score
   */
  private calculateReadability(content: string, metadata: DocumentMetadata): number {
    let score = 0.5; // Base score

    // Sentence length
    const avgSentenceLength = metadata.content.wordCount / Math.max(metadata.content.sentenceCount, 1);
    if (avgSentenceLength >= 10 && avgSentenceLength <= 25) score += 0.2;

    // Paragraph structure
    if (metadata.content.paragraphCount > 0) {
      const avgParagraphLength = metadata.content.wordCount / metadata.content.paragraphCount;
      if (avgParagraphLength >= 50 && avgParagraphLength <= 200) score += 0.2;
    }

    // Formatting aids readability
    if (metadata.formatting.hasEmphasis) score += 0.1;

    return Math.min(score, 1);
  }

  /**
   * Calculate structure score
   */
  private calculateStructureScore(metadata: DocumentMetadata): number {
    let score = 0;

    // Has headings
    if (metadata.structure.headings.length > 0) score += 0.4;

    // Proper hierarchy
    const headingLevels = metadata.structure.headings.map(h => h.level);
    if (this.hasProperHierarchy(headingLevels)) score += 0.3;

    // Multiple sections
    if (metadata.structure.sections.length > 1) score += 0.2;

    // Additional structure elements
    if (metadata.structure.lists.length > 0) score += 0.1;

    return Math.min(score, 1);
  }

  /**
   * Check if heading levels follow proper hierarchy
   */
  private hasProperHierarchy(levels: number[]): boolean {
    if (levels.length < 2) return true;

    for (let i = 1; i < levels.length; i++) {
      const diff = levels[i] - levels[i - 1];
      if (diff > 1) return false; // Skipped levels
    }

    return true;
  }

  /**
   * Check if section lengths are reasonably consistent
   */
  private hasConsistentLengths(lengths: number[]): boolean {
    if (lengths.length < 2) return true;

    const avg = lengths.reduce((sum, len) => sum + len, 0) / lengths.length;
    const variance = lengths.reduce((sum, len) => sum + Math.pow(len - avg, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);

    // Consider consistent if standard deviation is less than 50% of average
    return stdDev < avg * 0.5;
  }

  /**
   * Extract keywords from content
   */
  async extractKeywords(content: string, limit: number = 10): Promise<string[]> {
    // Simple keyword extraction based on word frequency
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);

    // Common stop words to exclude
    const stopWords = new Set([
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above',
      'below', 'between', 'among', 'this', 'that', 'these', 'those', 'they', 'them',
      'their', 'there', 'where', 'when', 'what', 'which', 'who', 'how', 'why'
    ]);

    // Count word frequencies
    const wordCounts = new Map<string, number>();
    words.forEach(word => {
      if (!stopWords.has(word)) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    });

    // Sort by frequency and return top keywords
    return Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word]) => word);
  }

  /**
   * Extract entities from content (simplified)
   */
  async extractEntities(content: string): Promise<{
    people: string[];
    organizations: string[];
    locations: string[];
    dates: string[];
  }> {
    const entities = {
      people: [] as string[],
      organizations: [] as string[],
      locations: [] as string[],
      dates: [] as string[]
    };

    // Simple regex-based entity extraction
    // Dates
    const dateRegex = /\b\d{1,2}\/\d{1,2}\/\d{4}|\b\d{4}-\d{2}-\d{2}|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi;
    const dates = content.match(dateRegex) || [];
    entities.dates = [...new Set(dates)];

    // Capitalized words (potential names/organizations)
    const capitalizedRegex = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
    const capitalized = content.match(capitalizedRegex) || [];
    
    // Simple heuristics to categorize
    capitalized.forEach(entity => {
      if (entity.split(' ').length === 2 && /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(entity)) {
        entities.people.push(entity);
      } else if (entity.includes('Inc') || entity.includes('Corp') || entity.includes('LLC')) {
        entities.organizations.push(entity);
      }
    });

    return entities;
  }
}
