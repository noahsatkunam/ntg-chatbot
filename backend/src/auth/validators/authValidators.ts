import Joi from 'joi';
import validator from 'validator';
import xss from 'xss';

// Custom sanitizer
const sanitizeInput = (value: string) => {
  return xss(value, {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script'],
  });
};

// Password validation regex
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;

// Common validation schemas
const emailSchema = Joi.string()
  .email({ tlds: { allow: true } })
  .lowercase()
  .trim()
  .max(255)
  .custom((value, helpers) => {
    if (!validator.isEmail(value)) {
      return helpers.error('any.invalid');
    }
    return validator.normalizeEmail(value) || value;
  })
  .messages({
    'string.email': 'Please provide a valid email address',
    'string.empty': 'Email is required',
    'string.max': 'Email must be less than 255 characters',
    'any.invalid': 'Invalid email format',
  });

const passwordSchema = Joi.string()
  .min(8)
  .max(128)
  .pattern(passwordRegex)
  .messages({
    'string.min': 'Password must be at least 8 characters long',
    'string.max': 'Password must be less than 128 characters',
    'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
    'string.empty': 'Password is required',
  });

const tenantIdSchema = Joi.string()
  .uuid()
  .optional()
  .messages({
    'string.guid': 'Invalid tenant ID format',
  });

// Authentication validation schemas
export const authValidationSchemas = {
  register: Joi.object({
    email: emailSchema.required(),
    password: passwordSchema.required(),
    confirmPassword: Joi.string()
      .required()
      .valid(Joi.ref('password'))
      .messages({
        'any.only': 'Passwords do not match',
        'any.required': 'Password confirmation is required',
      }),
    fullName: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .optional(),
    // CRITICAL: Remove tenantId and role from public registration
    // These are now extracted from subdomain/context only
    acceptTerms: Joi.boolean()
      .valid(true)
      .required()
      .messages({
        'any.only': 'You must accept the terms and conditions',
        'any.required': 'Terms acceptance is required',
      }),
  }),

  login: Joi.object({
    email: emailSchema.required(),
    password: Joi.string().required().messages({
      'string.empty': 'Password is required',
    }),
    rememberMe: Joi.boolean().optional().default(false),
  }),

  refreshToken: Joi.object({
    refreshToken: Joi.string().required().messages({
      'string.empty': 'Refresh token is required',
    }),
  }),

  forgotPassword: Joi.object({
    email: emailSchema.required(),
  }),

  resetPassword: Joi.object({
    token: Joi.string()
      .required()
      .length(64)
      .hex()
      .messages({
        'string.empty': 'Reset token is required',
        'string.length': 'Invalid reset token format',
        'string.hex': 'Invalid reset token format',
      }),
    password: passwordSchema.required(),
    confirmPassword: Joi.string()
      .valid(Joi.ref('password'))
      .required()
      .messages({
        'any.only': 'Passwords do not match',
        'string.empty': 'Please confirm your password',
      }),
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required().messages({
      'string.empty': 'Current password is required',
    }),
    newPassword: passwordSchema
      .required()
      .invalid(Joi.ref('currentPassword'))
      .messages({
        'any.invalid': 'New password must be different from current password',
      }),
    confirmPassword: Joi.string()
      .valid(Joi.ref('newPassword'))
      .required()
      .messages({
        'any.only': 'Passwords do not match',
        'string.empty': 'Please confirm your new password',
      }),
  }),

  updateProfile: Joi.object({
    fullName: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .pattern(/^[a-zA-Z\s'-]+$/)
      .custom((value) => sanitizeInput(value))
      .optional()
      .messages({
        'string.min': 'Full name must be at least 2 characters long',
        'string.max': 'Full name must be less than 100 characters',
        'string.pattern.base': 'Full name can only contain letters, spaces, hyphens, and apostrophes',
      }),
    email: emailSchema.optional(),
    metadata: Joi.object().optional(),
  }),

  verifyEmail: Joi.object({
    token: Joi.string()
      .required()
      .length(64)
      .hex()
      .messages({
        'string.empty': 'Verification token is required',
        'string.length': 'Invalid verification token',
        'string.hex': 'Invalid verification token format',
      }),
  }),

  resendVerificationEmail: Joi.object({
    email: emailSchema.required(),
  }),

  enableTwoFactor: Joi.object({
    password: Joi.string().required().messages({
      'string.empty': 'Password is required to enable 2FA',
    }),
  }),

  verifyTwoFactor: Joi.object({
    token: Joi.string()
      .required()
      .length(6)
      .pattern(/^\d+$/)
      .messages({
        'string.empty': '2FA code is required',
        'string.length': '2FA code must be 6 digits',
        'string.pattern.base': '2FA code must contain only numbers',
      }),
  }),

  disableTwoFactor: Joi.object({
    password: Joi.string().required().messages({
      'string.empty': 'Password is required to disable 2FA',
    }),
    token: Joi.string()
      .required()
      .length(6)
      .pattern(/^\d+$/)
      .messages({
        'string.empty': '2FA code is required',
        'string.length': '2FA code must be 6 digits',
        'string.pattern.base': '2FA code must contain only numbers',
      }),
  }),
};

// Validation middleware factory
export function validateRequest(schema: Joi.ObjectSchema) {
  return (req: any, res: any, next: any) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    // Replace request body with sanitized values
    req.body = value;
    next();
  };
}


// XSS prevention helper for output
export function sanitizeOutput(data: any): any {
  if (typeof data === 'string') {
    return xss(data);
  }
  
  if (Array.isArray(data)) {
    return data.map(sanitizeOutput);
  }
  
  if (data && typeof data === 'object') {
    const sanitized: any = {};
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        sanitized[key] = sanitizeOutput(data[key]);
      }
    }
    return sanitized;
  }
  
  return data;
}

// Email validation with additional checks
export function isValidEmail(email: string): boolean {
  // Basic validation
  if (!validator.isEmail(email)) {
    return false;
  }

  // Check for disposable email domains
  const disposableDomains = [
    'tempmail.com',
    'throwaway.email',
    'guerrillamail.com',
    '10minutemail.com',
    'mailinator.com',
  ];

  const domain = email.split('@')[1]?.toLowerCase();
  if (disposableDomains.includes(domain)) {
    return false;
  }

  return true;
}

// Input sanitization middleware
export function sanitizeInputMiddleware(req: any, _res: any, next: any) {
  // Sanitize body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query params
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  // Sanitize params
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
}

function sanitizeObject(obj: any): any {
  if (typeof obj === 'string') {
    return sanitizeInput(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        // Sanitize the key as well
        const sanitizedKey = sanitizeInput(key);
        sanitized[sanitizedKey] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }

  return obj;
}
