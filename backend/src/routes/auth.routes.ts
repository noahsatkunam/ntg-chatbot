import { Router, Request, Response, NextFunction } from 'express';
import { authRateLimiter } from '../middlewares/rateLimiter';
import { authValidation, handleValidationErrors } from '../middlewares/validation.middleware';
import { authenticate, optionalAuth } from '../middlewares/auth.middleware';
import { authController } from '../controllers/auth.controller';

const router = Router();

// Public auth routes with rate limiting
router.post(
  '/register',
  authRateLimiter,
  authValidation.register,
  handleValidationErrors,
  authController.register
);

router.post(
  '/login',
  authRateLimiter,
  authValidation.login,
  handleValidationErrors,
  authController.login
);

router.post(
  '/logout',
  optionalAuth,
  authController.logout
);

router.post(
  '/refresh',
  authValidation.refreshToken,
  handleValidationErrors,
  authController.refreshToken
);

router.post(
  '/forgot-password',
  authRateLimiter,
  authValidation.forgotPassword,
  handleValidationErrors,
  authController.forgotPassword
);

router.post(
  '/reset-password',
  authRateLimiter,
  authValidation.resetPassword,
  handleValidationErrors,
  authController.resetPassword
);

router.get(
  '/verify-email',
  authValidation.verifyEmail,
  handleValidationErrors,
  authController.verifyEmail
);

// Protected auth routes
router.get(
  '/me',
  authenticate,
  authController.getCurrentUser
);

router.post(
  '/enable-2fa',
  authenticate,
  authController.enableTwoFactor
);

router.post(
  '/verify-2fa',
  authenticate,
  authValidation.verifyTwoFactor,
  handleValidationErrors,
  authController.verifyTwoFactor
);

router.post(
  '/disable-2fa',
  authenticate,
  authValidation.verifyTwoFactor,
  handleValidationErrors,
  authController.disableTwoFactor
);

export default router;
