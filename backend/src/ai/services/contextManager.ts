import { PrismaClient } from '@prisma/client';
import { ConversationContext, ContextMessage, AIConfiguration } from '../types';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

export class ContextManager {
  private contextCache: Map<string, ConversationContext> = new Map();
  private readonly MAX_CACHE_SIZE = 1000;
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  /**
   * Get conversation context
   */
  async getContext(
    conversationId: string,
    tenantId: string,
    config: AIConfiguration
  ): Promise<ConversationContext> {
    const cacheKey = `${conversationId}:${tenantId}`;
    
    // Check cache first
    const cached = this.contextCache.get(cacheKey);
    if (cached && this.isCacheValid(cached)) {
      return cached;
    }

    // Load from database
    const context = await this.loadContextFromDB(conversationId, tenantId, config);
    
    // Cache the result
    this.setCache(cacheKey, context);
    
    return context;
  }

  /**
   * Add message to context
   */
  async addMessage(
    conversationId: string,
    tenantId: string,
    message: ContextMessage,
    config: AIConfiguration
  ): Promise<ConversationContext> {
    const cacheKey = `${conversationId}:${tenantId}`;
    
    // Get current context
    let context = await this.getContext(conversationId, tenantId, config);
    
    // Add new message
    context.messages.push(message);
    context.totalTokens += message.tokens;
    
    // Trim context if needed
    context = await this.trimContext(context, config);
    
    // Update cache
    this.setCache(cacheKey, context);
    
    return context;
  }

  /**
   * Trim context to fit within token limits
   */
  async trimContext(
    context: ConversationContext,
    config: AIConfiguration
  ): Promise<ConversationContext> {
    if (context.totalTokens <= config.maxTokens) {
      return context;
    }

    logger.info('Trimming conversation context', {
      conversationId: context.conversationId,
      currentTokens: context.totalTokens,
      maxTokens: config.maxTokens,
    });

    // Keep system message and recent messages
    const systemMessages = context.messages.filter(m => m.role === 'system');
    const nonSystemMessages = context.messages.filter(m => m.role !== 'system');
    
    // Calculate tokens for system messages
    const systemTokens = systemMessages.reduce((sum, msg) => sum + msg.tokens, 0);
    const availableTokens = config.maxTokens - systemTokens - 500; // Reserve 500 tokens for response
    
    if (availableTokens <= 0) {
      logger.warn('System messages exceed token limit', {
        conversationId: context.conversationId,
        systemTokens,
        maxTokens: config.maxTokens,
      });
      
      // Keep only the most recent system message
      const recentSystemMessage = systemMessages[systemMessages.length - 1];
      return {
        ...context,
        messages: recentSystemMessage ? [recentSystemMessage] : [],
        totalTokens: recentSystemMessage?.tokens || 0,
      };
    }

    // Keep recent messages within token limit
    const trimmedMessages = [...systemMessages];
    let currentTokens = systemTokens;
    
    // Add messages from most recent backwards
    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      const message = nonSystemMessages[i];
      if (currentTokens + message.tokens <= availableTokens) {
        trimmedMessages.unshift(message);
        currentTokens += message.tokens;
      } else {
        break;
      }
    }

    // Sort messages by timestamp to maintain conversation order
    trimmedMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return {
      ...context,
      messages: trimmedMessages,
      totalTokens: currentTokens,
    };
  }

  /**
   * Summarize old context
   */
  async summarizeContext(
    context: ConversationContext,
    config: AIConfiguration
  ): Promise<ContextMessage> {
    // This would integrate with AI providers to create summaries
    // For now, create a simple summary
    const messageCount = context.messages.length;
    const summary = `Previous conversation summary: ${messageCount} messages exchanged. Key topics and context preserved.`;
    
    return {
      id: `summary_${Date.now()}`,
      role: 'system',
      content: summary,
      tokens: this.estimateTokens(summary),
      timestamp: new Date(),
      metadata: {
        type: 'summary',
        originalMessageCount: messageCount,
      },
    };
  }

  /**
   * Load context from database
   */
  private async loadContextFromDB(
    conversationId: string,
    tenantId: string,
    config: AIConfiguration
  ): Promise<ConversationContext> {
    try {
      // Get recent messages from conversation
      const messages = await prisma.message.findMany({
        where: {
          conversationId,
          tenantId,
          deleted: false,
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
            },
          },
          chatbot: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 50, // Limit initial load
      });

      // Convert to context messages
      const contextMessages: ContextMessage[] = [];
      
      // Add system prompt as first message
      if (config.systemPrompt) {
        contextMessages.push({
          id: 'system_prompt',
          role: 'system',
          content: config.systemPrompt,
          tokens: this.estimateTokens(config.systemPrompt),
          timestamp: new Date(),
          metadata: { type: 'system_prompt' },
        });
      }

      // Add conversation messages
      for (const msg of messages.reverse()) { // Reverse to get chronological order
        const role = msg.userId ? 'user' : 'assistant';
        const tokens = this.estimateTokens(msg.content);
        
        contextMessages.push({
          id: msg.id,
          role,
          content: msg.content,
          tokens,
          timestamp: msg.createdAt,
          metadata: {
            messageId: msg.id,
            userId: msg.userId,
            chatbotId: msg.chatbotId,
          },
        });
      }

      const totalTokens = contextMessages.reduce((sum, msg) => sum + msg.tokens, 0);

      return {
        conversationId,
        tenantId,
        userId: '', // Will be set when needed
        messages: contextMessages,
        totalTokens,
        maxContextTokens: config.maxTokens,
        systemPrompt: config.systemPrompt,
        metadata: {
          loadedAt: new Date(),
          messageCount: messages.length,
        },
      };

    } catch (error) {
      logger.error('Failed to load context from database', {
        error,
        conversationId,
        tenantId,
      });

      // Return minimal context
      return {
        conversationId,
        tenantId,
        userId: '',
        messages: config.systemPrompt ? [{
          id: 'system_prompt',
          role: 'system',
          content: config.systemPrompt,
          tokens: this.estimateTokens(config.systemPrompt),
          timestamp: new Date(),
        }] : [],
        totalTokens: config.systemPrompt ? this.estimateTokens(config.systemPrompt) : 0,
        maxContextTokens: config.maxTokens,
        systemPrompt: config.systemPrompt,
        metadata: {},
      };
    }
  }

  /**
   * Estimate token count for text
   */
  private estimateTokens(text: string): number {
    // Simple estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if cached context is still valid
   */
  private isCacheValid(context: ConversationContext): boolean {
    const loadedAt = context.metadata.loadedAt as Date;
    if (!loadedAt) return false;
    
    return Date.now() - loadedAt.getTime() < this.CACHE_TTL;
  }

  /**
   * Set cache with size management
   */
  private setCache(key: string, context: ConversationContext): void {
    // Remove oldest entries if cache is full
    if (this.contextCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.contextCache.keys().next().value;
      this.contextCache.delete(firstKey);
    }

    // Add timestamp for cache validation
    context.metadata.loadedAt = new Date();
    this.contextCache.set(key, context);
  }

  /**
   * Clear cache for conversation
   */
  clearCache(conversationId: string, tenantId: string): void {
    const cacheKey = `${conversationId}:${tenantId}`;
    this.contextCache.delete(cacheKey);
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    this.contextCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.contextCache.size,
      maxSize: this.MAX_CACHE_SIZE,
      ttl: this.CACHE_TTL,
    };
  }
}
