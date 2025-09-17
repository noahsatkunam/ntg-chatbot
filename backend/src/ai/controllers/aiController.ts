import { Request, Response, NextFunction } from 'express';
import { AIService } from '../services/aiService';
import { TokenTracker } from '../services/tokenTracker';
import { AppError } from '../../middlewares/errorHandler';
import { logger } from '../../utils/logger';

interface AuthRequest extends Request {
  userId?: string;
  tenantId?: string;
  user?: any;
}

export class AIController {
  private aiService: AIService;
  private tokenTracker: TokenTracker;

  constructor() {
    this.aiService = new AIService();
    this.tokenTracker = new TokenTracker();
  }

  /**
   * Generate AI response for chat
   */
  async generateResponse(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { conversationId, message, model, temperature, maxTokens, stream } = req.body;
      
      if (!req.userId || !req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      if (!conversationId || !message) {
        throw new AppError('Conversation ID and message are required', 400);
      }

      const aiRequest = {
        conversationId,
        tenantId: req.tenantId,
        userId: req.userId,
        message,
        model,
        temperature,
        maxTokens,
        stream: stream || false,
      };

      if (stream) {
        // Set headers for streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Generate streaming response
        const streamGenerator = this.aiService.generateStreamingResponse(aiRequest);
        
        for await (const chunk of streamGenerator) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        // Generate regular response
        const response = await this.aiService.generateResponse(aiRequest);
        
        res.json({
          success: true,
          data: response,
        });
      }

    } catch (error) {
      if (stream) {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      } else {
        next(error);
      }
    }
  }

  /**
   * Get available AI models for tenant
   */
  async getModels(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const models = await this.aiService.getAvailableModels(req.tenantId);
      
      res.json({
        success: true,
        data: models,
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get AI configuration for tenant
   */
  async getConfiguration(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const config = await this.aiService.getAIConfiguration(req.tenantId);
      
      // Remove sensitive information
      const safeConfig = {
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
        stopSequences: config.stopSequences,
        responseFormat: config.responseFormat,
        safetySettings: config.safetySettings,
        rateLimits: config.rateLimits,
        fallbackModel: config.fallbackModel,
        customInstructions: config.customInstructions,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      };

      res.json({
        success: true,
        data: safeConfig,
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Update AI configuration for tenant
   */
  async updateConfiguration(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const {
        model,
        provider,
        systemPrompt,
        temperature,
        maxTokens,
        topP,
        frequencyPenalty,
        presencePenalty,
        stopSequences,
        responseFormat,
        safetySettings,
        rateLimits,
        fallbackModel,
        customInstructions,
      } = req.body;

      // Update configuration in database
      const updatedConfig = await prisma.aIConfiguration.upsert({
        where: { tenantId: req.tenantId },
        update: {
          model,
          provider,
          systemPrompt,
          temperature,
          maxTokens,
          topP,
          frequencyPenalty,
          presencePenalty,
          stopSequences,
          responseFormat,
          safetySettings,
          rateLimits,
          fallbackModel,
          customInstructions,
          updatedAt: new Date(),
        },
        create: {
          tenantId: req.tenantId,
          model: model || 'gpt-3.5-turbo',
          provider: provider || 'openai',
          systemPrompt: systemPrompt || 'You are a helpful AI assistant.',
          temperature: temperature ?? 0.7,
          maxTokens: maxTokens || 4096,
          topP: topP ?? 1.0,
          frequencyPenalty: frequencyPenalty ?? 0,
          presencePenalty: presencePenalty ?? 0,
          stopSequences: stopSequences || [],
          responseFormat: responseFormat || 'text',
          safetySettings: safetySettings || {
            contentFiltering: true,
            moderationLevel: 'medium',
            blockedCategories: ['hate', 'violence', 'sexual'],
          },
          rateLimits: rateLimits || {
            requestsPerMinute: 60,
            tokensPerMinute: 10000,
            dailyTokenLimit: 100000,
          },
          fallbackModel,
          customInstructions,
        },
      });

      // Clear cache
      this.aiService.clearConfigCache(req.tenantId);

      res.json({
        success: true,
        data: updatedConfig,
        message: 'AI configuration updated successfully',
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get token usage statistics
   */
  async getUsageStats(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const { startDate, endDate } = req.query;
      
      const stats = await this.tokenTracker.getUsageStats(
        req.tenantId,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );

      res.json({
        success: true,
        data: stats,
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get top conversations by usage
   */
  async getTopConversations(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const { limit, startDate, endDate } = req.query;
      
      const conversations = await this.tokenTracker.getTopConversations(
        req.tenantId,
        limit ? parseInt(limit as string) : 10,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );

      res.json({
        success: true,
        data: conversations,
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Set provider credentials
   */
  async setProviderCredentials(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const { provider, apiKey, organizationId, baseUrl } = req.body;

      if (!provider || !apiKey) {
        throw new AppError('Provider and API key are required', 400);
      }

      // In production, encrypt the API key
      const credentials = await prisma.providerCredentials.upsert({
        where: {
          tenantId_provider: {
            tenantId: req.tenantId,
            provider,
          },
        },
        update: {
          apiKey, // Should be encrypted
          organizationId,
          baseUrl,
          updatedAt: new Date(),
        },
        create: {
          tenantId: req.tenantId,
          provider,
          apiKey, // Should be encrypted
          organizationId,
          baseUrl,
          encrypted: false, // Set to true in production
        },
      });

      res.json({
        success: true,
        message: 'Provider credentials updated successfully',
        data: {
          id: credentials.id,
          provider: credentials.provider,
          hasApiKey: !!credentials.apiKey,
          organizationId: credentials.organizationId,
          baseUrl: credentials.baseUrl,
        },
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get AI service health status
   */
  async getHealthStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await this.aiService.getHealthStatus();
      
      res.json({
        success: true,
        data: status,
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Test AI connection
   */
  async testConnection(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) {
        throw new AppError('Authentication required', 401);
      }

      const { provider } = req.body;

      // Simple test message
      const testRequest = {
        conversationId: 'test',
        tenantId: req.tenantId,
        userId: req.userId!,
        message: 'Hello, this is a test message. Please respond with "Test successful".',
        model: provider === 'anthropic' ? 'claude-3-haiku-20240307' : 'gpt-3.5-turbo',
      };

      const response = await this.aiService.generateResponse(testRequest);
      
      res.json({
        success: true,
        message: 'AI connection test successful',
        data: {
          provider: response.provider,
          model: response.model,
          responseTime: response.metadata.processingTime,
          tokenUsage: response.usage,
        },
      });

    } catch (error) {
      logger.error('AI connection test failed', {
        error: error.message,
        tenantId: req.tenantId,
      });

      res.status(400).json({
        success: false,
        message: 'AI connection test failed',
        error: error.message,
      });
    }
  }
}

export const aiController = new AIController();
