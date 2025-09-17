import Joi from 'joi';

// RAG request validation
export const ragRequestSchema = Joi.object({
  query: Joi.string().required().min(1).max(2000),
  conversationId: Joi.string().uuid().optional(),
  maxContextLength: Joi.number().integer().min(1000).max(8000).default(4000),
  includeSourceCitations: Joi.boolean().default(true),
  temperature: Joi.number().min(0).max(2).default(0.7),
  model: Joi.string().optional(),
});

// Conversation context validation
export const conversationContextSchema = Joi.object({
  conversationId: Joi.string().uuid().required(),
});

// Query context validation
export const queryContextSchema = Joi.object({
  query: Joi.string().required().min(1).max(1000),
  limit: Joi.number().integer().min(1).max(20).default(5),
});

// Query ID validation for follow-up questions
export const followUpQuestionsSchema = Joi.object({
  queryId: Joi.string().uuid().required(),
});
