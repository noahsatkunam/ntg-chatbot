import { z } from 'zod';

// Common validation schemas
export const emailSchema = z.string().email('Please enter a valid email address');
export const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain uppercase, lowercase, and number');

export const nameSchema = z.string()
  .min(1, 'Name is required')
  .max(100, 'Name must be less than 100 characters')
  .regex(/^[a-zA-Z\s'-]+$/, 'Name contains invalid characters');

export const messageSchema = z.string()
  .min(1, 'Message cannot be empty')
  .max(4000, 'Message must be less than 4000 characters')
  .refine((val) => val.trim().length > 0, 'Message cannot be only whitespace');

export const fileSchema = z.object({
  name: z.string().min(1, 'Filename is required'),
  size: z.number().max(52428800, 'File size must be less than 50MB'),
  type: z.string().refine(
    (type) => [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
      'image/jpeg',
      'image/png',
      'image/gif',
    ].includes(type),
    'File type not supported'
  ),
});

// Authentication schemas
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  twoFactorCode: z.string().optional(),
  rememberMe: z.boolean().optional(),
});

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  confirmPassword: z.string(),
  tenantName: z.string().min(1, 'Organization name is required'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

// Chat schemas
export const sendMessageSchema = z.object({
  content: messageSchema,
  conversationId: z.string().uuid('Invalid conversation ID'),
  attachments: z.array(fileSchema).optional(),
});

export const createConversationSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(100, 'Title must be less than 100 characters'),
});

// Knowledge base schemas
export const uploadDocumentSchema = z.object({
  file: fileSchema,
  title: z.string().max(200, 'Title must be less than 200 characters').optional(),
  description: z.string().max(1000, 'Description must be less than 1000 characters').optional(),
  tags: z.array(z.string().max(50, 'Tag must be less than 50 characters')).optional(),
});

// Workflow schemas
export const createWorkflowSchema = z.object({
  name: z.string()
    .min(1, 'Workflow name is required')
    .max(100, 'Name must be less than 100 characters'),
  description: z.string()
    .max(500, 'Description must be less than 500 characters')
    .optional(),
  trigger: z.object({
    type: z.enum(['webhook', 'schedule', 'manual', 'chat_message']),
    config: z.record(z.any()),
  }),
});

// Tenant settings schemas
export const tenantSettingsSchema = z.object({
  features: z.object({
    chat: z.boolean(),
    knowledgeBase: z.boolean(),
    workflows: z.boolean(),
    analytics: z.boolean(),
    streaming: z.boolean(),
  }).optional(),
  limits: z.object({
    users: z.number().min(1).max(10000),
    conversations: z.number().min(1).max(100000),
    documents: z.number().min(1).max(50000),
    workflows: z.number().min(1).max(1000),
  }).optional(),
  branding: z.object({
    primaryColor: z.string().regex(/^#[0-9A-F]{6}$/i, 'Invalid color format').optional(),
    secondaryColor: z.string().regex(/^#[0-9A-F]{6}$/i, 'Invalid color format').optional(),
    logo: z.string().url('Invalid logo URL').optional(),
  }).optional(),
});

// Sanitization functions
export const sanitizeHtml = (input: string): string => {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

export const sanitizeFileName = (filename: string): string => {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');
};

export const validateAndSanitizeInput = <T>(
  schema: z.ZodSchema<T>,
  input: unknown
): { success: true; data: T } | { success: false; errors: string[] } => {
  try {
    const data = schema.parse(input);
    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(err => err.message);
      return { success: false, errors };
    }
    return { success: false, errors: ['Invalid input'] };
  }
};

// Rate limiting helpers
export const createRateLimiter = (maxRequests: number, windowMs: number) => {
  const requests = new Map<string, number[]>();
  
  return (identifier: string): boolean => {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!requests.has(identifier)) {
      requests.set(identifier, []);
    }
    
    const userRequests = requests.get(identifier)!;
    
    // Remove old requests outside the window
    const validRequests = userRequests.filter(time => time > windowStart);
    
    if (validRequests.length >= maxRequests) {
      return false; // Rate limit exceeded
    }
    
    validRequests.push(now);
    requests.set(identifier, validRequests);
    
    return true; // Request allowed
  };
};
