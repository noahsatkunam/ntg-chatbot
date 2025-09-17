import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import WebSocket from 'ws';

interface MonitoringMetrics {
  timestamp: Date;
  tenantId: string;
  metrics: {
    apiRequests: {
      total: number;
      successful: number;
      failed: number;
      averageResponseTime: number;
    };
    workflows: {
      totalExecutions: number;
      successfulExecutions: number;
      failedExecutions: number;
      averageExecutionTime: number;
    };
    integrations: {
      activeConnections: number;
      oauth2Connections: number;
      rateLimitViolations: number;
    };
    security: {
      securityViolations: number;
      suspiciousActivities: number;
      blockedRequests: number;
    };
  };
}

interface Alert {
  id: string;
  tenantId: string;
  type: 'error' | 'warning' | 'info' | 'critical';
  category: 'api' | 'workflow' | 'security' | 'integration';
  title: string;
  message: string;
  details: Record<string, any>;
  threshold?: number;
  currentValue?: number;
  timestamp: Date;
  acknowledged: boolean;
  resolvedAt?: Date;
}

interface HealthCheck {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  lastCheck: Date;
  details: Record<string, any>;
}

export class IntegrationMonitor extends EventEmitter {
  private prisma: PrismaClient;
  private wsServer?: WebSocket.Server;
  private clients: Map<string, WebSocket> = new Map();
  private metricsCache: Map<string, MonitoringMetrics> = new Map();
  private alerts: Map<string, Alert> = new Map();
  private healthChecks: Map<string, HealthCheck> = new Map();
  private monitoringInterval?: NodeJS.Timeout;

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.initializeWebSocketServer();
    this.startMonitoring();
  }

  private initializeWebSocketServer(): void {
    this.wsServer = new WebSocket.Server({ port: 8081 });
    
    this.wsServer.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      this.clients.set(clientId, ws);
      
      console.log(`Monitoring client connected: ${clientId}`);
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(clientId, data);
        } catch (error) {
          console.error('Error parsing client message:', error);
        }
      });
      
      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`Monitoring client disconnected: ${clientId}`);
      });
      
      // Send initial metrics
      this.sendMetricsToClient(ws);
    });
  }

  private startMonitoring(): void {
    // Collect metrics every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      await this.collectMetrics();
      await this.checkAlerts();
      await this.performHealthChecks();
    }, 30000);

    // Initial collection
    this.collectMetrics();
  }

  private async collectMetrics(): Promise<void> {
    try {
      // Get all active tenants
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true }
      });

      for (const tenant of tenants) {
        const metrics = await this.collectTenantMetrics(tenant.id);
        this.metricsCache.set(tenant.id, metrics);
        
        // Broadcast metrics to connected clients
        this.broadcastMetrics(tenant.id, metrics);
      }

    } catch (error) {
      console.error('Error collecting metrics:', error);
    }
  }

  private async collectTenantMetrics(tenantId: string): Promise<MonitoringMetrics> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    try {
      // API Request Metrics
      const apiRequests = await this.prisma.apiRequestLog.findMany({
        where: {
          tenantId,
          createdAt: { gte: oneHourAgo }
        }
      });

      const totalApiRequests = apiRequests.length;
      const successfulApiRequests = apiRequests.filter(req => req.statusCode < 400).length;
      const failedApiRequests = totalApiRequests - successfulApiRequests;
      const averageResponseTime = apiRequests.length > 0 
        ? apiRequests.reduce((sum, req) => sum + (req.duration || 0), 0) / apiRequests.length
        : 0;

      // Workflow Metrics
      const workflowExecutions = await this.prisma.workflowExecution.findMany({
        where: {
          tenantId,
          startTime: { gte: oneHourAgo }
        }
      });

      const totalExecutions = workflowExecutions.length;
      const successfulExecutions = workflowExecutions.filter(exec => exec.status === 'success').length;
      const failedExecutions = workflowExecutions.filter(exec => exec.status === 'error').length;
      const averageExecutionTime = workflowExecutions.length > 0
        ? workflowExecutions.reduce((sum, exec) => sum + (exec.duration || 0), 0) / workflowExecutions.length
        : 0;

      // Integration Metrics
      const activeConnections = await this.prisma.apiConnection.count({
        where: { tenantId, isActive: true }
      });

      const oauth2Connections = await this.prisma.oAuth2Connection.count({
        where: { tenantId, isActive: true }
      });

      // Security Metrics (simulated - would come from security service)
      const rateLimitViolations = apiRequests.filter(req => req.statusCode === 429).length;

      return {
        timestamp: now,
        tenantId,
        metrics: {
          apiRequests: {
            total: totalApiRequests,
            successful: successfulApiRequests,
            failed: failedApiRequests,
            averageResponseTime
          },
          workflows: {
            totalExecutions,
            successfulExecutions,
            failedExecutions,
            averageExecutionTime
          },
          integrations: {
            activeConnections,
            oauth2Connections,
            rateLimitViolations
          },
          security: {
            securityViolations: 0, // Would be populated by security service
            suspiciousActivities: 0,
            blockedRequests: rateLimitViolations
          }
        }
      };

    } catch (error) {
      console.error(`Error collecting metrics for tenant ${tenantId}:`, error);
      
      // Return empty metrics on error
      return {
        timestamp: now,
        tenantId,
        metrics: {
          apiRequests: { total: 0, successful: 0, failed: 0, averageResponseTime: 0 },
          workflows: { totalExecutions: 0, successfulExecutions: 0, failedExecutions: 0, averageExecutionTime: 0 },
          integrations: { activeConnections: 0, oauth2Connections: 0, rateLimitViolations: 0 },
          security: { securityViolations: 0, suspiciousActivities: 0, blockedRequests: 0 }
        }
      };
    }
  }

  private async checkAlerts(): Promise<void> {
    for (const [tenantId, metrics] of this.metricsCache) {
      await this.checkApiAlerts(tenantId, metrics);
      await this.checkWorkflowAlerts(tenantId, metrics);
      await this.checkSecurityAlerts(tenantId, metrics);
    }
  }

  private async checkApiAlerts(tenantId: string, metrics: MonitoringMetrics): Promise<void> {
    const { apiRequests } = metrics.metrics;
    
    // High error rate alert
    if (apiRequests.total > 0) {
      const errorRate = (apiRequests.failed / apiRequests.total) * 100;
      if (errorRate > 25) {
        await this.createAlert({
          tenantId,
          type: 'critical',
          category: 'api',
          title: 'High API Error Rate',
          message: `API error rate is ${errorRate.toFixed(1)}% (${apiRequests.failed}/${apiRequests.total} requests)`,
          details: { errorRate, failedRequests: apiRequests.failed, totalRequests: apiRequests.total },
          threshold: 25,
          currentValue: errorRate
        });
      } else if (errorRate > 10) {
        await this.createAlert({
          tenantId,
          type: 'warning',
          category: 'api',
          title: 'Elevated API Error Rate',
          message: `API error rate is ${errorRate.toFixed(1)}% (${apiRequests.failed}/${apiRequests.total} requests)`,
          details: { errorRate, failedRequests: apiRequests.failed, totalRequests: apiRequests.total },
          threshold: 10,
          currentValue: errorRate
        });
      }
    }

    // High response time alert
    if (apiRequests.averageResponseTime > 5000) {
      await this.createAlert({
        tenantId,
        type: 'warning',
        category: 'api',
        title: 'High API Response Time',
        message: `Average API response time is ${apiRequests.averageResponseTime}ms`,
        details: { averageResponseTime: apiRequests.averageResponseTime },
        threshold: 5000,
        currentValue: apiRequests.averageResponseTime
      });
    }
  }

  private async checkWorkflowAlerts(tenantId: string, metrics: MonitoringMetrics): Promise<void> {
    const { workflows } = metrics.metrics;
    
    // High workflow failure rate
    if (workflows.totalExecutions > 0) {
      const failureRate = (workflows.failedExecutions / workflows.totalExecutions) * 100;
      if (failureRate > 20) {
        await this.createAlert({
          tenantId,
          type: 'error',
          category: 'workflow',
          title: 'High Workflow Failure Rate',
          message: `Workflow failure rate is ${failureRate.toFixed(1)}% (${workflows.failedExecutions}/${workflows.totalExecutions} executions)`,
          details: { failureRate, failedExecutions: workflows.failedExecutions, totalExecutions: workflows.totalExecutions },
          threshold: 20,
          currentValue: failureRate
        });
      }
    }

    // Long execution time alert
    if (workflows.averageExecutionTime > 300000) { // 5 minutes
      await this.createAlert({
        tenantId,
        type: 'warning',
        category: 'workflow',
        title: 'Long Workflow Execution Time',
        message: `Average workflow execution time is ${(workflows.averageExecutionTime / 1000).toFixed(1)} seconds`,
        details: { averageExecutionTime: workflows.averageExecutionTime },
        threshold: 300000,
        currentValue: workflows.averageExecutionTime
      });
    }
  }

  private async checkSecurityAlerts(tenantId: string, metrics: MonitoringMetrics): Promise<void> {
    const { security } = metrics.metrics;
    
    // Security violations alert
    if (security.securityViolations > 0) {
      await this.createAlert({
        tenantId,
        type: 'critical',
        category: 'security',
        title: 'Security Violations Detected',
        message: `${security.securityViolations} security violations detected`,
        details: { securityViolations: security.securityViolations },
        currentValue: security.securityViolations
      });
    }

    // Rate limit violations
    if (security.blockedRequests > 10) {
      await this.createAlert({
        tenantId,
        type: 'warning',
        category: 'security',
        title: 'High Rate Limit Violations',
        message: `${security.blockedRequests} requests blocked due to rate limiting`,
        details: { blockedRequests: security.blockedRequests },
        threshold: 10,
        currentValue: security.blockedRequests
      });
    }
  }

  private async createAlert(alertData: Omit<Alert, 'id' | 'timestamp' | 'acknowledged'>): Promise<void> {
    const alertId = this.generateAlertId();
    const alert: Alert = {
      ...alertData,
      id: alertId,
      timestamp: new Date(),
      acknowledged: false
    };

    // Check if similar alert already exists
    const existingAlert = Array.from(this.alerts.values()).find(
      existing => 
        existing.tenantId === alert.tenantId &&
        existing.category === alert.category &&
        existing.title === alert.title &&
        !existing.acknowledged
    );

    if (!existingAlert) {
      this.alerts.set(alertId, alert);
      
      // Broadcast alert to clients
      this.broadcastAlert(alert);
      
      // Emit event
      this.emit('alert', alert);
      
      console.log(`Alert created: ${alert.title} for tenant ${alert.tenantId}`);
    }
  }

  private async performHealthChecks(): Promise<void> {
    const services = [
      { name: 'database', check: () => this.checkDatabaseHealth() },
      { name: 'redis', check: () => this.checkRedisHealth() },
      { name: 'external_apis', check: () => this.checkExternalApiHealth() }
    ];

    for (const service of services) {
      try {
        const startTime = Date.now();
        const result = await service.check();
        const responseTime = Date.now() - startTime;

        this.healthChecks.set(service.name, {
          service: service.name,
          status: result.status,
          responseTime,
          lastCheck: new Date(),
          details: result.details
        });

      } catch (error) {
        this.healthChecks.set(service.name, {
          service: service.name,
          status: 'unhealthy',
          responseTime: 0,
          lastCheck: new Date(),
          details: { error: error instanceof Error ? error.message : 'Unknown error' }
        });
      }
    }

    // Broadcast health status
    this.broadcastHealthStatus();
  }

  private async checkDatabaseHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: any }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'healthy', details: { connection: 'active' } };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        details: { error: error instanceof Error ? error.message : 'Database connection failed' } 
      };
    }
  }

  private async checkRedisHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: any }> {
    // Placeholder for Redis health check
    return { status: 'healthy', details: { connection: 'active' } };
  }

  private async checkExternalApiHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: any }> {
    // Placeholder for external API health checks
    return { status: 'healthy', details: { apis_checked: 0 } };
  }

  // WebSocket Communication
  private handleClientMessage(clientId: string, data: any): void {
    switch (data.type) {
      case 'subscribe':
        // Handle subscription to specific tenant metrics
        break;
      case 'acknowledge_alert':
        this.acknowledgeAlert(data.alertId);
        break;
      case 'get_metrics':
        const ws = this.clients.get(clientId);
        if (ws) {
          this.sendMetricsToClient(ws, data.tenantId);
        }
        break;
    }
  }

  private sendMetricsToClient(ws: WebSocket, tenantId?: string): void {
    try {
      const metrics = tenantId 
        ? this.metricsCache.get(tenantId)
        : Array.from(this.metricsCache.values());

      ws.send(JSON.stringify({
        type: 'metrics',
        data: metrics
      }));
    } catch (error) {
      console.error('Error sending metrics to client:', error);
    }
  }

  private broadcastMetrics(tenantId: string, metrics: MonitoringMetrics): void {
    const message = JSON.stringify({
      type: 'metrics_update',
      tenantId,
      data: metrics
    });

    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  private broadcastAlert(alert: Alert): void {
    const message = JSON.stringify({
      type: 'alert',
      data: alert
    });

    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  private broadcastHealthStatus(): void {
    const healthStatus = Array.from(this.healthChecks.values());
    const message = JSON.stringify({
      type: 'health_status',
      data: healthStatus
    });

    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  // Public API Methods
  async getMetrics(tenantId: string): Promise<MonitoringMetrics | null> {
    return this.metricsCache.get(tenantId) || null;
  }

  async getAlerts(tenantId: string, acknowledged: boolean = false): Promise<Alert[]> {
    return Array.from(this.alerts.values()).filter(
      alert => alert.tenantId === tenantId && alert.acknowledged === acknowledged
    );
  }

  async acknowledgeAlert(alertId: string): Promise<boolean> {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      this.alerts.set(alertId, alert);
      
      // Broadcast update
      this.broadcastAlert(alert);
      
      return true;
    }
    return false;
  }

  async resolveAlert(alertId: string): Promise<boolean> {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.resolvedAt = new Date();
      this.alerts.set(alertId, alert);
      
      // Broadcast update
      this.broadcastAlert(alert);
      
      return true;
    }
    return false;
  }

  getHealthStatus(): HealthCheck[] {
    return Array.from(this.healthChecks.values());
  }

  // Utility Methods
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Cleanup
  async cleanup(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    if (this.wsServer) {
      this.wsServer.close();
    }

    this.clients.clear();
    this.metricsCache.clear();
    this.alerts.clear();
    this.healthChecks.clear();

    await this.prisma.$disconnect();
  }
}
