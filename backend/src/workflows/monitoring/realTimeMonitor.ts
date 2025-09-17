import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import { WebSocketServer } from 'ws';
import { Server } from 'http';

export interface MonitoringMetrics {
  activeExecutions: number;
  queuedExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  resourceUsage: {
    cpu: number;
    memory: number;
    disk: number;
    network: number;
  };
  errorRate: number;
  throughput: number;
  timestamp: Date;
}

export interface ExecutionEvent {
  type: 'started' | 'completed' | 'failed' | 'cancelled' | 'progress';
  executionId: string;
  workflowId: string;
  tenantId: string;
  timestamp: Date;
  data?: any;
}

export interface Alert {
  id: string;
  type: 'error' | 'warning' | 'info';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  tenantId: string;
  workflowId?: string;
  executionId?: string;
  timestamp: Date;
  acknowledged: boolean;
  resolvedAt?: Date;
}

export class RealTimeMonitor extends EventEmitter {
  private prisma: PrismaClient;
  private wss: WebSocketServer | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  private alertsInterval: NodeJS.Timeout | null = null;
  private connectedClients: Map<string, any> = new Map();
  private currentMetrics: Map<string, MonitoringMetrics> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.setupEventListeners();
  }

  // Initialize WebSocket server for real-time updates
  initializeWebSocket(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws/workflow-monitor' });

    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      const tenantId = this.extractTenantFromRequest(req);
      
      this.connectedClients.set(clientId, {
        ws,
        tenantId,
        connectedAt: new Date(),
        lastPing: new Date()
      });

      // Send current metrics to new client
      this.sendMetricsToClient(clientId, tenantId);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(clientId, data);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        this.connectedClients.delete(clientId);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.connectedClients.delete(clientId);
      });
    });

    // Start metrics collection
    this.startMetricsCollection();
    this.startAlertMonitoring();
  }

  private setupEventListeners(): void {
    // Listen for execution events
    this.on('execution:started', (event: ExecutionEvent) => {
      this.broadcastExecutionEvent(event);
      this.updateMetrics(event.tenantId);
    });

    this.on('execution:completed', (event: ExecutionEvent) => {
      this.broadcastExecutionEvent(event);
      this.updateMetrics(event.tenantId);
      this.checkPerformanceAlerts(event);
    });

    this.on('execution:failed', (event: ExecutionEvent) => {
      this.broadcastExecutionEvent(event);
      this.updateMetrics(event.tenantId);
      this.createErrorAlert(event);
    });

    this.on('execution:progress', (event: ExecutionEvent) => {
      this.broadcastExecutionEvent(event);
    });
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      try {
        const tenants = await this.getActiveTenants();
        
        for (const tenantId of tenants) {
          const metrics = await this.collectMetrics(tenantId);
          this.currentMetrics.set(tenantId, metrics);
          this.broadcastMetrics(tenantId, metrics);
        }
      } catch (error) {
        console.error('Metrics collection error:', error);
      }
    }, 5000); // Collect metrics every 5 seconds
  }

  private startAlertMonitoring(): void {
    this.alertsInterval = setInterval(async () => {
      try {
        await this.checkSystemAlerts();
      } catch (error) {
        console.error('Alert monitoring error:', error);
      }
    }, 30000); // Check alerts every 30 seconds
  }

  private async collectMetrics(tenantId: string): Promise<MonitoringMetrics> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const [
      activeExecutions,
      queuedExecutions,
      recentExecutions,
      completedExecutions,
      failedExecutions
    ] = await Promise.all([
      this.prisma.workflowExecution.count({
        where: {
          tenantId,
          status: 'running'
        }
      }),
      this.prisma.workflowExecution.count({
        where: {
          tenantId,
          status: 'queued'
        }
      }),
      this.prisma.workflowExecution.findMany({
        where: {
          tenantId,
          startTime: { gte: oneHourAgo }
        },
        select: {
          status: true,
          startTime: true,
          endTime: true
        }
      }),
      this.prisma.workflowExecution.count({
        where: {
          tenantId,
          status: 'success',
          startTime: { gte: oneHourAgo }
        }
      }),
      this.prisma.workflowExecution.count({
        where: {
          tenantId,
          status: 'error',
          startTime: { gte: oneHourAgo }
        }
      })
    ]);

    // Calculate average execution time
    const completedRecentExecutions = recentExecutions.filter(
      e => e.status === 'success' && e.endTime
    );
    
    const averageExecutionTime = completedRecentExecutions.length > 0
      ? completedRecentExecutions.reduce((sum, e) => {
          const duration = e.endTime!.getTime() - e.startTime.getTime();
          return sum + duration;
        }, 0) / completedRecentExecutions.length
      : 0;

    // Calculate error rate
    const totalRecentExecutions = recentExecutions.length;
    const errorRate = totalRecentExecutions > 0 
      ? (failedExecutions / totalRecentExecutions) * 100 
      : 0;

    // Calculate throughput (executions per hour)
    const throughput = totalRecentExecutions;

    // Get resource usage (mock data - integrate with actual monitoring)
    const resourceUsage = await this.getResourceUsage(tenantId);

    return {
      activeExecutions,
      queuedExecutions,
      completedExecutions,
      failedExecutions,
      averageExecutionTime,
      resourceUsage,
      errorRate,
      throughput,
      timestamp: now
    };
  }

  private async getResourceUsage(tenantId: string): Promise<any> {
    // Mock resource usage - integrate with actual system monitoring
    return {
      cpu: Math.random() * 100,
      memory: Math.random() * 100,
      disk: Math.random() * 100,
      network: Math.random() * 100
    };
  }

  private async getActiveTenants(): Promise<string[]> {
    const result = await this.prisma.workflowExecution.findMany({
      where: {
        startTime: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      },
      select: { tenantId: true },
      distinct: ['tenantId']
    });

    return result.map(r => r.tenantId);
  }

  private async checkSystemAlerts(): Promise<void> {
    const tenants = await this.getActiveTenants();

    for (const tenantId of tenants) {
      const metrics = this.currentMetrics.get(tenantId);
      if (!metrics) continue;

      // Check for high error rate
      if (metrics.errorRate > 20) {
        await this.createAlert({
          type: 'error',
          severity: 'high',
          title: 'High Error Rate',
          message: `Error rate is ${metrics.errorRate.toFixed(1)}% for tenant ${tenantId}`,
          tenantId
        });
      }

      // Check for resource usage
      if (metrics.resourceUsage.cpu > 90) {
        await this.createAlert({
          type: 'warning',
          severity: 'medium',
          title: 'High CPU Usage',
          message: `CPU usage is ${metrics.resourceUsage.cpu.toFixed(1)}% for tenant ${tenantId}`,
          tenantId
        });
      }

      if (metrics.resourceUsage.memory > 90) {
        await this.createAlert({
          type: 'warning',
          severity: 'medium',
          title: 'High Memory Usage',
          message: `Memory usage is ${metrics.resourceUsage.memory.toFixed(1)}% for tenant ${tenantId}`,
          tenantId
        });
      }

      // Check for queue buildup
      if (metrics.queuedExecutions > 50) {
        await this.createAlert({
          type: 'warning',
          severity: 'medium',
          title: 'Queue Buildup',
          message: `${metrics.queuedExecutions} executions queued for tenant ${tenantId}`,
          tenantId
        });
      }
    }
  }

  private async createAlert(alertData: Partial<Alert>): Promise<void> {
    const alert: Alert = {
      id: this.generateAlertId(),
      type: alertData.type || 'info',
      severity: alertData.severity || 'low',
      title: alertData.title || 'System Alert',
      message: alertData.message || '',
      tenantId: alertData.tenantId!,
      workflowId: alertData.workflowId,
      executionId: alertData.executionId,
      timestamp: new Date(),
      acknowledged: false
    };

    // Check if similar alert already exists
    const existingAlert = Array.from(this.activeAlerts.values()).find(
      a => a.tenantId === alert.tenantId && 
           a.title === alert.title && 
           !a.acknowledged &&
           (new Date().getTime() - a.timestamp.getTime()) < 300000 // 5 minutes
    );

    if (existingAlert) {
      return; // Don't create duplicate alerts
    }

    this.activeAlerts.set(alert.id, alert);
    this.broadcastAlert(alert);

    // Store alert in database
    try {
      await this.prisma.workflowAlert.create({
        data: {
          id: alert.id,
          type: alert.type,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          tenantId: alert.tenantId,
          workflowId: alert.workflowId,
          executionId: alert.executionId,
          acknowledged: false,
          createdAt: alert.timestamp
        }
      });
    } catch (error) {
      console.error('Failed to store alert:', error);
    }
  }

  private createErrorAlert(event: ExecutionEvent): void {
    this.createAlert({
      type: 'error',
      severity: 'medium',
      title: 'Workflow Execution Failed',
      message: `Workflow ${event.workflowId} execution failed`,
      tenantId: event.tenantId,
      workflowId: event.workflowId,
      executionId: event.executionId
    });
  }

  private checkPerformanceAlerts(event: ExecutionEvent): void {
    // Check for long-running executions
    if (event.data?.duration && event.data.duration > 300000) { // 5 minutes
      this.createAlert({
        type: 'warning',
        severity: 'low',
        title: 'Long Running Execution',
        message: `Execution took ${Math.round(event.data.duration / 1000)}s to complete`,
        tenantId: event.tenantId,
        workflowId: event.workflowId,
        executionId: event.executionId
      });
    }
  }

  private broadcastExecutionEvent(event: ExecutionEvent): void {
    const message = JSON.stringify({
      type: 'execution_event',
      data: event
    });

    this.connectedClients.forEach((client, clientId) => {
      if (client.tenantId === event.tenantId && client.ws.readyState === 1) {
        client.ws.send(message);
      }
    });
  }

  private broadcastMetrics(tenantId: string, metrics: MonitoringMetrics): void {
    const message = JSON.stringify({
      type: 'metrics_update',
      data: metrics
    });

    this.connectedClients.forEach((client, clientId) => {
      if (client.tenantId === tenantId && client.ws.readyState === 1) {
        client.ws.send(message);
      }
    });
  }

  private broadcastAlert(alert: Alert): void {
    const message = JSON.stringify({
      type: 'alert',
      data: alert
    });

    this.connectedClients.forEach((client, clientId) => {
      if (client.tenantId === alert.tenantId && client.ws.readyState === 1) {
        client.ws.send(message);
      }
    });
  }

  private sendMetricsToClient(clientId: string, tenantId: string): void {
    const client = this.connectedClients.get(clientId);
    if (!client || client.ws.readyState !== 1) return;

    const metrics = this.currentMetrics.get(tenantId);
    if (metrics) {
      const message = JSON.stringify({
        type: 'metrics_update',
        data: metrics
      });
      client.ws.send(message);
    }

    // Send active alerts
    const tenantAlerts = Array.from(this.activeAlerts.values())
      .filter(alert => alert.tenantId === tenantId && !alert.acknowledged);
    
    if (tenantAlerts.length > 0) {
      const message = JSON.stringify({
        type: 'alerts',
        data: tenantAlerts
      });
      client.ws.send(message);
    }
  }

  private handleClientMessage(clientId: string, data: any): void {
    const client = this.connectedClients.get(clientId);
    if (!client) return;

    switch (data.type) {
      case 'ping':
        client.lastPing = new Date();
        client.ws.send(JSON.stringify({ type: 'pong' }));
        break;

      case 'acknowledge_alert':
        this.acknowledgeAlert(data.alertId, client.tenantId);
        break;

      case 'subscribe_workflow':
        // Subscribe to specific workflow updates
        client.subscribedWorkflows = client.subscribedWorkflows || new Set();
        client.subscribedWorkflows.add(data.workflowId);
        break;

      case 'unsubscribe_workflow':
        if (client.subscribedWorkflows) {
          client.subscribedWorkflows.delete(data.workflowId);
        }
        break;
    }
  }

  private async acknowledgeAlert(alertId: string, tenantId: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (alert && alert.tenantId === tenantId) {
      alert.acknowledged = true;
      alert.resolvedAt = new Date();

      // Update in database
      try {
        await this.prisma.workflowAlert.update({
          where: { id: alertId },
          data: {
            acknowledged: true,
            resolvedAt: alert.resolvedAt
          }
        });
      } catch (error) {
        console.error('Failed to acknowledge alert:', error);
      }

      // Broadcast update
      this.broadcastAlert(alert);
    }
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractTenantFromRequest(req: any): string {
    // Extract tenant ID from request headers or query params
    return req.headers['x-tenant-id'] || req.url.searchParams?.get('tenantId') || 'default';
  }

  // Public methods for triggering events
  emitExecutionStarted(executionId: string, workflowId: string, tenantId: string): void {
    this.emit('execution:started', {
      type: 'started',
      executionId,
      workflowId,
      tenantId,
      timestamp: new Date()
    });
  }

  emitExecutionCompleted(executionId: string, workflowId: string, tenantId: string, duration: number): void {
    this.emit('execution:completed', {
      type: 'completed',
      executionId,
      workflowId,
      tenantId,
      timestamp: new Date(),
      data: { duration }
    });
  }

  emitExecutionFailed(executionId: string, workflowId: string, tenantId: string, error: string): void {
    this.emit('execution:failed', {
      type: 'failed',
      executionId,
      workflowId,
      tenantId,
      timestamp: new Date(),
      data: { error }
    });
  }

  emitExecutionProgress(executionId: string, workflowId: string, tenantId: string, progress: any): void {
    this.emit('execution:progress', {
      type: 'progress',
      executionId,
      workflowId,
      tenantId,
      timestamp: new Date(),
      data: progress
    });
  }

  // Get current metrics for a tenant
  getMetrics(tenantId: string): MonitoringMetrics | null {
    return this.currentMetrics.get(tenantId) || null;
  }

  // Get active alerts for a tenant
  getActiveAlerts(tenantId: string): Alert[] {
    return Array.from(this.activeAlerts.values())
      .filter(alert => alert.tenantId === tenantId && !alert.acknowledged);
  }

  // Get connected clients count
  getConnectedClientsCount(tenantId?: string): number {
    if (tenantId) {
      return Array.from(this.connectedClients.values())
        .filter(client => client.tenantId === tenantId).length;
    }
    return this.connectedClients.size;
  }

  // Cleanup
  shutdown(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    if (this.alertsInterval) {
      clearInterval(this.alertsInterval);
    }

    if (this.wss) {
      this.wss.close();
    }

    this.connectedClients.clear();
    this.currentMetrics.clear();
    this.activeAlerts.clear();
  }
}

// Singleton instance
export const realTimeMonitor = new RealTimeMonitor();
