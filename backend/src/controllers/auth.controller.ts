import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { auditService } from '../services/audit.service';
import { logger } from '../utils/logger';

class AuthController {
  /**
   * Register a new user
   */
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await authService.register(req.body);

      res.status(201).json({
        success: true,
        message: 'Registration successful. Please check your email to verify your account.',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Login user
   */
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;
      const ipAddress = req.ip || req.headers['x-forwarded-for'] as string;
      const userAgent = req.headers['user-agent'];

      const { user, tokens } = await authService.login(
        email,
        password,
        ipAddress,
        userAgent
      );

      // Set cookies
      res.cookie('accessToken', tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 15 * 60 * 1000, // 15 minutes
      });

      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user,
          accessToken: tokens.accessToken,
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
      const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

      if (refreshToken) {
        await authService.logout(refreshToken);
      }

      // Clear cookies
      res.clearCookie('accessToken');
      res.clearCookie('refreshToken');

      // Audit log if user was authenticated
      if (req.user) {
        await auditService.log({
          userId: req.user.id,
          tenantId: req.user.tenantId,
          action: 'USER_LOGOUT',
          entity: 'User',
          entityId: req.user.id,
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string,
          userAgent: req.headers['user-agent'],
        });
      }

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

      const tokens = await authService.refreshTokens(refreshToken);

      // Set new cookies
      res.cookie('accessToken', tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 15 * 60 * 1000, // 15 minutes
      });

      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          accessToken: tokens.accessToken,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Request password reset
   */
  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;

      await authService.forgotPassword(email);

      // Always return success to prevent email enumeration
      res.json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link.',
      });
    } catch (error) {
      // Log error but don't expose it to user
      logger.error('Forgot password error', { error });
      
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
      const { token, newPassword } = req.body;

      await authService.resetPassword(token, newPassword);

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
      const { token } = req.query;

      await authService.verifyEmail(token as string);

      res.json({
        success: true,
        message: 'Email verified successfully. You can now login.',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get current user
   */
  async getCurrentUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new Error('User not found in request');
      }

      // Remove sensitive data
      const user = { ...req.user };
      delete (user as any).passwordHash;
      delete (user as any).twoFactorSecret;

      res.json({
        success: true,
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Enable two-factor authentication
   */
  async enableTwoFactor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new Error('User not found in request');
      }

      const { secret, qrCode } = await authService.enableTwoFactor(req.user.id);

      await auditService.log({
        userId: req.user.id,
        tenantId: req.user.tenantId,
        action: 'TWO_FACTOR_ENABLED',
        entity: 'User',
        entityId: req.user.id,
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        message: 'Two-factor authentication enabled',
        data: { secret, qrCode },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify two-factor authentication code
   */
  async verifyTwoFactor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new Error('User not found in request');
      }

      const { token } = req.body;
      const isValid = await authService.verifyTwoFactor(req.user.id, token);

      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid two-factor authentication code',
        });
      }

      res.json({
        success: true,
        message: 'Two-factor authentication verified',
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
      if (!req.user) {
        throw new Error('User not found in request');
      }

      const { token } = req.body;
      const isValid = await authService.verifyTwoFactor(req.user.id, token);

      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid two-factor authentication code',
        });
      }

      // Disable 2FA
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      
      await prisma.user.update({
        where: { id: req.user.id },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
        },
      });

      await auditService.log({
        userId: req.user.id,
        tenantId: req.user.tenantId,
        action: 'TWO_FACTOR_DISABLED',
        entity: 'User',
        entityId: req.user.id,
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        message: 'Two-factor authentication disabled',
      });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
