import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import axios from 'axios';
import { createError, HealthCheckErrorClass } from './errorHandler';

export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime: number;
  details?: any;
  error?: string;
}

export interface SystemHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  services: HealthCheckResult[];
  summary: {
    total: number;
    healthy: number;
    unhealthy: number;
    degraded: number;
  };
}

export class HealthCheckService {
  private prisma: PrismaClient;
  private redis: Redis | null = null;

  constructor() {
    this.prisma = new PrismaClient();
    
    // Initialize Redis if configured
    if (process.env.REDIS_URL) {
      try {
        this.redis = new Redis(process.env.REDIS_URL);
      } catch (error) {
        console.warn('Redis connection failed during health check initialization:', error);
      }
    }
  }

  async checkSystemHealth(): Promise<SystemHealth> {
    const startTime = Date.now();
    const services: HealthCheckResult[] = [];

    // Check all services in parallel
    const checks = [
      this.checkDatabase(),
      this.checkRedis(),
      this.checkN8n(),
      this.checkQdrant(),
      this.checkMinIO(),
      this.checkSupabase(),
      this.checkFileSystem(),
      this.checkEncryption()
    ];

    const results = await Promise.allSettled(checks);
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        services.push(result.value);
      } else {
        const serviceNames = ['database', 'redis', 'n8n', 'qdrant', 'minio', 'supabase', 'filesystem', 'encryption'];
        services.push({
          service: serviceNames[index],
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          error: result.reason?.message || 'Unknown error'
        });
      }
    });

    const summary = {
      total: services.length,
      healthy: services.filter(s => s.status === 'healthy').length,
      unhealthy: services.filter(s => s.status === 'unhealthy').length,
      degraded: services.filter(s => s.status === 'degraded').length
    };

    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
    if (summary.unhealthy > 0) {
      overallStatus = summary.unhealthy > summary.healthy ? 'unhealthy' : 'degraded';
    } else if (summary.degraded > 0) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services,
      summary
    };
  }

  private async checkDatabase(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Test basic connection
      await this.prisma.$queryRaw`SELECT 1`;
      
      // Test write operation
      const testQuery = await this.prisma.$queryRaw`
        SELECT COUNT(*) as count FROM "Tenant"
      `;
      
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'database',
        status: responseTime < 1000 ? 'healthy' : 'degraded',
        responseTime,
        details: {
          connected: true,
          queryTime: responseTime,
          testResult: testQuery
        }
      };
    } catch (error) {
      return {
        service: 'database',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Database connection failed'
      };
    }
  }

  private async checkRedis(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    if (!this.redis) {
      return {
        service: 'redis',
        status: 'degraded',
        responseTime: 0,
        details: { configured: false, message: 'Redis not configured' }
      };
    }

    try {
      // Test basic connection
      const pong = await this.redis.ping();
      
      // Test write/read operation
      const testKey = `health_check_${Date.now()}`;
      await this.redis.set(testKey, 'test_value', 'EX', 10);
      const testValue = await this.redis.get(testKey);
      await this.redis.del(testKey);
      
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'redis',
        status: responseTime < 500 ? 'healthy' : 'degraded',
        responseTime,
        details: {
          ping: pong,
          writeRead: testValue === 'test_value',
          memory: await this.redis.memory('usage')
        }
      };
    } catch (error) {
      return {
        service: 'redis',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Redis connection failed'
      };
    }
  }

  private async checkN8n(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const n8nUrl = process.env.N8N_URL || 'http://localhost:5678';
    
    try {
      const response = await axios.get(`${n8nUrl}/healthz`, {
        timeout: 5000,
        auth: process.env.N8N_BASIC_AUTH_USER && process.env.N8N_BASIC_AUTH_PASSWORD ? {
          username: process.env.N8N_BASIC_AUTH_USER,
          password: process.env.N8N_BASIC_AUTH_PASSWORD
        } : undefined
      });
      
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'n8n',
        status: response.status === 200 && responseTime < 2000 ? 'healthy' : 'degraded',
        responseTime,
        details: {
          status: response.status,
          data: response.data
        }
      };
    } catch (error) {
      return {
        service: 'n8n',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'n8n health check failed'
      };
    }
  }

  private async checkQdrant(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    
    try {
      const response = await axios.get(`${qdrantUrl}/health`, {
        timeout: 5000,
        headers: process.env.QDRANT_API_KEY ? {
          'api-key': process.env.QDRANT_API_KEY
        } : {}
      });
      
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'qdrant',
        status: response.status === 200 && responseTime < 2000 ? 'healthy' : 'degraded',
        responseTime,
        details: {
          status: response.status,
          data: response.data
        }
      };
    } catch (error) {
      return {
        service: 'qdrant',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Qdrant health check failed'
      };
    }
  }

  private async checkMinIO(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const minioEndpoint = process.env.MINIO_ENDPOINT || 'http://localhost:9000';
    
    try {
      const response = await axios.get(`${minioEndpoint}/minio/health/live`, {
        timeout: 5000
      });
      
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'minio',
        status: response.status === 200 && responseTime < 2000 ? 'healthy' : 'degraded',
        responseTime,
        details: {
          status: response.status,
          endpoint: minioEndpoint
        }
      };
    } catch (error) {
      return {
        service: 'minio',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'MinIO health check failed'
      };
    }
  }

  private async checkSupabase(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const supabaseUrl = process.env.SUPABASE_URL;
    
    if (!supabaseUrl) {
      return {
        service: 'supabase',
        status: 'degraded',
        responseTime: 0,
        details: { configured: false, message: 'Supabase not configured' }
      };
    }

    try {
      const response = await axios.get(`${supabaseUrl}/rest/v1/`, {
        timeout: 5000,
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || '',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`
        }
      });
      
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'supabase',
        status: response.status === 200 && responseTime < 2000 ? 'healthy' : 'degraded',
        responseTime,
        details: {
          status: response.status,
          url: supabaseUrl
        }
      };
    } catch (error) {
      return {
        service: 'supabase',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Supabase health check failed'
      };
    }
  }

  private async checkFileSystem(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const fs = require('fs').promises;
    const path = require('path');
    
    try {
      const tempDir = path.join(process.cwd(), 'temp');
      const testFile = path.join(tempDir, `health_check_${Date.now()}.txt`);
      
      // Ensure temp directory exists
      await fs.mkdir(tempDir, { recursive: true });
      
      // Test write operation
      await fs.writeFile(testFile, 'health check test');
      
      // Test read operation
      const content = await fs.readFile(testFile, 'utf8');
      
      // Cleanup
      await fs.unlink(testFile);
      
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'filesystem',
        status: responseTime < 1000 ? 'healthy' : 'degraded',
        responseTime,
        details: {
          writeRead: content === 'health check test',
          tempDir
        }
      };
    } catch (error) {
      return {
        service: 'filesystem',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'File system check failed'
      };
    }
  }

  private async checkEncryption(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const { encryptPayload, decryptPayload } = require('./encryption');
      const testKey = process.env.ENCRYPTION_KEY || 'test-key-32-chars-long-for-testing';
      const testData = 'health check encryption test';
      
      // Test encryption
      const encrypted = encryptPayload(testData, testKey);
      
      // Test decryption
      const decrypted = decryptPayload(encrypted, testKey);
      
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'encryption',
        status: decrypted === testData && responseTime < 100 ? 'healthy' : 'degraded',
        responseTime,
        details: {
          encryptionWorking: decrypted === testData,
          keyConfigured: !!process.env.ENCRYPTION_KEY
        }
      };
    } catch (error) {
      return {
        service: 'encryption',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Encryption check failed'
      };
    }
  }

  async checkServiceHealth(serviceName: string): Promise<HealthCheckResult> {
    switch (serviceName.toLowerCase()) {
      case 'database':
        return this.checkDatabase();
      case 'redis':
        return this.checkRedis();
      case 'n8n':
        return this.checkN8n();
      case 'qdrant':
        return this.checkQdrant();
      case 'minio':
        return this.checkMinIO();
      case 'supabase':
        return this.checkSupabase();
      case 'filesystem':
        return this.checkFileSystem();
      case 'encryption':
        return this.checkEncryption();
      default:
        throw new HealthCheckErrorClass(`Unknown service: ${serviceName}`);
    }
  }

  async waitForHealthy(
    serviceName: string,
    timeout: number = 30000,
    interval: number = 1000
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const result = await this.checkServiceHealth(serviceName);
        if (result.status === 'healthy') {
          return true;
        }
      } catch (error) {
        console.warn(`Health check failed for ${serviceName}:`, error);
      }
      
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    return false;
  }

  async getDetailedSystemInfo(): Promise<any> {
    const health = await this.checkSystemHealth();
    
    return {
      ...health,
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        env: process.env.NODE_ENV || 'development'
      },
      configuration: {
        databaseUrl: !!process.env.DATABASE_URL,
        redisUrl: !!process.env.REDIS_URL,
        encryptionKey: !!process.env.ENCRYPTION_KEY,
        n8nConfigured: !!(process.env.N8N_BASIC_AUTH_USER && process.env.N8N_BASIC_AUTH_PASSWORD),
        qdrantConfigured: !!process.env.QDRANT_URL,
        minioConfigured: !!process.env.MINIO_ENDPOINT,
        supabaseConfigured: !!process.env.SUPABASE_URL
      }
    };
  }

  async cleanup(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      if (this.redis) {
        await this.redis.quit();
      }
    } catch (error) {
      console.warn('Error during health check cleanup:', error);
    }
  }
}
