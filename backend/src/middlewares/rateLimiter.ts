import rateLimit from 'express-rate-limit';
import { Request } from 'express';

// Get configuration from environment variables
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '5', 10);
const RATE_LIMIT_SKIP_SUCCESSFUL = process.env.RATE_LIMIT_SKIP_SUCCESSFUL === 'true';

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
});

export const authRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS, // Default 1 minute
  max: RATE_LIMIT_MAX_REQUESTS, // Default 5 attempts
  message: 'Too many authentication attempts, please try again later',
  skipSuccessfulRequests: RATE_LIMIT_SKIP_SUCCESSFUL,
  standardHeaders: true,
  legacyHeaders: false,
  // Use IP + email as key for more granular rate limiting
  keyGenerator: (req: Request) => {
    const email = req.body?.email || '';
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    return `${ip}:${email}`;
  },
});

export const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 password reset requests per hour
  message: 'Too many password reset requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

export const apiKeyRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute for API key authenticated requests
  message: 'API rate limit exceeded',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Use API key as rate limit key if present
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      return apiKey as string;
    }
    // Fall back to IP
    return req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
  },
});
