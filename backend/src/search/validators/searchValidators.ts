import Joi from 'joi';

// Message search validation schema
export const messageSearchValidation = Joi.object({
  q: Joi.string().required().min(1).max(500),
  limit: Joi.number().integer().min(1).max(100).optional().default(50),
  offset: Joi.number().integer().min(0).optional().default(0),
  conversationId: Joi.string().optional(),
  userId: Joi.string().optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().optional(),
  sortBy: Joi.string().valid('relevance', 'date', 'sender').optional().default('relevance'),
  sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc'),
});

// Conversation search validation schema
export const conversationSearchValidation = Joi.object({
  q: Joi.string().required().min(1).max(500),
  limit: Joi.number().integer().min(1).max(50).optional().default(20),
  offset: Joi.number().integer().min(0).optional().default(0),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().optional(),
});

// Search suggestions validation schema
export const searchSuggestionsValidation = Joi.object({
  q: Joi.string().required().min(2).max(100),
  limit: Joi.number().integer().min(1).max(20).optional().default(10),
});

// Message ID validation schema
export const messageIdValidation = Joi.object({
  messageId: Joi.string().required(),
});
