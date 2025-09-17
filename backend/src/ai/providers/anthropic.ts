import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, AIRequest, AIResponse, StreamChunk, ModerationResult, AIError } from '../types';
import { logger } from '../../utils/logger';

export class AnthropicProvider implements AIProvider {
  name = 'anthropic';
  models = [
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
    'claude-2.1',
    'claude-2.0'
  ];
  maxTokens = 200000;
  supportsStreaming = true;
  costPerToken = {
    input: 0.000008,
    output: 0.000024,
  };

  private clients: Map<string, Anthropic> = new Map();

  /**
   * Get Anthropic client for tenant
   */
  private getClient(tenantId: string, apiKey: string): Anthropic {
    const clientKey = `${tenantId}:${apiKey.slice(-8)}`;
    
    if (!this.clients.has(clientKey)) {
      const client = new Anthropic({
        apiKey,
        timeout: 30000,
        maxRetries: 3,
      });
      this.clients.set(clientKey, client);
    }

    return this.clients.get(clientKey)!;
  }

  /**
   * Count tokens for a message (approximation)
   */
  private countTokens(text: string): number {
    // Anthropic uses ~3.5 characters per token on average
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Generate AI response
   */
  async generateResponse(
    request: AIRequest,
    apiKey: string,
    config: any
  ): Promise<AIResponse> {
    const startTime = Date.now();
    
    try {
      const client = this.getClient(request.tenantId, apiKey);
      
      // Prepare messages
      const { messages, system } = this.prepareMessages(request, config);
      
      // Make API call
      const response = await client.messages.create({
        model: request.model || config.model,
        max_tokens: request.maxTokens ?? config.maxTokens ?? 4096,
        temperature: request.temperature ?? config.temperature,
        top_p: config.topP,
        system,
        messages,
        stop_sequences: config.stopSequences?.length > 0 ? config.stopSequences : undefined,
      });

      if (!response.content || response.content.length === 0) {
        throw new Error('No response content received from Anthropic');
      }

      const textContent = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as any).text)
        .join('');

      const processingTime = Date.now() - startTime;

      // Estimate token usage (Anthropic doesn't always provide exact counts)
      const promptTokens = this.estimatePromptTokens(messages, system);
      const completionTokens = this.countTokens(textContent);

      return {
        id: response.id,
        content: textContent,
        model: response.model,
        provider: this.name,
        usage: {
          promptTokens: response.usage?.input_tokens || promptTokens,
          completionTokens: response.usage?.output_tokens || completionTokens,
          totalTokens: (response.usage?.input_tokens || promptTokens) + 
                      (response.usage?.output_tokens || completionTokens),
        },
        finishReason: response.stop_reason || 'stop',
        metadata: {
          processingTime,
          cached: false,
          filtered: false,
        },
        createdAt: new Date(),
      };

    } catch (error: any) {
      logger.error('Anthropic API error', {
        error: error.message,
        tenantId: request.tenantId,
        model: request.model,
      });

      throw this.handleError(error);
    }
  }

  /**
   * Generate streaming response
   */
  async *generateStreamingResponse(
    request: AIRequest,
    apiKey: string,
    config: any
  ): AsyncGenerator<StreamChunk> {
    try {
      const client = this.getClient(request.tenantId, apiKey);
      
      // Prepare messages
      const { messages, system } = this.prepareMessages(request, config);
      
      // Make streaming API call
      const stream = client.messages.stream({
        model: request.model || config.model,
        max_tokens: request.maxTokens ?? config.maxTokens ?? 4096,
        temperature: request.temperature ?? config.temperature,
        top_p: config.topP,
        system,
        messages,
        stop_sequences: config.stopSequences?.length > 0 ? config.stopSequences : undefined,
      });

      let fullContent = '';
      let id = '';

      for await (const chunk of stream) {
        if (chunk.type === 'message_start') {
          id = chunk.message.id;
        } else if (chunk.type === 'content_block_delta') {
          const delta = (chunk.delta as any).text || '';
          if (delta) {
            fullContent += delta;
            
            yield {
              id,
              content: fullContent,
              delta,
            };
          }
        } else if (chunk.type === 'message_delta') {
          const stopReason = (chunk.delta as any).stop_reason;
          if (stopReason) {
            yield {
              id,
              content: fullContent,
              delta: '',
              finishReason: stopReason,
              usage: (chunk as any).usage ? {
                promptTokens: (chunk as any).usage.input_tokens,
                completionTokens: (chunk as any).usage.output_tokens,
                totalTokens: (chunk as any).usage.input_tokens + (chunk as any).usage.output_tokens,
              } : undefined,
            };
          }
        }
      }

    } catch (error: any) {
      logger.error('Anthropic streaming error', {
        error: error.message,
        tenantId: request.tenantId,
      });

      throw this.handleError(error);
    }
  }

  /**
   * Moderate content (basic implementation)
   */
  async moderateContent(
    content: string,
    apiKey: string,
    tenantId: string
  ): Promise<ModerationResult> {
    try {
      // Anthropic doesn't have a dedicated moderation endpoint
      // We can implement basic content filtering here
      const flaggedPatterns = [
        /\b(hate|violence|harassment|self-harm|sexual)\b/i,
        // Add more patterns as needed
      ];

      const flagged = flaggedPatterns.some(pattern => pattern.test(content));

      return {
        flagged,
        categories: {
          hate: false,
          hateThreatening: false,
          harassment: false,
          harassmentThreatening: false,
          selfHarm: false,
          selfHarmIntent: false,
          selfHarmInstructions: false,
          sexual: false,
          sexualMinors: false,
          violence: false,
          violenceGraphic: false,
        },
        scores: {},
      };

    } catch (error: any) {
      logger.error('Anthropic moderation error', {
        error: error.message,
        tenantId,
      });

      return {
        flagged: false,
        categories: {
          hate: false,
          hateThreatening: false,
          harassment: false,
          harassmentThreatening: false,
          selfHarm: false,
          selfHarmIntent: false,
          selfHarmInstructions: false,
          sexual: false,
          sexualMinors: false,
          violence: false,
          violenceGraphic: false,
        },
        scores: {},
      };
    }
  }

  /**
   * Prepare messages for API call
   */
  private prepareMessages(request: AIRequest, config: any) {
    const messages: any[] = [];
    let system = config.systemPrompt || '';

    // Add conversation context
    if (request.context && request.context.length > 0) {
      for (const msg of request.context) {
        if (msg.role === 'system') {
          // Anthropic handles system messages differently
          system = msg.content;
        } else {
          messages.push({
            role: msg.role,
            content: msg.content,
          });
        }
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: request.message,
    });

    return { messages, system };
  }

  /**
   * Estimate prompt tokens
   */
  private estimatePromptTokens(messages: any[], system: string): number {
    let totalText = system;
    for (const msg of messages) {
      totalText += msg.content;
    }
    return this.countTokens(totalText);
  }

  /**
   * Handle API errors
   */
  private handleError(error: any): AIError {
    let code = 'UNKNOWN_ERROR';
    let retryable = false;

    if (error.status) {
      switch (error.status) {
        case 400:
          code = 'INVALID_REQUEST';
          break;
        case 401:
          code = 'INVALID_API_KEY';
          break;
        case 403:
          code = 'FORBIDDEN';
          break;
        case 404:
          code = 'NOT_FOUND';
          break;
        case 429:
          code = 'RATE_LIMITED';
          retryable = true;
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          code = 'SERVER_ERROR';
          retryable = true;
          break;
      }
    }

    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      code = 'CONNECTION_ERROR';
      retryable = true;
    }

    return {
      code,
      message: error.message || 'Unknown error occurred',
      provider: this.name,
      retryable,
      details: error,
    };
  }

  /**
   * Get model pricing
   */
  getModelPricing(model: string) {
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-3-opus-20240229': { input: 0.000015, output: 0.000075 },
      'claude-3-sonnet-20240229': { input: 0.000003, output: 0.000015 },
      'claude-3-haiku-20240307': { input: 0.00000025, output: 0.00000125 },
      'claude-2.1': { input: 0.000008, output: 0.000024 },
      'claude-2.0': { input: 0.000008, output: 0.000024 },
    };

    return pricing[model] || this.costPerToken;
  }

  /**
   * Validate model availability
   */
  isModelAvailable(model: string): boolean {
    return this.models.includes(model);
  }
}
