import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { createError } from './errorHandler';

// Common validation schemas
export const commonSchemas = {
  id: z.string().cuid('Invalid ID format'),
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password too long'),
  tenantId: z.string().cuid('Invalid tenant ID format'),
  userId: z.string().cuid('Invalid user ID format'),
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
  }),
  dateRange: z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional()
  }).refine(data => {
    if (data.startDate && data.endDate) {
      return new Date(data.startDate) <= new Date(data.endDate);
    }
    return true;
  }, 'Start date must be before end date')
};

// User validation schemas
export const userSchemas = {
  register: z.object({
    email: commonSchemas.email,
    password: commonSchemas.password,
    firstName: z.string().min(1, 'First name is required').max(50, 'First name too long'),
    lastName: z.string().min(1, 'Last name is required').max(50, 'Last name too long'),
    tenantId: commonSchemas.tenantId.optional()
  }),
  login: z.object({
    email: commonSchemas.email,
    password: z.string().min(1, 'Password is required')
  }),
  updateProfile: z.object({
    firstName: z.string().min(1).max(50).optional(),
    lastName: z.string().min(1).max(50).optional(),
    avatar: z.string().url().optional(),
    preferences: z.record(z.any()).optional()
  }),
  changePassword: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: commonSchemas.password
  })
};

// Chat validation schemas
export const chatSchemas = {
  sendMessage: z.object({
    conversationId: commonSchemas.id,
    content: z.string().min(1, 'Message content is required').max(4000, 'Message too long'),
    type: z.enum(['text', 'image', 'file', 'system']).default('text'),
    metadata: z.record(z.any()).optional()
  }),
  createConversation: z.object({
    title: z.string().min(1, 'Title is required').max(200, 'Title too long').optional(),
    isGroup: z.boolean().default(false),
    participants: z.array(commonSchemas.userId).optional(),
    metadata: z.record(z.any()).optional()
  }),
  updateConversation: z.object({
    title: z.string().min(1).max(200).optional(),
    metadata: z.record(z.any()).optional()
  })
};

// Workflow validation schemas
export const workflowSchemas = {
  create: z.object({
    name: z.string().min(1, 'Workflow name is required').max(200, 'Name too long'),
    description: z.string().max(1000, 'Description too long').optional(),
    definition: z.record(z.any()),
    isActive: z.boolean().default(true),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.any()).optional()
  }),
  update: z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    definition: z.record(z.any()).optional(),
    isActive: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.any()).optional()
  }),
  execute: z.object({
    workflowId: commonSchemas.id,
    inputData: z.record(z.any()).optional(),
    metadata: z.record(z.any()).optional()
  }),
  trigger: z.object({
    workflowId: commonSchemas.id,
    triggerType: z.enum(['manual', 'scheduled', 'webhook', 'chat', 'event']),
    configuration: z.record(z.any()),
    isActive: z.boolean().default(true),
    priority: z.number().int().min(0).max(100).default(0),
    requiresConfirmation: z.boolean().default(false)
  })
};

// Knowledge base validation schemas
export const knowledgeSchemas = {
  uploadDocument: z.object({
    title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
    description: z.string().max(1000, 'Description too long').optional(),
    tags: z.array(z.string()).optional(),
    category: z.string().max(100).optional(),
    isPublic: z.boolean().default(false),
    metadata: z.record(z.any()).optional()
  }),
  updateDocument: z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    tags: z.array(z.string()).optional(),
    category: z.string().max(100).optional(),
    isPublic: z.boolean().optional(),
    metadata: z.record(z.any()).optional()
  }),
  search: z.object({
    query: z.string().min(1, 'Search query is required').max(500, 'Query too long'),
    filters: z.object({
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
      dateRange: commonSchemas.dateRange.optional(),
      isPublic: z.boolean().optional()
    }).optional(),
    options: z.object({
      limit: z.number().int().min(1).max(50).default(10),
      includeContent: z.boolean().default(false),
      searchType: z.enum(['semantic', 'keyword', 'hybrid']).default('hybrid')
    }).optional()
  })
};

// API connector validation schemas
export const connectorSchemas = {
  create: z.object({
    name: z.string().min(1, 'Connection name is required').max(200, 'Name too long'),
    type: z.string().min(1, 'Connection type is required'),
    baseUrl: z.string().url('Invalid base URL'),
    authentication: z.object({
      type: z.enum(['none', 'basic', 'bearer', 'oauth2', 'api_key']),
      credentials: z.record(z.any())
    }),
    headers: z.record(z.string()).optional(),
    rateLimit: z.object({
      requestsPerSecond: z.number().positive().optional(),
      requestsPerMinute: z.number().positive().optional(),
      requestsPerHour: z.number().positive().optional(),
      burstLimit: z.number().positive().optional()
    }).optional(),
    retryConfig: z.object({
      maxRetries: z.number().int().min(0).max(10).default(3),
      backoffMultiplier: z.number().positive().default(2),
      maxBackoffMs: z.number().positive().default(30000),
      retryableStatusCodes: z.array(z.number().int()).optional()
    }).optional(),
    isActive: z.boolean().default(true),
    metadata: z.record(z.any()).optional()
  }),
  update: z.object({
    name: z.string().min(1).max(200).optional(),
    baseUrl: z.string().url().optional(),
    authentication: z.object({
      type: z.enum(['none', 'basic', 'bearer', 'oauth2', 'api_key']),
      credentials: z.record(z.any())
    }).optional(),
    headers: z.record(z.string()).optional(),
    rateLimit: z.object({
      requestsPerSecond: z.number().positive().optional(),
      requestsPerMinute: z.number().positive().optional(),
      requestsPerHour: z.number().positive().optional(),
      burstLimit: z.number().positive().optional()
    }).optional(),
    retryConfig: z.object({
      maxRetries: z.number().int().min(0).max(10),
      backoffMultiplier: z.number().positive(),
      maxBackoffMs: z.number().positive(),
      retryableStatusCodes: z.array(z.number().int()).optional()
    }).optional(),
    isActive: z.boolean().optional(),
    metadata: z.record(z.any()).optional()
  }),
  makeRequest: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    endpoint: z.string().min(1, 'Endpoint is required'),
    params: z.record(z.any()).optional(),
    data: z.any().optional(),
    headers: z.record(z.string()).optional()
  })
};

// OAuth2 validation schemas
export const oauth2Schemas = {
  registerProvider: z.object({
    name: z.string().min(1, 'Provider name is required').max(100, 'Name too long'),
    clientId: z.string().min(1, 'Client ID is required'),
    clientSecret: z.string().min(1, 'Client secret is required'),
    authorizationUrl: z.string().url('Invalid authorization URL'),
    tokenUrl: z.string().url('Invalid token URL'),
    scopes: z.array(z.string()).optional(),
    redirectUri: z.string().url('Invalid redirect URI').optional(),
    metadata: z.record(z.any()).optional()
  }),
  createConnection: z.object({
    providerId: commonSchemas.id,
    authorizationCode: z.string().min(1, 'Authorization code is required'),
    redirectUri: z.string().url('Invalid redirect URI').optional(),
    metadata: z.record(z.any()).optional()
  })
};

// Validation middleware factory
export const validate = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = schema.safeParse({
        ...req.body,
        ...req.params,
        ...req.query
      });

      if (!result.success) {
        throw createError.validation('Validation failed', result.error.errors);
      }

      // Merge validated data back to request
      req.body = { ...req.body, ...result.data };
      req.params = { ...req.params, ...result.data };
      req.query = { ...req.query, ...result.data };

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Tenant isolation validation
export const validateTenantAccess = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  const requestedTenantId = req.params.tenantId || req.body.tenantId || req.query.tenantId;

  if (!user) {
    throw createError.authentication('User not authenticated');
  }

  if (!user.tenantId) {
    throw createError.tenantIsolation('User has no tenant association');
  }

  if (requestedTenantId && requestedTenantId !== user.tenantId) {
    throw createError.tenantIsolation('Access denied to different tenant resources');
  }

  // Add tenant ID to request for consistency
  req.body.tenantId = user.tenantId;
  req.params.tenantId = user.tenantId;

  next();
};

// File upload validation
export const validateFileUpload = (options: {
  maxSize?: number;
  allowedTypes?: string[];
  required?: boolean;
} = {}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const file = req.file;
    const files = req.files;

    if (options.required && !file && (!files || (Array.isArray(files) && files.length === 0))) {
      throw createError.validation('File is required');
    }

    const validateSingleFile = (fileToValidate: Express.Multer.File) => {
      if (options.maxSize && fileToValidate.size > options.maxSize) {
        throw createError.validation(`File size exceeds limit of ${options.maxSize} bytes`);
      }

      if (options.allowedTypes && !options.allowedTypes.includes(fileToValidate.mimetype)) {
        throw createError.validation(`File type ${fileToValidate.mimetype} not allowed`);
      }
    };

    if (file) {
      validateSingleFile(file);
    }

    if (files) {
      if (Array.isArray(files)) {
        files.forEach(validateSingleFile);
      } else {
        Object.values(files).flat().forEach(validateSingleFile);
      }
    }

    next();
  };
};

// Rate limiting validation
export const validateRateLimit = (windowMs: number, maxRequests: number) => {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const key = user?.id || req.ip;
    const now = Date.now();

    let requestData = requests.get(key);
    
    if (!requestData || now > requestData.resetTime) {
      requestData = { count: 0, resetTime: now + windowMs };
      requests.set(key, requestData);
    }

    if (requestData.count >= maxRequests) {
      throw createError.rateLimit(`Rate limit exceeded. Try again in ${Math.ceil((requestData.resetTime - now) / 1000)} seconds`);
    }

    requestData.count++;
    next();
  };
};

// Input sanitization
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  const sanitizeValue = (value: any): any => {
    if (typeof value === 'string') {
      // Remove potential XSS patterns
      return value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .trim();
    }
    
    if (Array.isArray(value)) {
      return value.map(sanitizeValue);
    }
    
    if (value && typeof value === 'object') {
      const sanitized: any = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = sanitizeValue(val);
      }
      return sanitized;
    }
    
    return value;
  };

  req.body = sanitizeValue(req.body);
  req.query = sanitizeValue(req.query);
  
  next();
};

// Export validation utilities
export const validationUtils = {
  isValidEmail: (email: string): boolean => {
    return commonSchemas.email.safeParse(email).success;
  },
  
  isValidId: (id: string): boolean => {
    return commonSchemas.id.safeParse(id).success;
  },
  
  isValidUrl: (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },
  
  sanitizeHtml: (html: string): string => {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  },
  
  validatePassword: (password: string): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    if (password.length < 8) errors.push('Password must be at least 8 characters');
    if (password.length > 128) errors.push('Password must be less than 128 characters');
    if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('Password must contain at least one lowercase letter');
    if (!/\d/.test(password)) errors.push('Password must contain at least one number');
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push('Password must contain at least one special character');
    
    return { valid: errors.length === 0, errors };
  }
};
