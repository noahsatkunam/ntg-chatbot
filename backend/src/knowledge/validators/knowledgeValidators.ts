import Joi from 'joi';

// Document upload validation
export const documentUploadSchema = Joi.object({
  // File validation is handled by multer middleware
  // This schema can be extended for additional metadata
  metadata: Joi.object().optional(),
  tags: Joi.array().items(Joi.string()).optional(),
});

// Search validation
export const searchSchema = Joi.object({
  query: Joi.string().required().min(1).max(1000),
  limit: Joi.number().integer().min(1).max(50).default(10),
  scoreThreshold: Joi.number().min(0).max(1).default(0.7),
  useHybrid: Joi.boolean().default(false),
  filters: Joi.object().optional(),
});

// Document ID validation
export const documentIdSchema = Joi.object({
  documentId: Joi.string().uuid().required(),
});

// Query ID validation
export const queryIdSchema = Joi.object({
  queryId: Joi.string().uuid().required(),
});

// Feedback validation
export const feedbackSchema = Joi.object({
  queryId: Joi.string().uuid().required(),
  feedback: Joi.string().valid('helpful', 'not_helpful', 'partially_helpful').required(),
});

// Analytics date range validation
export const analyticsSchema = Joi.object({
  dateFrom: Joi.date().optional(),
  dateTo: Joi.date().optional(),
});

// Document list query validation
export const documentListSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
  status: Joi.string().valid('PROCESSING', 'COMPLETED', 'FAILED', 'PENDING').optional(),
});
