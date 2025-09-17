import { Request, Response, NextFunction } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { ZodError } from 'zod';
import { ValidationError } from 'express-validator';

export interface AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  code?: string;
  details?: any;
}

export class AppErrorClass extends Error implements AppError {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;
  public readonly details?: any;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true, code?: string, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationErrorClass extends AppErrorClass {
  constructor(message: string, details?: any) {
    super(message, 400, true, 'VALIDATION_ERROR', details);
  }
}

export class AuthenticationErrorClass extends AppErrorClass {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, true, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationErrorClass extends AppErrorClass {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, true, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundErrorClass extends AppErrorClass {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, true, 'NOT_FOUND_ERROR');
  }
}

export class ConflictErrorClass extends AppErrorClass {
  constructor(message: string) {
    super(message, 409, true, 'CONFLICT_ERROR');
  }
}

export class RateLimitErrorClass extends AppErrorClass {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, true, 'RATE_LIMIT_ERROR');
  }
}

export class TenantIsolationErrorClass extends AppErrorClass {
  constructor(message: string = 'Tenant isolation violation') {
    super(message, 403, true, 'TENANT_ISOLATION_ERROR');
  }
}

export class ExternalServiceErrorClass extends AppErrorClass {
  constructor(service: string, message: string, details?: any) {
    super(`${service} service error: ${message}`, 502, true, 'EXTERNAL_SERVICE_ERROR', details);
  }
}

// Error handler middleware
export const errorHandler = (
  error: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let statusCode = 500;
  let message = 'Internal server error';
  let code = 'INTERNAL_ERROR';
  let details: any = undefined;

  // Log error for debugging
  console.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    body: req.body,
    params: req.params,
    query: req.query,
    user: (req as any).user?.id,
    tenant: (req as any).user?.tenantId,
    timestamp: new Date().toISOString()
  });

  // Handle different error types
  if (error instanceof AppErrorClass) {
    statusCode = error.statusCode;
    message = error.message;
    code = error.code || 'APP_ERROR';
    details = error.details;
  } else if (error instanceof PrismaClientKnownRequestError) {
    ({ statusCode, message, code, details } = handlePrismaError(error));
  } else if (error instanceof ZodError) {
    ({ statusCode, message, code, details } = handleZodError(error));
  } else if (isValidationError(error)) {
    ({ statusCode, message, code, details } = handleValidationError(error));
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    code = 'INVALID_TOKEN';
  } else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    code = 'TOKEN_EXPIRED';
  } else if (error.name === 'MulterError') {
    ({ statusCode, message, code } = handleMulterError(error));
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal server error';
    details = undefined;
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method
    }
  });
};

// Handle Prisma errors
function handlePrismaError(error: PrismaClientKnownRequestError): {
  statusCode: number;
  message: string;
  code: string;
  details?: any;
} {
  switch (error.code) {
    case 'P2002':
      return {
        statusCode: 409,
        message: 'Unique constraint violation',
        code: 'UNIQUE_CONSTRAINT_ERROR',
        details: { field: error.meta?.target }
      };
    case 'P2025':
      return {
        statusCode: 404,
        message: 'Record not found',
        code: 'RECORD_NOT_FOUND'
      };
    case 'P2003':
      return {
        statusCode: 400,
        message: 'Foreign key constraint violation',
        code: 'FOREIGN_KEY_ERROR',
        details: { field: error.meta?.field_name }
      };
    case 'P2014':
      return {
        statusCode: 400,
        message: 'Invalid relation',
        code: 'INVALID_RELATION_ERROR'
      };
    default:
      return {
        statusCode: 500,
        message: 'Database error',
        code: 'DATABASE_ERROR',
        details: process.env.NODE_ENV !== 'production' ? { prismaCode: error.code } : undefined
      };
  }
}

// Handle Zod validation errors
function handleZodError(error: ZodError): {
  statusCode: number;
  message: string;
  code: string;
  details: any;
} {
  const details = error.errors.map(err => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code
  }));

  return {
    statusCode: 400,
    message: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details
  };
}

// Handle express-validator errors
function handleValidationError(errors: any): {
  statusCode: number;
  message: string;
  code: string;
  details: any;
} {
  const details = errors.map((err: any) => ({
    field: err.path || err.param,
    message: err.msg,
    value: err.value
  }));

  return {
    statusCode: 400,
    message: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details
  };
}

// Handle Multer errors
function handleMulterError(error: any): {
  statusCode: number;
  message: string;
  code: string;
} {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return {
        statusCode: 413,
        message: 'File too large',
        code: 'FILE_TOO_LARGE'
      };
    case 'LIMIT_FILE_COUNT':
      return {
        statusCode: 400,
        message: 'Too many files',
        code: 'TOO_MANY_FILES'
      };
    case 'LIMIT_UNEXPECTED_FILE':
      return {
        statusCode: 400,
        message: 'Unexpected file field',
        code: 'UNEXPECTED_FILE'
      };
    default:
      return {
        statusCode: 400,
        message: 'File upload error',
        code: 'FILE_UPLOAD_ERROR'
      };
  }
}

// Type guard for validation errors
function isValidationError(error: any): error is ValidationError[] {
  return Array.isArray(error) && error.length > 0 && error[0].msg !== undefined;
}

// Async error wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Create specific error instances
export const createError = {
  validation: (message: string, details?: any) => new ValidationErrorClass(message, details),
  authentication: (message?: string) => new AuthenticationErrorClass(message),
  authorization: (message?: string) => new AuthorizationErrorClass(message),
  notFound: (resource?: string) => new NotFoundErrorClass(resource),
  conflict: (message: string) => new ConflictErrorClass(message),
  rateLimit: (message?: string) => new RateLimitErrorClass(message),
  tenantIsolation: (message?: string) => new TenantIsolationErrorClass(message),
  externalService: (service: string, message: string, details?: any) => 
    new ExternalServiceErrorClass(service, message, details),
  generic: (message: string, statusCode?: number, code?: string, details?: any) => 
    new AppErrorClass(message, statusCode, true, code, details)
};

// Error logging utility
export const logError = (error: Error | AppError, context?: any) => {
  const errorLog = {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    context
  };

  if (error instanceof AppErrorClass) {
    errorLog.statusCode = error.statusCode;
    errorLog.code = error.code;
    errorLog.details = error.details;
  }

  console.error('Application Error:', errorLog);
};

// Health check error
export class HealthCheckErrorClass extends AppErrorClass {
  constructor(service: string, details?: any) {
    super(`Health check failed for ${service}`, 503, true, 'HEALTH_CHECK_ERROR', details);
  }
}
