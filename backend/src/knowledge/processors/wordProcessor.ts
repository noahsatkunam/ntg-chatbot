import * as mammoth from 'mammoth';
import { createReadStream } from 'fs';
import { AppError } from '../../middlewares/errorHandler';

export interface WordProcessingOptions {
  preserveFormatting?: boolean;
  extractImages?: boolean;
  includeComments?: boolean;
  includeFootnotes?: boolean;
  convertToMarkdown?: boolean;
}

export interface WordProcessingResult {
  text: string;
  html?: string;
  markdown?: string;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    comments?: string;
    lastModifiedBy?: string;
    createdDate?: Date;
    modifiedDate?: Date;
    wordCount?: number;
    pageCount?: number;
  };
  structure: {
    headings: Array<{ level: number; text: string; id?: string }>;
    tables: Array<{ caption?: string; data: string[][]; rowCount: number; colCount: number }>;
    images: Array<{ alt?: string; title?: string; data?: Buffer; contentType?: string }>;
    links: Array<{ text: string; url: string; type: 'internal' | 'external' }>;
    footnotes: Array<{ id: string; text: string }>;
    comments: Array<{ author: string; text: string; date?: Date }>;
  };
  styles: {
    fonts: string[];
    colors: string[];
    customStyles: Array<{ name: string; properties: any }>;
  };
}

export class WordProcessor {
  /**
   * Process Word document with advanced content extraction
   */
  async processWord(
    filePath: string, 
    options: WordProcessingOptions = {}
  ): Promise<WordProcessingResult> {
    try {
      const buffer = await this.readFileBuffer(filePath);
      
      // Configure mammoth options
      const mammothOptions = {
        convertImage: mammoth.images.imgElement((image: any) => {
          return image.read().then((imageBuffer: Buffer) => {
            // Store image data for later processing
            return {
              src: `data:${image.contentType};base64,${imageBuffer.toString('base64')}`
            };
          });
        }),
        includeDefaultStyleMap: true,
        includeEmbeddedStyleMap: true,
        transformDocument: options.preserveFormatting ? this.preserveFormattingTransform : undefined
      };

      // Extract HTML content
      const htmlResult = await mammoth.convertToHtml(buffer, mammothOptions);
      
      // Extract plain text
      const textResult = await mammoth.extractRawText(buffer);

      const result: WordProcessingResult = {
        text: this.cleanExtractedText(textResult.value),
        html: htmlResult.value,
        metadata: {},
        structure: {
          headings: [],
          tables: [],
          images: [],
          links: [],
          footnotes: [],
          comments: []
        },
        styles: {
          fonts: [],
          colors: [],
          customStyles: []
        }
      };

      // Convert to markdown if requested
      if (options.convertToMarkdown) {
        result.markdown = await this.convertToMarkdown(htmlResult.value);
      }

      // Extract document metadata
      await this.extractMetadata(buffer, result);

      // Analyze document structure
      await this.analyzeDocumentStructure(result, options);

      // Extract styles information
      await this.extractStyles(htmlResult.value, result);

      // Process any warnings
      if (htmlResult.messages.length > 0) {
        console.warn('Word processing warnings:', htmlResult.messages);
      }

      return result;
    } catch (error) {
      throw new AppError(
        `Failed to process Word document: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Extract text content only (lightweight processing)
   */
  async extractTextOnly(filePath: string): Promise<string> {
    try {
      const buffer = await this.readFileBuffer(filePath);
      const result = await mammoth.extractRawText(buffer);
      return this.cleanExtractedText(result.value);
    } catch (error) {
      throw new AppError(`Failed to extract text from Word document: ${error}`, 500);
    }
  }

  /**
   * Extract document outline/headings
   */
  async extractOutline(filePath: string): Promise<Array<{ level: number; text: string }>> {
    try {
      const result = await this.processWord(filePath, { preserveFormatting: true });
      return result.structure.headings;
    } catch (error) {
      throw new AppError(`Failed to extract document outline: ${error}`, 500);
    }
  }

  /**
   * Check if document is password protected
   */
  async isPasswordProtected(filePath: string): Promise<boolean> {
    try {
      const buffer = await this.readFileBuffer(filePath);
      await mammoth.extractRawText(buffer);
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '';
      return errorMessage.includes('password') || errorMessage.includes('encrypted');
    }
  }

  private async readFileBuffer(filePath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(filePath);
      
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  private preserveFormattingTransform(element: any): any {
    // Transform to preserve important formatting
    if (element.type === 'paragraph') {
      const style = element.styleName;
      if (style && style.includes('Heading')) {
        const level = parseInt(style.replace('Heading', '')) || 1;
        return {
          ...element,
          type: 'heading',
          level: Math.min(level, 6)
        };
      }
    }
    return element;
  }

  private cleanExtractedText(text: string): string {
    return text
      .replace(/\r\n/g, '\n') // Normalize line endings
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Clean up multiple newlines
      .replace(/\t+/g, ' ') // Replace tabs with spaces
      .trim();
  }

  private async convertToMarkdown(html: string): Promise<string> {
    // Simple HTML to Markdown conversion
    return html
      .replace(/<h([1-6])>/g, (match, level) => '#'.repeat(parseInt(level)) + ' ')
      .replace(/<\/h[1-6]>/g, '\n\n')
      .replace(/<p>/g, '')
      .replace(/<\/p>/g, '\n\n')
      .replace(/<strong>/g, '**')
      .replace(/<\/strong>/g, '**')
      .replace(/<em>/g, '*')
      .replace(/<\/em>/g, '*')
      .replace(/<a href="([^"]*)"[^>]*>/g, '[')
      .replace(/<\/a>/g, ']($1)')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<[^>]*>/g, '') // Remove remaining HTML tags
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }

  private async extractMetadata(buffer: Buffer, result: WordProcessingResult): Promise<void> {
    try {
      // Extract document properties using mammoth
      // This is a simplified version - in practice, you'd use a more comprehensive library
      const textContent = result.text;
      
      result.metadata = {
        wordCount: textContent.split(/\s+/).length,
        pageCount: Math.ceil(textContent.length / 2000), // Rough estimate
        createdDate: new Date(), // Would extract from document properties
        modifiedDate: new Date()
      };
    } catch (error) {
      console.warn('Failed to extract metadata:', error);
    }
  }

  private async analyzeDocumentStructure(
    result: WordProcessingResult, 
    options: WordProcessingOptions
  ): Promise<void> {
    if (!result.html) return;

    // Extract headings
    const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/g;
    let headingMatch;
    while ((headingMatch = headingRegex.exec(result.html)) !== null) {
      result.structure.headings.push({
        level: parseInt(headingMatch[1]),
        text: this.stripHtml(headingMatch[2])
      });
    }

    // Extract tables
    const tableRegex = /<table[^>]*>(.*?)<\/table>/gs;
    let tableMatch;
    while ((tableMatch = tableRegex.exec(result.html)) !== null) {
      const tableData = this.parseTableHtml(tableMatch[1]);
      result.structure.tables.push(tableData);
    }

    // Extract links
    const linkRegex = /<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/g;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(result.html)) !== null) {
      result.structure.links.push({
        text: this.stripHtml(linkMatch[2]),
        url: linkMatch[1],
        type: linkMatch[1].startsWith('http') ? 'external' : 'internal'
      });
    }

    // Extract images
    const imgRegex = /<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/g;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(result.html)) !== null) {
      result.structure.images.push({
        alt: imgMatch[2],
        data: Buffer.from(''), // Would contain actual image data
        contentType: 'image/png' // Would detect actual type
      });
    }
  }

  private async extractStyles(html: string, result: WordProcessingResult): Promise<void> {
    // Extract font families
    const fontRegex = /font-family:\s*([^;]+)/g;
    let fontMatch;
    const fonts = new Set<string>();
    while ((fontMatch = fontRegex.exec(html)) !== null) {
      fonts.add(fontMatch[1].replace(/['"]/g, '').trim());
    }
    result.styles.fonts = Array.from(fonts);

    // Extract colors
    const colorRegex = /color:\s*([^;]+)/g;
    let colorMatch;
    const colors = new Set<string>();
    while ((colorMatch = colorRegex.exec(html)) !== null) {
      colors.add(colorMatch[1].trim());
    }
    result.styles.colors = Array.from(colors);
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }

  private parseTableHtml(tableHtml: string): { caption?: string; data: string[][]; rowCount: number; colCount: number } {
    const rows: string[][] = [];
    const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gs;
    let rowMatch;
    
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<t[hd][^>]*>(.*?)<\/t[hd]>/gs;
      let cellMatch;
      
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(this.stripHtml(cellMatch[1]));
      }
      
      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    return {
      data: rows,
      rowCount: rows.length,
      colCount: rows.length > 0 ? Math.max(...rows.map(row => row.length)) : 0
    };
  }
}
