import { authService } from '../services/authService';
import { PrismaClient } from '@prisma/client';
import * as passwordUtils from '../utils/password';
import * as jwtUtils from '../utils/jwt';
import { emailService } from '../../services/email.service';
import { AppError } from '../../middlewares/errorHandler';

// Mock dependencies
jest.mock('@prisma/client');
jest.mock('../utils/password');
jest.mock('../utils/jwt');
jest.mock('../../services/email.service');
jest.mock('../../utils/redis', () => ({
  getRedisClient: jest.fn(() => ({
    setex: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    keys: jest.fn(),
  })),
}));

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  authToken: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // @ts-ignore
    PrismaClient.mockImplementation(() => mockPrisma);
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const mockUser = {
        id: '123',
        email: 'test@example.com',
        fullName: 'Test User',
        role: 'TENANT_USER',
        emailVerified: false,
        passwordHash: 'hashed',
        twoFactorSecret: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (passwordUtils.validatePasswordStrength as jest.Mock).mockReturnValue({
        isValid: true,
        errors: [],
      });
      (passwordUtils.hashPassword as jest.Mock).mockResolvedValue('hashed_password');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma));
      mockPrisma.user.create.mockResolvedValue(mockUser);

      const result = await authService.register({
        email: 'test@example.com',
        password: 'Test123!@#',
        fullName: 'Test User',
      });

      expect(result.email).toBe('test@example.com');
      expect(result.fullName).toBe('Test User');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('twoFactorSecret');
    });

    it('should reject registration with existing email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: '123' });

      await expect(authService.register({
        email: 'existing@example.com',
        password: 'Test123!@#',
      })).rejects.toThrow('User with this email already exists');
    });

    it('should reject registration with weak password', async () => {
      (passwordUtils.validatePasswordStrength as jest.Mock).mockReturnValue({
        isValid: false,
        errors: ['Password too weak'],
      });

      await expect(authService.register({
        email: 'test@example.com',
        password: 'weak',
      })).rejects.toThrow('Password too weak');
    });
  });

  describe('login', () => {
    const mockUser = {
      id: '123',
      email: 'test@example.com',
      passwordHash: 'hashed_password',
      emailVerified: true,
      twoFactorEnabled: false,
      lockedUntil: null,
      failedLoginAttempts: 0,
      tenantId: '456',
      role: 'TENANT_USER',
      lastLoginIp: null,
    };

    it('should login user successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);
      (passwordUtils.verifyPassword as jest.Mock).mockResolvedValue(true);
      (jwtUtils.generateTokenPair as jest.Mock).mockResolvedValue({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        accessTokenExpiry: new Date(),
        refreshTokenExpiry: new Date(),
      });

      const result = await authService.login('test@example.com', 'password123');

      expect(result.user.email).toBe('test@example.com');
      expect(result.tokens.accessToken).toBe('access_token');
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it('should reject login with invalid password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (passwordUtils.verifyPassword as jest.Mock).mockResolvedValue(false);

      await expect(authService.login('test@example.com', 'wrong_password'))
        .rejects.toThrow('Invalid email or password');
    });

    it('should reject login with unverified email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        emailVerified: false,
      });
      (passwordUtils.verifyPassword as jest.Mock).mockResolvedValue(true);

      await expect(authService.login('test@example.com', 'password123'))
        .rejects.toThrow('Please verify your email address before logging in');
    });

    it('should handle account lockout', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        lockedUntil: new Date(Date.now() + 30 * 60 * 1000),
      });

      await expect(authService.login('test@example.com', 'password123'))
        .rejects.toThrow(/Account is locked/);
    });

    it('should require 2FA when enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        twoFactorEnabled: true,
      });
      (passwordUtils.verifyPassword as jest.Mock).mockResolvedValue(true);

      const result = await authService.login('test@example.com', 'password123');

      expect(result.requiresTwoFactor).toBe(true);
      expect(result.tokens.accessToken).toBe('');
    });
  });

  describe('password reset', () => {
    it('should request password reset successfully', async () => {
      const mockUser = {
        id: '123',
        email: 'test@example.com',
        tenantId: '456',
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.authToken.findFirst.mockResolvedValue(null);

      await authService.forgotPassword('test@example.com');

      expect(mockPrisma.authToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: '123',
          type: 'PASSWORD_RESET',
        }),
      });
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalled();
    });

    it('should not reveal if user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(authService.forgotPassword('nonexistent@example.com'))
        .resolves.not.toThrow();
    });

    it('should reset password with valid token', async () => {
      const mockToken = {
        id: '789',
        userId: '123',
        user: { id: '123', tenantId: '456' },
      };

      mockPrisma.authToken.findFirst.mockResolvedValue(mockToken);
      (passwordUtils.validatePasswordStrength as jest.Mock).mockReturnValue({
        isValid: true,
        errors: [],
      });
      (passwordUtils.hashPassword as jest.Mock).mockResolvedValue('new_hashed_password');
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma));

      await authService.resetPassword('valid_token', 'NewPass123!@#');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: '123' },
        data: expect.objectContaining({
          passwordHash: 'new_hashed_password',
        }),
      });
    });

    it('should reject invalid reset token', async () => {
      mockPrisma.authToken.findFirst.mockResolvedValue(null);

      await expect(authService.resetPassword('invalid_token', 'NewPass123!@#'))
        .rejects.toThrow('Invalid or expired reset token');
    });
  });

  describe('email verification', () => {
    it('should verify email with valid token', async () => {
      const mockToken = {
        id: '789',
        userId: '123',
        user: { id: '123', tenantId: '456' },
      };

      mockPrisma.authToken.findFirst.mockResolvedValue(mockToken);
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma));

      await authService.verifyEmail('valid_token');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: '123' },
        data: {
          emailVerified: true,
          emailVerifiedAt: expect.any(Date),
        },
      });
    });

    it('should reject invalid verification token', async () => {
      mockPrisma.authToken.findFirst.mockResolvedValue(null);

      await expect(authService.verifyEmail('invalid_token'))
        .rejects.toThrow('Invalid or expired verification token');
    });
  });

  describe('two-factor authentication', () => {
    it('should enable 2FA setup', async () => {
      const mockUser = {
        id: '123',
        email: 'test@example.com',
        passwordHash: 'hashed_password',
        tenantId: '456',
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (passwordUtils.verifyPassword as jest.Mock).mockResolvedValue(true);

      const result = await authService.enableTwoFactor('123', 'password123');

      expect(result).toHaveProperty('secret');
      expect(result).toHaveProperty('qrCode');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: '123' },
        data: expect.objectContaining({
          twoFactorSecret: expect.any(String),
          twoFactorEnabled: false,
        }),
      });
    });

    it('should verify 2FA code', async () => {
      const mockUser = {
        id: '123',
        twoFactorSecret: 'secret',
        twoFactorEnabled: false,
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(require('speakeasy').totp, 'verify').mockReturnValue(true);

      const result = await authService.verifyTwoFactor('123', '123456', true);

      expect(result).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: '123' },
        data: { twoFactorEnabled: true },
      });
    });

    it('should disable 2FA', async () => {
      const mockUser = {
        id: '123',
        passwordHash: 'hashed_password',
        twoFactorSecret: 'secret',
        twoFactorEnabled: true,
        tenantId: '456',
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (passwordUtils.verifyPassword as jest.Mock).mockResolvedValue(true);
      jest.spyOn(require('speakeasy').totp, 'verify').mockReturnValue(true);

      await authService.disableTwoFactor('123', 'password123', '123456');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: '123' },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
        },
      });
    });
  });
});
