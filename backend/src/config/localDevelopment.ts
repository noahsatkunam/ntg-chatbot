import { config } from './environment.js';
import { MockServiceFactory } from '../services/mockServices.js';
import { logger } from '../utils/logger.js';

export interface LocalDevConfig {
  useMockServices: boolean;
  useSQLite: boolean;
  skipExternalServices: boolean;
  enableDebugMode: boolean;
  mockAI: boolean;
  mockEmail: boolean;
  mockStorage: boolean;
  mockRedis: boolean;
  mockVector: boolean;
}

export function getLocalDevConfig(): LocalDevConfig {
  const isDevelopment = config.NODE_ENV === 'development';
  const isLocal = process.env.DEVELOPMENT_MODE === 'local';
  
  return {
    useMockServices: isDevelopment && isLocal,
    useSQLite: isDevelopment && (config.DATABASE_URL?.includes('file:') || false),
    skipExternalServices: process.env.SKIP_EXTERNAL_SERVICES === 'true',
    enableDebugMode: isDevelopment,
    mockAI: process.env.USE_MOCK_AI === 'true',
    mockEmail: process.env.USE_MOCK_EMAIL === 'true',
    mockStorage: process.env.USE_LOCAL_STORAGE === 'true',
    mockRedis: process.env.USE_MEMORY_CACHE === 'true',
    mockVector: process.env.USE_MEMORY_VECTOR_DB === 'true'
  };
}

export function initializeLocalDevelopment(): void {
  const devConfig = getLocalDevConfig();
  
  logger.info('Initializing local development environment', {
    config: devConfig
  });

  if (devConfig.useMockServices) {
    MockServiceFactory.initializeAllServices();
  }

  // Set up local directories
  if (devConfig.mockStorage) {
    const fs = require('fs');
    const path = require('path');
    
    const uploadDir = process.env.LOCAL_STORAGE_PATH || './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      logger.info(`Created local upload directory: ${uploadDir}`);
    }
  }

  // Log configuration
  logger.info('Local development configuration:', {
    database: devConfig.useSQLite ? 'SQLite' : 'PostgreSQL',
    services: devConfig.useMockServices ? 'Mock Services' : 'Real Services',
    ai: devConfig.mockAI ? 'Mock AI' : 'Real AI APIs',
    storage: devConfig.mockStorage ? 'Local File System' : 'External Storage'
  });
}

export function isLocalDevelopment(): boolean {
  return getLocalDevConfig().useMockServices;
}

export function shouldUseMockService(serviceName: string): boolean {
  const devConfig = getLocalDevConfig();
  
  switch (serviceName.toLowerCase()) {
    case 'ai':
    case 'openai':
    case 'anthropic':
      return devConfig.mockAI;
    case 'email':
    case 'smtp':
      return devConfig.mockEmail;
    case 'storage':
    case 'minio':
    case 's3':
      return devConfig.mockStorage;
    case 'redis':
    case 'cache':
      return devConfig.mockRedis;
    case 'vector':
    case 'qdrant':
      return devConfig.mockVector;
    default:
      return devConfig.useMockServices;
  }
}
