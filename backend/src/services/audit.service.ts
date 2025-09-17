import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

interface AuditLogData {
  tenantId?: string | null;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
}

class AuditService {
  private readonly retentionDays: number;

  constructor() {
    this.retentionDays = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '90', 10);
  }

  /**
   * Create audit log entry
   */
  async log(data: AuditLogData): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          tenantId: data.tenantId,
          userId: data.userId,
          action: data.action,
          entity: data.entity,
          entityId: data.entityId,
          metadata: data.metadata || {},
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
        },
      });
    } catch (error) {
      logger.error('Failed to create audit log', { error, data });
    }
  }

  /**
   * Clean up old audit logs
   */
  async cleanupOldLogs(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    try {
      const result = await prisma.auditLog.deleteMany({
        where: {
          timestamp: { lt: cutoffDate },
        },
      });

      logger.info(`Cleaned up ${result.count} old audit logs`);
    } catch (error) {
      logger.error('Failed to cleanup audit logs', { error });
    }
  }

  /**
   * Get audit logs for a specific entity
   */
  async getEntityLogs(entity: string, entityId: string, limit = 100): Promise<any[]> {
    return await prisma.auditLog.findMany({
      where: {
        entity,
        entityId,
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
    });
  }

  /**
   * Get audit logs for a user
   */
  async getUserLogs(userId: string, limit = 100): Promise<any[]> {
    return await prisma.auditLog.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  /**
   * Get audit logs for a tenant
   */
  async getTenantLogs(tenantId: string, limit = 100): Promise<any[]> {
    return await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
    });
  }

  /**
   * Get security-related audit logs
   */
  async getSecurityLogs(tenantId?: string, limit = 100): Promise<any[]> {
    const securityActions = [
      'USER_LOGIN',
      'USER_LOGOUT',
      'PASSWORD_RESET_REQUESTED',
      'PASSWORD_RESET',
      'EMAIL_VERIFIED',
      'TWO_FACTOR_ENABLED',
      'TWO_FACTOR_DISABLED',
      'ACCOUNT_LOCKED',
      'FAILED_LOGIN_ATTEMPT',
    ];

    return await prisma.auditLog.findMany({
      where: {
        action: { in: securityActions },
        ...(tenantId && { tenantId }),
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
    });
  }
}

export const auditService = new AuditService();
