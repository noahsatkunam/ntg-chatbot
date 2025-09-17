import request from 'supertest';
import { Express } from 'express';
import { 
  createTestTenant,
  cleanupTestData,
  mockEnvironment,
  expectApiError
} from '../utils/testHelpers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Authentication Flow Integration Tests', () => {
  let app: Express;
  let testTenantId: string;
  let testSubdomain: string;

  beforeAll(async () => {
    mockEnvironment();
    // Initialize Express app
    const { default: createApp } = require('../../index');
    app = await createApp();
  });

  beforeEach(async () => {
    const tenant = await createTestTenant();
    testTenantId = tenant.id;
    testSubdomain = tenant.subdomain;
  });

  afterEach(async () => {
    await cleanupTestData(testTenantId);
  });

  describe('Complete Registration → Login → Protected Route Flow', () => {
    it('should complete full authentication flow', async () => {
      const userData = {
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
        fullName: 'New User',
        acceptTerms: true,
      };

      // Step 1: Register
      const registerRes = await request(app)
        .post('/api/auth/register')
        .set('Host', `${testSubdomain}.platform.com`)
        .send(userData)
        .expect(201);

      expect(registerRes.body.success).toBe(true);
      expect(registerRes.body.data.user.email).toBe(userData.email);

      // Step 2: Verify email (simulate by updating database)
      await prisma.user.update({
        where: { email: userData.email },
        data: { emailVerified: true },
      });

      // Step 3: Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .set('Host', `${testSubdomain}.platform.com`)
        .send({
          email: userData.email,
          password: userData.password,
        })
        .expect(200);

      expect(loginRes.body.success).toBe(true);
      expect(loginRes.body.data.user.email).toBe(userData.email);
      
      // Extract token from cookies
      const cookies = loginRes.headers['set-cookie'];
      const accessTokenCookie = cookies.find((c: string) => c.startsWith('accessToken='));
      expect(accessTokenCookie).toBeDefined();

      // Step 4: Access protected route
      const profileRes = await request(app)
        .get('/api/auth/profile')
        .set('Host', `${testSubdomain}.platform.com`)
        .set('Cookie', cookies)
        .expect(200);

      expect(profileRes.body.success).toBe(true);
      expect(profileRes.body.data.user.email).toBe(userData.email);
    });

    it('should prevent access without authentication', async () => {
      const res = await request(app)
        .get('/api/auth/profile')
        .set('Host', `${testSubdomain}.platform.com`)
        .expect(401);

      expectApiError(res, 401, 'No token provided');
    });
  });

  describe('Password Reset Flow', () => {
    let userEmail: string;

    beforeEach(async () => {
      // Create a verified user
      userEmail = 'resetuser@example.com';
      await prisma.user.create({
        data: {
          email: userEmail,
          passwordHash: 'oldhash',
          emailVerified: true,
          tenantId: testTenantId,
        },
      });
    });

    it('should complete password reset flow', async () => {
      // Step 1: Request password reset
      const forgotRes = await request(app)
        .post('/api/auth/forgot-password')
        .set('Host', `${testSubdomain}.platform.com`)
        .send({ email: userEmail })
        .expect(200);

      expect(forgotRes.body.success).toBe(true);

      // Step 2: Get reset token from database (simulate email)
      const token = await prisma.authToken.findFirst({
        where: {
          user: { email: userEmail },
          type: 'PASSWORD_RESET',
        },
      });
      expect(token).toBeDefined();

      // Step 3: Reset password with token
      const newPassword = 'NewSecurePassword123!';
      const resetRes = await request(app)
        .post('/api/auth/reset-password')
        .set('Host', `${testSubdomain}.platform.com`)
        .send({
          token: token!.token,
          password: newPassword,
          confirmPassword: newPassword,
        })
        .expect(200);

      expect(resetRes.body.success).toBe(true);

      // Step 4: Login with new password
      const loginRes = await request(app)
        .post('/api/auth/login')
        .set('Host', `${testSubdomain}.platform.com`)
        .send({
          email: userEmail,
          password: newPassword,
        })
        .expect(200);

      expect(loginRes.body.success).toBe(true);
    });
  });

  describe('JWT Token Refresh Flow', () => {
    it('should refresh expired access token', async () => {
      // Create and login user
      const userData = {
        email: 'refresh@example.com',
        password: 'TestPassword123!',
      };

      await prisma.user.create({
        data: {
          email: userData.email,
          passwordHash: await require('../../auth/utils/password').hashPassword(userData.password),
          emailVerified: true,
          tenantId: testTenantId,
        },
      });

      // Login to get tokens
      const loginRes = await request(app)
        .post('/api/auth/login')
        .set('Host', `${testSubdomain}.platform.com`)
        .send(userData)
        .expect(200);

      const cookies = loginRes.headers['set-cookie'];
      const refreshTokenCookie = cookies.find((c: string) => c.startsWith('refreshToken='));
      expect(refreshTokenCookie).toBeDefined();

      // Wait a moment and refresh
      await new Promise(resolve => setTimeout(resolve, 100));

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Host', `${testSubdomain}.platform.com`)
        .set('Cookie', refreshTokenCookie)
        .expect(200);

      expect(refreshRes.body.success).toBe(true);
      
      // Should have new access token
      const newCookies = refreshRes.headers['set-cookie'];
      const newAccessToken = newCookies.find((c: string) => c.startsWith('accessToken='));
      expect(newAccessToken).toBeDefined();
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits per tenant', async () => {
      const requests = [];
      
      // Make multiple login attempts
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .post('/api/auth/login')
            .set('Host', `${testSubdomain}.platform.com`)
            .send({
              email: 'test@example.com',
              password: 'wrong',
            })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);
      
      expect(rateLimited.length).toBeGreaterThan(0);
      expect(rateLimited[0].body.message).toContain('Too many requests');
    });

    it('should have separate rate limits per tenant', async () => {
      const tenant2 = await createTestTenant({ subdomain: 'tenant2' });

      // Make requests to tenant 1
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .set('Host', `${testSubdomain}.platform.com`)
          .send({ email: 'test@example.com', password: 'wrong' });
      }

      // Tenant 2 should not be rate limited
      const tenant2Res = await request(app)
        .post('/api/auth/login')
        .set('Host', `${tenant2.subdomain}.platform.com`)
        .send({ email: 'test@example.com', password: 'wrong' });

      expect(tenant2Res.status).not.toBe(429);

      await cleanupTestData(tenant2.id);
    });
  });

  describe('Logout Flow', () => {
    it('should clear session on logout', async () => {
      // Create and login user
      const user = await prisma.user.create({
        data: {
          email: 'logout@example.com',
          passwordHash: 'hash',
          emailVerified: true,
          tenantId: testTenantId,
        },
      });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .set('Host', `${testSubdomain}.platform.com`)
        .send({
          email: 'logout@example.com',
          password: 'TestPassword123!',
        });

      const cookies = loginRes.headers['set-cookie'];

      // Logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Host', `${testSubdomain}.platform.com`)
        .set('Cookie', cookies)
        .expect(200);

      expect(logoutRes.body.success).toBe(true);

      // Should not be able to access protected routes
      const profileRes = await request(app)
        .get('/api/auth/profile')
        .set('Host', `${testSubdomain}.platform.com`)
        .set('Cookie', cookies)
        .expect(401);

      expectApiError(profileRes, 401);
    });
  });

  describe('Cross-Origin Requests', () => {
    it('should handle CORS properly', async () => {
      const res = await request(app)
        .options('/api/auth/login')
        .set('Origin', 'https://frontend.example.com')
        .set('Host', `${testSubdomain}.platform.com`)
        .expect(204);

      expect(res.headers['access-control-allow-origin']).toBeDefined();
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });
});
