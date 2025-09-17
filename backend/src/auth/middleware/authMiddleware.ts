import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient, User } from '@prisma/client';
import { verifyToken, extractBearerToken, isTokenBlacklisted } from '../utils/jwt.js';
import { logger } from '../../utils/logger';
import { AppError } from '../../middlewares/errorHandler';
import { getRedisClient } from '../../utils/redis';

const prisma = new PrismaClient();
const redis = getRedisClient();

// Extend Express Request interface
// Extend Express Request interface
export interface AuthRequest extends Request {
  user?: User;
  userId?: string;
  tenantId?: string;
  token?: string;
  sessionId?: string;
  requestId?: string;
  csrfToken?: () => string;
}

/**
 * Authentication middleware - verifies JWT and attaches user to request
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Add request ID for tracking
    req.requestId = req.headers['x-request-id'] as string || uuidv4();
    res.setHeader('X-Request-ID', req.requestId);

    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    const token = extractBearerToken(authHeader);

    // Also check for token in cookies
    const cookieToken = req.cookies?.accessToken;
    const finalToken = token || cookieToken;

    if (!finalToken) {
      throw new AppError('No authentication token provided', 401);
    }

    // Check if token is blacklisted
    const isBlacklisted = await isTokenBlacklisted(finalToken, 'access');
    if (isBlacklisted) {
      throw new AppError('Token has been revoked', 401);
    }

    // Verify token
    const decoded = verifyToken(finalToken);

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: { tenant: true },
    });

    if (!user) {
      throw new AppError('User not found', 401);
    }

    // Check if user account is active
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('Account is locked', 423);
    }

    // Check if email is verified
    if (!user.emailVerified) {
      throw new AppError('Email not verified', 403);
    }

    // Validate session
    if (decoded.sessionId) {
      const sessionData = await redis.get(`session:${decoded.sessionId}`);
      if (!sessionData) {
        throw new AppError('Session expired', 401);
      }
    }

    // Attach user and metadata to request
    req.user = user;
    req.userId = user.id;
    req.tenantId = user.tenantId || undefined;
    req.token = finalToken;
    req.sessionId = decoded.sessionId;

    // Log authentication
    logger.debug('User authenticated', {
      userId: user.id,
      email: user.email,
      tenantId: user.tenantId,
      requestId: req.requestId,
    });

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else if (error instanceof Error && error.message === 'Token has expired') {
      next(new AppError('Token has expired', 401));
    } else if (error instanceof Error && error.message === 'Invalid token') {
      next(new AppError('Invalid authentication token', 401));
    } else {
      next(new AppError('Authentication failed', 401));
    }
  }
};

/**
 * Optional authentication - doesn't fail if no token provided
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Add request ID
    req.requestId = req.headers['x-request-id'] as string || uuidv4();
    res.setHeader('X-Request-ID', req.requestId);

    const authHeader = req.headers.authorization;
    const token = extractBearerToken(authHeader) || req.cookies?.accessToken;

    if (!token) {
      return next();
    }

    // Check if token is blacklisted
    const isBlacklisted = await isTokenBlacklisted(token, 'access');
    if (isBlacklisted) {
      return next();
    }

    // Verify token
    const decoded = verifyToken(token);

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: { tenant: true },
    });

    if (user && (!user.lockedUntil || user.lockedUntil < new Date())) {
      req.user = user;
      req.userId = user.id;
      req.tenantId = user.tenantId || undefined;
      req.token = token;
      req.sessionId = decoded.sessionId;
    }
  } catch {
    // Ignore errors for optional auth
  }

  next();
};

/**
 * Authorization middleware - checks if user has required role
 */
export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('Unauthorized access attempt', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: allowedRoles,
        path: req.path,
        requestId: req.requestId,
      });
      
      return next(new AppError('Insufficient permissions', 403));
    }

    next();
  };
};

/**
 * Tenant access validation middleware
 */
export const validateTenantAccess = (req: Request, res: Response, next: NextFunction) => {
  const requestedTenantId = req.params.tenantId || req.body.tenantId || req.query.tenantId as string;

  if (!requestedTenantId || !req.user) {
    return next();
  }

  // Super admins can access any tenant
  if (req.user.role === 'SUPER_ADMIN') {
    req.tenantId = requestedTenantId;
    return next();
  }

  // Check if user belongs to the requested tenant
  if (req.user.tenantId !== requestedTenantId) {
    logger.warn('Tenant access violation', {
      userId: req.user.id,
      userTenantId: req.user.tenantId,
      requestedTenantId,
      requestId: req.requestId,
    });
    
    return next(new AppError('Access denied to this tenant', 403));
  }

  req.tenantId = requestedTenantId;
  next();
};

/**
 * Require verified email middleware
 */
export const requireVerifiedEmail = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.emailVerified) {
    return next(new AppError('Email verification required', 403));
  }
  next();
};

/**
 * Require two-factor authentication middleware
 */
export const requireTwoFactor = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.twoFactorEnabled && !req.session?.twoFactorVerified) {
    return next(new AppError('Two-factor authentication required', 403));
  }
  next();
};

/**
 * Rate limiting by user ID (in addition to IP-based rate limiting)
 */
export const userRateLimit = (maxRequests: number, windowMs: number) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return next();
    }

    const key = `rate_limit:user:${req.userId}:${req.path}`;
    const current = await redis.incr(key);
    
    if (current === 1) {
      await redis.expire(key, Math.ceil(windowMs / 1000));
    }

    if (current > maxRequests) {
      const ttl = await redis.ttl(key);
      res.setHeader('Retry-After', ttl.toString());
      return next(new AppError(`Rate limit exceeded. Please try again in ${ttl} seconds`, 429));
    }

    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', (maxRequests - current).toString());
    
    next();
  };
};

/**
 * Audit logging middleware
 */
export const auditLog = (action: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    // Capture original response methods
    const originalSend = res.send;
    const originalJson = res.json;
    
    // Override response methods to capture response data
    res.send = function(data: any) {
      res.locals.responseData = data;
      res.send = originalSend;
      return res.send(data);
    };
    
    res.json = function(data: any) {
      res.locals.responseData = data;
      res.json = originalJson;
      return res.json(data);
    };
    
    // Continue to next middleware
    next();
    
    // Log after response is sent
    res.on('finish', async () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;
      
      try {
        await prisma.auditLog.create({
          data: {
            action,
            entity: 'Auth',
            userId: req.userId,
            tenantId: req.tenantId,
            ipAddress: req.ip || req.headers['x-forwarded-for'] as string,
            userAgent: req.headers['user-agent'],
            metadata: {
              requestId: req.requestId,
              method: req.method,
              path: req.path,
              statusCode,
              duration,
              success: statusCode < 400,
            },
          },
        });
      } catch (error) {
        logger.error('Failed to create audit log', {
          error,
          action,
          userId: req.userId,
          requestId: req.requestId,
        });
      }
    });
  };
};

/**
 * Secure headers middleware
 */
export const secureHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Remove fingerprinting headers
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  
  next();
};
