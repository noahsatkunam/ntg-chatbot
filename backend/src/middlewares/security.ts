import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Additional security headers middleware
 */
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Generate nonce for CSP
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;

  // Additional security headers not covered by Helmet
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  
  // Feature Policy / Permissions Policy
  res.setHeader('Permissions-Policy', 
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
  );

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Remove server information
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');

  next();
};

/**
 * CSRF protection middleware
 */
export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
  // Skip CSRF for GET requests and API endpoints that use JWT
  if (req.method === 'GET' || req.path.startsWith('/api/auth/')) {
    return next();
  }

  const token = req.headers['x-csrf-token'] || req.body._csrf;
  const sessionToken = req.session?.csrfToken;

  if (!token || token !== sessionToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  next();
};

/**
 * Generate CSRF token for session
 */
export const generateCSRFToken = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session) {
    return next();
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  // Make token available to views
  res.locals.csrfToken = req.session.csrfToken;
  next();
};
