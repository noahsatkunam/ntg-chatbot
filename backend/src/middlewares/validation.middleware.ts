import { Request, Response, NextFunction } from 'express';
import { Schema } from 'joi';
import { body, param, query, validationResult } from 'express-validator';
import validator from 'validator';
import xss from 'xss';
import { AppError } from './errorHandler';

/**
 * Joi validation middleware
 */
export const validateRequest = (schema: Schema, property: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req[property], { abortEarly: false });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return next(new AppError('Validation failed', 400, { errors }));
    }
    
    next();
  };
};

/**
 * Handle validation errors
 */
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map((error) => ({
      field: error.param,
      message: error.msg,
    }));
    
    throw new AppError('Validation failed', 400, {
      errors: formattedErrors,
    });
  }
  
  next();
};

/**
 * Sanitize input to prevent XSS
 */
export const sanitizeInput = (value: any): string => {
  if (typeof value !== 'string') {
    return value;
  }
  
  return xss(value, {
    whiteList: {}, // No HTML tags allowed
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script'],
  });
};

/**
 * Authentication validation rules
 */
export const authValidation = {
  register: [
    body('email')
      .trim()
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail()
      .customSanitizer(sanitizeInput),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain uppercase, lowercase, number and special character'),
    body('fullName')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Full name must be between 2 and 100 characters')
      .customSanitizer(sanitizeInput),
    body('tenantId')
      .optional()
      .isUUID()
      .withMessage('Invalid tenant ID'),
  ],

  login: [
    body('email')
      .trim()
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),
    body('password')
      .notEmpty()
      .withMessage('Password is required'),
  ],

  forgotPassword: [
    body('email')
      .trim()
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),
  ],

  resetPassword: [
    body('token')
      .notEmpty()
      .withMessage('Reset token is required')
      .isLength({ min: 36, max: 36 })
      .withMessage('Invalid reset token'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain uppercase, lowercase, number and special character'),
  ],

  verifyEmail: [
    query('token')
      .notEmpty()
      .withMessage('Verification token is required')
      .isLength({ min: 36, max: 36 })
      .withMessage('Invalid verification token'),
  ],

  refreshToken: [
    body('refreshToken')
      .notEmpty()
      .withMessage('Refresh token is required'),
  ],

  verifyTwoFactor: [
    body('token')
      .notEmpty()
      .withMessage('2FA token is required')
      .isLength({ min: 6, max: 6 })
      .withMessage('2FA token must be 6 digits')
      .isNumeric()
      .withMessage('2FA token must contain only numbers'),
  ],
};

/**
 * Common validation rules
 */
export const commonValidation = {
  uuidParam: (paramName: string) => [
    param(paramName)
      .isUUID()
      .withMessage(`Invalid ${paramName}`),
  ],

  pagination: [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer')
      .toInt(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
      .toInt(),
    query('sortBy')
      .optional()
      .isIn(['createdAt', 'updatedAt', 'name', 'email'])
      .withMessage('Invalid sort field'),
    query('sortOrder')
      .optional()
      .isIn(['asc', 'desc'])
      .withMessage('Sort order must be asc or desc'),
  ],

  search: [
    query('q')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Search query must be between 1 and 100 characters')
      .customSanitizer(sanitizeInput),
  ],
};

/**
 * Tenant validation rules
 */
export const tenantValidation = {
  create: [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Tenant name is required')
      .isLength({ min: 2, max: 100 })
      .withMessage('Tenant name must be between 2 and 100 characters')
      .customSanitizer(sanitizeInput),
    body('slug')
      .trim()
      .notEmpty()
      .withMessage('Tenant slug is required')
      .matches(/^[a-z0-9-]+$/)
      .withMessage('Slug must contain only lowercase letters, numbers, and hyphens')
      .isLength({ min: 3, max: 50 })
      .withMessage('Slug must be between 3 and 50 characters'),
  ],

  update: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Tenant name must be between 2 and 100 characters')
      .customSanitizer(sanitizeInput),
    body('status')
      .optional()
      .isIn(['ACTIVE', 'SUSPENDED', 'DELETED'])
      .withMessage('Invalid tenant status'),
    body('settings')
      .optional()
      .isObject()
      .withMessage('Settings must be an object'),
  ],
};

/**
 * Chatbot validation rules
 */
export const chatbotValidation = {
  create: [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Chatbot name is required')
      .isLength({ min: 2, max: 100 })
      .withMessage('Chatbot name must be between 2 and 100 characters')
      .customSanitizer(sanitizeInput),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters')
      .customSanitizer(sanitizeInput),
    body('promptTemplate')
      .optional()
      .trim()
      .isLength({ max: 2000 })
      .withMessage('Prompt template must not exceed 2000 characters')
      .customSanitizer(sanitizeInput),
    body('welcomeMessage')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Welcome message must not exceed 500 characters')
      .customSanitizer(sanitizeInput),
  ],
};

/**
 * Message validation rules
 */
export const messageValidation = {
  send: [
    body('content')
      .trim()
      .notEmpty()
      .withMessage('Message content is required')
      .isLength({ max: 5000 })
      .withMessage('Message must not exceed 5000 characters')
      .customSanitizer(sanitizeInput),
    body('type')
      .optional()
      .isIn(['user', 'assistant', 'system'])
      .withMessage('Invalid message type'),
  ],
};

/**
 * Custom validators
 */
export const customValidators = {
  isStrongPassword: (value: string): boolean => {
    const hasUpperCase = /[A-Z]/.test(value);
    const hasLowerCase = /[a-z]/.test(value);
    const hasNumber = /\d/.test(value);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(value);
    const hasMinLength = value.length >= 8;
    
    return hasUpperCase && hasLowerCase && hasNumber && hasSpecialChar && hasMinLength;
  },

  isValidUrl: (value: string): boolean => {
    return validator.isURL(value, {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_valid_protocol: true,
    });
  },

  isSafeString: (value: string): boolean => {
    // Check for common SQL injection patterns
    const sqlPatterns = /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)|(--)|(;)|(\/\*)|(\*\/)/i;
    
    // Check for script injection
    const scriptPatterns = /<script|<\/script|javascript:|onerror=|onclick=/i;
    
    return !sqlPatterns.test(value) && !scriptPatterns.test(value);
  },
};
