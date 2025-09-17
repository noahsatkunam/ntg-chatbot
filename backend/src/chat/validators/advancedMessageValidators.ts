import Joi from 'joi';

// Reaction validation schema
export const reactionValidation = Joi.object({
  reaction: Joi.string().required().min(1).max(10),
});

// Reply message validation schema
export const replyMessageValidation = Joi.object({
  content: Joi.string().required().min(1).max(10000),
  type: Joi.string().valid('text', 'image', 'file', 'audio', 'video').optional().default('text'),
});

// Edit message validation schema
export const editMessageValidation = Joi.object({
  content: Joi.string().required().min(1).max(10000),
});

// Bulk operations validation schema
export const bulkOperationsValidation = Joi.object({
  operation: Joi.string().valid('delete', 'mark_read', 'archive').required(),
  messageIds: Joi.array().items(Joi.string()).min(1).max(100).required(),
  data: Joi.object().optional(),
});

// Export conversation validation schema
export const exportConversationValidation = Joi.object({
  format: Joi.string().valid('json', 'csv').optional().default('json'),
  includeFiles: Joi.boolean().optional().default(false),
});

// Message ID validation schema
export const messageIdValidation = Joi.object({
  messageId: Joi.string().required(),
});

// Conversation ID validation schema
export const conversationIdValidation = Joi.object({
  conversationId: Joi.string().required(),
});
