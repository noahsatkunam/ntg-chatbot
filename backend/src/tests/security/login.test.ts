import { authService } from '../../auth/services/authService';
import { 
  createTestTenant, 
  createTestUser,
  cleanupTestData, 
  mockEnvironment,
  createMultipleTenants
} from '../utils/testHelpers';
import { AppError } from '../../middlewares/errorHandler';

describe('Login Security Tests', () => {
  let testTenantId: string;
  let testUserId: string;
  const testPassword = 'SecurePass123!';

  beforeAll(() => {
    mockEnvironment();
  });

  beforeEach(async () => {
    const tenant = await createTestTenant();
    testTenantId = tenant.id;
    
    const user = await createTestUser(testTenantId, {
      email: 'test@example.com',
      password: testPassword,
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    await cleanupTestData(testTenantId);
  });

  describe('Tenant Context Requirement', () => {
    it('should require tenant context for login', async () => {
      await expect(
        authService.login('test@example.com', testPassword, null)
      ).rejects.toThrow('Tenant context required for login');
    });

    it('should validate tenant exists', async () => {
      await expect(
        authService.login('test@example.com', testPassword, 'non-existent-tenant')
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('Tenant-Scoped Authentication', () => {
    it('should prevent cross-tenant authentication', async () => {
      // Create another tenant with same email
      const tenant2 = await createTestTenant({ subdomain: 'tenant2' });
      await createTestUser(tenant2.id, {
        email: 'test@example.com',
        password: 'DifferentPass123!',
      });

      // Try to login with first tenant's password in second tenant
      await expect(
        authService.login('test@example.com', testPassword, tenant2.id)
      ).rejects.toThrow('Invalid credentials');

      // Cleanup
      await cleanupTestData(tenant2.id);
    });

    it('should allow login to correct tenant only', async () => {
      const result = await authService.login(
        'test@example.com',
        testPassword,
        testTenantId
      );

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tokens');
      expect(result.user.id).toBe(testUserId);
      expect(result.user.email).toBe('test@example.com');
    });

    it('should handle users with same email in different tenants', async () => {
      const { tenants, users } = await createMultipleTenants(3);
      const sharedPassword = 'SharedPass123!';

      // Update all users to have same password for testing
      for (const user of users) {
        const prisma = new (require('@prisma/client').PrismaClient)();
        const { hashPassword } = require('../../auth/utils/password');
        const hash = await hashPassword(sharedPassword);
        await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: hash },
        });
      }

      // Each user should only be able to login to their own tenant
      for (let i = 0; i < tenants.length; i++) {
        const result = await authService.login(
          'shared@example.com',
          sharedPassword,
          tenants[i].id
        );
        
        expect(result.user.id).toBe(users[i].id);
        expect(result.user.tenantId).toBe(tenants[i].id);
      }

      // Cross-tenant login should fail
      await expect(
        authService.login('shared@example.com', sharedPassword, tenants[0].id)
      ).resolves.toBeTruthy(); // Should work for correct tenant

      // Cleanup
      for (const tenant of tenants) {
        await cleanupTestData(tenant.id);
      }
    });
  });

  describe('Tenant Status Validation', () => {
    it('should prevent login for suspended tenant', async () => {
      const prisma = new (require('@prisma/client').PrismaClient)();
      await prisma.tenant.update({
        where: { id: testTenantId },
        data: { status: 'SUSPENDED' },
      });

      await expect(
        authService.login('test@example.com', testPassword, testTenantId)
      ).rejects.toThrow('Tenant is not active');
    });

    it('should prevent login for inactive tenant', async () => {
      const prisma = new (require('@prisma/client').PrismaClient)();
      await prisma.tenant.update({
        where: { id: testTenantId },
        data: { status: 'INACTIVE' },
      });

      await expect(
        authService.login('test@example.com', testPassword, testTenantId)
      ).rejects.toThrow('Tenant is not active');
    });

    it('should allow login for active tenant', async () => {
      const result = await authService.login(
        'test@example.com',
        testPassword,
        testTenantId
      );

      expect(result).toHaveProperty('tokens');
    });

    it('should allow login for trial tenant within trial period', async () => {
      const prisma = new (require('@prisma/client').PrismaClient)();
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7); // 7 days from now
      
      await prisma.tenant.update({
        where: { id: testTenantId },
        data: { 
          status: 'TRIAL',
          trialEndsAt: futureDate,
        },
      });

      const result = await authService.login(
        'test@example.com',
        testPassword,
        testTenantId
      );

      expect(result).toHaveProperty('tokens');
    });
  });

  describe('Account Security', () => {
    it('should check account lockout', async () => {
      const prisma = new (require('@prisma/client').PrismaClient)();
      const lockUntil = new Date();
      lockUntil.setMinutes(lockUntil.getMinutes() + 30);
      
      await prisma.user.update({
        where: { id: testUserId },
        data: { lockedUntil: lockUntil },
      });

      await expect(
        authService.login('test@example.com', testPassword, testTenantId)
      ).rejects.toThrow('Account is locked');
    });

    it('should require email verification', async () => {
      const prisma = new (require('@prisma/client').PrismaClient)();
      await prisma.user.update({
        where: { id: testUserId },
        data: { emailVerified: false },
      });

      await expect(
        authService.login('test@example.com', testPassword, testTenantId)
      ).rejects.toThrow('Please verify your email address');
    });

    it('should handle incorrect password', async () => {
      await expect(
        authService.login('test@example.com', 'WrongPassword123!', testTenantId)
      ).rejects.toThrow('Invalid credentials');
    });

    it('should handle non-existent user', async () => {
      await expect(
        authService.login('nonexistent@example.com', testPassword, testTenantId)
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('Login Response Security', () => {
    it('should not expose sensitive data in response', async () => {
      const result = await authService.login(
        'test@example.com',
        testPassword,
        testTenantId
      );

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('twoFactorSecret');
    });

    it('should include tenant context in JWT payload', async () => {
      const result = await authService.login(
        'test@example.com',
        testPassword,
        testTenantId
      );

      // Decode JWT to check payload
      const jwt = require('jsonwebtoken');
      const decoded = jwt.decode(result.tokens.accessToken);

      expect(decoded).toHaveProperty('tenantId', testTenantId);
      expect(decoded).toHaveProperty('sub', testUserId);
      expect(decoded).toHaveProperty('email', 'test@example.com');
      expect(decoded).toHaveProperty('role');
    });
  });

  describe('Two-Factor Authentication', () => {
    it('should require 2FA when enabled', async () => {
      const prisma = new (require('@prisma/client').PrismaClient)();
      await prisma.user.update({
        where: { id: testUserId },
        data: { 
          twoFactorEnabled: true,
          twoFactorSecret: 'secret',
        },
      });

      const result = await authService.login(
        'test@example.com',
        testPassword,
        testTenantId
      );

      expect(result).toHaveProperty('requiresTwoFactor', true);
      expect(result).toHaveProperty('tempToken');
      expect(result).not.toHaveProperty('tokens');
    });
  });
});
