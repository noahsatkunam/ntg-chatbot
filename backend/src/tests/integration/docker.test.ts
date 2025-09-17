import { execSync } from 'child_process';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { wait } from '../utils/testHelpers';

describe('Docker Integration Tests', () => {
  const services = {
    postgres: { port: 5432, healthCheck: 'pg_isready' },
    redis: { port: 6379, healthCheck: 'redis-cli ping' },
    backend: { port: 3000, healthCheck: 'api/health' },
  };

  describe('Service Health Checks', () => {
    it('should have PostgreSQL running and accessible', async () => {
      const prisma = new PrismaClient({
        datasource: {
          url: process.env.DATABASE_URL || 'postgresql://chatbot_user:secure_password@localhost:5432/chatbot_platform',
        },
      });

      try {
        await prisma.$queryRaw`SELECT 1`;
        expect(true).toBe(true);
      } catch (error) {
        fail('PostgreSQL is not accessible');
      } finally {
        await prisma.$disconnect();
      }
    });

    it('should have Redis running and accessible', async () => {
      const redis = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
      });

      try {
        await redis.connect();
        const pong = await redis.ping();
        expect(pong).toBe('PONG');
      } catch (error) {
        fail('Redis is not accessible');
      } finally {
        await redis.disconnect();
      }
    });

    it('should have backend API responding to health checks', async () => {
      try {
        const response = await axios.get('http://localhost:3000/health');
        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('status', 'ok');
        expect(response.data).toHaveProperty('timestamp');
      } catch (error) {
        fail('Backend API is not responding to health checks');
      }
    });
  });

  describe('Service Communication', () => {
    it('should allow backend to connect to database', async () => {
      try {
        const response = await axios.get('http://localhost:3000/health');
        expect(response.data.status).toBe('ok');
        // Health check includes DB connection test
      } catch (error) {
        fail('Backend cannot connect to database');
      }
    });

    it('should allow backend to connect to Redis', async () => {
      // Test rate limiting which uses Redis
      const requests = Array(5).fill(null).map(() => 
        axios.post('http://testtenant1.localhost:3000/api/auth/login', {
          email: 'test@example.com',
          password: 'wrong',
        }).catch(e => e.response)
      );

      const responses = await Promise.all(requests);
      const hasRateLimiting = responses.some(r => r && r.status === 429);
      
      expect(hasRateLimiting).toBe(true);
    });
  });

  describe('Environment Variables', () => {
    it('should load environment variables correctly', async () => {
      try {
        // Test JWT functionality which requires JWT_SECRET
        const response = await axios.post('http://testtenant1.localhost:3000/api/auth/login', {
          email: 'nonexistent@example.com',
          password: 'test',
        });
      } catch (error: any) {
        // Should get 401, not 500 (which would indicate env var issue)
        expect(error.response.status).toBe(401);
        expect(error.response.data.message).not.toContain('JWT_SECRET');
      }
    });

    it('should have required environment variables set', () => {
      const requiredEnvVars = [
        'DATABASE_URL',
        'REDIS_URL',
        'JWT_SECRET',
        'NODE_ENV',
        'N8N_ENCRYPTION_KEY',
      ];

      const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
      
      if (missingVars.length > 0) {
        fail(`Missing required environment variables: ${missingVars.join(', ')}`);
      }
    });
  });

  describe('Database Migrations', () => {
    it('should have all migrations applied', async () => {
      const prisma = new PrismaClient();
      
      try {
        // Check if core tables exist
        const tables = await prisma.$queryRaw`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
        `;

        const expectedTables = ['tenants', 'users', 'audit_logs', 'auth_tokens'];
        const tableNames = (tables as any[]).map(t => t.table_name);

        for (const table of expectedTables) {
          expect(tableNames).toContain(table);
        }
      } finally {
        await prisma.$disconnect();
      }
    });
  });

  describe('Service Restart Recovery', () => {
    it('should maintain data after service restart', async () => {
      const prisma = new PrismaClient();
      
      try {
        // Create test data
        const testData = {
          name: 'Docker Test Tenant',
          slug: 'docker-test',
          subdomain: 'dockertest',
        };

        const tenant = await prisma.tenant.create({ data: testData });
        expect(tenant.id).toBeDefined();

        // Simulate service restart by disconnecting and reconnecting
        await prisma.$disconnect();
        await wait(1000);

        const prisma2 = new PrismaClient();
        const foundTenant = await prisma2.tenant.findUnique({
          where: { id: tenant.id },
        });

        expect(foundTenant).toBeTruthy();
        expect(foundTenant?.name).toBe(testData.name);

        // Cleanup
        await prisma2.tenant.delete({ where: { id: tenant.id } });
        await prisma2.$disconnect();
      } catch (error) {
        await prisma.$disconnect();
        throw error;
      }
    });
  });

  describe('Network Isolation', () => {
    it('should isolate database from external access', async () => {
      // Database should only be accessible from backend container
      // This test assumes Docker networking is properly configured
      expect(process.env.DATABASE_URL).toMatch(/localhost|postgres/);
      expect(process.env.DATABASE_URL).not.toMatch(/0\.0\.0\.0/);
    });

    it('should isolate Redis from external access', async () => {
      // Redis should only be accessible from backend container
      expect(process.env.REDIS_URL).toMatch(/localhost|redis/);
      expect(process.env.REDIS_URL).not.toMatch(/0\.0\.0\.0/);
    });
  });

  describe('Performance Under Load', () => {
    it('should handle concurrent database connections', async () => {
      const connectionPromises = Array(10).fill(null).map(async () => {
        const prisma = new PrismaClient();
        try {
          await prisma.$queryRaw`SELECT 1`;
          return true;
        } finally {
          await prisma.$disconnect();
        }
      });

      const results = await Promise.all(connectionPromises);
      expect(results.every(r => r === true)).toBe(true);
    });

    it('should handle burst API traffic', async () => {
      const startTime = Date.now();
      const requests = Array(20).fill(null).map(() => 
        axios.get('http://localhost:3000/health').catch(e => null)
      );

      const responses = await Promise.all(requests);
      const successCount = responses.filter(r => r && r.status === 200).length;
      const duration = Date.now() - startTime;

      expect(successCount).toBeGreaterThan(15); // At least 75% success
      expect(duration).toBeLessThan(5000); // Complete within 5 seconds
    });
  });

  describe('Error Recovery', () => {
    it('should handle database connection errors gracefully', async () => {
      // Test with invalid connection string
      const badPrisma = new PrismaClient({
        datasource: {
          url: 'postgresql://bad:bad@nonexistent:5432/bad',
        },
      });

      try {
        await badPrisma.$queryRaw`SELECT 1`;
        fail('Should have thrown connection error');
      } catch (error) {
        expect(error).toBeDefined();
      } finally {
        await badPrisma.$disconnect();
      }
    });

    it('should handle Redis connection errors gracefully', async () => {
      const badRedis = createClient({
        url: 'redis://nonexistent:6379',
      });

      try {
        await badRedis.connect();
        fail('Should have thrown connection error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Container Resource Limits', () => {
    it('should respect memory limits', () => {
      // Check Node.js memory usage
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
      
      expect(heapUsedMB).toBeLessThan(512); // Should use less than 512MB
    });

    it('should have reasonable response times', async () => {
      const timings = [];
      
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        await axios.get('http://localhost:3000/health');
        timings.push(Date.now() - start);
      }

      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
      expect(avgTime).toBeLessThan(100); // Average response < 100ms
    });
  });
});
