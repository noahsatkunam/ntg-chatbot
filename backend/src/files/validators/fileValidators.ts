import Joi from 'joi';

// File upload validation schema
export const fileUploadValidation = Joi.object({
  conversationId: Joi.string().optional(),
  generateThumbnail: Joi.boolean().optional().default(true),
  virusScan: Joi.boolean().optional().default(true),
});

// Thumbnail generation validation schema
export const thumbnailValidation = Joi.object({
  width: Joi.number().integer().min(50).max(2000).optional().default(300),
  height: Joi.number().integer().min(50).max(2000).optional().default(300),
  quality: Joi.number().integer().min(1).max(100).optional().default(80),
  format: Joi.string().valid('jpeg', 'png', 'webp').optional().default('jpeg'),
});

// File query validation schema
export const fileQueryValidation = Joi.object({
  limit: Joi.number().integer().min(1).max(100).optional().default(50),
  offset: Joi.number().integer().min(0).optional().default(0),
  mimeType: Joi.string().optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().optional(),
});

// File ID validation schema
export const fileIdValidation = Joi.object({
  fileId: Joi.string().required(),
});

// Conversation ID validation schema
export const conversationIdValidation = Joi.object({
  conversationId: Joi.string().required(),
});
