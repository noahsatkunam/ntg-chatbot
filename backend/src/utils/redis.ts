import { createClient, RedisClientType } from 'redis';
import { logger } from './logger';

let redisClient: RedisClientType;

/**
 * Initialize Redis client
 */
export async function initializeRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  redisClient = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          logger.error('Redis connection failed after 10 retries');
          return new Error('Redis connection failed');
        }
        return Math.min(retries * 100, 3000);
      },
    },
  });

  redisClient.on('error', (err) => {
    logger.error('Redis Client Error', { error: err });
  });

  redisClient.on('connect', () => {
    logger.info('Redis Client Connected');
  });

  redisClient.on('ready', () => {
    logger.info('Redis Client Ready');
  });

  redisClient.on('reconnecting', () => {
    logger.info('Redis Client Reconnecting');
  });

  await redisClient.connect();
}

/**
 * Get Redis client instance
 */
export function getRedisClient(): RedisClientType {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call initializeRedis() first.');
  }
  return redisClient;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
  }
}

// Export a proxy that ensures client is available
export const redis = new Proxy({} as RedisClientType, {
  get(target, prop) {
    const client = getRedisClient();
    return client[prop as keyof RedisClientType];
  },
});

// For backward compatibility
export { redis as redisClient };
