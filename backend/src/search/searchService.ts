import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { sanitizeInput } from '../utils/sanitizer';

const prisma = new PrismaClient();

export interface SearchOptions {
  limit?: number;
  offset?: number;
  dateFrom?: Date;
  dateTo?: Date;
  conversationId?: string;
  userId?: string;
  fileTypes?: string[];
  sortBy?: 'relevance' | 'date' | 'sender';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchResult {
  id: string;
  content: string;
  conversationId: string;
  userId?: string;
  createdAt: Date;
  messageType: string;
  relevanceScore?: number;
  highlights?: string[];
  conversation?: {
    id: string;
    title?: string;
  };
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface ConversationSearchResult {
  id: string;
  title?: string;
  lastMessageAt?: Date;
  participantCount: number;
  messageCount: number;
  relevanceScore?: number;
}

export class SearchService {
  // Search messages with full-text search
  public async searchMessages(
    query: string,
    tenantId: string,
    options: SearchOptions = {}
  ): Promise<{
    results: SearchResult[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const sanitizedQuery = sanitizeInput(query);
      const limit = Math.min(options.limit || 50, 100);
      const offset = options.offset || 0;

      // Build where clause
      const whereClause: any = {
        tenantId,
        deleted: false,
      };

      // Add conversation filter
      if (options.conversationId) {
        whereClause.conversationId = options.conversationId;
      }

      // Add user filter
      if (options.userId) {
        whereClause.userId = options.userId;
      }

      // Add date filters
      if (options.dateFrom || options.dateTo) {
        whereClause.createdAt = {};
        if (options.dateFrom) {
          whereClause.createdAt.gte = options.dateFrom;
        }
        if (options.dateTo) {
          whereClause.createdAt.lte = options.dateTo;
        }
      }

      // Add content search
      if (sanitizedQuery) {
        whereClause.OR = [
          {
            content: {
              contains: sanitizedQuery,
              mode: 'insensitive',
            },
          },
          {
            searchIndex: {
              content: {
                contains: sanitizedQuery,
                mode: 'insensitive',
              },
            },
          },
        ];
      }

      // Build order by clause
      let orderBy: any = { createdAt: 'desc' };
      if (options.sortBy === 'date') {
        orderBy = { createdAt: options.sortOrder || 'desc' };
      }

      // Execute search
      const [messages, total] = await Promise.all([
        prisma.message.findMany({
          where: whereClause,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            conversation: {
              select: {
                id: true,
                title: true,
              },
            },
          },
          orderBy,
          take: limit,
          skip: offset,
        }),
        prisma.message.count({ where: whereClause }),
      ]);

      // Calculate relevance scores and highlights
      const results: SearchResult[] = messages.map(message => {
        const result: SearchResult = {
          id: message.id,
          content: message.content,
          conversationId: message.conversationId,
          userId: message.userId || undefined,
          createdAt: message.createdAt,
          messageType: message.type,
          conversation: message.conversation,
          user: message.user || undefined,
        };

        // Add relevance score and highlights if query provided
        if (sanitizedQuery) {
          result.relevanceScore = this.calculateRelevanceScore(
            message.content,
            sanitizedQuery
          );
          result.highlights = this.extractHighlights(
            message.content,
            sanitizedQuery
          );
        }

        return result;
      });

      // Sort by relevance if specified
      if (options.sortBy === 'relevance' && sanitizedQuery) {
        results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
      }

      logger.info('Message search completed', {
        query: sanitizedQuery,
        tenantId,
        resultCount: results.length,
        total,
      });

      return {
        results,
        total,
        hasMore: offset + results.length < total,
      };
    } catch (error) {
      logger.error('Message search failed', {
        error: error.message,
        query,
        tenantId,
      });
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  // Search conversations
  public async searchConversations(
    query: string,
    tenantId: string,
    options: SearchOptions = {}
  ): Promise<{
    results: ConversationSearchResult[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const sanitizedQuery = sanitizeInput(query);
      const limit = Math.min(options.limit || 20, 50);
      const offset = options.offset || 0;

      // Build where clause
      const whereClause: any = {
        tenantId,
      };

      if (sanitizedQuery) {
        whereClause.OR = [
          {
            title: {
              contains: sanitizedQuery,
              mode: 'insensitive',
            },
          },
          {
            messages: {
              some: {
                content: {
                  contains: sanitizedQuery,
                  mode: 'insensitive',
                },
                deleted: false,
              },
            },
          },
        ];
      }

      // Add date filters
      if (options.dateFrom || options.dateTo) {
        whereClause.createdAt = {};
        if (options.dateFrom) {
          whereClause.createdAt.gte = options.dateFrom;
        }
        if (options.dateTo) {
          whereClause.createdAt.lte = options.dateTo;
        }
      }

      // Execute search
      const [conversations, total] = await Promise.all([
        prisma.conversation.findMany({
          where: whereClause,
          include: {
            _count: {
              select: {
                messages: {
                  where: { deleted: false },
                },
                participants: true,
              },
            },
          },
          orderBy: {
            lastMessageAt: 'desc',
          },
          take: limit,
          skip: offset,
        }),
        prisma.conversation.count({ where: whereClause }),
      ]);

      // Format results
      const results: ConversationSearchResult[] = conversations.map(conv => ({
        id: conv.id,
        title: conv.title,
        lastMessageAt: conv.lastMessageAt || undefined,
        participantCount: conv._count.participants,
        messageCount: conv._count.messages,
        relevanceScore: sanitizedQuery
          ? this.calculateConversationRelevance(conv.title || '', sanitizedQuery)
          : undefined,
      }));

      logger.info('Conversation search completed', {
        query: sanitizedQuery,
        tenantId,
        resultCount: results.length,
        total,
      });

      return {
        results,
        total,
        hasMore: offset + results.length < total,
      };
    } catch (error) {
      logger.error('Conversation search failed', {
        error: error.message,
        query,
        tenantId,
      });
      throw new Error(`Conversation search failed: ${error.message}`);
    }
  }

  // Get search suggestions
  public async getSearchSuggestions(
    query: string,
    tenantId: string,
    limit = 10
  ): Promise<string[]> {
    try {
      const sanitizedQuery = sanitizeInput(query);
      
      if (!sanitizedQuery || sanitizedQuery.length < 2) {
        return [];
      }

      // Get recent unique words from messages
      const recentMessages = await prisma.message.findMany({
        where: {
          tenantId,
          deleted: false,
          content: {
            contains: sanitizedQuery,
            mode: 'insensitive',
          },
        },
        select: {
          content: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 100,
      });

      // Extract words and create suggestions
      const words = new Set<string>();
      const queryLower = sanitizedQuery.toLowerCase();

      recentMessages.forEach(message => {
        const messageWords = message.content
          .toLowerCase()
          .split(/\s+/)
          .filter(word => 
            word.length > 2 && 
            word.includes(queryLower) &&
            word !== queryLower
          );
        
        messageWords.forEach(word => words.add(word));
      });

      // Sort by relevance and return top suggestions
      const suggestions = Array.from(words)
        .sort((a, b) => {
          const aStartsWith = a.startsWith(queryLower);
          const bStartsWith = b.startsWith(queryLower);
          
          if (aStartsWith && !bStartsWith) return -1;
          if (!aStartsWith && bStartsWith) return 1;
          
          return a.length - b.length;
        })
        .slice(0, limit);

      return suggestions;
    } catch (error) {
      logger.error('Search suggestions failed', {
        error: error.message,
        query,
        tenantId,
      });
      return [];
    }
  }

  // Index message for search
  public async indexMessage(messageId: string, tenantId: string): Promise<void> {
    try {
      const message = await prisma.message.findFirst({
        where: {
          id: messageId,
          tenantId,
        },
      });

      if (!message) {
        return;
      }

      // Create or update search index
      await prisma.searchIndex.upsert({
        where: {
          messageId,
        },
        create: {
          tenantId,
          conversationId: message.conversationId,
          messageId,
          content: message.content,
          searchVector: this.generateSearchVector(message.content),
        },
        update: {
          content: message.content,
          searchVector: this.generateSearchVector(message.content),
          updatedAt: new Date(),
        },
      });

      logger.debug('Message indexed for search', {
        messageId,
        tenantId,
      });
    } catch (error) {
      logger.error('Message indexing failed', {
        error: error.message,
        messageId,
        tenantId,
      });
    }
  }

  // Reindex all messages for a tenant
  public async reindexTenant(tenantId: string): Promise<number> {
    try {
      let indexed = 0;
      let offset = 0;
      const batchSize = 100;

      while (true) {
        const messages = await prisma.message.findMany({
          where: {
            tenantId,
            deleted: false,
          },
          select: {
            id: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
          take: batchSize,
          skip: offset,
        });

        if (messages.length === 0) {
          break;
        }

        // Index messages in batch
        const indexPromises = messages.map(message =>
          this.indexMessage(message.id, tenantId)
        );
        
        await Promise.all(indexPromises);
        
        indexed += messages.length;
        offset += batchSize;

        logger.info('Batch indexed', {
          tenantId,
          batchSize: messages.length,
          totalIndexed: indexed,
        });
      }

      logger.info('Tenant reindexing completed', {
        tenantId,
        totalIndexed: indexed,
      });

      return indexed;
    } catch (error) {
      logger.error('Tenant reindexing failed', {
        error: error.message,
        tenantId,
      });
      throw error;
    }
  }

  // Private helper methods
  private calculateRelevanceScore(content: string, query: string): number {
    const contentLower = content.toLowerCase();
    const queryLower = query.toLowerCase();
    
    let score = 0;
    
    // Exact match bonus
    if (contentLower.includes(queryLower)) {
      score += 10;
    }
    
    // Word match scoring
    const queryWords = queryLower.split(/\s+/);
    const contentWords = contentLower.split(/\s+/);
    
    queryWords.forEach(queryWord => {
      contentWords.forEach(contentWord => {
        if (contentWord === queryWord) {
          score += 5;
        } else if (contentWord.includes(queryWord)) {
          score += 2;
        }
      });
    });
    
    // Length penalty (shorter messages with matches are more relevant)
    score = score / Math.log(content.length + 1);
    
    return Math.round(score * 100) / 100;
  }

  private calculateConversationRelevance(title: string, query: string): number {
    if (!title) return 0;
    
    const titleLower = title.toLowerCase();
    const queryLower = query.toLowerCase();
    
    if (titleLower.includes(queryLower)) {
      return titleLower === queryLower ? 100 : 80;
    }
    
    const queryWords = queryLower.split(/\s+/);
    const titleWords = titleLower.split(/\s+/);
    
    let matches = 0;
    queryWords.forEach(queryWord => {
      if (titleWords.some(titleWord => titleWord.includes(queryWord))) {
        matches++;
      }
    });
    
    return (matches / queryWords.length) * 60;
  }

  private extractHighlights(content: string, query: string, maxLength = 150): string[] {
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();
    
    const highlights: string[] = [];
    let startIndex = 0;
    
    while (startIndex < content.length) {
      const matchIndex = contentLower.indexOf(queryLower, startIndex);
      
      if (matchIndex === -1) {
        break;
      }
      
      // Extract context around the match
      const contextStart = Math.max(0, matchIndex - 50);
      const contextEnd = Math.min(content.length, matchIndex + queryLower.length + 50);
      
      let highlight = content.substring(contextStart, contextEnd);
      
      // Add ellipsis if truncated
      if (contextStart > 0) {
        highlight = '...' + highlight;
      }
      if (contextEnd < content.length) {
        highlight = highlight + '...';
      }
      
      highlights.push(highlight);
      startIndex = matchIndex + queryLower.length;
      
      // Limit number of highlights
      if (highlights.length >= 3) {
        break;
      }
    }
    
    return highlights;
  }

  private generateSearchVector(content: string): string {
    // Simple search vector generation
    // In production, you might want to use more sophisticated text processing
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .slice(0, 50); // Limit vector size
    
    return words.join(' ');
  }
}
