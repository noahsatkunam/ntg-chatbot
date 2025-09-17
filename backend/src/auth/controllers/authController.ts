import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';
import { logger } from '../../utils/logger';
import { AppError } from '../../middlewares/errorHandler';
import { getRedisClient } from '../../utils/redis';

const redis = getRedisClient();

class AuthController {
  /**
   * Register a new user (tenant context required)
   */
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // CRITICAL: Extract tenant context from request
      if (!req.tenantId) {
        throw new AppError('Tenant context required for registration', 400);
      }
      
      const user = await authService.register(req.body, req.tenantId);
      
      res.status(201).json({
        success: true,
        message: 'Registration successful! Please check your email to verify your account.',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Login user (tenant context required)
   */
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // CRITICAL: Extract tenant context from request
      if (!req.tenantId) {
        throw new AppError('Tenant context required for login', 400);
      }

      const { email, password, rememberMe } = req.body;
      const ipAddress = req.ip || req.headers['x-forwarded-for'] as string;
      const userAgent = req.headers['user-agent'];

      const result = await authService.login(
        email,
        password,
        req.tenantId,
        ipAddress,
        userAgent,
        rememberMe
      );

      if (result.requiresTwoFactor) {
        res.status(200).json({
          success: true,
          message: 'Two-factor authentication required',
          requiresTwoFactor: true,
        });
        return;
      }

      // Set HTTP-only cookies for tokens
      const accessTokenMaxAge = 15 * 60 * 1000; // 15 minutes
      const refreshTokenMaxAge = rememberMe 
        ? 30 * 24 * 60 * 60 * 1000 // 30 days
        : 24 * 60 * 60 * 1000; // 1 day

      res.cookie('accessToken', result.tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: accessTokenMaxAge,
        path: '/',
      });

      res.cookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: refreshTokenMaxAge,
        path: '/api/auth',
      });

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: result.user,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Logout user
   */
  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const accessToken = req.token || req.cookies?.accessToken;
      const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

      await authService.logout(refreshToken, accessToken, req.userId);

      // Clear cookies
      res.clearCookie('accessToken', { path: '/' });
      res.clearCookie('refreshToken', { path: '/api/auth' });

      res.json({
        success: true,
        message: 'Logout successful',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

      if (!refreshToken) {
        throw new AppError('Refresh token not provided', 400);
      }

      const tokens = await authService.refreshTokens(refreshToken);

      // Set new cookies
      res.cookie('accessToken', tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 15 * 60 * 1000,
        path: '/',
      });

      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/api/auth',
      });

      res.json({
        success: true,
        message: 'Token refreshed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get current user profile
   */
  async getCurrentUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.userId) {
        throw new AppError('User not authenticated', 401);
      }

      const user = await authService.getCurrentUser(req.userId);

      res.json({
        success: true,
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Request password reset
   */
  async forgotPassword(req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;

      await authService.forgotPassword(email);

      // Always return success to prevent email enumeration
      res.json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link.',
      });
    } catch (error) {
      // Log error but don't expose it
      logger.error('Forgot password error', { 
        error, 
        email: req.body.email,
        requestId: req.requestId,
      });

      // Always return success message
      res.json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link.',
      });
    }
  }

  /**
   * Reset password
   */
  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, password } = req.body;

      await authService.resetPassword(token, password);

      res.json({
        success: true,
        message: 'Password reset successful. Please login with your new password.',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify email address
   */
  async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.body;

      await authService.verifyEmail(token);

      res.json({
        success: true,
        message: 'Email verified successfully. You can now login.',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;

      await authService.resendVerificationEmail(email);

      res.json({
        success: true,
        message: 'If an account exists with this email, a verification link has been sent.',
      });
    } catch (error) {
      logger.error('Resend verification email error', { 
        error, 
        email: req.body.email,
        requestId: req.requestId,
      });

      // Always return success message
      res.json({
        success: true,
        message: 'If an account exists with this email, a verification link has been sent.',
      });
    }
  }

  /**
   * Enable two-factor authentication
   */
  async enableTwoFactor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.userId) {
        throw new AppError('User not authenticated', 401);
      }

      const { password } = req.body;
      const { secret, qrCode } = await authService.enableTwoFactor(req.userId, password);

      res.json({
        success: true,
        message: 'Two-factor authentication setup initiated',
        data: { secret, qrCode },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify two-factor code
   */
  async verifyTwoFactor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, tempToken } = req.body;

      // If tempToken provided, this is login 2FA verification
      if (tempToken) {
        const tempData = await redis.get(`2fa_temp:${tempToken}`);
        if (!tempData) {
          throw new AppError('Invalid or expired authentication session', 401);
        }

        const { userId, ipAddress, userAgent } = JSON.parse(tempData);
        
        // Verify 2FA code
        const isValid = await authService.verifyTwoFactor(userId, token);
        if (!isValid) {
          throw new AppError('Invalid two-factor code', 401);
        }

        // Delete temp token
        await redis.del(`2fa_temp:${tempToken}`);

        // Complete login
        const user = await authService.getCurrentUser(userId);
        const tokens = await authService.login(
          user.email!,
          '', // Password already verified
          ipAddress,
          userAgent,
          false
        );

        res.json({
          success: true,
          message: 'Two-factor authentication successful',
          data: {
            user: tokens.user,
            accessToken: tokens.tokens.accessToken,
          },
        });
        return;
      }

      // Otherwise, this is enabling 2FA
      if (!req.userId) {
        throw new AppError('User not authenticated', 401);
      }

      const isValid = await authService.verifyTwoFactor(req.userId, token, true);
      
      if (!isValid) {
        throw new AppError('Invalid two-factor code', 401);
      }

      res.json({
        success: true,
        message: 'Two-factor authentication enabled successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Disable two-factor authentication
   */
  async disableTwoFactor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.userId) {
        throw new AppError('User not authenticated', 401);
      }

      const { password, token } = req.body;
      await authService.disableTwoFactor(req.userId, password, token);

      res.json({
        success: true,
        message: 'Two-factor authentication disabled',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get CSRF token
   */
  async getCsrfToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const csrfToken = req.csrfToken?.();
      
      if (!csrfToken) {
        throw new AppError('CSRF token not available', 500);
      }

      res.json({
        success: true,
        data: { csrfToken },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
