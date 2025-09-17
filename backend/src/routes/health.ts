import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { getLocalDevConfig, shouldUseMockService } from '../config/localDevelopment.js';
import { MockServiceFactory } from '../services/mockServices.js';
import { logger } from '../utils/logger.js';

const router = Router();
const prisma = new PrismaClient();

// Health check endpoint
router.get('/health', async (_req, res) => {
  const healthCheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    services: {
      database: 'unknown',
      redis: 'unknown',
      openai: 'unknown'
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024 * 100) / 100,
      external: Math.round(process.memoryUsage().external / 1024 / 1024 * 100) / 100
    }
  };

  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    healthCheck.services.database = 'healthy';
  } catch (error) {
    healthCheck.services.database = 'unhealthy';
    healthCheck.status = 'degraded';
  }

  try {
    // Check Redis connection (or mock service)
    if (shouldUseMockService('redis')) {
      const mockRedis = MockServiceFactory.getRedisService();
      await mockRedis.ping();
      healthCheck.services.redis = 'healthy (mock)';
    } else {
      const Redis = require('ioredis');
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
      await redis.ping();
      healthCheck.services.redis = 'healthy';
      redis.disconnect();
    }
  } catch (error) {
    healthCheck.services.redis = 'unhealthy';
    healthCheck.status = 'degraded';
  }

  try {
    // Check AI services (OpenAI/Anthropic or mock)
    if (shouldUseMockService('ai')) {
      healthCheck.services.openai = 'healthy (mock)';
    } else if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'mock-openai-key') {
      healthCheck.services.openai = 'configured';
    } else {
      healthCheck.services.openai = 'not_configured';
    }
  } catch (error) {
    healthCheck.services.openai = 'error';
  }

  // Set appropriate status code
  const statusCode = healthCheck.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(healthCheck);
});

// Readiness check (more strict)
router.get('/ready', async (_req, res) => {
  const devConfig = getLocalDevConfig();
  
  try {
    // Check database
    await prisma.$queryRaw`SELECT 1`;
    
    // Check Redis (or mock)
    if (shouldUseMockService('redis')) {
      const mockRedis = MockServiceFactory.getRedisService();
      await mockRedis.ping();
    } else {
      const Redis = require('ioredis');
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
      await redis.ping();
      redis.disconnect();
    }

    // Check AI services (less strict in local dev)
    if (!shouldUseMockService('ai') && !process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      mode: devConfig.useMockServices ? 'local_development' : 'production'
    });
  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Liveness check (basic)
router.get('/live', (_req, res) => {
  const devConfig = getLocalDevConfig();
  
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mode: devConfig.useMockServices ? 'local_development' : 'production',
    services: {
      mock_redis: devConfig.mockRedis,
      mock_ai: devConfig.mockAI,
      mock_storage: devConfig.mockStorage,
      sqlite: devConfig.useSQLite
    }
  });
});

export default router;
