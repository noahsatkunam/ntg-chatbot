import { PrismaClient } from '@prisma/client';
import { 
  createTestTenant,
  createTestUser,
  cleanupTestData,
  mockEnvironment,
  createMultipleTenants,
  assertTenantIsolation
} from '../utils/testHelpers';
import { createTenantPrismaClient } from '../../tenant/utils/tenantSecurity';

const prisma = new PrismaClient();

describe('Multi-Tenant Isolation Tests', () => {
  let tenant1Id: string;
  let tenant2Id: string;
  let user1Id: string;
  let user2Id: string;

  beforeAll(() => {
    mockEnvironment();
  });

  beforeEach(async () => {
    // Create two test tenants
    const tenant1 = await createTestTenant({ subdomain: 'tenant1' });
    const tenant2 = await createTestTenant({ subdomain: 'tenant2' });
    tenant1Id = tenant1.id;
    tenant2Id = tenant2.id;

    // Create users with same email in different tenants
    const user1 = await createTestUser(tenant1Id, {
      email: 'shared@example.com',
      fullName: 'User in Tenant 1',
    });
    const user2 = await createTestUser(tenant2Id, {
      email: 'shared@example.com',
      fullName: 'User in Tenant 2',
    });
    user1Id = user1.id;
    user2Id = user2.id;
  });

  afterEach(async () => {
    await cleanupTestData(tenant1Id);
    await cleanupTestData(tenant2Id);
  });

  describe('Database Query Isolation', () => {
    it('should isolate user queries by tenant', async () => {
      // Query users for tenant 1
      const tenant1Users = await prisma.user.findMany({
        where: { tenantId: tenant1Id },
      });

      expect(tenant1Users).toHaveLength(1);
      expect(tenant1Users[0].id).toBe(user1Id);
      expect(tenant1Users[0].tenantId).toBe(tenant1Id);

      // Query users for tenant 2
      const tenant2Users = await prisma.user.findMany({
        where: { tenantId: tenant2Id },
      });

      expect(tenant2Users).toHaveLength(1);
      expect(tenant2Users[0].id).toBe(user2Id);
      expect(tenant2Users[0].tenantId).toBe(tenant2Id);
    });

    it('should prevent access to other tenant data', async () => {
      // Try to access user2 with tenant1 context
      const user = await prisma.user.findFirst({
        where: {
          id: user2Id,
          tenantId: tenant1Id, // Wrong tenant
        },
      });

      expect(user).toBeNull();
    });

    it('should handle same email in different tenants', async () => {
      // Both tenants have users with email 'shared@example.com'
      const tenant1User = await prisma.user.findFirst({
        where: {
          email: 'shared@example.com',
          tenantId: tenant1Id,
        },
      });

      const tenant2User = await prisma.user.findFirst({
        where: {
          email: 'shared@example.com',
          tenantId: tenant2Id,
        },
      });

      expect(tenant1User).toBeTruthy();
      expect(tenant2User).toBeTruthy();
      expect(tenant1User!.id).not.toBe(tenant2User!.id);
      expect(tenant1User!.fullName).toBe('User in Tenant 1');
      expect(tenant2User!.fullName).toBe('User in Tenant 2');
    });
  });

  describe('Tenant-Scoped Prisma Client', () => {
    it('should automatically filter queries by tenant', async () => {
      const tenant1Prisma = createTenantPrismaClient(tenant1Id);
      const tenant2Prisma = createTenantPrismaClient(tenant2Id);

      // Each client should only see its tenant's data
      const tenant1Users = await tenant1Prisma.user.findMany();
      expect(tenant1Users).toHaveLength(1);
      expect(tenant1Users[0].tenantId).toBe(tenant1Id);

      const tenant2Users = await tenant2Prisma.user.findMany();
      expect(tenant2Users).toHaveLength(1);
      expect(tenant2Users[0].tenantId).toBe(tenant2Id);
    });

    it('should prevent cross-tenant data creation', async () => {
      const tenant1Prisma = createTenantPrismaClient(tenant1Id);

      // Try to create user with different tenantId
      const newUser = await tenant1Prisma.user.create({
        data: {
          email: 'new@example.com',
          passwordHash: 'hash',
          tenantId: tenant2Id, // This should be overridden
        },
      });

      // User should be created in tenant1, not tenant2
      expect(newUser.tenantId).toBe(tenant1Id);
    });
  });

  describe('Audit Log Isolation', () => {
    it('should isolate audit logs by tenant', async () => {
      // Create audit logs for both tenants
      await prisma.auditLog.create({
        data: {
          tenantId: tenant1Id,
          action: 'USER_LOGIN',
          entity: 'User',
          entityId: user1Id,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: tenant2Id,
          action: 'USER_LOGIN',
          entity: 'User',
          entityId: user2Id,
        },
      });

      // Query audit logs for tenant 1
      const tenant1Logs = await prisma.auditLog.findMany({
        where: { tenantId: tenant1Id },
      });

      expect(tenant1Logs).toHaveLength(1);
      expect(tenant1Logs[0].entityId).toBe(user1Id);

      // Query audit logs for tenant 2
      const tenant2Logs = await prisma.auditLog.findMany({
        where: { tenantId: tenant2Id },
      });

      expect(tenant2Logs).toHaveLength(1);
      expect(tenant2Logs[0].entityId).toBe(user2Id);
    });
  });

  describe('Tenant Configuration Isolation', () => {
    it('should maintain separate settings per tenant', async () => {
      // Update tenant settings
      await prisma.tenant.update({
        where: { id: tenant1Id },
        data: {
          settings: {
            maxUsers: 100,
            enableFeatureX: true,
          },
        },
      });

      await prisma.tenant.update({
        where: { id: tenant2Id },
        data: {
          settings: {
            maxUsers: 50,
            enableFeatureX: false,
          },
        },
      });

      // Verify settings are isolated
      const tenant1 = await prisma.tenant.findUnique({
        where: { id: tenant1Id },
      });
      const tenant2 = await prisma.tenant.findUnique({
        where: { id: tenant2Id },
      });

      expect(tenant1!.settings).toMatchObject({
        maxUsers: 100,
        enableFeatureX: true,
      });

      expect(tenant2!.settings).toMatchObject({
        maxUsers: 50,
        enableFeatureX: false,
      });
    });

    it('should maintain separate feature flags per tenant', async () => {
      await prisma.tenant.update({
        where: { id: tenant1Id },
        data: {
          features: {
            advancedAnalytics: true,
            customIntegrations: true,
          },
        },
      });

      await prisma.tenant.update({
        where: { id: tenant2Id },
        data: {
          features: {
            advancedAnalytics: false,
            customIntegrations: false,
          },
        },
      });

      const tenant1 = await prisma.tenant.findUnique({
        where: { id: tenant1Id },
      });
      const tenant2 = await prisma.tenant.findUnique({
        where: { id: tenant2Id },
      });

      expect(tenant1!.features).toMatchObject({
        advancedAnalytics: true,
        customIntegrations: true,
      });

      expect(tenant2!.features).toMatchObject({
        advancedAnalytics: false,
        customIntegrations: false,
      });
    });
  });

  describe('Complex Query Isolation', () => {
    it('should handle complex queries with joins', async () => {
      // Create more test data
      await createTestUser(tenant1Id, { email: 'user2@tenant1.com' });
      await createTestUser(tenant1Id, { email: 'user3@tenant1.com' });
      await createTestUser(tenant2Id, { email: 'user2@tenant2.com' });

      // Complex query with count
      const tenant1Count = await prisma.user.count({
        where: { tenantId: tenant1Id },
      });
      const tenant2Count = await prisma.user.count({
        where: { tenantId: tenant2Id },
      });

      expect(tenant1Count).toBe(3); // Original + 2 new
      expect(tenant2Count).toBe(2); // Original + 1 new
    });

    it('should handle aggregation queries with tenant filter', async () => {
      // Add usage data
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      await prisma.tenantUsage.create({
        data: {
          tenantId: tenant1Id,
          period: today,
          apiCalls: 1000,
          messagesCount: 500,
        },
      });

      await prisma.tenantUsage.create({
        data: {
          tenantId: tenant2Id,
          period: today,
          apiCalls: 2000,
          messagesCount: 1000,
        },
      });

      // Aggregate usage by tenant
      const tenant1Usage = await prisma.tenantUsage.aggregate({
        where: { tenantId: tenant1Id },
        _sum: {
          apiCalls: true,
          messagesCount: true,
        },
      });

      const tenant2Usage = await prisma.tenantUsage.aggregate({
        where: { tenantId: tenant2Id },
        _sum: {
          apiCalls: true,
          messagesCount: true,
        },
      });

      expect(tenant1Usage._sum.apiCalls).toBe(1000);
      expect(tenant1Usage._sum.messagesCount).toBe(500);
      expect(tenant2Usage._sum.apiCalls).toBe(2000);
      expect(tenant2Usage._sum.messagesCount).toBe(1000);
    });
  });

  describe('Tenant Deletion Cascade', () => {
    it('should delete all tenant data when tenant is deleted', async () => {
      const tempTenant = await createTestTenant({ subdomain: 'temp' });
      const tempUser = await createTestUser(tempTenant.id);

      // Create audit log
      await prisma.auditLog.create({
        data: {
          tenantId: tempTenant.id,
          action: 'TEST_ACTION',
          entity: 'Test',
        },
      });

      // Delete tenant
      await prisma.tenant.delete({
        where: { id: tempTenant.id },
      });

      // Verify cascade deletion
      const users = await prisma.user.findMany({
        where: { tenantId: tempTenant.id },
      });
      const logs = await prisma.auditLog.findMany({
        where: { tenantId: tempTenant.id },
      });

      expect(users).toHaveLength(0);
      expect(logs).toHaveLength(0);
    });
  });
});
