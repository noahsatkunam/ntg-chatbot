import Joi from 'joi';

export const aiValidators = {
  generateResponse: Joi.object({
    conversationId: Joi.string()
      .uuid()
      .required()
      .messages({
        'string.guid': 'Conversation ID must be a valid UUID',
      }),
    message: Joi.string()
      .min(1)
      .max(10000)
      .required()
      .messages({
        'string.empty': 'Message cannot be empty',
        'string.max': 'Message cannot exceed 10000 characters',
      }),
    model: Joi.string()
      .optional(),
    temperature: Joi.number()
      .min(0)
      .max(2)
      .optional(),
    maxTokens: Joi.number()
      .min(1)
      .max(32000)
      .optional(),
    stream: Joi.boolean()
      .optional()
      .default(false),
  }),

  updateConfiguration: Joi.object({
    model: Joi.string()
      .optional(),
    provider: Joi.string()
      .valid('openai', 'anthropic')
      .optional(),
    systemPrompt: Joi.string()
      .max(5000)
      .optional(),
    temperature: Joi.number()
      .min(0)
      .max(2)
      .optional(),
    maxTokens: Joi.number()
      .min(1)
      .max(32000)
      .optional(),
    topP: Joi.number()
      .min(0)
      .max(1)
      .optional(),
    frequencyPenalty: Joi.number()
      .min(-2)
      .max(2)
      .optional(),
    presencePenalty: Joi.number()
      .min(-2)
      .max(2)
      .optional(),
    stopSequences: Joi.array()
      .items(Joi.string())
      .max(4)
      .optional(),
    responseFormat: Joi.string()
      .valid('text', 'json')
      .optional(),
    safetySettings: Joi.object({
      contentFiltering: Joi.boolean().optional(),
      moderationLevel: Joi.string().valid('low', 'medium', 'high').optional(),
      blockedCategories: Joi.array().items(Joi.string()).optional(),
    }).optional(),
    rateLimits: Joi.object({
      requestsPerMinute: Joi.number().min(1).max(1000).optional(),
      tokensPerMinute: Joi.number().min(100).max(100000).optional(),
      dailyTokenLimit: Joi.number().min(1000).max(10000000).optional(),
    }).optional(),
    fallbackModel: Joi.string().optional(),
    customInstructions: Joi.string().max(2000).optional(),
  }),

  setProviderCredentials: Joi.object({
    provider: Joi.string()
      .valid('openai', 'anthropic')
      .required(),
    apiKey: Joi.string()
      .min(10)
      .required()
      .messages({
        'string.min': 'API key must be at least 10 characters',
      }),
    organizationId: Joi.string()
      .optional(),
    baseUrl: Joi.string()
      .uri()
      .optional(),
  }),

  getUsageStats: Joi.object({
    startDate: Joi.date()
      .iso()
      .optional(),
    endDate: Joi.date()
      .iso()
      .optional(),
  }),

  getTopConversations: Joi.object({
    limit: Joi.number()
      .min(1)
      .max(100)
      .optional()
      .default(10),
    startDate: Joi.date()
      .iso()
      .optional(),
    endDate: Joi.date()
      .iso()
      .optional(),
  }),

  testConnection: Joi.object({
    provider: Joi.string()
      .valid('openai', 'anthropic')
      .required(),
  }),
};
