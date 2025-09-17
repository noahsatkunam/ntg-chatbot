import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';
import { WorkflowService } from './workflowService';
import { TenantIsolationService } from './security/tenantIsolation';

const prisma = new PrismaClient();

export interface ScheduledWorkflow {
  id: string;
  workflowId: string;
  tenantId: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  nextRun: Date;
  lastRun?: Date;
  lastStatus?: 'success' | 'error';
  lastError?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleOptions {
  cronExpression: string;
  timezone?: string;
  enabled?: boolean;
  metadata?: Record<string, any>;
  startDate?: Date;
  endDate?: Date;
}

export class ScheduledWorkflowService {
  private workflowService: WorkflowService;
  private tenantIsolation: TenantIsolationService;
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();

  constructor() {
    this.workflowService = new WorkflowService();
    this.tenantIsolation = new TenantIsolationService();
    this.initializeScheduler();
  }

  private async initializeScheduler(): Promise<void> {
    try {
      // Load all active scheduled workflows on startup
      const scheduledWorkflows = await prisma.workflowSchedule.findMany({
        where: { enabled: true },
        include: { workflow: true }
      });

      for (const schedule of scheduledWorkflows) {
        await this.scheduleWorkflow(schedule);
      }

      console.log(`Initialized ${scheduledWorkflows.length} scheduled workflows`);
    } catch (error) {
      console.error('Failed to initialize scheduler:', error);
    }
  }

  async createSchedule(
    tenantId: string,
    workflowId: string,
    options: ScheduleOptions
  ): Promise<ScheduledWorkflow> {
    // Validate tenant access
    await this.tenantIsolation.validateWorkflowAccess(tenantId, workflowId);

    // Validate cron expression
    if (!cron.validate(options.cronExpression)) {
      throw new Error('Invalid cron expression');
    }

    // Calculate next run time
    const nextRun = this.calculateNextRun(options.cronExpression, options.timezone);

    const schedule = await prisma.workflowSchedule.create({
      data: {
        workflowId,
        tenantId,
        cronExpression: options.cronExpression,
        timezone: options.timezone || 'UTC',
        enabled: options.enabled ?? true,
        nextRun,
        metadata: options.metadata || {},
        startDate: options.startDate,
        endDate: options.endDate
      },
      include: { workflow: true }
    });

    // Schedule the job if enabled
    if (schedule.enabled) {
      await this.scheduleWorkflow(schedule);
    }

    return this.mapToScheduledWorkflow(schedule);
  }

  async updateSchedule(
    tenantId: string,
    scheduleId: string,
    updates: Partial<ScheduleOptions>
  ): Promise<ScheduledWorkflow> {
    // Validate tenant access
    const existingSchedule = await prisma.workflowSchedule.findFirst({
      where: { id: scheduleId, tenantId },
      include: { workflow: true }
    });

    if (!existingSchedule) {
      throw new Error('Schedule not found or access denied');
    }

    // Validate new cron expression if provided
    if (updates.cronExpression && !cron.validate(updates.cronExpression)) {
      throw new Error('Invalid cron expression');
    }

    // Calculate new next run time if cron or timezone changed
    let nextRun = existingSchedule.nextRun;
    if (updates.cronExpression || updates.timezone) {
      nextRun = this.calculateNextRun(
        updates.cronExpression || existingSchedule.cronExpression,
        updates.timezone || existingSchedule.timezone
      );
    }

    const updatedSchedule = await prisma.workflowSchedule.update({
      where: { id: scheduleId },
      data: {
        ...updates,
        nextRun,
        updatedAt: new Date()
      },
      include: { workflow: true }
    });

    // Reschedule the job
    this.unscheduleWorkflow(scheduleId);
    if (updatedSchedule.enabled) {
      await this.scheduleWorkflow(updatedSchedule);
    }

    return this.mapToScheduledWorkflow(updatedSchedule);
  }

  async deleteSchedule(tenantId: string, scheduleId: string): Promise<void> {
    // Validate tenant access
    const schedule = await prisma.workflowSchedule.findFirst({
      where: { id: scheduleId, tenantId }
    });

    if (!schedule) {
      throw new Error('Schedule not found or access denied');
    }

    // Remove from scheduler
    this.unscheduleWorkflow(scheduleId);

    // Delete from database
    await prisma.workflowSchedule.delete({
      where: { id: scheduleId }
    });
  }

  async getSchedules(tenantId: string): Promise<ScheduledWorkflow[]> {
    const schedules = await prisma.workflowSchedule.findMany({
      where: { tenantId },
      include: { workflow: true },
      orderBy: { nextRun: 'asc' }
    });

    return schedules.map(this.mapToScheduledWorkflow);
  }

  async getSchedule(tenantId: string, scheduleId: string): Promise<ScheduledWorkflow | null> {
    const schedule = await prisma.workflowSchedule.findFirst({
      where: { id: scheduleId, tenantId },
      include: { workflow: true }
    });

    return schedule ? this.mapToScheduledWorkflow(schedule) : null;
  }

  async enableSchedule(tenantId: string, scheduleId: string): Promise<void> {
    const schedule = await prisma.workflowSchedule.findFirst({
      where: { id: scheduleId, tenantId },
      include: { workflow: true }
    });

    if (!schedule) {
      throw new Error('Schedule not found or access denied');
    }

    await prisma.workflowSchedule.update({
      where: { id: scheduleId },
      data: { enabled: true }
    });

    await this.scheduleWorkflow({ ...schedule, enabled: true });
  }

  async disableSchedule(tenantId: string, scheduleId: string): Promise<void> {
    const schedule = await prisma.workflowSchedule.findFirst({
      where: { id: scheduleId, tenantId }
    });

    if (!schedule) {
      throw new Error('Schedule not found or access denied');
    }

    await prisma.workflowSchedule.update({
      where: { id: scheduleId },
      data: { enabled: false }
    });

    this.unscheduleWorkflow(scheduleId);
  }

  async getUpcomingExecutions(tenantId: string, hours: number = 24): Promise<any[]> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() + hours);

    const schedules = await prisma.workflowSchedule.findMany({
      where: {
        tenantId,
        enabled: true,
        nextRun: {
          lte: cutoff
        }
      },
      include: { workflow: true },
      orderBy: { nextRun: 'asc' }
    });

    return schedules.map(schedule => ({
      scheduleId: schedule.id,
      workflowId: schedule.workflowId,
      workflowName: schedule.workflow.name,
      nextRun: schedule.nextRun,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone
    }));
  }

  private async scheduleWorkflow(schedule: any): Promise<void> {
    try {
      const task = cron.schedule(
        schedule.cronExpression,
        async () => {
          await this.executeScheduledWorkflow(schedule.id);
        },
        {
          scheduled: false,
          timezone: schedule.timezone
        }
      );

      this.scheduledJobs.set(schedule.id, task);
      task.start();

      console.log(`Scheduled workflow ${schedule.workflowId} with cron: ${schedule.cronExpression}`);
    } catch (error) {
      console.error(`Failed to schedule workflow ${schedule.workflowId}:`, error);
    }
  }

  private unscheduleWorkflow(scheduleId: string): void {
    const task = this.scheduledJobs.get(scheduleId);
    if (task) {
      task.stop();
      task.destroy();
      this.scheduledJobs.delete(scheduleId);
    }
  }

  private async executeScheduledWorkflow(scheduleId: string): Promise<void> {
    try {
      const schedule = await prisma.workflowSchedule.findUnique({
        where: { id: scheduleId },
        include: { workflow: true }
      });

      if (!schedule || !schedule.enabled) {
        return;
      }

      // Check if workflow is within date range
      const now = new Date();
      if (schedule.startDate && now < schedule.startDate) {
        return;
      }
      if (schedule.endDate && now > schedule.endDate) {
        // Disable expired schedule
        await this.disableSchedule(schedule.tenantId, scheduleId);
        return;
      }

      // Execute the workflow
      const execution = await this.workflowService.executeWorkflow(
        schedule.tenantId,
        schedule.workflowId,
        {
          trigger: 'schedule',
          scheduleId: scheduleId,
          scheduledTime: now,
          ...schedule.metadata
        }
      );

      // Update schedule with execution results
      const nextRun = this.calculateNextRun(schedule.cronExpression, schedule.timezone);
      
      await prisma.workflowSchedule.update({
        where: { id: scheduleId },
        data: {
          lastRun: now,
          nextRun,
          lastStatus: 'success',
          lastError: null
        }
      });

      console.log(`Successfully executed scheduled workflow ${schedule.workflowId}`);
    } catch (error) {
      console.error(`Failed to execute scheduled workflow ${scheduleId}:`, error);

      // Update schedule with error
      await prisma.workflowSchedule.update({
        where: { id: scheduleId },
        data: {
          lastRun: new Date(),
          lastStatus: 'error',
          lastError: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }

  private calculateNextRun(cronExpression: string, timezone: string = 'UTC'): Date {
    try {
      // Use a cron parser library to calculate next execution time
      const task = cron.schedule(cronExpression, () => {}, {
        scheduled: false,
        timezone
      });

      // Get next execution time (this is a simplified implementation)
      // In a real implementation, you'd use a proper cron parser
      const now = new Date();
      const nextRun = new Date(now.getTime() + 60000); // Placeholder: 1 minute from now
      
      return nextRun;
    } catch (error) {
      throw new Error(`Failed to calculate next run time: ${error}`);
    }
  }

  private mapToScheduledWorkflow(schedule: any): ScheduledWorkflow {
    return {
      id: schedule.id,
      workflowId: schedule.workflowId,
      tenantId: schedule.tenantId,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
      nextRun: schedule.nextRun,
      lastRun: schedule.lastRun,
      lastStatus: schedule.lastStatus,
      lastError: schedule.lastError,
      metadata: schedule.metadata,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt
    };
  }

  // Utility methods for common cron expressions
  static getCronPresets(): Record<string, string> {
    return {
      'every-minute': '* * * * *',
      'every-5-minutes': '*/5 * * * *',
      'every-15-minutes': '*/15 * * * *',
      'every-30-minutes': '*/30 * * * *',
      'hourly': '0 * * * *',
      'daily': '0 0 * * *',
      'weekly': '0 0 * * 0',
      'monthly': '0 0 1 * *',
      'yearly': '0 0 1 1 *',
      'business-hours': '0 9-17 * * 1-5',
      'weekends': '0 0 * * 6,0'
    };
  }

  static validateCronExpression(expression: string): boolean {
    return cron.validate(expression);
  }

  static describeCronExpression(expression: string): string {
    // This would use a cron description library in a real implementation
    const presets = this.getCronPresets();
    const preset = Object.entries(presets).find(([_, cron]) => cron === expression);
    
    if (preset) {
      return preset[0].replace('-', ' ');
    }

    return 'Custom schedule';
  }
}
