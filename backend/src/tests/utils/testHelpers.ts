import { PrismaClient, Tenant, User, TenantPlan, TenantStatus } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { hashPassword } from '../../auth/utils/password';

const prisma = new PrismaClient();

/**
 * Test data generators
 */
export const testData = {
  tenant: (overrides?: Partial<Tenant>): Partial<Tenant> => ({
    id: uuidv4(),
    name: `Test Tenant ${Date.now()}`,
    slug: `test-tenant-${Date.now()}`,
    subdomain: `test${Date.now()}`,
    status: 'ACTIVE' as TenantStatus,
    plan: 'PROFESSIONAL' as TenantPlan,
    primaryColor: '#3B82F6',
    secondaryColor: '#10B981',
    settings: {},
    features: {},
    limits: {},
    ...overrides,
  }),

  user: (overrides?: Partial<User>): Partial<User> => ({
    id: uuidv4(),
    email: `test${Date.now()}@example.com`,
    passwordHash: 'hashed_password',
    fullName: 'Test User',
    role: 'TENANT_USER',
    emailVerified: true,
    tenantId: null,
    ...overrides,
  }),
};

/**
 * Create a test tenant
 */
export async function createTestTenant(overrides?: Partial<Tenant>): Promise<Tenant> {
  const data = testData.tenant(overrides);
  return prisma.tenant.create({ data: data as any });
}

/**
 * Create a test user
 */
export async function createTestUser(
  tenantId: string,
  overrides?: Partial<User>
): Promise<User> {
  const password = overrides?.password || 'TestPassword123!';
  const passwordHash = await hashPassword(password);
  
  const data = testData.user({
    ...overrides,
    tenantId,
    passwordHash,
  });
  
  return prisma.user.create({ data: data as any });
}

/**
 * Generate a test JWT token
 */
export function generateTestToken(
  userId: string,
  tenantId: string,
  role: string = 'TENANT_USER'
): string {
  const payload = {
    sub: userId,
    email: 'test@example.com',
    role,
    tenantId,
    sessionId: uuidv4(),
  };

  return jwt.sign(payload, process.env.JWT_SECRET || 'test-secret', {
    expiresIn: '1h',
  });
}

/**
 * Clean up test data
 */
export async function cleanupTestData(tenantId?: string): Promise<void> {
  if (tenantId) {
    // Clean up specific tenant and related data
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  } else {
    // Clean up all test data (be careful!)
    await prisma.user.deleteMany({
      where: { email: { contains: '@example.com' } },
    });
    await prisma.tenant.deleteMany({
      where: { subdomain: { startsWith: 'test' } },
    });
  }
}

/**
 * Create test request with tenant context
 */
export function createTestRequest(
  tenantId: string,
  userId?: string,
  overrides?: any
): any {
  return {
    tenantId,
    userId,
    tenant: {
      id: tenantId,
      plan: 'PROFESSIONAL',
      status: 'ACTIVE',
      features: {},
      limits: {},
    },
    headers: {
      'x-tenant-subdomain': `test${Date.now()}`,
      ...overrides?.headers,
    },
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

/**
 * Create test response mock
 */
export function createTestResponse(): any {
  const res: any = {
    statusCode: 200,
    headers: {},
    body: null,
  };

  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };

  res.json = (data: any) => {
    res.body = data;
    return res;
  };

  res.setHeader = (key: string, value: string) => {
    res.headers[key] = value;
    return res;
  };

  res.cookie = jest.fn();
  res.clearCookie = jest.fn();

  return res;
}

/**
 * Wait for async operations
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Assert tenant isolation
 */
export async function assertTenantIsolation(
  model: any,
  tenantId: string,
  otherTenantId: string
): Promise<void> {
  // Create data in both tenants
  const data1 = await model.create({
    data: { tenantId, name: 'Tenant 1 Data' },
  });
  
  const data2 = await model.create({
    data: { tenantId: otherTenantId, name: 'Tenant 2 Data' },
  });

  // Query with tenant filter
  const results = await model.findMany({
    where: { tenantId },
  });

  // Should only see data from the specified tenant
  expect(results).toHaveLength(1);
  expect(results[0].id).toBe(data1.id);
  expect(results[0].tenantId).toBe(tenantId);
}

/**
 * Mock environment variables for testing
 */
export function mockEnvironment(overrides?: Record<string, string>): void {
  const defaults = {
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    NODE_ENV: 'test',
  };

  Object.entries({ ...defaults, ...overrides }).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

/**
 * Create multiple tenants with users
 */
export async function createMultipleTenants(count: number = 3): Promise<{
  tenants: Tenant[];
  users: User[];
}> {
  const tenants: Tenant[] = [];
  const users: User[] = [];

  for (let i = 0; i < count; i++) {
    const tenant = await createTestTenant({
      name: `Tenant ${i + 1}`,
      subdomain: `tenant${i + 1}`,
    });
    tenants.push(tenant);

    // Create users with same email in different tenants
    const user = await createTestUser(tenant.id, {
      email: 'shared@example.com',
      fullName: `User in Tenant ${i + 1}`,
    });
    users.push(user);
  }

  return { tenants, users };
}

/**
 * Verify API error response
 */
export function expectApiError(
  response: any,
  statusCode: number,
  messagePattern?: string | RegExp
): void {
  expect(response.statusCode).toBe(statusCode);
  expect(response.body).toHaveProperty('success', false);
  expect(response.body).toHaveProperty('message');
  
  if (messagePattern) {
    if (typeof messagePattern === 'string') {
      expect(response.body.message).toContain(messagePattern);
    } else {
      expect(response.body.message).toMatch(messagePattern);
    }
  }
}
