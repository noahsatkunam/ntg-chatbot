import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

export interface ResourceLimits {
  maxConcurrentExecutions: number;
  maxExecutionDuration: number; // in milliseconds
  maxMemoryUsage: number; // in MB
  maxCpuUsage: number; // percentage
  maxDiskUsage: number; // in MB
  maxNetworkRequests: number;
}

export interface ResourceUsage {
  executionId: string;
  workflowId: string;
  tenantId: string;
  startTime: Date;
  duration?: number;
  memoryUsage: number;
  cpuUsage: number;
  diskUsage: number;
  networkRequests: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}

export interface TenantResourceQuota {
  tenantId: string;
  maxConcurrentExecutions: number;
  maxExecutionsPerHour: number;
  maxExecutionsPerDay: number;
  maxTotalDuration: number; // per day in milliseconds
  maxStorageUsage: number; // in MB
  resetTime: Date;
}

export class ResourceManager extends EventEmitter {
  private prisma: PrismaClient;
  private activeExecutions: Map<string, ResourceUsage> = new Map();
  private tenantQuotas: Map<string, TenantResourceQuota> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.startResourceMonitoring();
  }

  // Start resource monitoring
  private startResourceMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      await this.monitorActiveExecutions();
      await this.cleanupCompletedExecutions();
      await this.checkResourceLimits();
    }, 10000); // Monitor every 10 seconds
  }

  // Stop resource monitoring
  stopResourceMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  // Check if execution can start based on resource limits
  async canStartExecution(
    workflowId: string,
    tenantId: string,
    estimatedDuration?: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      // Get tenant quota
      const quota = await this.getTenantQuota(tenantId);
      
      // Check concurrent execution limit
      const currentExecutions = this.getConcurrentExecutions(tenantId);
      if (currentExecutions >= quota.maxConcurrentExecutions) {
        return {
          allowed: false,
          reason: `Maximum concurrent executions reached (${quota.maxConcurrentExecutions})`
        };
      }

      // Check hourly execution limit
      const hourlyExecutions = await this.getExecutionsInTimeRange(
        tenantId,
        new Date(Date.now() - 60 * 60 * 1000)
      );
      if (hourlyExecutions >= quota.maxExecutionsPerHour) {
        return {
          allowed: false,
          reason: `Hourly execution limit reached (${quota.maxExecutionsPerHour})`
        };
      }

      // Check daily execution limit
      const dailyExecutions = await this.getExecutionsInTimeRange(
        tenantId,
        new Date(Date.now() - 24 * 60 * 60 * 1000)
      );
      if (dailyExecutions >= quota.maxExecutionsPerDay) {
        return {
          allowed: false,
          reason: `Daily execution limit reached (${quota.maxExecutionsPerDay})`
        };
      }

      // Check daily duration limit
      const dailyDuration = await this.getTotalDurationInTimeRange(
        tenantId,
        new Date(Date.now() - 24 * 60 * 60 * 1000)
      );
      if (estimatedDuration && (dailyDuration + estimatedDuration) > quota.maxTotalDuration) {
        return {
          allowed: false,
          reason: `Daily duration limit would be exceeded`
        };
      }

      // Check system resource availability
      const systemResources = await this.getSystemResourceUsage();
      if (systemResources.cpuUsage > 90) {
        return {
          allowed: false,
          reason: 'System CPU usage too high'
        };
      }

      if (systemResources.memoryUsage > 90) {
        return {
          allowed: false,
          reason: 'System memory usage too high'
        };
      }

      return { allowed: true };

    } catch (error) {
      console.error('Error checking execution limits:', error);
      return {
        allowed: false,
        reason: 'Error checking resource limits'
      };
    }
  }

  // Register execution start
  async registerExecutionStart(
    executionId: string,
    workflowId: string,
    tenantId: string
  ): Promise<void> {
    const resourceUsage: ResourceUsage = {
      executionId,
      workflowId,
      tenantId,
      startTime: new Date(),
      memoryUsage: 0,
      cpuUsage: 0,
      diskUsage: 0,
      networkRequests: 0,
      status: 'running'
    };

    this.activeExecutions.set(executionId, resourceUsage);

    // Update database
    await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        metadata: {
          resourceTracking: {
            startTime: resourceUsage.startTime,
            status: 'running'
          }
        }
      }
    });

    this.emit('execution:started', { executionId, tenantId });
  }

  // Register execution completion
  async registerExecutionEnd(
    executionId: string,
    status: 'completed' | 'failed' | 'cancelled'
  ): Promise<void> {
    const resourceUsage = this.activeExecutions.get(executionId);
    if (!resourceUsage) return;

    resourceUsage.status = status;
    resourceUsage.duration = Date.now() - resourceUsage.startTime.getTime();

    // Update database with final resource usage
    await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        duration: resourceUsage.duration,
        metadata: {
          resourceUsage: {
            duration: resourceUsage.duration,
            memoryUsage: resourceUsage.memoryUsage,
            cpuUsage: resourceUsage.cpuUsage,
            diskUsage: resourceUsage.diskUsage,
            networkRequests: resourceUsage.networkRequests,
            status
          }
        }
      }
    });

    // Update tenant resource analytics
    await this.updateTenantResourceAnalytics(resourceUsage);

    this.activeExecutions.delete(executionId);
    this.emit('execution:ended', { executionId, status, resourceUsage });
  }

  // Monitor active executions for resource usage
  private async monitorActiveExecutions(): Promise<void> {
    for (const [executionId, resourceUsage] of this.activeExecutions) {
      try {
        // Simulate resource monitoring (in production, this would use actual system metrics)
        const currentUsage = await this.getCurrentResourceUsage(executionId);
        
        resourceUsage.memoryUsage = Math.max(resourceUsage.memoryUsage, currentUsage.memory);
        resourceUsage.cpuUsage = Math.max(resourceUsage.cpuUsage, currentUsage.cpu);
        resourceUsage.diskUsage += currentUsage.diskDelta;
        resourceUsage.networkRequests += currentUsage.networkDelta;

        // Check for resource limit violations
        const limits = await this.getResourceLimits(resourceUsage.tenantId);
        await this.checkExecutionLimits(resourceUsage, limits);

        // Check for long-running executions
        const runningTime = Date.now() - resourceUsage.startTime.getTime();
        if (runningTime > limits.maxExecutionDuration) {
          await this.terminateExecution(executionId, 'timeout');
        }

      } catch (error) {
        console.error(`Error monitoring execution ${executionId}:`, error);
      }
    }
  }

  // Check execution against resource limits
  private async checkExecutionLimits(
    resourceUsage: ResourceUsage,
    limits: ResourceLimits
  ): Promise<void> {
    const violations: string[] = [];

    if (resourceUsage.memoryUsage > limits.maxMemoryUsage) {
      violations.push(`Memory usage exceeded: ${resourceUsage.memoryUsage}MB > ${limits.maxMemoryUsage}MB`);
    }

    if (resourceUsage.cpuUsage > limits.maxCpuUsage) {
      violations.push(`CPU usage exceeded: ${resourceUsage.cpuUsage}% > ${limits.maxCpuUsage}%`);
    }

    if (resourceUsage.diskUsage > limits.maxDiskUsage) {
      violations.push(`Disk usage exceeded: ${resourceUsage.diskUsage}MB > ${limits.maxDiskUsage}MB`);
    }

    if (resourceUsage.networkRequests > limits.maxNetworkRequests) {
      violations.push(`Network requests exceeded: ${resourceUsage.networkRequests} > ${limits.maxNetworkRequests}`);
    }

    if (violations.length > 0) {
      this.emit('resource:violation', {
        executionId: resourceUsage.executionId,
        tenantId: resourceUsage.tenantId,
        violations
      });

      // Terminate execution if critical limits are exceeded
      if (resourceUsage.memoryUsage > limits.maxMemoryUsage * 1.5 ||
          resourceUsage.cpuUsage > limits.maxCpuUsage * 1.2) {
        await this.terminateExecution(resourceUsage.executionId, 'resource_limit');
      }
    }
  }

  // Terminate execution due to resource violations
  private async terminateExecution(executionId: string, reason: string): Promise<void> {
    try {
      // Cancel execution in n8n (would need n8n client integration)
      console.log(`Terminating execution ${executionId} due to: ${reason}`);

      await this.registerExecutionEnd(executionId, 'cancelled');

      this.emit('execution:terminated', {
        executionId,
        reason
      });

    } catch (error) {
      console.error(`Error terminating execution ${executionId}:`, error);
    }
  }

  // Get tenant resource quota
  private async getTenantQuota(tenantId: string): Promise<TenantResourceQuota> {
    let quota = this.tenantQuotas.get(tenantId);
    
    if (!quota || quota.resetTime < new Date()) {
      // Load or create quota from database
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId }
      });

      const defaultQuota: TenantResourceQuota = {
        tenantId,
        maxConcurrentExecutions: 5,
        maxExecutionsPerHour: 100,
        maxExecutionsPerDay: 1000,
        maxTotalDuration: 24 * 60 * 60 * 1000, // 24 hours
        maxStorageUsage: 1000, // 1GB
        resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000) // Reset daily
      };

      // Merge with tenant-specific settings
      if (tenant?.metadata?.resourceQuota) {
        quota = { ...defaultQuota, ...tenant.metadata.resourceQuota };
      } else {
        quota = defaultQuota;
      }

      this.tenantQuotas.set(tenantId, quota);
    }

    return quota;
  }

  // Get resource limits for tenant
  private async getResourceLimits(tenantId: string): Promise<ResourceLimits> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }
    });

    const defaultLimits: ResourceLimits = {
      maxConcurrentExecutions: 5,
      maxExecutionDuration: 30 * 60 * 1000, // 30 minutes
      maxMemoryUsage: 512, // 512MB
      maxCpuUsage: 80, // 80%
      maxDiskUsage: 100, // 100MB
      maxNetworkRequests: 1000
    };

    if (tenant?.metadata?.resourceLimits) {
      return { ...defaultLimits, ...tenant.metadata.resourceLimits };
    }

    return defaultLimits;
  }

  // Get current concurrent executions for tenant
  private getConcurrentExecutions(tenantId: string): number {
    return Array.from(this.activeExecutions.values())
      .filter(usage => usage.tenantId === tenantId && usage.status === 'running')
      .length;
  }

  // Get executions in time range
  private async getExecutionsInTimeRange(tenantId: string, since: Date): Promise<number> {
    return this.prisma.workflowExecution.count({
      where: {
        tenantId,
        startTime: { gte: since }
      }
    });
  }

  // Get total duration in time range
  private async getTotalDurationInTimeRange(tenantId: string, since: Date): Promise<number> {
    const result = await this.prisma.workflowExecution.aggregate({
      where: {
        tenantId,
        startTime: { gte: since },
        duration: { not: null }
      },
      _sum: { duration: true }
    });

    return result._sum.duration || 0;
  }

  // Get current resource usage for execution (simulated)
  private async getCurrentResourceUsage(executionId: string): Promise<{
    memory: number;
    cpu: number;
    diskDelta: number;
    networkDelta: number;
  }> {
    // In production, this would integrate with system monitoring tools
    return {
      memory: Math.random() * 100, // MB
      cpu: Math.random() * 50, // %
      diskDelta: Math.random() * 10, // MB
      networkDelta: Math.floor(Math.random() * 10) // requests
    };
  }

  // Get system resource usage
  private async getSystemResourceUsage(): Promise<{
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
  }> {
    // In production, this would get actual system metrics
    return {
      cpuUsage: Math.random() * 100,
      memoryUsage: Math.random() * 100,
      diskUsage: Math.random() * 100
    };
  }

  // Update tenant resource analytics
  private async updateTenantResourceAnalytics(resourceUsage: ResourceUsage): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.prisma.workflowAnalytics.upsert({
      where: {
        tenantId_date: {
          tenantId: resourceUsage.tenantId,
          date: today
        }
      },
      update: {
        totalDuration: { increment: resourceUsage.duration || 0 },
        averageMemoryUsage: resourceUsage.memoryUsage,
        averageCpuUsage: resourceUsage.cpuUsage,
        totalDiskUsage: { increment: resourceUsage.diskUsage },
        totalNetworkRequests: { increment: resourceUsage.networkRequests }
      },
      create: {
        tenantId: resourceUsage.tenantId,
        date: today,
        totalExecutions: 1,
        totalDuration: resourceUsage.duration || 0,
        averageMemoryUsage: resourceUsage.memoryUsage,
        averageCpuUsage: resourceUsage.cpuUsage,
        totalDiskUsage: resourceUsage.diskUsage,
        totalNetworkRequests: resourceUsage.networkRequests
      }
    });
  }

  // Clean up completed executions
  private async cleanupCompletedExecutions(): Promise<void> {
    const completedExecutions = Array.from(this.activeExecutions.entries())
      .filter(([_, usage]) => usage.status !== 'running');

    for (const [executionId, _] of completedExecutions) {
      this.activeExecutions.delete(executionId);
    }
  }

  // Check overall resource limits
  private async checkResourceLimits(): Promise<void> {
    const systemUsage = await this.getSystemResourceUsage();

    if (systemUsage.cpuUsage > 95) {
      this.emit('system:resource:critical', {
        type: 'cpu',
        usage: systemUsage.cpuUsage
      });
    }

    if (systemUsage.memoryUsage > 95) {
      this.emit('system:resource:critical', {
        type: 'memory',
        usage: systemUsage.memoryUsage
      });
    }
  }

  // Get resource statistics for tenant
  async getTenantResourceStats(tenantId: string): Promise<any> {
    const quota = await this.getTenantQuota(tenantId);
    const currentExecutions = this.getConcurrentExecutions(tenantId);
    
    const [hourlyExecutions, dailyExecutions, dailyDuration] = await Promise.all([
      this.getExecutionsInTimeRange(tenantId, new Date(Date.now() - 60 * 60 * 1000)),
      this.getExecutionsInTimeRange(tenantId, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      this.getTotalDurationInTimeRange(tenantId, new Date(Date.now() - 24 * 60 * 60 * 1000))
    ]);

    return {
      quota,
      current: {
        concurrentExecutions: currentExecutions,
        hourlyExecutions,
        dailyExecutions,
        dailyDuration
      },
      utilization: {
        concurrent: (currentExecutions / quota.maxConcurrentExecutions) * 100,
        hourly: (hourlyExecutions / quota.maxExecutionsPerHour) * 100,
        daily: (dailyExecutions / quota.maxExecutionsPerDay) * 100,
        duration: (dailyDuration / quota.maxTotalDuration) * 100
      }
    };
  }

  // Update tenant resource quota
  async updateTenantQuota(tenantId: string, newQuota: Partial<TenantResourceQuota>): Promise<void> {
    const currentQuota = await this.getTenantQuota(tenantId);
    const updatedQuota = { ...currentQuota, ...newQuota };

    this.tenantQuotas.set(tenantId, updatedQuota);

    // Update in database
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        metadata: {
          resourceQuota: updatedQuota
        }
      }
    });
  }

  // Get active executions for tenant
  getActiveExecutions(tenantId: string): ResourceUsage[] {
    return Array.from(this.activeExecutions.values())
      .filter(usage => usage.tenantId === tenantId);
  }

  // Force terminate execution
  async forceTerminateExecution(executionId: string, reason: string): Promise<void> {
    await this.terminateExecution(executionId, reason);
  }
}
