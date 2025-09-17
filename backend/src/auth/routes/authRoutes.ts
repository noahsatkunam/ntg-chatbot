import { Router } from 'express';
import { authController } from '../controllers/authController';
import { validateRequest } from '../../middlewares/validation.middleware';
import { authValidationSchemas } from '../validators/authValidators';
import { 
  authenticate, 
  authorize, 
  checkEmailVerified,
  checkTwoFactorEnabled,
  auditLog,
  refreshTokenMiddleware
} from '../middleware/authMiddleware';
import { sanitizeInputMiddleware } from '../validators/authValidators';
import rateLimit from 'express-rate-limit';
import { getRedisClient } from '../../utils/redis';
import { identifyTenant } from '../../tenant/middleware/tenantMiddleware';

const router = Router();
const redis = getRedisClient();

// Enhanced rate limiters with Redis store
const authRateLimit = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:auth:',
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 attempts per minute
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // Use IP + email for more granular rate limiting
    const email = req.body?.email || '';
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    return `${ip}:${email}`;
  },
});

const passwordResetRateLimit = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:reset:',
  }),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 password reset requests per hour
  message: 'Too many password reset requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const generalRateLimit = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:general:',
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply security headers to all auth routes
router.use(secureHeaders);
router.use(sanitizeInputMiddleware);

// Public routes - no authentication required
router.post(
  '/register',
  authRateLimit,
  validateRequest(authValidationSchemas.register),
  auditLog('AUTH_REGISTER'),
  authController.register
);

router.post(
  '/login',
  authRateLimit,
  validateRequest(authValidationSchemas.login),
  auditLog('AUTH_LOGIN'),
  authController.login
);

router.post(
  '/logout',
  optionalAuth,
  auditLog('AUTH_LOGOUT'),
  authController.logout
);

router.post(
  '/refresh',
  generalRateLimit,
  validateRequest(authValidationSchemas.refreshToken),
  authController.refreshToken
);

router.post(
  '/forgot-password',
  passwordResetRateLimit,
  identifyTenant,
  validateRequest(authValidationSchemas.forgotPassword),
  auditLog('AUTH_FORGOT_PASSWORD'),
  authController.forgotPassword
);

router.post(
  '/reset-password',
  passwordResetRateLimit,
  identifyTenant,
  validateRequest(authValidationSchemas.resetPassword),
  auditLog('AUTH_RESET_PASSWORD'),
  authController.resetPassword
);

router.post(
  '/verify-email',
  generalRateLimit,
  validateRequest(authValidationSchemas.verifyEmail),
  auditLog('AUTH_VERIFY_EMAIL'),
  authController.verifyEmail
);

router.post(
  '/resend-verification',
  authRateLimit,
  identifyTenant,
  validateRequest(authValidationSchemas.resendVerificationEmail),
  auditLog('AUTH_RESEND_VERIFICATION'),
  authController.resendVerificationEmail
);

// Two-factor authentication routes
router.post(
  '/verify-2fa',
  authRateLimit,
  validateRequest(authValidationSchemas.verifyTwoFactor),
  auditLog('AUTH_VERIFY_2FA'),
  authController.verifyTwoFactor
);

// Protected routes - authentication required
router.get(
  '/me',
  authenticate,
  userRateLimit(100, 60000), // 100 requests per minute per user
  auditLog('AUTH_GET_PROFILE'),
  authController.getCurrentUser
);

router.post(
  '/enable-2fa',
  authenticate,
  csrfProtection,
  validateRequest(authValidationSchemas.enableTwoFactor),
  userRateLimit(5, 300000), // 5 requests per 5 minutes
  auditLog('AUTH_ENABLE_2FA'),
  authController.enableTwoFactor
);

router.post(
  '/disable-2fa',
  authenticate,
  csrfProtection,
  validateRequest(authValidationSchemas.disableTwoFactor),
  userRateLimit(5, 300000), // 5 requests per 5 minutes
  auditLog('AUTH_DISABLE_2FA'),
  authController.disableTwoFactor
);

// CSRF token endpoint
router.get(
  '/csrf-token',
  authenticate,
  authController.getCsrfToken
);

export default router;
