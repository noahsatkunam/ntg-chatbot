import { authService } from '../../auth/services/authService';
import { createTestTenant, cleanupTestData, mockEnvironment } from '../utils/testHelpers';
import { AppError } from '../../middlewares/errorHandler';

describe('Registration Security Tests', () => {
  let testTenantId: string;

  beforeAll(() => {
    mockEnvironment();
  });

  beforeEach(async () => {
    const tenant = await createTestTenant();
    testTenantId = tenant.id;
  });

  afterEach(async () => {
    await cleanupTestData(testTenantId);
  });

  describe('SUPER_ADMIN Creation Prevention', () => {
    it('should reject SUPER_ADMIN role in public registration', async () => {
      const registrationData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        fullName: 'Test User',
        role: 'SUPER_ADMIN',
      };

      await expect(
        authService.register(registrationData, testTenantId)
      ).rejects.toThrow(AppError);

      await expect(
        authService.register(registrationData, testTenantId)
      ).rejects.toThrow('Insufficient permissions to create admin users');
    });

    it('should reject TENANT_ADMIN role in public registration', async () => {
      const registrationData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        fullName: 'Test User',
        role: 'TENANT_ADMIN',
      };

      await expect(
        authService.register(registrationData, testTenantId)
      ).rejects.toThrow('Insufficient permissions to create admin users');
    });

    it('should always create TENANT_USER role regardless of input', async () => {
      const registrationData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        fullName: 'Test User',
        role: 'SUPER_ADMIN', // This should be ignored
      };

      const user = await authService.register(registrationData, testTenantId);
      expect(user.role).toBe('TENANT_USER');
    });
  });

  describe('Tenant Context Validation', () => {
    it('should require tenant context for registration', async () => {
      const registrationData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        fullName: 'Test User',
      };

      await expect(
        authService.register(registrationData, null)
      ).rejects.toThrow('Tenant context required for registration');
    });

    it('should validate tenant exists', async () => {
      const registrationData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        fullName: 'Test User',
      };

      await expect(
        authService.register(registrationData, 'non-existent-tenant-id')
      ).rejects.toThrow('Invalid tenant');
    });

    it('should reject registration for suspended tenant', async () => {
      // Update tenant status to suspended
      const prisma = new (require('@prisma/client').PrismaClient)();
      await prisma.tenant.update({
        where: { id: testTenantId },
        data: { status: 'SUSPENDED' },
      });

      const registrationData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        fullName: 'Test User',
      };

      await expect(
        authService.register(registrationData, testTenantId)
      ).rejects.toThrow('Tenant is not active');
    });
  });

  describe('Email Uniqueness Per Tenant', () => {
    it('should allow same email in different tenants', async () => {
      const email = 'shared@example.com';
      const registrationData = {
        email,
        password: 'SecurePass123!',
        fullName: 'Test User',
      };

      // Register in first tenant
      const user1 = await authService.register(registrationData, testTenantId);
      expect(user1.email).toBe(email);

      // Create second tenant
      const tenant2 = await createTestTenant({
        subdomain: 'tenant2',
      });

      // Register same email in second tenant
      const user2 = await authService.register(registrationData, tenant2.id);
      expect(user2.email).toBe(email);
      
      // Cleanup
      await cleanupTestData(tenant2.id);
    });

    it('should prevent duplicate email within same tenant', async () => {
      const email = 'duplicate@example.com';
      const registrationData = {
        email,
        password: 'SecurePass123!',
        fullName: 'Test User',
      };

      // First registration should succeed
      await authService.register(registrationData, testTenantId);

      // Second registration should fail
      await expect(
        authService.register(registrationData, testTenantId)
      ).rejects.toThrow('User with this email already exists');
    });
  });

  describe('Password Security', () => {
    it('should reject weak passwords', async () => {
      const registrationData = {
        email: 'test@example.com',
        password: 'weak',
        fullName: 'Test User',
      };

      await expect(
        authService.register(registrationData, testTenantId)
      ).rejects.toThrow();
    });

    it('should hash passwords securely', async () => {
      const registrationData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        fullName: 'Test User',
      };

      const user = await authService.register(registrationData, testTenantId);
      
      // Get user from database
      const prisma = new (require('@prisma/client').PrismaClient)();
      const dbUser = await prisma.user.findFirst({
        where: { id: user.id },
      });

      expect(dbUser.passwordHash).toBeDefined();
      expect(dbUser.passwordHash).not.toBe(registrationData.password);
      expect(dbUser.passwordHash.length).toBeGreaterThan(50); // bcrypt hashes are long
    });
  });

  describe('Input Sanitization', () => {
    it('should normalize email to lowercase', async () => {
      const registrationData = {
        email: 'TEST@EXAMPLE.COM',
        password: 'SecurePass123!',
        fullName: 'Test User',
      };

      const user = await authService.register(registrationData, testTenantId);
      expect(user.email).toBe('test@example.com');
    });

    it('should trim whitespace from email', async () => {
      const registrationData = {
        email: '  test@example.com  ',
        password: 'SecurePass123!',
        fullName: 'Test User',
      };

      const user = await authService.register(registrationData, testTenantId);
      expect(user.email).toBe('test@example.com');
    });
  });
});
