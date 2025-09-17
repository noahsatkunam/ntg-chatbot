import { Socket } from 'socket.io';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { logger } from '../../utils/logger';

// Create rate limiters for different event types
const messageLimiter = new RateLimiterMemory({
  points: 30, // Number of messages
  duration: 60, // Per 60 seconds
  blockDuration: 60, // Block for 1 minute
});

const typingLimiter = new RateLimiterMemory({
  points: 60, // Typing events
  duration: 60, // Per 60 seconds
  blockDuration: 30, // Block for 30 seconds
});

const generalLimiter = new RateLimiterMemory({
  points: 100, // General events
  duration: 60, // Per 60 seconds
  blockDuration: 60, // Block for 1 minute
});

interface SocketWithAuth extends Socket {
  userId?: string;
  tenantId?: string;
}

export async function rateLimitMiddleware(
  socket: SocketWithAuth,
  next: (err?: Error) => void
) {
  const originalEmit = socket.emit;
  const limitedEvents = new Set<string>();

  // Override emit to check rate limits
  socket.emit = function(event: string, ...args: any[]) {
    // Skip rate limiting for system events
    if (event.startsWith('system:') || event === 'pong' || event === 'error') {
      return originalEmit.apply(socket, [event, ...args]);
    }

    // Check if already rate limited
    if (limitedEvents.has(event)) {
      socket.emit('error', {
        type: 'RATE_LIMIT',
        message: `Rate limit exceeded for ${event}`,
      });
      return socket;
    }

    // Apply rate limiting based on event type
    const key = `${socket.userId || socket.id}:${event}`;
    let limiter = generalLimiter;

    if (event.startsWith('message:')) {
      limiter = messageLimiter;
    } else if (event.startsWith('typing:')) {
      limiter = typingLimiter;
    }

    limiter
      .consume(key, 1)
      .then(() => {
        originalEmit.apply(socket, [event, ...args]);
      })
      .catch((rejRes) => {
        limitedEvents.add(event);
        
        // Clear the flag after block duration
        setTimeout(() => {
          limitedEvents.delete(event);
        }, rejRes.msBeforeNext || 60000);

        logger.warn('Rate limit exceeded', {
          userId: socket.userId,
          socketId: socket.id,
          event,
          msBeforeNext: rejRes.msBeforeNext,
        });

        socket.emit('error', {
          type: 'RATE_LIMIT',
          message: 'Too many requests. Please slow down.',
          retryAfter: Math.round((rejRes.msBeforeNext || 60000) / 1000),
        });
      });

    return socket;
  } as any;

  next();
}

// Per-tenant rate limiting
export class TenantRateLimiter {
  private limiters: Map<string, RateLimiterMemory> = new Map();

  getLimiter(tenantId: string): RateLimiterMemory {
    if (!this.limiters.has(tenantId)) {
      this.limiters.set(
        tenantId,
        new RateLimiterMemory({
          points: 1000, // Requests per tenant
          duration: 60, // Per minute
          blockDuration: 300, // Block for 5 minutes
        })
      );
    }
    return this.limiters.get(tenantId)!;
  }

  async consume(tenantId: string, points: number = 1): Promise<boolean> {
    try {
      const limiter = this.getLimiter(tenantId);
      await limiter.consume(tenantId, points);
      return true;
    } catch (error) {
      logger.warn('Tenant rate limit exceeded', { tenantId });
      return false;
    }
  }

  reset(tenantId: string): void {
    this.limiters.delete(tenantId);
  }
}
