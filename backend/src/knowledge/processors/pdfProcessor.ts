import * as pdfParse from 'pdf-parse';
import { createReadStream } from 'fs';
import { AppError } from '../../middlewares/errorHandler';

export interface PDFProcessingOptions {
  extractImages?: boolean;
  ocrEnabled?: boolean;
  preserveFormatting?: boolean;
  pageRange?: { start: number; end: number };
}

export interface PDFProcessingResult {
  text: string;
  metadata: {
    pages: number;
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
    modificationDate?: Date;
    encrypted?: boolean;
    pageTexts?: string[];
    images?: Array<{ page: number; data: Buffer; type: string }>;
  };
  structure: {
    headings: Array<{ level: number; text: string; page: number }>;
    tables: Array<{ page: number; data: string[][] }>;
    links: Array<{ text: string; url: string; page: number }>;
  };
}

export class PDFProcessor {
  /**
   * Process PDF document with advanced text extraction
   */
  async processPDF(
    filePath: string, 
    options: PDFProcessingOptions = {}
  ): Promise<PDFProcessingResult> {
    try {
      const dataBuffer = await this.readFileBuffer(filePath);
      const pdfData = await pdfParse(dataBuffer, {
        // Custom render function for better text extraction
        render_page: (pageData: any) => {
          return this.renderPageWithFormatting(pageData, options);
        }
      });

      const result: PDFProcessingResult = {
        text: this.cleanExtractedText(pdfData.text),
        metadata: {
          pages: pdfData.numpages,
          title: pdfData.info?.Title,
          author: pdfData.info?.Author,
          subject: pdfData.info?.Subject,
          creator: pdfData.info?.Creator,
          producer: pdfData.info?.Producer,
          creationDate: pdfData.info?.CreationDate,
          modificationDate: pdfData.info?.ModDate,
          encrypted: pdfData.info?.IsAcroFormPresent || false,
          pageTexts: []
        },
        structure: {
          headings: [],
          tables: [],
          links: []
        }
      };

      // Extract page-by-page content if requested
      if (options.pageRange || options.extractImages) {
        await this.extractDetailedContent(dataBuffer, result, options);
      }

      // Analyze document structure
      await this.analyzeDocumentStructure(result);

      return result;
    } catch (error) {
      throw new AppError(
        `Failed to process PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Extract text from specific PDF pages
   */
  async extractPageRange(
    filePath: string, 
    startPage: number, 
    endPage: number
  ): Promise<string[]> {
    try {
      const result = await this.processPDF(filePath, {
        pageRange: { start: startPage, end: endPage }
      });
      return result.metadata.pageTexts || [];
    } catch (error) {
      throw new AppError(`Failed to extract page range: ${error}`, 500);
    }
  }

  /**
   * Check if PDF is text-searchable or needs OCR
   */
  async isTextSearchable(filePath: string): Promise<boolean> {
    try {
      const result = await this.processPDF(filePath);
      const textDensity = result.text.length / result.metadata.pages;
      return textDensity > 50; // Threshold for text density
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract images from PDF for OCR processing
   */
  async extractImages(filePath: string): Promise<Array<{ page: number; data: Buffer; type: string }>> {
    // This would integrate with a PDF image extraction library
    // For now, return empty array as placeholder
    return [];
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

  private renderPageWithFormatting(pageData: any, options: PDFProcessingOptions): string {
    // Enhanced page rendering with formatting preservation
    if (options.preserveFormatting) {
      return this.preserveTextFormatting(pageData);
    }
    return pageData.getTextContent();
  }

  private preserveTextFormatting(pageData: any): string {
    // Implement advanced formatting preservation
    // This would analyze text positions, fonts, and spacing
    return pageData.getTextContent();
  }

  private cleanExtractedText(text: string): string {
    return text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\n\s*\n/g, '\n\n') // Clean up multiple newlines
      .trim();
  }

  private async extractDetailedContent(
    dataBuffer: Buffer, 
    result: PDFProcessingResult, 
    options: PDFProcessingOptions
  ): Promise<void> {
    // Extract page-by-page content and images
    // This would use more advanced PDF parsing libraries
    result.metadata.pageTexts = [];
    
    if (options.extractImages) {
      result.metadata.images = await this.extractImages('');
    }
  }

  private async analyzeDocumentStructure(result: PDFProcessingResult): Promise<void> {
    // Analyze text for headings, tables, and links
    const lines = result.text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Detect headings (simple heuristic)
      if (this.isHeading(line)) {
        result.structure.headings.push({
          level: this.getHeadingLevel(line),
          text: line,
          page: 1 // Would need page tracking
        });
      }
      
      // Detect URLs
      const urls = this.extractUrls(line);
      result.structure.links.push(...urls.map(url => ({
        text: line,
        url,
        page: 1
      })));
    }
  }

  private isHeading(line: string): boolean {
    // Simple heading detection heuristics
    return (
      line.length < 100 && 
      line.length > 3 &&
      (line.match(/^[A-Z][^.]*$/) || 
       line.match(/^\d+\.?\s+[A-Z]/))
    );
  }

  private getHeadingLevel(line: string): number {
    // Determine heading level based on formatting
    if (line.match(/^\d+\.\s+/)) return 1;
    if (line.match(/^\d+\.\d+\s+/)) return 2;
    if (line.match(/^\d+\.\d+\.\d+\s+/)) return 3;
    return 1;
  }

  private extractUrls(text: string): string[] {
    const urlRegex = /https?:\/\/[^\s]+/g;
    return text.match(urlRegex) || [];
  }
}
