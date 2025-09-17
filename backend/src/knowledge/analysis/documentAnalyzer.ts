import { PrismaClient } from '@prisma/client';
import { MetadataExtractor, DocumentMetadata } from '../chunking/metadataExtractor';
import { AppError } from '../../middlewares/errorHandler';

const prisma = new PrismaClient();

export interface DocumentAnalysisResult {
  documentId: string;
  analysis: {
    quality: {
      score: number;
      issues: string[];
      recommendations: string[];
    };
    content: {
      type: 'technical' | 'business' | 'academic' | 'general';
      complexity: number;
      readability: number;
      topics: string[];
      entities: {
        people: string[];
        organizations: string[];
        locations: string[];
        dates: string[];
      };
    };
    structure: {
      hasProperHierarchy: boolean;
      sectionBalance: number;
      navigationScore: number;
      consistencyScore: number;
    };
    duplicates: {
      similarDocuments: Array<{
        documentId: string;
        similarity: number;
        title: string;
      }>;
      duplicateChunks: Array<{
        chunkId: string;
        similarity: number;
        content: string;
      }>;
    };
    language: {
      detected: string;
      confidence: number;
      multiLanguage: boolean;
    };
    sentiment: {
      overall: 'positive' | 'neutral' | 'negative';
      score: number;
      confidence: number;
    };
  };
  recommendations: {
    processing: string[];
    chunking: string[];
    indexing: string[];
  };
  metadata: DocumentMetadata;
}

export class DocumentAnalyzer {
  private metadataExtractor: MetadataExtractor;

  constructor() {
    this.metadataExtractor = new MetadataExtractor();
  }

  /**
   * Perform comprehensive analysis of a document
   */
  async analyzeDocument(
    documentId: string,
    content: string,
    tenantId: string
  ): Promise<DocumentAnalysisResult> {
    try {
      // Extract metadata
      const metadata = await this.metadataExtractor.extractMetadata(content);

      // Perform various analyses
      const [
        qualityAnalysis,
        contentAnalysis,
        structureAnalysis,
        duplicateAnalysis,
        languageAnalysis,
        sentimentAnalysis
      ] = await Promise.all([
        this.analyzeQuality(content, metadata),
        this.analyzeContent(content, metadata),
        this.analyzeStructure(content, metadata),
        this.findDuplicates(documentId, content, tenantId),
        this.analyzeLanguage(content),
        this.analyzeSentiment(content)
      ]);

      // Generate recommendations
      const recommendations = await this.generateRecommendations(
        content,
        metadata,
        qualityAnalysis,
        contentAnalysis,
        structureAnalysis
      );

      return {
        documentId,
        analysis: {
          quality: qualityAnalysis,
          content: contentAnalysis,
          structure: structureAnalysis,
          duplicates: duplicateAnalysis,
          language: languageAnalysis,
          sentiment: sentimentAnalysis
        },
        recommendations,
        metadata
      };
    } catch (error) {
      throw new AppError(`Document analysis failed: ${error}`, 500);
    }
  }

  /**
   * Analyze document quality
   */
  private async analyzeQuality(content: string, metadata: DocumentMetadata): Promise<{
    score: number;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 1.0;

    // Check content length
    if (metadata.content.wordCount < 100) {
      issues.push('Document is very short');
      recommendations.push('Consider adding more detailed content');
      score -= 0.2;
    } else if (metadata.content.wordCount > 10000) {
      issues.push('Document is very long');
      recommendations.push('Consider breaking into smaller documents');
      score -= 0.1;
    }

    // Check structure
    if (metadata.structure.headings.length === 0) {
      issues.push('No headings found');
      recommendations.push('Add section headings to improve structure');
      score -= 0.2;
    }

    // Check readability
    if (metadata.quality.readability < 0.5) {
      issues.push('Poor readability');
      recommendations.push('Simplify sentence structure and use clearer language');
      score -= 0.15;
    }

    // Check completeness
    if (metadata.quality.completeness < 0.7) {
      issues.push('Content appears incomplete');
      recommendations.push('Add more comprehensive information');
      score -= 0.1;
    }

    // Check for broken formatting
    if (this.hasBrokenFormatting(content)) {
      issues.push('Formatting issues detected');
      recommendations.push('Fix formatting inconsistencies');
      score -= 0.1;
    }

    // Check for missing metadata
    if (!metadata.structure.headings.length && !metadata.structure.lists.length) {
      issues.push('Lacks structural elements');
      recommendations.push('Add lists, headings, or other structural elements');
      score -= 0.1;
    }

    return {
      score: Math.max(0, Math.min(1, score)),
      issues,
      recommendations
    };
  }

  /**
   * Analyze content characteristics
   */
  private async analyzeContent(content: string, metadata: DocumentMetadata): Promise<{
    type: 'technical' | 'business' | 'academic' | 'general';
    complexity: number;
    readability: number;
    topics: string[];
    entities: {
      people: string[];
      organizations: string[];
      locations: string[];
      dates: string[];
    };
  }> {
    // Determine document type
    const type = this.classifyDocumentType(content);

    // Extract topics using keyword analysis
    const topics = await this.extractTopics(content);

    // Extract entities
    const entities = await this.metadataExtractor.extractEntities(content);

    return {
      type,
      complexity: metadata.content.complexity,
      readability: metadata.quality.readability,
      topics,
      entities
    };
  }

  /**
   * Analyze document structure
   */
  private async analyzeStructure(content: string, metadata: DocumentMetadata): Promise<{
    hasProperHierarchy: boolean;
    sectionBalance: number;
    navigationScore: number;
    consistencyScore: number;
  }> {
    const headings = metadata.structure.headings;
    const sections = metadata.structure.sections;

    // Check heading hierarchy
    const hasProperHierarchy = this.checkHeadingHierarchy(headings);

    // Calculate section balance (how evenly distributed sections are)
    const sectionBalance = this.calculateSectionBalance(sections);

    // Calculate navigation score (ease of finding information)
    const navigationScore = this.calculateNavigationScore(headings, sections);

    // Calculate consistency score (formatting and style consistency)
    const consistencyScore = this.calculateConsistencyScore(content, metadata);

    return {
      hasProperHierarchy,
      sectionBalance,
      navigationScore,
      consistencyScore
    };
  }

  /**
   * Find duplicate content
   */
  private async findDuplicates(
    documentId: string,
    content: string,
    tenantId: string
  ): Promise<{
    similarDocuments: Array<{
      documentId: string;
      similarity: number;
      title: string;
    }>;
    duplicateChunks: Array<{
      chunkId: string;
      similarity: number;
      content: string;
    }>;
  }> {
    try {
      // Get other documents in the same tenant
      const otherDocuments = await prisma.knowledgeDocument.findMany({
        where: {
          tenantId,
          id: { not: documentId }
        },
        select: {
          id: true,
          title: true,
          content: true
        },
        take: 100 // Limit for performance
      });

      const similarDocuments = [];
      
      // Simple similarity check (in production, would use embeddings)
      for (const doc of otherDocuments) {
        if (doc.content) {
          const similarity = this.calculateTextSimilarity(content, doc.content);
          if (similarity > 0.7) {
            similarDocuments.push({
              documentId: doc.id,
              similarity,
              title: doc.title || 'Untitled'
            });
          }
        }
      }

      // Find duplicate chunks (simplified)
      const duplicateChunks = await this.findDuplicateChunks(documentId, content, tenantId);

      return {
        similarDocuments: similarDocuments.sort((a, b) => b.similarity - a.similarity),
        duplicateChunks
      };
    } catch (error) {
      console.error('Error finding duplicates:', error);
      return { similarDocuments: [], duplicateChunks: [] };
    }
  }

  /**
   * Analyze language characteristics
   */
  private async analyzeLanguage(content: string): Promise<{
    detected: string;
    confidence: number;
    multiLanguage: boolean;
  }> {
    // Simple language detection (in production, would use proper language detection library)
    const detected = await this.detectLanguage(content);
    const confidence = 0.8; // Simplified
    const multiLanguage = this.detectMultiLanguage(content);

    return {
      detected,
      confidence,
      multiLanguage
    };
  }

  /**
   * Analyze sentiment
   */
  private async analyzeSentiment(content: string): Promise<{
    overall: 'positive' | 'neutral' | 'negative';
    score: number;
    confidence: number;
  }> {
    // Simple sentiment analysis (in production, would use ML models)
    const sentimentScore = this.calculateSentimentScore(content);
    
    let overall: 'positive' | 'neutral' | 'negative' = 'neutral';
    if (sentimentScore > 0.1) overall = 'positive';
    else if (sentimentScore < -0.1) overall = 'negative';

    return {
      overall,
      score: sentimentScore,
      confidence: 0.7 // Simplified
    };
  }

  /**
   * Generate processing recommendations
   */
  private async generateRecommendations(
    content: string,
    metadata: DocumentMetadata,
    qualityAnalysis: any,
    contentAnalysis: any,
    structureAnalysis: any
  ): Promise<{
    processing: string[];
    chunking: string[];
    indexing: string[];
  }> {
    const processing: string[] = [];
    const chunking: string[] = [];
    const indexing: string[] = [];

    // Processing recommendations
    if (contentAnalysis.type === 'technical') {
      processing.push('Enable code block detection');
      processing.push('Extract technical terms for glossary');
    }

    if (metadata.structure.tables.length > 0) {
      processing.push('Use table-aware processing');
      chunking.push('Preserve table structure in chunks');
    }

    if (metadata.structure.codeBlocks.length > 0) {
      processing.push('Enable syntax highlighting');
      chunking.push('Keep code blocks intact');
    }

    // Chunking recommendations
    if (structureAnalysis.hasProperHierarchy) {
      chunking.push('Use hierarchical chunking strategy');
    } else {
      chunking.push('Use semantic chunking strategy');
    }

    if (metadata.content.wordCount > 5000) {
      chunking.push('Use smaller chunk sizes for better granularity');
    }

    if (contentAnalysis.complexity > 0.7) {
      chunking.push('Increase chunk overlap for complex content');
    }

    // Indexing recommendations
    if (contentAnalysis.topics.length > 5) {
      indexing.push('Create topic-based collections');
    }

    if (contentAnalysis.entities.people.length > 0) {
      indexing.push('Index person entities for faceted search');
    }

    if (contentAnalysis.entities.organizations.length > 0) {
      indexing.push('Index organization entities');
    }

    return { processing, chunking, indexing };
  }

  /**
   * Classify document type
   */
  private classifyDocumentType(content: string): 'technical' | 'business' | 'academic' | 'general' {
    const technicalKeywords = ['api', 'function', 'class', 'method', 'algorithm', 'code', 'programming'];
    const businessKeywords = ['revenue', 'profit', 'market', 'strategy', 'customer', 'sales', 'business'];
    const academicKeywords = ['research', 'study', 'analysis', 'hypothesis', 'methodology', 'conclusion'];

    const lowerContent = content.toLowerCase();
    
    const technicalCount = technicalKeywords.filter(word => lowerContent.includes(word)).length;
    const businessCount = businessKeywords.filter(word => lowerContent.includes(word)).length;
    const academicCount = academicKeywords.filter(word => lowerContent.includes(word)).length;

    if (technicalCount >= businessCount && technicalCount >= academicCount) return 'technical';
    if (businessCount >= academicCount) return 'business';
    if (academicCount > 0) return 'academic';
    
    return 'general';
  }

  /**
   * Extract topics from content
   */
  private async extractTopics(content: string): Promise<string[]> {
    // Simple topic extraction using keyword frequency
    const keywords = await this.metadataExtractor.extractKeywords(content, 20);
    
    // Group related keywords into topics (simplified)
    const topics: string[] = [];
    const topicGroups = this.groupKeywordsIntoTopics(keywords);
    
    return topicGroups.slice(0, 10); // Return top 10 topics
  }

  /**
   * Group keywords into topics
   */
  private groupKeywordsIntoTopics(keywords: string[]): string[] {
    // Simplified topic grouping
    const topics = new Set<string>();
    
    for (const keyword of keywords) {
      if (keyword.length > 3) {
        topics.add(keyword);
      }
    }
    
    return Array.from(topics);
  }

  /**
   * Check if content has broken formatting
   */
  private hasBrokenFormatting(content: string): boolean {
    // Check for common formatting issues
    const issues = [
      /\s{3,}/, // Multiple consecutive spaces
      /\n{4,}/, // Too many line breaks
      /[^\w\s.,!?;:()\-"']/g, // Unusual characters
      /\w{50,}/ // Very long words (likely broken)
    ];

    return issues.some(pattern => pattern.test(content));
  }

  /**
   * Check heading hierarchy
   */
  private checkHeadingHierarchy(headings: any[]): boolean {
    if (headings.length < 2) return true;

    for (let i = 1; i < headings.length; i++) {
      const diff = headings[i].level - headings[i - 1].level;
      if (diff > 1) return false; // Skipped levels
    }

    return true;
  }

  /**
   * Calculate section balance
   */
  private calculateSectionBalance(sections: any[]): number {
    if (sections.length < 2) return 1;

    const lengths = sections.map(s => s.content.length);
    const avg = lengths.reduce((sum, len) => sum + len, 0) / lengths.length;
    const variance = lengths.reduce((sum, len) => sum + Math.pow(len - avg, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);

    // Lower standard deviation relative to mean = better balance
    return Math.max(0, 1 - (stdDev / avg));
  }

  /**
   * Calculate navigation score
   */
  private calculateNavigationScore(headings: any[], sections: any[]): number {
    let score = 0;

    // Points for having headings
    if (headings.length > 0) score += 0.4;

    // Points for proper hierarchy
    if (this.checkHeadingHierarchy(headings)) score += 0.3;

    // Points for reasonable section count
    if (sections.length >= 3 && sections.length <= 10) score += 0.3;

    return Math.min(1, score);
  }

  /**
   * Calculate consistency score
   */
  private calculateConsistencyScore(content: string, metadata: DocumentMetadata): number {
    let score = 1;

    // Check for consistent heading formats
    const headingFormats = metadata.structure.headings.map(h => {
      if (content.includes(`${'#'.repeat(h.level)} ${h.text}`)) return 'markdown';
      return 'other';
    });

    const uniqueFormats = new Set(headingFormats);
    if (uniqueFormats.size > 1) score -= 0.2;

    // Check for consistent list formats
    const hasOrderedLists = metadata.structure.lists.some(l => l.type === 'ordered');
    const hasUnorderedLists = metadata.structure.lists.some(l => l.type === 'unordered');
    
    if (hasOrderedLists && hasUnorderedLists) {
      // Mixed list types can be inconsistent if not used purposefully
      score -= 0.1;
    }

    return Math.max(0, score);
  }

  /**
   * Calculate text similarity (simplified)
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  /**
   * Find duplicate chunks
   */
  private async findDuplicateChunks(
    documentId: string,
    content: string,
    tenantId: string
  ): Promise<Array<{
    chunkId: string;
    similarity: number;
    content: string;
  }>> {
    try {
      // Get existing chunks from other documents
      const existingChunks = await prisma.documentChunk.findMany({
        where: {
          tenantId,
          documentId: { not: documentId }
        },
        select: {
          id: true,
          content: true
        },
        take: 500 // Limit for performance
      });

      const duplicates = [];
      const contentChunks = this.splitIntoChunks(content);

      for (const chunk of contentChunks) {
        for (const existing of existingChunks) {
          const similarity = this.calculateTextSimilarity(chunk, existing.content);
          if (similarity > 0.8) {
            duplicates.push({
              chunkId: existing.id,
              similarity,
              content: existing.content.slice(0, 200) + '...'
            });
          }
        }
      }

      return duplicates.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
    } catch (error) {
      console.error('Error finding duplicate chunks:', error);
      return [];
    }
  }

  /**
   * Split content into chunks for analysis
   */
  private splitIntoChunks(content: string): string[] {
    // Simple chunking for duplicate detection
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const chunks = [];
    
    for (let i = 0; i < sentences.length; i += 5) {
      const chunk = sentences.slice(i, i + 5).join('. ');
      if (chunk.length > 100) {
        chunks.push(chunk);
      }
    }
    
    return chunks;
  }

  /**
   * Detect language (simplified)
   */
  private async detectLanguage(content: string): Promise<string> {
    // Simple heuristic-based language detection
    const sample = content.slice(0, 1000).toLowerCase();
    
    const englishWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of'];
    const englishCount = englishWords.reduce((count, word) => {
      return count + (sample.split(word).length - 1);
    }, 0);

    if (englishCount > 10) return 'en';
    return 'unknown';
  }

  /**
   * Detect if content contains multiple languages
   */
  private detectMultiLanguage(content: string): boolean {
    // Simple check for mixed scripts or language indicators
    const hasLatin = /[a-zA-Z]/.test(content);
    const hasCyrillic = /[\u0400-\u04FF]/.test(content);
    const hasArabic = /[\u0600-\u06FF]/.test(content);
    const hasCJK = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/.test(content);

    const scriptCount = [hasLatin, hasCyrillic, hasArabic, hasCJK].filter(Boolean).length;
    return scriptCount > 1;
  }

  /**
   * Calculate sentiment score (simplified)
   */
  private calculateSentimentScore(content: string): number {
    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'positive', 'success'];
    const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'negative', 'failure', 'problem', 'issue'];

    const lowerContent = content.toLowerCase();
    
    const positiveCount = positiveWords.filter(word => lowerContent.includes(word)).length;
    const negativeCount = negativeWords.filter(word => lowerContent.includes(word)).length;

    const totalWords = content.split(/\s+/).length;
    const positiveScore = positiveCount / totalWords;
    const negativeScore = negativeCount / totalWords;

    return positiveScore - negativeScore;
  }

  /**
   * Batch analyze multiple documents
   */
  async batchAnalyzeDocuments(
    documentIds: string[],
    tenantId: string
  ): Promise<DocumentAnalysisResult[]> {
    const results: DocumentAnalysisResult[] = [];

    for (const documentId of documentIds) {
      try {
        const document = await prisma.knowledgeDocument.findFirst({
          where: { id: documentId, tenantId }
        });

        if (document && document.content) {
          const analysis = await this.analyzeDocument(documentId, document.content, tenantId);
          results.push(analysis);
        }
      } catch (error) {
        console.error(`Error analyzing document ${documentId}:`, error);
      }
    }

    return results;
  }

  /**
   * Get analysis summary for tenant
   */
  async getAnalysisSummary(tenantId: string): Promise<{
    totalDocuments: number;
    averageQuality: number;
    commonIssues: string[];
    documentTypes: Record<string, number>;
    languageDistribution: Record<string, number>;
  }> {
    try {
      // This would aggregate analysis results from database
      // For now, return mock data
      return {
        totalDocuments: 0,
        averageQuality: 0,
        commonIssues: [],
        documentTypes: {},
        languageDistribution: {}
      };
    } catch (error) {
      throw new AppError(`Failed to get analysis summary: ${error}`, 500);
    }
  }
}
