import { readFile } from 'fs/promises';
import { AppError } from '../../middlewares/errorHandler';

export interface TextProcessingOptions {
  detectLanguage?: boolean;
  preserveFormatting?: boolean;
  extractMetadata?: boolean;
  parseMarkdown?: boolean;
  detectEncoding?: boolean;
}

export interface TextProcessingResult {
  text: string;
  html?: string;
  metadata: {
    language?: string;
    encoding?: string;
    lineCount: number;
    wordCount: number;
    charCount: number;
    paragraphCount: number;
    estimatedReadingTime: number; // minutes
  };
  structure: {
    headings: Array<{ level: number; text: string; line: number }>;
    links: Array<{ text: string; url: string; line: number }>;
    codeBlocks: Array<{ language?: string; code: string; line: number }>;
    lists: Array<{ type: 'ordered' | 'unordered'; items: string[]; line: number }>;
    tables: Array<{ headers: string[]; rows: string[][]; line: number }>;
  };
  formatting: {
    isMarkdown: boolean;
    hasCodeBlocks: boolean;
    hasLinks: boolean;
    hasTables: boolean;
    hasLists: boolean;
  };
}

export class TextProcessor {
  /**
   * Process plain text or markdown content
   */
  async processText(
    filePath: string, 
    options: TextProcessingOptions = {}
  ): Promise<TextProcessingResult> {
    try {
      const content = await this.readTextFile(filePath, options.detectEncoding);
      
      const result: TextProcessingResult = {
        text: content,
        metadata: {
          lineCount: content.split('\n').length,
          wordCount: this.countWords(content),
          charCount: content.length,
          paragraphCount: this.countParagraphs(content),
          estimatedReadingTime: this.estimateReadingTime(content)
        },
        structure: {
          headings: [],
          links: [],
          codeBlocks: [],
          lists: [],
          tables: []
        },
        formatting: {
          isMarkdown: false,
          hasCodeBlocks: false,
          hasLinks: false,
          hasTables: false,
          hasLists: false
        }
      };

      // Detect language if requested
      if (options.detectLanguage) {
        result.metadata.language = await this.detectLanguage(content);
      }

      // Parse markdown structure if detected or requested
      if (options.parseMarkdown || this.isMarkdown(content)) {
        result.formatting.isMarkdown = true;
        await this.parseMarkdownStructure(content, result);
        
        if (options.preserveFormatting) {
          result.html = await this.convertMarkdownToHtml(content);
        }
      } else {
        // Parse plain text structure
        await this.parsePlainTextStructure(content, result);
      }

      return result;
    } catch (error) {
      throw new AppError(
        `Failed to process text document: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Extract text content only (lightweight processing)
   */
  async extractTextOnly(filePath: string): Promise<string> {
    try {
      return await this.readTextFile(filePath);
    } catch (error) {
      throw new AppError(`Failed to extract text: ${error}`, 500);
    }
  }

  /**
   * Detect document language
   */
  async detectLanguage(text: string): Promise<string> {
    // Simple language detection based on common words
    const commonWords = {
      en: ['the', 'and', 'is', 'in', 'to', 'of', 'a', 'that', 'it', 'with'],
      es: ['el', 'la', 'de', 'que', 'y', 'en', 'un', 'es', 'se', 'no'],
      fr: ['le', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir'],
      de: ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich'],
      it: ['il', 'di', 'che', 'e', 'la', 'per', 'in', 'un', 'è', 'con']
    };

    const words = text.toLowerCase().split(/\s+/).slice(0, 1000); // Sample first 1000 words
    const scores: { [key: string]: number } = {};

    for (const [lang, commonWordList] of Object.entries(commonWords)) {
      scores[lang] = 0;
      for (const word of commonWordList) {
        scores[lang] += words.filter(w => w === word).length;
      }
    }

    const detectedLang = Object.keys(scores).reduce((a, b) => 
      scores[a] > scores[b] ? a : b
    );

    return scores[detectedLang] > 5 ? detectedLang : 'unknown';
  }

  /**
   * Check if content is markdown
   */
  isMarkdown(content: string): boolean {
    const markdownIndicators = [
      /^#{1,6}\s+/m, // Headers
      /^\*\s+/m, // Unordered lists
      /^\d+\.\s+/m, // Ordered lists
      /```/m, // Code blocks
      /\[.*\]\(.*\)/m, // Links
      /^\|.*\|/m, // Tables
      /^\*\*.*\*\*$/m, // Bold
      /^_.*_$/m // Italic
    ];

    return markdownIndicators.some(regex => regex.test(content));
  }

  private async readTextFile(filePath: string, detectEncoding = false): Promise<string> {
    try {
      let encoding: BufferEncoding = 'utf8';
      
      if (detectEncoding) {
        encoding = await this.detectFileEncoding(filePath);
      }
      
      return await readFile(filePath, encoding);
    } catch (error) {
      // Try different encodings if UTF-8 fails
      const encodings: BufferEncoding[] = ['latin1', 'ascii', 'utf16le'];
      
      for (const enc of encodings) {
        try {
          return await readFile(filePath, enc);
        } catch (e) {
          continue;
        }
      }
      
      throw new AppError(`Unable to read file with any supported encoding`, 500);
    }
  }

  private async detectFileEncoding(filePath: string): Promise<BufferEncoding> {
    // Simple encoding detection - in production, use a proper library like chardet
    try {
      const buffer = await readFile(filePath);
      const sample = buffer.slice(0, 1000);
      
      // Check for BOM
      if (sample[0] === 0xEF && sample[1] === 0xBB && sample[2] === 0xBF) {
        return 'utf8';
      }
      if (sample[0] === 0xFF && sample[1] === 0xFE) {
        return 'utf16le';
      }
      
      // Default to UTF-8
      return 'utf8';
    } catch (error) {
      return 'utf8';
    }
  }

  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  private countParagraphs(text: string): number {
    return text.split(/\n\s*\n/).filter(para => para.trim().length > 0).length;
  }

  private estimateReadingTime(text: string): number {
    const wordsPerMinute = 200; // Average reading speed
    const wordCount = this.countWords(text);
    return Math.ceil(wordCount / wordsPerMinute);
  }

  private async parseMarkdownStructure(content: string, result: TextProcessingResult): Promise<void> {
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;
      
      // Parse headings
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        result.structure.headings.push({
          level: headingMatch[1].length,
          text: headingMatch[2],
          line: lineNumber
        });
        continue;
      }
      
      // Parse links
      const linkMatches = line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
      for (const match of linkMatches) {
        result.structure.links.push({
          text: match[1],
          url: match[2],
          line: lineNumber
        });
        result.formatting.hasLinks = true;
      }
      
      // Parse code blocks
      if (line.startsWith('```')) {
        const language = line.substring(3).trim();
        const codeLines: string[] = [];
        let j = i + 1;
        
        while (j < lines.length && !lines[j].startsWith('```')) {
          codeLines.push(lines[j]);
          j++;
        }
        
        result.structure.codeBlocks.push({
          language: language || undefined,
          code: codeLines.join('\n'),
          line: lineNumber
        });
        result.formatting.hasCodeBlocks = true;
        i = j; // Skip processed lines
        continue;
      }
      
      // Parse lists
      const unorderedListMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
      const orderedListMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
      
      if (unorderedListMatch || orderedListMatch) {
        const listType = unorderedListMatch ? 'unordered' : 'ordered';
        const items: string[] = [];
        let j = i;
        
        while (j < lines.length) {
          const listItemMatch = listType === 'unordered' 
            ? lines[j].match(/^[\s]*[-*+]\s+(.+)$/)
            : lines[j].match(/^[\s]*\d+\.\s+(.+)$/);
          
          if (listItemMatch) {
            items.push(listItemMatch[1]);
            j++;
          } else if (lines[j].trim() === '') {
            j++;
          } else {
            break;
          }
        }
        
        result.structure.lists.push({
          type: listType,
          items,
          line: lineNumber
        });
        result.formatting.hasLists = true;
        i = j - 1; // Adjust for loop increment
        continue;
      }
      
      // Parse tables
      if (line.includes('|') && line.trim().startsWith('|')) {
        const tableLines: string[] = [line];
        let j = i + 1;
        
        while (j < lines.length && lines[j].includes('|') && lines[j].trim().startsWith('|')) {
          tableLines.push(lines[j]);
          j++;
        }
        
        if (tableLines.length > 1) {
          const table = this.parseMarkdownTable(tableLines);
          result.structure.tables.push({
            ...table,
            line: lineNumber
          });
          result.formatting.hasTables = true;
          i = j - 1;
        }
      }
    }
  }

  private async parsePlainTextStructure(content: string, result: TextProcessingResult): Promise<void> {
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;
      
      // Detect potential headings in plain text
      if (this.isPotentialHeading(line, lines[i - 1], lines[i + 1])) {
        result.structure.headings.push({
          level: this.estimateHeadingLevel(line),
          text: line.trim(),
          line: lineNumber
        });
      }
      
      // Extract URLs
      const urls = this.extractUrls(line);
      for (const url of urls) {
        result.structure.links.push({
          text: line.trim(),
          url,
          line: lineNumber
        });
        result.formatting.hasLinks = true;
      }
    }
  }

  private isPotentialHeading(line: string, prevLine?: string, nextLine?: string): boolean {
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) return false;
    
    // Check for common heading patterns
    const headingPatterns = [
      /^[A-Z][^.!?]*$/, // All caps or title case without punctuation
      /^\d+\.?\s+[A-Z]/, // Numbered headings
      /^[IVX]+\.\s+[A-Z]/, // Roman numerals
    ];
    
    const isShort = trimmed.length < 100;
    const matchesPattern = headingPatterns.some(pattern => pattern.test(trimmed));
    const followedByEmptyLine = !nextLine || nextLine.trim() === '';
    
    return isShort && matchesPattern && followedByEmptyLine;
  }

  private estimateHeadingLevel(line: string): number {
    const trimmed = line.trim();
    
    if (trimmed.match(/^\d+\.\s+/)) return 1;
    if (trimmed.match(/^\d+\.\d+\s+/)) return 2;
    if (trimmed.match(/^\d+\.\d+\.\d+\s+/)) return 3;
    if (trimmed.match(/^[A-Z][A-Z\s]+$/)) return 1; // ALL CAPS
    
    return 2; // Default level
  }

  private extractUrls(text: string): string[] {
    const urlRegex = /https?:\/\/[^\s]+/g;
    return text.match(urlRegex) || [];
  }

  private parseMarkdownTable(tableLines: string[]): { headers: string[]; rows: string[][] } {
    const headers = tableLines[0]
      .split('|')
      .map(cell => cell.trim())
      .filter(cell => cell.length > 0);
    
    const rows: string[][] = [];
    
    // Skip header separator line (usually line 1)
    for (let i = 2; i < tableLines.length; i++) {
      const row = tableLines[i]
        .split('|')
        .map(cell => cell.trim())
        .filter(cell => cell.length > 0);
      
      if (row.length > 0) {
        rows.push(row);
      }
    }
    
    return { headers, rows };
  }

  private async convertMarkdownToHtml(content: string): Promise<string> {
    // Simple markdown to HTML conversion
    return content
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/^\* (.*$)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/^\d+\. (.*$)/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
  }
}
