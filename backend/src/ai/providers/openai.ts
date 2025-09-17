import OpenAI from 'openai';
import { AIProvider, AIRequest, AIResponse, StreamChunk, ModerationResult, AIError } from '../types';
import { logger } from '../../utils/logger';
import { encoding_for_model } from 'tiktoken';

export class OpenAIProvider implements AIProvider {
  name = 'openai';
  models = [
    'gpt-4-turbo-preview',
    'gpt-4',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k'
  ];
  maxTokens = 128000;
  supportsStreaming = true;
  costPerToken = {
    input: 0.00001,
    output: 0.00003,
  };

  private clients: Map<string, OpenAI> = new Map();

  /**
   * Get OpenAI client for tenant
   */
  private getClient(tenantId: string, apiKey: string): OpenAI {
    const clientKey = `${tenantId}:${apiKey.slice(-8)}`;
    
    if (!this.clients.has(clientKey)) {
      const client = new OpenAI({
        apiKey,
        timeout: 30000,
        maxRetries: 3,
      });
      this.clients.set(clientKey, client);
    }

    return this.clients.get(clientKey)!;
  }

  /**
   * Count tokens for a message
   */
  private countTokens(text: string, model: string): number {
    try {
      const encoding = encoding_for_model(model as any);
      const tokens = encoding.encode(text);
      encoding.free();
      return tokens.length;
    } catch (error) {
      // Fallback estimation: ~4 characters per token
      return Math.ceil(text.length / 4);
    }
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
      const messages = this.prepareMessages(request, config);
      
      // Make API call
      const response = await client.chat.completions.create({
        model: request.model || config.model,
        messages,
        temperature: request.temperature ?? config.temperature,
        max_tokens: request.maxTokens ?? config.maxTokens,
        top_p: config.topP,
        frequency_penalty: config.frequencyPenalty,
        presence_penalty: config.presencePenalty,
        stop: config.stopSequences?.length > 0 ? config.stopSequences : undefined,
        user: request.userId,
      });

      const choice = response.choices[0];
      if (!choice?.message?.content) {
        throw new Error('No response content received from OpenAI');
      }

      const processingTime = Date.now() - startTime;

      return {
        id: response.id,
        content: choice.message.content,
        model: response.model,
        provider: this.name,
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
        finishReason: choice.finish_reason || 'stop',
        metadata: {
          processingTime,
          cached: false,
          filtered: false,
        },
        createdAt: new Date(),
      };

    } catch (error: any) {
      logger.error('OpenAI API error', {
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
      const messages = this.prepareMessages(request, config);
      
      // Make streaming API call
      const stream = await client.chat.completions.create({
        model: request.model || config.model,
        messages,
        temperature: request.temperature ?? config.temperature,
        max_tokens: request.maxTokens ?? config.maxTokens,
        top_p: config.topP,
        frequency_penalty: config.frequencyPenalty,
        presence_penalty: config.presencePenalty,
        stop: config.stopSequences?.length > 0 ? config.stopSequences : undefined,
        user: request.userId,
        stream: true,
      });

      let fullContent = '';
      let id = '';

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        if (!id && chunk.id) {
          id = chunk.id;
        }

        const delta = choice.delta?.content || '';
        if (delta) {
          fullContent += delta;
        }

        yield {
          id: chunk.id,
          content: fullContent,
          delta,
          finishReason: choice.finish_reason || undefined,
          usage: chunk.usage ? {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          } : undefined,
        };
      }

    } catch (error: any) {
      logger.error('OpenAI streaming error', {
        error: error.message,
        tenantId: request.tenantId,
      });

      throw this.handleError(error);
    }
  }

  /**
   * Moderate content
   */
  async moderateContent(
    content: string,
    apiKey: string,
    tenantId: string
  ): Promise<ModerationResult> {
    try {
      const client = this.getClient(tenantId, apiKey);
      
      const response = await client.moderations.create({
        input: content,
      });

      const result = response.results[0];
      
      return {
        flagged: result.flagged,
        categories: {
          hate: result.categories.hate,
          hateThreatening: result.categories['hate/threatening'],
          harassment: result.categories.harassment,
          harassmentThreatening: result.categories['harassment/threatening'],
          selfHarm: result.categories['self-harm'],
          selfHarmIntent: result.categories['self-harm/intent'],
          selfHarmInstructions: result.categories['self-harm/instructions'],
          sexual: result.categories.sexual,
          sexualMinors: result.categories['sexual/minors'],
          violence: result.categories.violence,
          violenceGraphic: result.categories['violence/graphic'],
        },
        scores: result.category_scores,
      };

    } catch (error: any) {
      logger.error('OpenAI moderation error', {
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

    // Add system prompt
    if (config.systemPrompt) {
      messages.push({
        role: 'system',
        content: config.systemPrompt,
      });
    }

    // Add conversation context
    if (request.context && request.context.length > 0) {
      for (const msg of request.context) {
        if (msg.role !== 'system') {
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

    return messages;
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
      'gpt-4-turbo-preview': { input: 0.00001, output: 0.00003 },
      'gpt-4': { input: 0.00003, output: 0.00006 },
      'gpt-3.5-turbo': { input: 0.0000005, output: 0.0000015 },
      'gpt-3.5-turbo-16k': { input: 0.000003, output: 0.000004 },
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
