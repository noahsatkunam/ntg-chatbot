import Joi from 'joi';

export const chatValidators = {
  createConversation: Joi.object({
    type: Joi.string()
      .valid('SUPPORT', 'CHAT', 'GROUP', 'CHANNEL')
      .optional()
      .default('SUPPORT'),
    participantIds: Joi.array()
      .items(Joi.string().uuid())
      .optional()
      .default([]),
    metadata: Joi.object()
      .optional(),
  }),

  sendMessage: Joi.object({
    content: Joi.string()
      .min(1)
      .max(10000)
      .required()
      .messages({
        'string.empty': 'Message content cannot be empty',
        'string.max': 'Message content cannot exceed 10000 characters',
      }),
    type: Joi.string()
      .valid('TEXT', 'IMAGE', 'FILE', 'VIDEO', 'AUDIO', 'SYSTEM')
      .optional()
      .default('TEXT'),
    metadata: Joi.object()
      .optional(),
    attachments: Joi.array()
      .items(
        Joi.object({
          filename: Joi.string().required(),
          fileSize: Joi.number().positive().required(),
          mimeType: Joi.string().required(),
          url: Joi.string().uri().required(),
          metadata: Joi.object().optional(),
        })
      )
      .optional(),
  }),

  getMessages: Joi.object({
    limit: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .optional()
      .default(50),
    before: Joi.date()
      .iso()
      .optional(),
    after: Joi.date()
      .iso()
      .optional(),
    includeDeleted: Joi.boolean()
      .optional()
      .default(false),
  }),

  markAsRead: Joi.object({
    messageIds: Joi.array()
      .items(Joi.string().uuid())
      .min(1)
      .max(100)
      .required()
      .messages({
        'array.min': 'At least one message ID is required',
        'array.max': 'Cannot mark more than 100 messages at once',
      }),
  }),

  searchMessages: Joi.object({
    q: Joi.string()
      .min(2)
      .max(100)
      .required()
      .messages({
        'string.min': 'Search query must be at least 2 characters',
        'string.max': 'Search query cannot exceed 100 characters',
      }),
  }),

  uploadFiles: Joi.object({
    conversationId: Joi.string()
      .uuid()
      .required(),
  }),
};
