import { AIResponse, StreamChunk, ModerationResult, AIConfiguration } from '../types';
import { sanitizeInput, sanitizeHtml } from '../../utils/sanitizer';
import { logger } from '../../utils/logger';

export class ResponseProcessor {
  private responseCache: Map<string, AIResponse> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_CACHE_SIZE = 1000;

  /**
   * Process AI response before sending to user
   */
  async processResponse(
    response: AIResponse,
    config: AIConfiguration,
    moderationResult?: ModerationResult
  ): Promise<AIResponse> {
    try {
      let processedContent = response.content;

      // Apply content filtering if enabled
      if (config.safetySettings.contentFiltering && moderationResult?.flagged) {
        processedContent = this.applyContentFilter(processedContent, moderationResult);
      }

      // Sanitize content
      processedContent = this.sanitizeContent(processedContent, config.responseFormat);

      // Apply formatting
      processedContent = this.formatResponse(processedContent, config);

      // Apply custom post-processing rules
      processedContent = await this.applyCustomRules(processedContent, config);

      const processedResponse: AIResponse = {
        ...response,
        content: processedContent,
        metadata: {
          ...response.metadata,
          processed: true,
          originalLength: response.content.length,
          processedLength: processedContent.length,
          filtered: moderationResult?.flagged || false,
        },
      };

      // Cache successful responses
      if (!moderationResult?.flagged) {
        this.cacheResponse(response.id, processedResponse);
      }

      return processedResponse;

    } catch (error) {
      logger.error('Failed to process AI response', {
        error,
        responseId: response.id,
        tenantId: config.tenantId,
      });

      // Return original response if processing fails
      return {
        ...response,
        metadata: {
          ...response.metadata,
          processed: false,
          processingError: error.message,
        },
      };
    }
  }

  /**
   * Process streaming chunk
   */
  processStreamChunk(
    chunk: StreamChunk,
    config: AIConfiguration,
    accumulatedContent: string = ''
  ): StreamChunk {
    try {
      let processedDelta = chunk.delta;
      let processedContent = chunk.content;

      // Basic sanitization for streaming content
      if (processedDelta) {
        processedDelta = this.sanitizeStreamingContent(processedDelta);
      }

      if (processedContent) {
        processedContent = this.sanitizeStreamingContent(processedContent);
      }

      return {
        ...chunk,
        delta: processedDelta,
        content: processedContent,
      };

    } catch (error) {
      logger.error('Failed to process stream chunk', {
        error,
        chunkId: chunk.id,
      });

      return chunk;
    }
  }

  /**
   * Generate fallback response
   */
  generateFallbackResponse(
    error: any,
    config: AIConfiguration,
    conversationId: string
  ): AIResponse {
    const fallbackMessages = [
      "I'm sorry, I'm having trouble processing your request right now. Please try again in a moment.",
      "I apologize for the inconvenience. There seems to be a temporary issue with my response system.",
      "I'm experiencing some technical difficulties. Could you please rephrase your question?",
    ];

    const randomMessage = fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];

    return {
      id: `fallback_${Date.now()}`,
      content: config.customInstructions || randomMessage,
      model: 'fallback',
      provider: 'system',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      finishReason: 'error',
      metadata: {
        processingTime: 0,
        cached: false,
        filtered: false,
        fallback: true,
        originalError: error.message,
      },
      createdAt: new Date(),
    };
  }

  /**
   * Apply content filtering
   */
  private applyContentFilter(
    content: string,
    moderationResult: ModerationResult
  ): string {
    if (!moderationResult.flagged) {
      return content;
    }

    // Replace flagged content with appropriate message
    const flaggedCategories = Object.entries(moderationResult.categories)
      .filter(([_, flagged]) => flagged)
      .map(([category]) => category);

    logger.warn('Content filtered due to moderation', {
      categories: flaggedCategories,
      originalLength: content.length,
    });

    return "I apologize, but I cannot provide a response to that request as it may contain inappropriate content. Please rephrase your question in a different way.";
  }

  /**
   * Sanitize content based on format
   */
  private sanitizeContent(content: string, format: 'text' | 'json'): string {
    if (format === 'json') {
      try {
        // Validate and sanitize JSON
        const parsed = JSON.parse(content);
        return JSON.stringify(parsed);
      } catch {
        // If not valid JSON, treat as text
        return sanitizeInput(content);
      }
    }

    // For text format, check if it contains HTML
    if (content.includes('<') && content.includes('>')) {
      return sanitizeHtml(content);
    }

    return sanitizeInput(content);
  }

  /**
   * Sanitize streaming content (lighter processing)
   */
  private sanitizeStreamingContent(content: string): string {
    // Basic XSS prevention for streaming
    return content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  }

  /**
   * Format response according to configuration
   */
  private formatResponse(content: string, config: AIConfiguration): string {
    // Apply tenant-specific formatting rules
    let formatted = content;

    // Remove excessive whitespace
    formatted = formatted.replace(/\n{3,}/g, '\n\n');
    formatted = formatted.trim();

    // Apply custom formatting based on tenant preferences
    if (config.metadata?.formatting) {
      const formatting = config.metadata.formatting;
      
      if (formatting.maxLength) {
        formatted = this.truncateContent(formatted, formatting.maxLength);
      }

      if (formatting.removeMarkdown) {
        formatted = this.removeMarkdown(formatted);
      }

      if (formatting.addSignature && config.metadata?.signature) {
        formatted += `\n\n${config.metadata.signature}`;
      }
    }

    return formatted;
  }

  /**
   * Apply custom processing rules
   */
  private async applyCustomRules(
    content: string,
    config: AIConfiguration
  ): Promise<string> {
    let processed = content;

    // Apply tenant-specific rules
    if (config.metadata?.customRules) {
      const rules = config.metadata.customRules;

      // Word replacements
      if (rules.wordReplacements) {
        for (const [from, to] of Object.entries(rules.wordReplacements)) {
          const regex = new RegExp(`\\b${from}\\b`, 'gi');
          processed = processed.replace(regex, to as string);
        }
      }

      // Blocked phrases
      if (rules.blockedPhrases) {
        for (const phrase of rules.blockedPhrases) {
          const regex = new RegExp(phrase, 'gi');
          processed = processed.replace(regex, '[REDACTED]');
        }
      }

      // Required disclaimers
      if (rules.disclaimers) {
        for (const disclaimer of rules.disclaimers) {
          if (!processed.includes(disclaimer)) {
            processed += `\n\n${disclaimer}`;
          }
        }
      }
    }

    return processed;
  }

  /**
   * Truncate content to maximum length
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }

    // Try to truncate at sentence boundary
    const truncated = content.substring(0, maxLength - 3);
    const lastSentence = truncated.lastIndexOf('.');
    
    if (lastSentence > maxLength * 0.8) {
      return truncated.substring(0, lastSentence + 1);
    }

    return truncated + '...';
  }

  /**
   * Remove markdown formatting
   */
  private removeMarkdown(content: string): string {
    return content
      .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
      .replace(/\*(.*?)\*/g, '$1')     // Italic
      .replace(/`(.*?)`/g, '$1')       // Code
      .replace(/#{1,6}\s/g, '')        // Headers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
      .replace(/^\s*[-*+]\s/gm, '')    // List items
      .replace(/^\s*\d+\.\s/gm, '');   // Numbered lists
  }

  /**
   * Cache response
   */
  private cacheResponse(id: string, response: AIResponse): void {
    // Remove old entries if cache is full
    if (this.responseCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.responseCache.keys().next().value;
      this.responseCache.delete(firstKey);
    }

    this.responseCache.set(id, {
      ...response,
      metadata: {
        ...response.metadata,
        cachedAt: new Date(),
      },
    });

    // Set TTL cleanup
    setTimeout(() => {
      this.responseCache.delete(id);
    }, this.CACHE_TTL);
  }

  /**
   * Get cached response
   */
  getCachedResponse(id: string): AIResponse | null {
    const cached = this.responseCache.get(id);
    if (!cached) return null;

    const cachedAt = cached.metadata.cachedAt as Date;
    if (cachedAt && Date.now() - cachedAt.getTime() > this.CACHE_TTL) {
      this.responseCache.delete(id);
      return null;
    }

    return cached;
  }

  /**
   * Clear response cache
   */
  clearCache(): void {
    this.responseCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.responseCache.size,
      maxSize: this.MAX_CACHE_SIZE,
      ttl: this.CACHE_TTL,
    };
  }
}
