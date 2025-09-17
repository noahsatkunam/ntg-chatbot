import { PrismaClient, User, TokenType } from '@prisma/client';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import { logger } from '../../utils/logger';
import { AppError } from '../../middlewares/errorHandler';
import { getRedisClient } from '../../utils/redis';
import { 
  hashPassword, 
  verifyPassword, 
  validatePasswordStrength
} from '../utils/password';
import {
  generateTokenPair,
  refreshAccessToken,
  blacklistToken,
  invalidateAllUserTokens,
  generateSecureToken
} from '../utils/jwt';
import { emailService } from '../../services/email.service';

const prisma = new PrismaClient();
const redis = getRedisClient();

export interface RegisterUserData {
  email: string;
  password: string;
  fullName?: string;
  tenantId?: string;
  role?: string;
  invitationToken?: string;
}

export interface LoginResult {
  user: Partial<User>;
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiry: Date;
    refreshTokenExpiry: Date;
  };
  requiresTwoFactor?: boolean;
}

export interface PasswordResetData {
  token: string;
  password: string;
}

class AuthService {
  /**
   * Register a new user (public endpoint - tenant context required)
   */
  async register(data: RegisterUserData, tenantId: string | null): Promise<Partial<User>> {
    // CRITICAL: Prevent public SUPER_ADMIN creation
    // Only existing SUPER_ADMINs can create other admins
    if (data.role === 'SUPER_ADMIN' || data.role === 'TENANT_ADMIN') {
      throw new AppError('Insufficient permissions to create admin users', 403);
    }

    // Validate password strength
    const passwordValidation = validatePasswordStrength(data.password);
    if (!passwordValidation.isValid) {
      throw new AppError(passwordValidation.errors.join(', '), 400);
    }

    // Normalize email
    const email = data.email.toLowerCase().trim();

    // CRITICAL: Tenant validation
    if (!tenantId) {
      throw new AppError('Tenant context required for registration', 400);
    }

    // Verify tenant exists and is active
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new AppError('Invalid tenant', 404);
    }

    if (tenant.status === 'SUSPENDED' || tenant.status === 'INACTIVE') {
      throw new AppError('Tenant is not active', 403);
    }

    // Check if user already exists in the tenant
    const existingUser = await prisma.user.findFirst({
      where: {
        email,
        tenantId,
      },
    });

    if (existingUser) {
      throw new AppError('User with this email already exists', 409);
    }

    // Hash password
    const passwordHash = await hashPassword(data.password);

    // Begin transaction
    const user = await prisma.$transaction(async (tx) => {
      // Create user in database
      const newUser = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: data.fullName,
          tenantId,
          // CRITICAL: Always create TENANT_USER for public registration
          role: 'TENANT_USER' as any,
          metadata: {
            registrationSource: 'web',
            registrationDate: new Date().toISOString(),
          },
        },
      });

      // Create verification token
      const verificationToken = generateSecureToken(32);
      const hashedToken = crypto
        .createHash('sha256')
        .update(verificationToken)
        .digest('hex');

      await tx.authToken.create({
        data: {
          userId: newUser.id,
          token: hashedToken,
          type: TokenType.EMAIL_VERIFICATION,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      });

      // Send verification email
      try {
        await emailService.sendVerificationEmail(email, verificationToken);
      } catch (error) {
        logger.error('Failed to send verification email', { error, email });
        // Don't fail registration if email fails
      }

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId: newUser.id,
          tenantId: newUser.tenantId,
          action: 'USER_REGISTERED',
          entity: 'User',
          entityId: newUser.id,
          metadata: { email },
        },
      });

      return newUser;
    });

    // Return user without sensitive data
    const { passwordHash: _, twoFactorSecret: __, ...safeUser } = user;
    return safeUser;
  }

  /**
   * Login user (tenant-scoped)
   */
  async login(
    email: string,
    password: string,
    tenantId: string | null,
    ipAddress?: string,
    userAgent?: string,
    skipPasswordCheck: boolean = false
  ): Promise<LoginResult> {
    const normalizedEmail = email.toLowerCase().trim();

    // CRITICAL: Require tenant context for login
    if (!tenantId) {
      throw new AppError('Tenant context required for login', 400);
    }

    // Find user by email AND tenantId to prevent cross-tenant authentication
    const user = await prisma.user.findFirst({
      where: { 
        email: normalizedEmail,
        tenantId: tenantId
      },
      include: {
        tenant: true
      }
    });

    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    // Verify tenant is active
    if (user.tenant && (user.tenant.status === 'SUSPENDED' || user.tenant.status === 'INACTIVE')) {
      throw new AppError('Tenant is not active', 403);
    }

    // Check account lock
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('Account is locked. Please try again later.', 423);
    }

    // Verify password (skip for 2FA second step)
    if (!skipPasswordCheck) {
      const isPasswordValid = await verifyPassword(password, user.passwordHash);
      
      if (!isPasswordValid) {
        // Increment failed login attempts
        await this.incrementFailedLoginAttempts(user.id);
        throw new AppError('Invalid credentials', 401);
      }
    } 

    // Check if email is verified
    if (!user.emailVerified) {
      throw new AppError('Please verify your email address before logging in', 403);
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      // Generate temporary auth token for 2FA flow
      const tempToken = generateSecureToken(32);
      await redis.setEx(
        `2fa_temp:${tempToken}`,
        300, // 5 minutes
        JSON.stringify({ userId: user.id, ipAddress, userAgent })
      );

      return {
        user: { id: user.id, email: user.email },
        tokens: {
          accessToken: '',
          refreshToken: '',
          accessTokenExpiry: new Date(),
          refreshTokenExpiry: new Date(),
        },
        requiresTwoFactor: true,
      };
    }

    // Reset failed login attempts
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress,
      },
    });

    // Generate tokens
    const tokens = await generateTokenPair(
      user.id,
      user.email,
      user.role,
      user.tenantId || undefined
    );

    // Adjust refresh token expiry based on rememberMe
    if (!rememberMe) {
      tokens.refreshTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day
    }

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        action: 'USER_LOGIN',
        entity: 'User',
        entityId: user.id,
        ipAddress,
        userAgent,
        metadata: { rememberMe },
      },
    });

    // Send login alert if from new location
    if (ipAddress && ipAddress !== user.lastLoginIp) {
      try {
        await emailService.sendLoginAlert(user.email, {
          ipAddress,
          userAgent: userAgent || 'Unknown',
          timestamp: new Date(),
        });
      } catch (error) {
        logger.error('Failed to send login alert', { error });
      }
    }

    // Return user without sensitive data
    const { passwordHash: _, twoFactorSecret: __, ...safeUser } = user;
    return { user: safeUser, tokens };
  }

  /**
   * Logout user
   */
  async logout(refreshToken?: string, accessToken?: string, userId?: string): Promise<void> {
    try {
      // Blacklist tokens
      if (accessToken) {
        await blacklistToken(accessToken, 'access');
      }
      
      if (refreshToken) {
        await blacklistToken(refreshToken, 'refresh');
      }

      // Create audit log
      if (userId) {
        await prisma.auditLog.create({
          data: {
            userId,
            action: 'USER_LOGOUT',
            entity: 'User',
            entityId: userId,
          },
        });
      }
    } catch (error) {
      logger.error('Error during logout', { error, userId });
      // Don't throw error on logout failure
    }
  }

  /**
   * Refresh access token
   */
  async refreshTokens(refreshToken: string): Promise<LoginResult['tokens']> {
    try {
      const tokens = await refreshAccessToken(refreshToken);
      return tokens;
    } catch (error) {
      logger.error('Failed to refresh tokens', { error });
      throw new AppError('Failed to refresh tokens', 401);
    }
  }

  /**
   * Request password reset
   */
  async forgotPassword(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      // Don't reveal if user exists
      logger.info('Password reset requested for non-existent email', { email: normalizedEmail });
      return;
    }

    // Check if user has recent password reset request
    const recentToken = await prisma.authToken.findFirst({
      where: {
        userId: user.id,
        type: TokenType.PASSWORD_RESET,
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }, // 5 minutes
      },
    });

    if (recentToken) {
      throw new AppError('Password reset already requested. Please check your email.', 429);
    }

    // Generate reset token
    const resetToken = generateSecureToken(32);
    const hashedToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Store token
    await prisma.authToken.create({
      data: {
        userId: user.id,
        token: hashedToken,
        type: TokenType.PASSWORD_RESET,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    // Send reset email
    try {
      await emailService.sendPasswordResetEmail(user.email, resetToken);
    } catch (error) {
      logger.error('Failed to send password reset email', { error });
      throw new AppError('Failed to send password reset email', 500);
    }

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        action: 'PASSWORD_RESET_REQUESTED',
        entity: 'User',
        entityId: user.id,
      },
    });
  }

  /**
   * Reset password
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    // Validate password strength
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      throw new AppError(passwordValidation.errors.join(', '), 400);
    }

    // Hash the token to find it in database
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find valid reset token
    const resetToken = await prisma.authToken.findFirst({
      where: {
        token: hashedToken,
        type: TokenType.PASSWORD_RESET,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
      include: { user: true },
    });

    if (!resetToken) {
      throw new AppError('Invalid or expired reset token', 400);
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword);

    // Update user password and mark token as used
    await prisma.$transaction(async (tx) => {
      // Update password
      await tx.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });

      // Mark token as used
      await tx.authToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });

      // Invalidate all other password reset tokens for this user
      await tx.authToken.updateMany({
        where: {
          userId: resetToken.userId,
          type: TokenType.PASSWORD_RESET,
          usedAt: null,
          id: { not: resetToken.id },
        },
        data: { usedAt: new Date() },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId: resetToken.userId,
          tenantId: resetToken.user.tenantId,
          action: 'PASSWORD_RESET',
          entity: 'User',
          entityId: resetToken.userId,
        },
      });
    });

    // Invalidate all user sessions
    await invalidateAllUserTokens(resetToken.userId);
  }

  /**
   * Verify email
   */
  async verifyEmail(token: string): Promise<void> {
    // Hash the token
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find valid verification token
    const verificationToken = await prisma.authToken.findFirst({
      where: {
        token: hashedToken,
        type: TokenType.EMAIL_VERIFICATION,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
      include: { user: true },
    });

    if (!verificationToken) {
      throw new AppError('Invalid or expired verification token', 400);
    }

    // Update user and mark token as used
    await prisma.$transaction(async (tx) => {
      // Update user
      await tx.user.update({
        where: { id: verificationToken.userId },
        data: {
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });

      // Mark token as used
      await tx.authToken.update({
        where: { id: verificationToken.id },
        data: { usedAt: new Date() },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId: verificationToken.userId,
          tenantId: verificationToken.user.tenantId,
          action: 'EMAIL_VERIFIED',
          entity: 'User',
          entityId: verificationToken.userId,
        },
      });
    });
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      // Don't reveal if user exists
      return;
    }

    if (user.emailVerified) {
      throw new AppError('Email is already verified', 400);
    }

    // Check for recent verification token
    const recentToken = await prisma.authToken.findFirst({
      where: {
        userId: user.id,
        type: TokenType.EMAIL_VERIFICATION,
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }, // 5 minutes
      },
    });

    if (recentToken) {
      throw new AppError('Verification email already sent. Please check your email.', 429);
    }

    // Generate new token
    const verificationToken = generateSecureToken(32);
    const hashedToken = crypto
      .createHash('sha256')
      .update(verificationToken)
      .digest('hex');

    await prisma.authToken.create({
      data: {
        userId: user.id,
        token: hashedToken,
        type: TokenType.EMAIL_VERIFICATION,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    // Send email
    try {
      await emailService.sendVerificationEmail(user.email, verificationToken);
    } catch (error) {
      logger.error('Failed to send verification email', { error });
      throw new AppError('Failed to send verification email', 500);
    }
  }

  /**
   * Get current user
   */
  async getCurrentUser(userId: string): Promise<Partial<User>> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const { passwordHash: _, twoFactorSecret: __, ...safeUser } = user;
    return safeUser;
  }

  /**
   * Enable two-factor authentication
   */
  async enableTwoFactor(userId: string, password: string): Promise<{ secret: string; qrCode: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      throw new AppError('Invalid password', 401);
    }

    // Generate secret
    const appName = process.env.TWO_FACTOR_APP_NAME || 'ChatbotPlatform';
    const secret = speakeasy.generateSecret({
      name: `${appName} (${user.email})`,
      length: 32,
    });

    // Store secret (encrypted in production)
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: secret.base32,
        twoFactorEnabled: false, // Will be enabled after first successful verification
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId,
        tenantId: user.tenantId,
        action: 'TWO_FACTOR_SETUP_INITIATED',
        entity: 'User',
        entityId: userId,
      },
    });

    return {
      secret: secret.base32,
      qrCode: secret.otpauth_url || '',
    };
  }

  /**
   * Verify two-factor code
   */
  async verifyTwoFactor(userId: string, code: string, isEnabling: boolean = false): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.twoFactorSecret) {
      throw new AppError('Two-factor authentication not set up', 400);
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code,
      window: parseInt(process.env.TWO_FACTOR_WINDOW || '1', 10),
    });

    if (verified && isEnabling && !user.twoFactorEnabled) {
      // Enable 2FA if this is first successful verification
      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: true },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          tenantId: user.tenantId,
          action: 'TWO_FACTOR_ENABLED',
          entity: 'User',
          entityId: userId,
        },
      });
    }

    return verified;
  }

  /**
   * Disable two-factor authentication
   */
  async disableTwoFactor(userId: string, password: string, code: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      throw new AppError('Invalid password', 401);
    }

    // Verify 2FA code
    const isValidCode = await this.verifyTwoFactor(userId, code);
    if (!isValidCode) {
      throw new AppError('Invalid two-factor code', 401);
    }

    // Disable 2FA
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId,
        tenantId: user.tenantId,
        action: 'TWO_FACTOR_DISABLED',
        entity: 'User',
        entityId: userId,
      },
    });
  }

  /**
   * Handle failed login attempt
   */
  private async handleFailedLogin(userId: string, ipAddress?: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) return;

    const failedAttempts = user.failedLoginAttempts + 1;
    const maxAttempts = 5;
    const lockDuration = 30 * 60 * 1000; // 30 minutes

    const updateData: any = { failedLoginAttempts: failedAttempts };

    if (failedAttempts >= maxAttempts) {
      updateData.lockedUntil = new Date(Date.now() + lockDuration);
      updateData.failedLoginAttempts = 0;

      // Create audit log for account lock
      await prisma.auditLog.create({
        data: {
          userId,
          tenantId: user.tenantId,
          action: 'ACCOUNT_LOCKED',
          entity: 'User',
          entityId: userId,
          ipAddress,
          metadata: { reason: 'Too many failed login attempts' },
        },
      });
    }

    await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
  }
}

export const authService = new AuthService();
