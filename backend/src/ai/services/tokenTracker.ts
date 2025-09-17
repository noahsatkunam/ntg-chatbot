import { PrismaClient } from '@prisma/client';
import { TokenUsage, AIConfiguration } from '../types';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

export class TokenTracker {
  private usageCache: Map<string, TokenUsage[]> = new Map();
  private readonly CACHE_FLUSH_INTERVAL = 60000; // 1 minute
  private readonly MAX_CACHE_SIZE = 1000;

  constructor() {
    // Periodically flush usage data to database
    setInterval(() => {
      this.flushUsageToDatabase();
    }, this.CACHE_FLUSH_INTERVAL);
  }

  /**
   * Track token usage
   */
  async trackUsage(usage: Omit<TokenUsage, 'id' | 'timestamp'>): Promise<void> {
    const fullUsage: TokenUsage = {
      ...usage,
      id: `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
    };

    // Add to cache
    const cacheKey = usage.tenantId;
    if (!this.usageCache.has(cacheKey)) {
      this.usageCache.set(cacheKey, []);
    }

    const tenantUsage = this.usageCache.get(cacheKey)!;
    tenantUsage.push(fullUsage);

    // Flush if cache is getting too large
    if (tenantUsage.length >= 100) {
      await this.flushTenantUsage(cacheKey);
    }

    logger.debug('Token usage tracked', {
      tenantId: usage.tenantId,
      model: usage.model,
      totalTokens: usage.totalTokens,
      cost: usage.cost,
    });
  }

  /**
   * Get usage statistics for tenant
   */
  async getUsageStats(
    tenantId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalTokens: number;
    totalCost: number;
    requestCount: number;
    modelBreakdown: Record<string, {
      tokens: number;
      cost: number;
      requests: number;
    }>;
    dailyUsage: Array<{
      date: string;
      tokens: number;
      cost: number;
      requests: number;
    }>;
  }> {
    try {
      const whereClause: any = { tenantId };
      
      if (startDate || endDate) {
        whereClause.timestamp = {};
        if (startDate) whereClause.timestamp.gte = startDate;
        if (endDate) whereClause.timestamp.lte = endDate;
      }

      // Get usage records
      const usageRecords = await prisma.$queryRaw<TokenUsage[]>`
        SELECT * FROM token_usage 
        WHERE tenant_id = ${tenantId}
        ${startDate ? `AND timestamp >= ${startDate}` : ''}
        ${endDate ? `AND timestamp <= ${endDate}` : ''}
        ORDER BY timestamp DESC
      `;

      // Calculate totals
      const totalTokens = usageRecords.reduce((sum, record) => sum + record.totalTokens, 0);
      const totalCost = usageRecords.reduce((sum, record) => sum + record.cost, 0);
      const requestCount = usageRecords.length;

      // Model breakdown
      const modelBreakdown: Record<string, any> = {};
      for (const record of usageRecords) {
        if (!modelBreakdown[record.model]) {
          modelBreakdown[record.model] = {
            tokens: 0,
            cost: 0,
            requests: 0,
          };
        }
        modelBreakdown[record.model].tokens += record.totalTokens;
        modelBreakdown[record.model].cost += record.cost;
        modelBreakdown[record.model].requests += 1;
      }

      // Daily usage
      const dailyUsageMap: Record<string, any> = {};
      for (const record of usageRecords) {
        const date = record.timestamp.toISOString().split('T')[0];
        if (!dailyUsageMap[date]) {
          dailyUsageMap[date] = {
            date,
            tokens: 0,
            cost: 0,
            requests: 0,
          };
        }
        dailyUsageMap[date].tokens += record.totalTokens;
        dailyUsageMap[date].cost += record.cost;
        dailyUsageMap[date].requests += 1;
      }

      const dailyUsage = Object.values(dailyUsageMap).sort((a: any, b: any) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      return {
        totalTokens,
        totalCost,
        requestCount,
        modelBreakdown,
        dailyUsage,
      };

    } catch (error) {
      logger.error('Failed to get usage stats', { error, tenantId });
      throw error;
    }
  }

  /**
   * Check if tenant is within rate limits
   */
  async checkRateLimits(
    tenantId: string,
    config: AIConfiguration
  ): Promise<{
    withinLimits: boolean;
    currentUsage: {
      requestsPerMinute: number;
      tokensPerMinute: number;
      dailyTokens: number;
    };
    limits: {
      requestsPerMinute: number;
      tokensPerMinute: number;
      dailyTokenLimit: number;
    };
  }> {
    try {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Get recent usage
      const [minuteUsage, dayUsage] = await Promise.all([
        prisma.$queryRaw<Array<{ count: number; tokens: number }>>`
          SELECT COUNT(*) as count, COALESCE(SUM(total_tokens), 0) as tokens
          FROM token_usage 
          WHERE tenant_id = ${tenantId} AND timestamp >= ${oneMinuteAgo}
        `,
        prisma.$queryRaw<Array<{ tokens: number }>>`
          SELECT COALESCE(SUM(total_tokens), 0) as tokens
          FROM token_usage 
          WHERE tenant_id = ${tenantId} AND timestamp >= ${oneDayAgo}
        `
      ]);

      const currentUsage = {
        requestsPerMinute: Number(minuteUsage[0]?.count || 0),
        tokensPerMinute: Number(minuteUsage[0]?.tokens || 0),
        dailyTokens: Number(dayUsage[0]?.tokens || 0),
      };

      const limits = config.rateLimits;

      const withinLimits = 
        currentUsage.requestsPerMinute < limits.requestsPerMinute &&
        currentUsage.tokensPerMinute < limits.tokensPerMinute &&
        currentUsage.dailyTokens < limits.dailyTokenLimit;

      return {
        withinLimits,
        currentUsage,
        limits,
      };

    } catch (error) {
      logger.error('Failed to check rate limits', { error, tenantId });
      // Allow request if we can't check limits
      return {
        withinLimits: true,
        currentUsage: {
          requestsPerMinute: 0,
          tokensPerMinute: 0,
          dailyTokens: 0,
        },
        limits: config.rateLimits,
      };
    }
  }

  /**
   * Calculate cost for usage
   */
  calculateCost(
    promptTokens: number,
    completionTokens: number,
    model: string,
    provider: string
  ): number {
    // Default pricing (should be updated with actual provider pricing)
    const pricing: Record<string, Record<string, { input: number; output: number }>> = {
      openai: {
        'gpt-4-turbo-preview': { input: 0.00001, output: 0.00003 },
        'gpt-4': { input: 0.00003, output: 0.00006 },
        'gpt-3.5-turbo': { input: 0.0000005, output: 0.0000015 },
      },
      anthropic: {
        'claude-3-opus-20240229': { input: 0.000015, output: 0.000075 },
        'claude-3-sonnet-20240229': { input: 0.000003, output: 0.000015 },
        'claude-3-haiku-20240307': { input: 0.00000025, output: 0.00000125 },
      },
    };

    const modelPricing = pricing[provider]?.[model];
    if (!modelPricing) {
      // Fallback pricing
      return (promptTokens + completionTokens) * 0.00001;
    }

    return (promptTokens * modelPricing.input) + (completionTokens * modelPricing.output);
  }

  /**
   * Get top usage by conversation
   */
  async getTopConversations(
    tenantId: string,
    limit: number = 10,
    startDate?: Date,
    endDate?: Date
  ): Promise<Array<{
    conversationId: string;
    totalTokens: number;
    totalCost: number;
    requestCount: number;
  }>> {
    try {
      const whereClause: any = { tenantId, conversationId: { not: null } };
      
      if (startDate || endDate) {
        whereClause.timestamp = {};
        if (startDate) whereClause.timestamp.gte = startDate;
        if (endDate) whereClause.timestamp.lte = endDate;
      }

      const results = await prisma.$queryRaw<Array<{
        conversationId: string;
        totalTokens: number;
        totalCost: number;
        requestCount: number;
      }>>`
        SELECT 
          conversation_id as "conversationId",
          SUM(total_tokens) as "totalTokens",
          SUM(cost) as "totalCost",
          COUNT(*) as "requestCount"
        FROM token_usage 
        WHERE tenant_id = ${tenantId} 
        AND conversation_id IS NOT NULL
        ${startDate ? `AND timestamp >= ${startDate}` : ''}
        ${endDate ? `AND timestamp <= ${endDate}` : ''}
        GROUP BY conversation_id
        ORDER BY SUM(total_tokens) DESC
        LIMIT ${limit}
      `;

      return results.map(row => ({
        conversationId: row.conversationId,
        totalTokens: Number(row.totalTokens),
        totalCost: Number(row.totalCost),
        requestCount: Number(row.requestCount),
      }));

    } catch (error) {
      logger.error('Failed to get top conversations', { error, tenantId });
      return [];
    }
  }

  /**
   * Flush usage data to database
   */
  private async flushUsageToDatabase(): Promise<void> {
    const tenantIds = Array.from(this.usageCache.keys());
    
    for (const tenantId of tenantIds) {
      await this.flushTenantUsage(tenantId);
    }
  }

  /**
   * Flush usage for specific tenant
   */
  private async flushTenantUsage(tenantId: string): Promise<void> {
    const usage = this.usageCache.get(tenantId);
    if (!usage || usage.length === 0) {
      return;
    }

    try {
      // Clear cache first to avoid duplicate writes
      this.usageCache.set(tenantId, []);

      // Batch insert to database
      await prisma.$executeRaw`
        INSERT INTO token_usage (
          id, tenant_id, user_id, conversation_id, model, provider,
          prompt_tokens, completion_tokens, total_tokens, cost, timestamp, metadata
        ) VALUES ${usage.map(u => `(
          ${u.id}, ${u.tenantId}, ${u.userId}, ${u.conversationId}, 
          ${u.model}, ${u.provider}, ${u.promptTokens}, ${u.completionTokens},
          ${u.totalTokens}, ${u.cost}, ${u.timestamp}, ${JSON.stringify(u.metadata || {})}
        )`).join(', ')}
      `;

      logger.debug('Flushed token usage to database', {
        tenantId,
        recordCount: usage.length,
      });

    } catch (error) {
      logger.error('Failed to flush usage to database', {
        error,
        tenantId,
        recordCount: usage.length,
      });

      // Put records back in cache for retry
      const currentCache = this.usageCache.get(tenantId) || [];
      this.usageCache.set(tenantId, [...usage, ...currentCache]);
    }
  }

  /**
   * Clean up old usage records
   */
  async cleanupOldUsage(daysToKeep: number = 90): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await prisma.$executeRaw`
        DELETE FROM token_usage 
        WHERE timestamp < ${cutoffDate}
      `;

      logger.info('Cleaned up old token usage records', {
        cutoffDate,
        deletedRecords: result,
      });

    } catch (error) {
      logger.error('Failed to cleanup old usage records', { error });
    }
  }
}
