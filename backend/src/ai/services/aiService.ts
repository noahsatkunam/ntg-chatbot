import { PrismaClient } from '@prisma/client';
import { OpenAIProvider } from '../providers/openai';
import { AnthropicProvider } from '../providers/anthropic';
import { ContextManager } from './contextManager';
import { TokenTracker } from './tokenTracker';
import { ResponseProcessor } from './responseProcessor';
import { 
  AIRequest, 
  AIResponse, 
  StreamChunk, 
  AIConfiguration, 
  AIProviderType,
  ContextMessage,
  ModerationResult,
  AIError 
} from '../types';
import { logger } from '../../utils/logger';
import { AppError } from '../../middlewares/errorHandler';

const prisma = new PrismaClient();

export class AIService {
  private openaiProvider: OpenAIProvider;
  private anthropicProvider: AnthropicProvider;
  private contextManager: ContextManager;
  private tokenTracker: TokenTracker;
  private responseProcessor: ResponseProcessor;
  private configCache: Map<string, AIConfiguration> = new Map();

  constructor() {
    this.openaiProvider = new OpenAIProvider();
    this.anthropicProvider = new AnthropicProvider();
    this.contextManager = new ContextManager();
    this.tokenTracker = new TokenTracker();
    this.responseProcessor = new ResponseProcessor();
  }

  /**
   * Generate AI response for a conversation
   */
  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    
    try {
      // Get AI configuration for tenant
      const config = await this.getAIConfiguration(request.tenantId);
      
      // Check rate limits
      const rateLimitCheck = await this.tokenTracker.checkRateLimits(request.tenantId, config);
      if (!rateLimitCheck.withinLimits) {
        throw new AppError('Rate limit exceeded', 429, {
          limits: rateLimitCheck.limits,
          current: rateLimitCheck.currentUsage,
        });
      }

      // Get API credentials
      const credentials = await this.getProviderCredentials(request.tenantId, config.provider as AIProviderType);
      
      // Moderate input content if enabled
      let moderationResult: ModerationResult | undefined;
      if (config.safetySettings.contentFiltering) {
        moderationResult = await this.moderateContent(request.message, credentials.apiKey, request.tenantId, config.provider as AIProviderType);
        
        if (moderationResult.flagged) {
          logger.warn('Input content flagged by moderation', {
            tenantId: request.tenantId,
            conversationId: request.conversationId,
            categories: moderationResult.categories,
          });
          
          return this.responseProcessor.generateFallbackResponse(
            new Error('Content moderation failed'),
            config,
            request.conversationId
          );
        }
      }

      // Get conversation context
      const context = await this.contextManager.getContext(
        request.conversationId,
        request.tenantId,
        config
      );

      // Add user message to context
      const userMessage: ContextMessage = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: request.message,
        tokens: this.estimateTokens(request.message),
        timestamp: new Date(),
        metadata: { userId: request.userId },
      };

      const updatedContext = await this.contextManager.addMessage(
        request.conversationId,
        request.tenantId,
        userMessage,
        config
      );

      // Prepare request with context
      const aiRequest: AIRequest = {
        ...request,
        context: updatedContext.messages,
        model: request.model || config.model,
      };

      // Generate response using appropriate provider
      let response: AIResponse;
      const provider = this.getProvider(config.provider as AIProviderType);
      
      try {
        response = await provider.generateResponse(aiRequest, credentials.apiKey, config);
      } catch (error: any) {
        // Try fallback model if available
        if (config.fallbackModel && error.retryable) {
          logger.warn('Primary model failed, trying fallback', {
            primaryModel: config.model,
            fallbackModel: config.fallbackModel,
            error: error.message,
          });

          const fallbackRequest = { ...aiRequest, model: config.fallbackModel };
          response = await provider.generateResponse(fallbackRequest, credentials.apiKey, config);
        } else {
          throw error;
        }
      }

      // Process response
      const processedResponse = await this.responseProcessor.processResponse(
        response,
        config,
        moderationResult
      );

      // Add AI response to context
      const aiMessage: ContextMessage = {
        id: response.id,
        role: 'assistant',
        content: processedResponse.content,
        tokens: response.usage.completionTokens,
        timestamp: new Date(),
        metadata: { 
          model: response.model,
          provider: response.provider,
        },
      };

      await this.contextManager.addMessage(
        request.conversationId,
        request.tenantId,
        aiMessage,
        config
      );

      // Track token usage
      const cost = this.tokenTracker.calculateCost(
        response.usage.promptTokens,
        response.usage.completionTokens,
        response.model,
        response.provider
      );

      await this.tokenTracker.trackUsage({
        tenantId: request.tenantId,
        userId: request.userId,
        conversationId: request.conversationId,
        model: response.model,
        provider: response.provider,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        cost,
        metadata: {
          processingTime: Date.now() - startTime,
          cached: processedResponse.metadata.cached,
        },
      });

      logger.info('AI response generated successfully', {
        tenantId: request.tenantId,
        conversationId: request.conversationId,
        model: response.model,
        tokens: response.usage.totalTokens,
        cost,
        processingTime: Date.now() - startTime,
      });

      return processedResponse;

    } catch (error: any) {
      logger.error('Failed to generate AI response', {
        error: error.message,
        tenantId: request.tenantId,
        conversationId: request.conversationId,
        processingTime: Date.now() - startTime,
      });

      if (error instanceof AppError) {
        throw error;
      }

      // Return fallback response for unexpected errors
      const config = await this.getAIConfiguration(request.tenantId).catch(() => null);
      if (config) {
        return this.responseProcessor.generateFallbackResponse(error, config, request.conversationId);
      }

      throw new AppError('AI service temporarily unavailable', 503);
    }
  }

  /**
   * Generate streaming AI response
   */
  async *generateStreamingResponse(request: AIRequest): AsyncGenerator<StreamChunk> {
    try {
      // Get AI configuration for tenant
      const config = await this.getAIConfiguration(request.tenantId);
      
      // Check rate limits
      const rateLimitCheck = await this.tokenTracker.checkRateLimits(request.tenantId, config);
      if (!rateLimitCheck.withinLimits) {
        throw new AppError('Rate limit exceeded', 429);
      }

      // Get API credentials
      const credentials = await this.getProviderCredentials(request.tenantId, config.provider as AIProviderType);
      
      // Get conversation context
      const context = await this.contextManager.getContext(
        request.conversationId,
        request.tenantId,
        config
      );

      // Prepare request with context
      const aiRequest: AIRequest = {
        ...request,
        context: context.messages,
        model: request.model || config.model,
        stream: true,
      };

      // Generate streaming response
      const provider = this.getProvider(config.provider as AIProviderType);
      const stream = provider.generateStreamingResponse(aiRequest, credentials.apiKey, config);

      let accumulatedContent = '';
      let finalUsage: any = null;

      for await (const chunk of stream) {
        accumulatedContent = chunk.content;
        
        // Process chunk
        const processedChunk = this.responseProcessor.processStreamChunk(
          chunk,
          config,
          accumulatedContent
        );

        // Store final usage for tracking
        if (chunk.usage) {
          finalUsage = chunk.usage;
        }

        yield processedChunk;
      }

      // Track usage after streaming completes
      if (finalUsage) {
        const cost = this.tokenTracker.calculateCost(
          finalUsage.promptTokens,
          finalUsage.completionTokens,
          config.model,
          config.provider
        );

        await this.tokenTracker.trackUsage({
          tenantId: request.tenantId,
          userId: request.userId,
          conversationId: request.conversationId,
          model: config.model,
          provider: config.provider,
          promptTokens: finalUsage.promptTokens,
          completionTokens: finalUsage.completionTokens,
          totalTokens: finalUsage.totalTokens,
          cost,
          metadata: { streaming: true },
        });

        // Add messages to context
        const userMessage: ContextMessage = {
          id: `user_${Date.now()}`,
          role: 'user',
          content: request.message,
          tokens: finalUsage.promptTokens,
          timestamp: new Date(),
        };

        const aiMessage: ContextMessage = {
          id: `ai_${Date.now()}`,
          role: 'assistant',
          content: accumulatedContent,
          tokens: finalUsage.completionTokens,
          timestamp: new Date(),
        };

        await this.contextManager.addMessage(request.conversationId, request.tenantId, userMessage, config);
        await this.contextManager.addMessage(request.conversationId, request.tenantId, aiMessage, config);
      }

    } catch (error: any) {
      logger.error('Failed to generate streaming response', {
        error: error.message,
        tenantId: request.tenantId,
        conversationId: request.conversationId,
      });

      throw error;
    }
  }

  /**
   * Get AI configuration for tenant
   */
  async getAIConfiguration(tenantId: string): Promise<AIConfiguration> {
    // Check cache first
    const cached = this.configCache.get(tenantId);
    if (cached) {
      return cached;
    }

    try {
      const config = await prisma.aIConfiguration.findFirst({
        where: { tenantId },
      });

      if (!config) {
        // Return default configuration
        const defaultConfig: AIConfiguration = {
          id: `default_${tenantId}`,
          tenantId,
          model: 'gpt-3.5-turbo',
          provider: 'openai',
          systemPrompt: 'You are a helpful AI assistant.',
          temperature: 0.7,
          maxTokens: 4096,
          topP: 1.0,
          frequencyPenalty: 0,
          presencePenalty: 0,
          stopSequences: [],
          responseFormat: 'text',
          safetySettings: {
            contentFiltering: true,
            moderationLevel: 'medium',
            blockedCategories: ['hate', 'violence', 'sexual'],
          },
          rateLimits: {
            requestsPerMinute: 60,
            tokensPerMinute: 10000,
            dailyTokenLimit: 100000,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        this.configCache.set(tenantId, defaultConfig);
        return defaultConfig;
      }

      const aiConfig: AIConfiguration = {
        id: config.id,
        tenantId: config.tenantId,
        model: config.model,
        provider: config.provider,
        systemPrompt: config.systemPrompt,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        topP: config.topP,
        frequencyPenalty: config.frequencyPenalty,
        presencePenalty: config.presencePenalty,
        stopSequences: config.stopSequences as string[],
        responseFormat: config.responseFormat as 'text' | 'json',
        safetySettings: config.safetySettings as any,
        rateLimits: config.rateLimits as any,
        fallbackModel: config.fallbackModel,
        customInstructions: config.customInstructions,
        knowledgeBase: config.knowledgeBase as string[],
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      };

      this.configCache.set(tenantId, aiConfig);
      return aiConfig;

    } catch (error) {
      logger.error('Failed to get AI configuration', { error, tenantId });
      throw new AppError('Failed to load AI configuration', 500);
    }
  }

  /**
   * Get provider credentials
   */
  private async getProviderCredentials(tenantId: string, provider: AIProviderType) {
    try {
      const credentials = await prisma.providerCredentials.findFirst({
        where: {
          tenantId,
          provider,
        },
      });

      if (!credentials) {
        throw new AppError(`No ${provider} credentials found for tenant`, 404);
      }

      return {
        apiKey: credentials.apiKey, // Should be decrypted in production
        organizationId: credentials.organizationId,
        baseUrl: credentials.baseUrl,
      };

    } catch (error) {
      logger.error('Failed to get provider credentials', { error, tenantId, provider });
      throw new AppError('Provider credentials not found', 404);
    }
  }

  /**
   * Get provider instance
   */
  private getProvider(providerType: AIProviderType) {
    switch (providerType) {
      case 'openai':
        return this.openaiProvider;
      case 'anthropic':
        return this.anthropicProvider;
      default:
        throw new AppError(`Unsupported provider: ${providerType}`, 400);
    }
  }

  /**
   * Moderate content
   */
  private async moderateContent(
    content: string,
    apiKey: string,
    tenantId: string,
    provider: AIProviderType
  ): Promise<ModerationResult> {
    try {
      const providerInstance = this.getProvider(provider);
      return await providerInstance.moderateContent(content, apiKey, tenantId);
    } catch (error) {
      logger.error('Content moderation failed', { error, tenantId });
      // Return safe default if moderation fails
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
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Clear configuration cache
   */
  clearConfigCache(tenantId?: string): void {
    if (tenantId) {
      this.configCache.delete(tenantId);
    } else {
      this.configCache.clear();
    }
  }

  /**
   * Get available models for tenant
   */
  async getAvailableModels(tenantId: string): Promise<Array<{
    id: string;
    name: string;
    provider: string;
    maxTokens: number;
    supportsStreaming: boolean;
  }>> {
    const config = await this.getAIConfiguration(tenantId);
    const provider = this.getProvider(config.provider as AIProviderType);

    return provider.models.map(model => ({
      id: model,
      name: model,
      provider: provider.name,
      maxTokens: provider.maxTokens,
      supportsStreaming: provider.supportsStreaming,
    }));
  }

  /**
   * Get service health status
   */
  async getHealthStatus() {
    return {
      status: 'healthy',
      providers: {
        openai: this.openaiProvider.name,
        anthropic: this.anthropicProvider.name,
      },
      cacheStats: {
        config: {
          size: this.configCache.size,
        },
        context: this.contextManager.getCacheStats(),
        response: this.responseProcessor.getCacheStats(),
      },
    };
  }
}
