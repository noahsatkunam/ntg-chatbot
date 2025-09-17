import { PrismaClient, PresenceStatus } from '@prisma/client';
import { logger } from '../../utils/logger';

export class PresenceManager {
  private presenceCache: Map<string, PresenceStatus> = new Map();
  private gracePeriodTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly GRACE_PERIOD_MS = 30000; // 30 seconds grace period

  constructor(private prisma: PrismaClient) {}

  /**
   * Update user presence status
   */
  async updatePresence(
    userId: string,
    tenantId: string,
    status: PresenceStatus
  ): Promise<void> {
    try {
      // Clear any existing grace period timer
      this.clearGracePeriod(userId);

      // Update cache
      this.presenceCache.set(userId, status);

      // Update database
      await this.prisma.userPresence.upsert({
        where: { userId },
        update: {
          status,
          lastSeenAt: new Date(),
          metadata: {
            updatedAt: new Date().toISOString(),
          },
        },
        create: {
          userId,
          tenantId,
          status,
          lastSeenAt: new Date(),
          metadata: {
            createdAt: new Date().toISOString(),
          },
        },
      });

      logger.debug('User presence updated', { userId, status });
    } catch (error) {
      logger.error('Failed to update presence', { error, userId, status });
    }
  }

  /**
   * Handle user disconnect with grace period
   */
  async handleDisconnect(userId: string, tenantId: string): Promise<void> {
    // Set a grace period before marking as offline
    this.gracePeriodTimers.set(
      userId,
      setTimeout(async () => {
        await this.updatePresence(userId, tenantId, 'OFFLINE');
        this.gracePeriodTimers.delete(userId);
      }, this.GRACE_PERIOD_MS)
    );

    logger.debug('User disconnect grace period started', { userId });
  }

  /**
   * Clear grace period timer
   */
  private clearGracePeriod(userId: string): void {
    const timer = this.gracePeriodTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.gracePeriodTimers.delete(userId);
    }
  }

  /**
   * Get user presence status
   */
  async getUserPresence(userId: string): Promise<PresenceStatus> {
    // Check cache first
    const cached = this.presenceCache.get(userId);
    if (cached) return cached;

    // Query database
    const presence = await this.prisma.userPresence.findUnique({
      where: { userId },
      select: { status: true },
    });

    const status = presence?.status || 'OFFLINE';
    this.presenceCache.set(userId, status);
    
    return status;
  }

  /**
   * Get multiple users presence status
   */
  async getUsersPresence(userIds: string[]): Promise<Map<string, PresenceStatus>> {
    const result = new Map<string, PresenceStatus>();

    // Get cached values
    const uncachedIds: string[] = [];
    for (const userId of userIds) {
      const cached = this.presenceCache.get(userId);
      if (cached) {
        result.set(userId, cached);
      } else {
        uncachedIds.push(userId);
      }
    }

    // Query database for uncached values
    if (uncachedIds.length > 0) {
      const presences = await this.prisma.userPresence.findMany({
        where: {
          userId: { in: uncachedIds },
        },
        select: {
          userId: true,
          status: true,
        },
      });

      for (const presence of presences) {
        result.set(presence.userId, presence.status);
        this.presenceCache.set(presence.userId, presence.status);
      }

      // Set offline status for users not found
      for (const userId of uncachedIds) {
        if (!result.has(userId)) {
          result.set(userId, 'OFFLINE');
          this.presenceCache.set(userId, 'OFFLINE');
        }
      }
    }

    return result;
  }

  /**
   * Get online users in tenant
   */
  async getOnlineUsersInTenant(tenantId: string): Promise<string[]> {
    const users = await this.prisma.userPresence.findMany({
      where: {
        tenantId,
        status: { in: ['ONLINE', 'AWAY', 'BUSY'] },
        lastSeenAt: {
          gt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Active in last 24 hours
        },
      },
      select: { userId: true },
    });

    return users.map(u => u.userId);
  }

  /**
   * Get user's last seen timestamp
   */
  async getLastSeen(userId: string): Promise<Date | null> {
    const presence = await this.prisma.userPresence.findUnique({
      where: { userId },
      select: { lastSeenAt: true },
    });

    return presence?.lastSeenAt || null;
  }

  /**
   * Cleanup stale presence data
   */
  async cleanupStalePresence(): Promise<void> {
    const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days

    try {
      const result = await this.prisma.userPresence.updateMany({
        where: {
          lastSeenAt: { lt: staleThreshold },
          status: { not: 'OFFLINE' },
        },
        data: {
          status: 'OFFLINE',
        },
      });

      if (result.count > 0) {
        logger.info('Cleaned up stale presence data', { count: result.count });
      }
    } catch (error) {
      logger.error('Failed to cleanup stale presence', { error });
    }
  }

  /**
   * Clear cache (for maintenance)
   */
  clearCache(): void {
    this.presenceCache.clear();
    logger.info('Presence cache cleared');
  }
}
