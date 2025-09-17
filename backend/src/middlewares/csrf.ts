import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AppError } from './errorHandler';
import { logger } from '../utils/logger';

// CSRF token storage (in production, use Redis or session store)
const csrfTokens = new Map<string, { token: string; expires: number }>();

// Configuration
const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour

declare global {
  namespace Express {
    interface Request {
      csrfToken?: () => string;
    }
  }
}

/**
 * Generate CSRF token
 */
function generateCSRFToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * CSRF token generation middleware
 */
export const csrfTokenGenerator = (req: Request, res: Response, next: NextFunction) => {
  // Generate new token or get existing
  const sessionId = req.sessionId || req.cookies?.sessionId || crypto.randomUUID();
  
  let tokenData = csrfTokens.get(sessionId);
  
  // Clean up expired tokens
  if (tokenData && tokenData.expires < Date.now()) {
    csrfTokens.delete(sessionId);
    tokenData = undefined;
  }
  
  // Generate new token if needed
  if (!tokenData) {
    const token = generateCSRFToken();
    tokenData = {
      token,
      expires: Date.now() + CSRF_TOKEN_EXPIRY,
    };
    csrfTokens.set(sessionId, tokenData);
  }
  
  // Attach token getter to request
  req.csrfToken = () => tokenData!.token;
  
  // Set token in response locals for views
  res.locals.csrfToken = tokenData.token;
  
  // Set CSRF token cookie for SPAs
  res.cookie('XSRF-TOKEN', tokenData.token, {
    httpOnly: false, // Allow JavaScript access for SPAs
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: CSRF_TOKEN_EXPIRY,
  });
  
  next();
};

/**
 * CSRF protection middleware
 */
export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
  // Skip CSRF for GET, HEAD, OPTIONS requests
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  // Skip for API endpoints that use JWT authentication
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return next();
  }
  
  // Get session ID
  const sessionId = req.sessionId || req.cookies?.sessionId;
  if (!sessionId) {
    throw new AppError('No session found', 403);
  }
  
  // Get stored token
  const tokenData = csrfTokens.get(sessionId);
  if (!tokenData || tokenData.expires < Date.now()) {
    throw new AppError('CSRF token expired', 403);
  }
  
  // Get submitted token from multiple sources
  const submittedToken = 
    req.body?._csrf ||
    req.query?._csrf ||
    req.headers['csrf-token'] ||
    req.headers['xsrf-token'] ||
    req.headers['x-csrf-token'] ||
    req.headers['x-xsrf-token'];
  
  if (!submittedToken) {
    logger.warn('CSRF token missing', {
      sessionId,
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    throw new AppError('CSRF token missing', 403);
  }
  
  // Verify token
  if (submittedToken !== tokenData.token) {
    logger.warn('CSRF token mismatch', {
      sessionId,
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    throw new AppError('Invalid CSRF token', 403);
  }
  
  // Refresh token expiry
  tokenData.expires = Date.now() + CSRF_TOKEN_EXPIRY;
  
  next();
};

/**
 * Clean up expired CSRF tokens periodically
 */
export function startCSRFCleanup(): void {
  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, tokenData] of csrfTokens.entries()) {
      if (tokenData.expires < now) {
        csrfTokens.delete(sessionId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired CSRF tokens`);
    }
  }, 5 * 60 * 1000); // Run every 5 minutes
}

// Export convenience middleware that combines both
export const csrf = [csrfTokenGenerator, csrfProtection];
