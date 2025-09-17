import { PrismaClient } from '@prisma/client';
import { AppError } from '../../middlewares/errorHandler';

const prisma = new PrismaClient();

export interface SearchFacet {
  name: string;
  type: 'text' | 'date' | 'number' | 'boolean' | 'category';
  values: Array<{
    value: string | number | boolean;
    count: number;
    label?: string;
  }>;
  min?: number;
  max?: number;
}

export interface FacetedSearchQuery {
  query?: string;
  facets?: Record<string, any>;
  filters?: {
    dateRange?: { start: Date; end: Date };
    documentTypes?: string[];
    collections?: string[];
    authors?: string[];
    tags?: string[];
    qualityScore?: { min: number; max: number };
    fileSize?: { min: number; max: number };
  };
  sort?: {
    field: 'relevance' | 'date' | 'title' | 'quality' | 'size';
    order: 'asc' | 'desc';
  };
  pagination?: {
    page: number;
    limit: number;
  };
}

export interface FacetedSearchResult {
  documents: Array<{
    id: string;
    title: string;
    content: string;
    relevanceScore: number;
    metadata: {
      author?: string;
      createdAt: Date;
      updatedAt: Date;
      fileType?: string;
      fileSize?: number;
      tags?: string[];
      qualityScore?: number;
      collection?: {
        id: string;
        name: string;
      };
    };
    highlights?: {
      title?: string[];
      content?: string[];
    };
  }>;
  facets: SearchFacet[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  aggregations: {
    totalDocuments: number;
    averageQuality: number;
    documentTypes: Record<string, number>;
    timeDistribution: Record<string, number>;
  };
  suggestions?: {
    queries: string[];
    filters: Array<{
      facet: string;
      value: string;
      count: number;
    }>;
  };
}

export class FacetedSearchService {
  /**
   * Perform faceted search with advanced filtering
   */
  async search(
    tenantId: string,
    searchQuery: FacetedSearchQuery
  ): Promise<FacetedSearchResult> {
    try {
      // Build base query
      const whereClause = this.buildWhereClause(tenantId, searchQuery);
      
      // Get documents with pagination
      const documents = await this.getDocuments(whereClause, searchQuery);
      
      // Generate facets
      const facets = await this.generateFacets(tenantId, searchQuery);
      
      // Get aggregations
      const aggregations = await this.getAggregations(tenantId, searchQuery);
      
      // Generate suggestions
      const suggestions = await this.generateSuggestions(tenantId, searchQuery);
      
      // Calculate pagination
      const total = await prisma.knowledgeDocument.count({ where: whereClause });
      const page = searchQuery.pagination?.page || 1;
      const limit = searchQuery.pagination?.limit || 20;
      
      return {
        documents: await this.processDocuments(documents, searchQuery.query),
        facets,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        },
        aggregations,
        suggestions
      };
    } catch (error) {
      throw new AppError(`Faceted search failed: ${error}`, 500);
    }
  }

  /**
   * Get available facets for a tenant
   */
  async getAvailableFacets(tenantId: string): Promise<SearchFacet[]> {
    try {
      const facets: SearchFacet[] = [];

      // Document type facet
      const documentTypes = await this.getDocumentTypeFacet(tenantId);
      facets.push(documentTypes);

      // Collection facet
      const collections = await this.getCollectionFacet(tenantId);
      facets.push(collections);

      // Author facet
      const authors = await this.getAuthorFacet(tenantId);
      facets.push(authors);

      // Tags facet
      const tags = await this.getTagsFacet(tenantId);
      facets.push(tags);

      // Date facet
      const dateRanges = await this.getDateRangeFacet(tenantId);
      facets.push(dateRanges);

      // Quality score facet
      const qualityScore = await this.getQualityScoreFacet(tenantId);
      facets.push(qualityScore);

      // File size facet
      const fileSize = await this.getFileSizeFacet(tenantId);
      facets.push(fileSize);

      return facets;
    } catch (error) {
      throw new AppError(`Failed to get available facets: ${error}`, 500);
    }
  }

  /**
   * Get search suggestions based on query
   */
  async getSearchSuggestions(
    tenantId: string,
    partialQuery: string,
    limit: number = 10
  ): Promise<{
    queries: string[];
    documents: Array<{
      id: string;
      title: string;
      relevance: number;
    }>;
  }> {
    try {
      // Get query suggestions from search analytics
      const querySuggestions = await this.getQuerySuggestions(tenantId, partialQuery, limit);
      
      // Get document suggestions
      const documentSuggestions = await this.getDocumentSuggestions(tenantId, partialQuery, limit);

      return {
        queries: querySuggestions,
        documents: documentSuggestions
      };
    } catch (error) {
      throw new AppError(`Failed to get search suggestions: ${error}`, 500);
    }
  }

  /**
   * Advanced multi-modal search
   */
  async multiModalSearch(
    tenantId: string,
    searchQuery: {
      text?: string;
      semantic?: string;
      filters?: FacetedSearchQuery['filters'];
      includeImages?: boolean;
      includeTables?: boolean;
      includeCode?: boolean;
    }
  ): Promise<FacetedSearchResult> {
    try {
      // Combine different search modes
      const results: any[] = [];

      // Text-based search
      if (searchQuery.text) {
        const textResults = await this.performTextSearch(tenantId, searchQuery.text, searchQuery.filters);
        results.push(...textResults);
      }

      // Semantic search (would integrate with vector search)
      if (searchQuery.semantic) {
        const semanticResults = await this.performSemanticSearch(tenantId, searchQuery.semantic, searchQuery.filters);
        results.push(...semanticResults);
      }

      // Content type specific searches
      if (searchQuery.includeImages) {
        const imageResults = await this.searchImageContent(tenantId, searchQuery.text || searchQuery.semantic || '', searchQuery.filters);
        results.push(...imageResults);
      }

      if (searchQuery.includeTables) {
        const tableResults = await this.searchTableContent(tenantId, searchQuery.text || searchQuery.semantic || '', searchQuery.filters);
        results.push(...tableResults);
      }

      if (searchQuery.includeCode) {
        const codeResults = await this.searchCodeContent(tenantId, searchQuery.text || searchQuery.semantic || '', searchQuery.filters);
        results.push(...codeResults);
      }

      // Merge and rank results
      const mergedResults = await this.mergeAndRankResults(results);

      // Generate facets for combined results
      const facets = await this.generateFacets(tenantId, { filters: searchQuery.filters });

      return {
        documents: mergedResults,
        facets,
        pagination: {
          total: mergedResults.length,
          page: 1,
          limit: mergedResults.length,
          totalPages: 1
        },
        aggregations: await this.getAggregations(tenantId, { filters: searchQuery.filters }),
        suggestions: await this.generateSuggestions(tenantId, { query: searchQuery.text || searchQuery.semantic })
      };
    } catch (error) {
      throw new AppError(`Multi-modal search failed: ${error}`, 500);
    }
  }

  // Private helper methods

  private buildWhereClause(tenantId: string, searchQuery: FacetedSearchQuery): any {
    const where: any = { tenantId };

    // Text search
    if (searchQuery.query) {
      where.OR = [
        { title: { contains: searchQuery.query, mode: 'insensitive' } },
        { content: { contains: searchQuery.query, mode: 'insensitive' } }
      ];
    }

    // Filters
    if (searchQuery.filters) {
      const filters = searchQuery.filters;

      if (filters.dateRange) {
        where.createdAt = {
          gte: filters.dateRange.start,
          lte: filters.dateRange.end
        };
      }

      if (filters.documentTypes && filters.documentTypes.length > 0) {
        where.fileType = { in: filters.documentTypes };
      }

      if (filters.collections && filters.collections.length > 0) {
        where.collectionId = { in: filters.collections };
      }

      if (filters.authors && filters.authors.length > 0) {
        where.createdBy = { in: filters.authors };
      }

      if (filters.tags && filters.tags.length > 0) {
        where.tags = {
          hasSome: filters.tags
        };
      }

      if (filters.fileSize) {
        where.fileSize = {
          gte: filters.fileSize.min,
          lte: filters.fileSize.max
        };
      }
    }

    return where;
  }

  private async getDocuments(whereClause: any, searchQuery: FacetedSearchQuery): Promise<any[]> {
    const page = searchQuery.pagination?.page || 1;
    const limit = searchQuery.pagination?.limit || 20;
    const skip = (page - 1) * limit;

    // Build order by clause
    let orderBy: any = { createdAt: 'desc' };
    if (searchQuery.sort) {
      switch (searchQuery.sort.field) {
        case 'title':
          orderBy = { title: searchQuery.sort.order };
          break;
        case 'date':
          orderBy = { createdAt: searchQuery.sort.order };
          break;
        case 'size':
          orderBy = { fileSize: searchQuery.sort.order };
          break;
        default:
          orderBy = { createdAt: 'desc' };
      }
    }

    return await prisma.knowledgeDocument.findMany({
      where: whereClause,
      include: {
        collection: {
          select: { id: true, name: true }
        }
      },
      orderBy,
      skip,
      take: limit
    });
  }

  private async processDocuments(documents: any[], query?: string): Promise<any[]> {
    return documents.map(doc => ({
      id: doc.id,
      title: doc.title || 'Untitled',
      content: this.truncateContent(doc.content || '', 300),
      relevanceScore: this.calculateRelevanceScore(doc, query),
      metadata: {
        author: doc.createdBy,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        tags: doc.tags || [],
        qualityScore: doc.qualityScore,
        collection: doc.collection
      },
      highlights: query ? this.generateHighlights(doc, query) : undefined
    }));
  }

  private async generateFacets(tenantId: string, searchQuery: FacetedSearchQuery): Promise<SearchFacet[]> {
    const facets: SearchFacet[] = [];

    // Apply current filters to facet generation
    const baseWhere = this.buildWhereClause(tenantId, { filters: searchQuery.filters });

    // Document type facet
    const docTypes = await prisma.knowledgeDocument.groupBy({
      by: ['fileType'],
      where: baseWhere,
      _count: { fileType: true }
    });

    facets.push({
      name: 'documentType',
      type: 'category',
      values: docTypes.map(dt => ({
        value: dt.fileType || 'unknown',
        count: dt._count.fileType,
        label: this.getFileTypeLabel(dt.fileType)
      }))
    });

    // Collection facet
    const collections = await prisma.knowledgeDocument.groupBy({
      by: ['collectionId'],
      where: { ...baseWhere, collectionId: { not: null } },
      _count: { collectionId: true }
    });

    const collectionDetails = await prisma.knowledgeCollection.findMany({
      where: { id: { in: collections.map(c => c.collectionId!).filter(Boolean) } },
      select: { id: true, name: true }
    });

    facets.push({
      name: 'collection',
      type: 'category',
      values: collections.map(c => {
        const collection = collectionDetails.find(cd => cd.id === c.collectionId);
        return {
          value: c.collectionId!,
          count: c._count.collectionId,
          label: collection?.name || 'Unknown Collection'
        };
      })
    });

    // Date range facet
    const dateStats = await prisma.knowledgeDocument.aggregate({
      where: baseWhere,
      _min: { createdAt: true },
      _max: { createdAt: true }
    });

    if (dateStats._min.createdAt && dateStats._max.createdAt) {
      facets.push({
        name: 'dateRange',
        type: 'date',
        values: [],
        min: dateStats._min.createdAt.getTime(),
        max: dateStats._max.createdAt.getTime()
      });
    }

    return facets;
  }

  private async getAggregations(tenantId: string, searchQuery: FacetedSearchQuery): Promise<any> {
    const where = this.buildWhereClause(tenantId, searchQuery);

    const [totalDocs, docTypes, avgQuality] = await Promise.all([
      prisma.knowledgeDocument.count({ where }),
      prisma.knowledgeDocument.groupBy({
        by: ['fileType'],
        where,
        _count: { fileType: true }
      }),
      prisma.knowledgeDocument.aggregate({
        where,
        _avg: { qualityScore: true }
      })
    ]);

    return {
      totalDocuments: totalDocs,
      averageQuality: avgQuality._avg.qualityScore || 0,
      documentTypes: Object.fromEntries(
        docTypes.map(dt => [dt.fileType || 'unknown', dt._count.fileType])
      ),
      timeDistribution: {} // Would implement time-based aggregation
    };
  }

  private async generateSuggestions(tenantId: string, searchQuery: FacetedSearchQuery): Promise<any> {
    const suggestions = {
      queries: [] as string[],
      filters: [] as any[]
    };

    if (searchQuery.query) {
      // Get related queries from search analytics
      const relatedQueries = await prisma.searchAnalytics.findMany({
        where: {
          tenantId,
          query: { contains: searchQuery.query, mode: 'insensitive' }
        },
        select: { query: true },
        distinct: ['query'],
        take: 5
      });

      suggestions.queries = relatedQueries.map(rq => rq.query);
    }

    return suggestions;
  }

  private async getDocumentTypeFacet(tenantId: string): Promise<SearchFacet> {
    const types = await prisma.knowledgeDocument.groupBy({
      by: ['fileType'],
      where: { tenantId },
      _count: { fileType: true }
    });

    return {
      name: 'documentType',
      type: 'category',
      values: types.map(t => ({
        value: t.fileType || 'unknown',
        count: t._count.fileType,
        label: this.getFileTypeLabel(t.fileType)
      }))
    };
  }

  private async getCollectionFacet(tenantId: string): Promise<SearchFacet> {
    const collections = await prisma.knowledgeCollection.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: { documents: true }
        }
      }
    });

    return {
      name: 'collection',
      type: 'category',
      values: collections.map(c => ({
        value: c.id,
        count: c._count.documents,
        label: c.name
      }))
    };
  }

  private async getAuthorFacet(tenantId: string): Promise<SearchFacet> {
    const authors = await prisma.knowledgeDocument.groupBy({
      by: ['createdBy'],
      where: { tenantId },
      _count: { createdBy: true }
    });

    return {
      name: 'author',
      type: 'category',
      values: authors.map(a => ({
        value: a.createdBy,
        count: a._count.createdBy,
        label: a.createdBy // Would resolve to user name
      }))
    };
  }

  private async getTagsFacet(tenantId: string): Promise<SearchFacet> {
    // This would require a more complex query to extract individual tags
    return {
      name: 'tags',
      type: 'category',
      values: []
    };
  }

  private async getDateRangeFacet(tenantId: string): Promise<SearchFacet> {
    const stats = await prisma.knowledgeDocument.aggregate({
      where: { tenantId },
      _min: { createdAt: true },
      _max: { createdAt: true }
    });

    return {
      name: 'dateRange',
      type: 'date',
      values: [],
      min: stats._min.createdAt?.getTime(),
      max: stats._max.createdAt?.getTime()
    };
  }

  private async getQualityScoreFacet(tenantId: string): Promise<SearchFacet> {
    const stats = await prisma.knowledgeDocument.aggregate({
      where: { tenantId },
      _min: { qualityScore: true },
      _max: { qualityScore: true }
    });

    return {
      name: 'qualityScore',
      type: 'number',
      values: [],
      min: stats._min.qualityScore || 0,
      max: stats._max.qualityScore || 1
    };
  }

  private async getFileSizeFacet(tenantId: string): Promise<SearchFacet> {
    const stats = await prisma.knowledgeDocument.aggregate({
      where: { tenantId },
      _min: { fileSize: true },
      _max: { fileSize: true }
    });

    return {
      name: 'fileSize',
      type: 'number',
      values: [],
      min: stats._min.fileSize || 0,
      max: stats._max.fileSize || 0
    };
  }

  private async getQuerySuggestions(tenantId: string, partialQuery: string, limit: number): Promise<string[]> {
    const suggestions = await prisma.searchAnalytics.findMany({
      where: {
        tenantId,
        query: { contains: partialQuery, mode: 'insensitive' }
      },
      select: { query: true },
      distinct: ['query'],
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return suggestions.map(s => s.query);
  }

  private async getDocumentSuggestions(tenantId: string, partialQuery: string, limit: number): Promise<any[]> {
    const documents = await prisma.knowledgeDocument.findMany({
      where: {
        tenantId,
        OR: [
          { title: { contains: partialQuery, mode: 'insensitive' } },
          { content: { contains: partialQuery, mode: 'insensitive' } }
        ]
      },
      select: { id: true, title: true },
      take: limit
    });

    return documents.map(d => ({
      id: d.id,
      title: d.title || 'Untitled',
      relevance: this.calculateTitleRelevance(d.title || '', partialQuery)
    }));
  }

  private async performTextSearch(tenantId: string, query: string, filters?: any): Promise<any[]> {
    const where = this.buildWhereClause(tenantId, { query, filters });
    return await this.getDocuments(where, {});
  }

  private async performSemanticSearch(tenantId: string, query: string, filters?: any): Promise<any[]> {
    // This would integrate with vector search service
    // For now, return empty array
    return [];
  }

  private async searchImageContent(tenantId: string, query: string, filters?: any): Promise<any[]> {
    // Search documents that contain images with relevant alt text or captions
    return [];
  }

  private async searchTableContent(tenantId: string, query: string, filters?: any): Promise<any[]> {
    // Search within table content
    return [];
  }

  private async searchCodeContent(tenantId: string, query: string, filters?: any): Promise<any[]> {
    // Search within code blocks
    return [];
  }

  private async mergeAndRankResults(resultSets: any[][]): Promise<any[]> {
    // Merge results from different search modes and rank by relevance
    const merged = resultSets.flat();
    
    // Remove duplicates and rank
    const unique = merged.filter((doc, index, self) => 
      index === self.findIndex(d => d.id === doc.id)
    );

    return unique.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private calculateRelevanceScore(document: any, query?: string): number {
    if (!query) return 0.5;

    let score = 0;
    const lowerQuery = query.toLowerCase();
    const title = (document.title || '').toLowerCase();
    const content = (document.content || '').toLowerCase();

    // Title match bonus
    if (title.includes(lowerQuery)) score += 0.5;
    
    // Content match
    const contentMatches = (content.match(new RegExp(lowerQuery, 'gi')) || []).length;
    score += Math.min(contentMatches * 0.1, 0.4);

    // Quality score bonus
    if (document.qualityScore) {
      score += document.qualityScore * 0.1;
    }

    return Math.min(score, 1);
  }

  private calculateTitleRelevance(title: string, query: string): number {
    const lowerTitle = title.toLowerCase();
    const lowerQuery = query.toLowerCase();
    
    if (lowerTitle.includes(lowerQuery)) {
      return 1 - (lowerTitle.indexOf(lowerQuery) / lowerTitle.length);
    }
    
    return 0;
  }

  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  }

  private generateHighlights(document: any, query: string): any {
    const highlights: any = {};
    
    if (document.title && document.title.toLowerCase().includes(query.toLowerCase())) {
      highlights.title = [this.highlightText(document.title, query)];
    }
    
    if (document.content && document.content.toLowerCase().includes(query.toLowerCase())) {
      highlights.content = [this.highlightText(document.content.substring(0, 300), query)];
    }
    
    return highlights;
  }

  private highlightText(text: string, query: string): string {
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  private getFileTypeLabel(fileType?: string): string {
    const labels: Record<string, string> = {
      'pdf': 'PDF Document',
      'docx': 'Word Document',
      'txt': 'Text File',
      'md': 'Markdown',
      'json': 'JSON File',
      'csv': 'CSV File'
    };
    
    return labels[fileType || ''] || fileType || 'Unknown';
  }
}
