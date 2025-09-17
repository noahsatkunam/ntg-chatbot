import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

interface AlertRule {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  type: 'threshold' | 'anomaly' | 'pattern' | 'composite';
  metric: string;
  condition: {
    operator: '>' | '<' | '=' | '!=' | 'contains' | 'matches';
    value: any;
    threshold?: number;
    timeWindow?: number; // minutes
  };
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  actions: AlertAction[];
  cooldownPeriod: number; // minutes
  lastTriggered?: Date;
}

interface AlertAction {
  type: 'email' | 'webhook' | 'slack' | 'sms' | 'auto_scale' | 'workflow_pause';
  config: Record<string, any>;
  enabled: boolean;
}

interface Alert {
  id: string;
  ruleId: string;
  tenantId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  metric: string;
  currentValue: any;
  threshold: any;
  timestamp: Date;
  status: 'active' | 'acknowledged' | 'resolved';
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  metadata: Record<string, any>;
}

interface MonitoringMetrics {
  tenantId: string;
  timestamp: Date;
  workflowMetrics: {
    activeExecutions: number;
    queuedExecutions: number;
    failedExecutions: number;
    avgExecutionTime: number;
    successRate: number;
  };
  systemMetrics: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    networkUsage: number;
  };
  businessMetrics: {
    costPerHour: number;
    savingsPerHour: number;
    userActivity: number;
    apiCalls: number;
  };
}

export class AdvancedMonitoring extends EventEmitter {
  private prisma: PrismaClient;
  private wsServer: WebSocket.Server;
  private alertRules: Map<string, AlertRule[]> = new Map();
  private activeAlerts: Map<string, Alert[]> = new Map();
  private metricsBuffer: Map<string, MonitoringMetrics[]> = new Map();
  private anomalyDetectors: Map<string, any> = new Map();

  constructor(port: number = 8081) {
    super();
    this.prisma = new PrismaClient();
    this.wsServer = new WebSocket.Server({ port });
    this.initializeMonitoring();
  }

  private async initializeMonitoring(): Promise<void> {
    await this.loadAlertRules();
    this.setupWebSocketServer();
    this.startMetricsCollection();
    this.startAlertProcessing();
    this.initializeAnomalyDetection();
  }

  private setupWebSocketServer(): void {
    this.wsServer.on('connection', (ws: WebSocket, request) => {
      console.log('Monitoring WebSocket client connected');
      
      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message);
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        console.log('Monitoring WebSocket client disconnected');
      });
    });
  }

  private handleWebSocketMessage(ws: WebSocket, data: any): void {
    switch (data.type) {
      case 'subscribe_alerts':
        // Subscribe to alerts for specific tenant
        ws.send(JSON.stringify({
          type: 'subscription_confirmed',
          tenantId: data.tenantId
        }));
        break;
      case 'acknowledge_alert':
        this.acknowledgeAlert(data.alertId, data.userId);
        break;
      case 'resolve_alert':
        this.resolveAlert(data.alertId, data.userId);
        break;
    }
  }

  async createAlertRule(rule: Omit<AlertRule, 'id'>): Promise<AlertRule> {
    const alertRule: AlertRule = {
      ...rule,
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    // Add to tenant's rules
    const tenantRules = this.alertRules.get(rule.tenantId) || [];
    tenantRules.push(alertRule);
    this.alertRules.set(rule.tenantId, tenantRules);

    // Emit rule created event
    this.emit('alert_rule_created', alertRule);

    return alertRule;
  }

  async updateAlertRule(ruleId: string, updates: Partial<AlertRule>): Promise<AlertRule | null> {
    for (const [tenantId, rules] of this.alertRules.entries()) {
      const ruleIndex = rules.findIndex(r => r.id === ruleId);
      if (ruleIndex !== -1) {
        rules[ruleIndex] = { ...rules[ruleIndex], ...updates };
        this.alertRules.set(tenantId, rules);
        this.emit('alert_rule_updated', rules[ruleIndex]);
        return rules[ruleIndex];
      }
    }
    return null;
  }

  async deleteAlertRule(ruleId: string): Promise<boolean> {
    for (const [tenantId, rules] of this.alertRules.entries()) {
      const ruleIndex = rules.findIndex(r => r.id === ruleId);
      if (ruleIndex !== -1) {
        const deletedRule = rules.splice(ruleIndex, 1)[0];
        this.alertRules.set(tenantId, rules);
        this.emit('alert_rule_deleted', deletedRule);
        return true;
      }
    }
    return false;
  }

  private async collectMetrics(tenantId: string): Promise<MonitoringMetrics> {
    // Collect workflow metrics
    const activeExecutions = await this.prisma.workflowExecution.count({
      where: { tenantId, status: 'running' }
    });

    const queuedExecutions = await this.prisma.workflowExecution.count({
      where: { tenantId, status: 'waiting' }
    });

    const recentExecutions = await this.prisma.workflowExecution.findMany({
      where: {
        tenantId,
        startTime: { gte: new Date(Date.now() - 60 * 60 * 1000) } // Last hour
      }
    });

    const failedExecutions = recentExecutions.filter(e => e.status === 'failed').length;
    const completedExecutions = recentExecutions.filter(e => e.status === 'completed');
    
    const avgExecutionTime = completedExecutions.length > 0 ?
      completedExecutions.reduce((sum, e) => {
        const time = e.endTime ? 
          (new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 1000 : 0;
        return sum + time;
      }, 0) / completedExecutions.length : 0;

    const successRate = recentExecutions.length > 0 ? 
      completedExecutions.length / recentExecutions.length : 1;

    // Simulate system metrics (in production, these would come from system monitoring)
    const systemMetrics = {
      cpuUsage: Math.random() * 100,
      memoryUsage: Math.random() * 100,
      diskUsage: Math.random() * 100,
      networkUsage: Math.random() * 100
    };

    // Calculate business metrics
    const costPerHour = recentExecutions.length * 0.05; // $0.05 per execution
    const savingsPerHour = recentExecutions.length * 12.5; // $12.5 savings per execution
    const userActivity = await this.getUserActivity(tenantId);
    const apiCalls = await this.getApiCallCount(tenantId);

    return {
      tenantId,
      timestamp: new Date(),
      workflowMetrics: {
        activeExecutions,
        queuedExecutions,
        failedExecutions,
        avgExecutionTime,
        successRate
      },
      systemMetrics,
      businessMetrics: {
        costPerHour,
        savingsPerHour,
        userActivity,
        apiCalls
      }
    };
  }

  private async getUserActivity(tenantId: string): Promise<number> {
    return await this.prisma.user.count({
      where: {
        tenantId,
        lastActiveAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }
      }
    });
  }

  private async getApiCallCount(tenantId: string): Promise<number> {
    // Simulate API call count
    return Math.floor(Math.random() * 1000);
  }

  private async evaluateAlertRules(metrics: MonitoringMetrics): Promise<void> {
    const tenantRules = this.alertRules.get(metrics.tenantId) || [];
    
    for (const rule of tenantRules) {
      if (!rule.enabled) continue;

      // Check cooldown period
      if (rule.lastTriggered && rule.cooldownPeriod > 0) {
        const timeSinceLastTrigger = Date.now() - rule.lastTriggered.getTime();
        if (timeSinceLastTrigger < rule.cooldownPeriod * 60 * 1000) {
          continue;
        }
      }

      const shouldTrigger = await this.evaluateRule(rule, metrics);
      
      if (shouldTrigger) {
        await this.triggerAlert(rule, metrics);
      }
    }
  }

  private async evaluateRule(rule: AlertRule, metrics: MonitoringMetrics): Promise<boolean> {
    const metricValue = this.getMetricValue(rule.metric, metrics);
    
    if (metricValue === undefined) return false;

    switch (rule.type) {
      case 'threshold':
        return this.evaluateThresholdRule(rule, metricValue);
      case 'anomaly':
        return await this.evaluateAnomalyRule(rule, metricValue, metrics.tenantId);
      case 'pattern':
        return await this.evaluatePatternRule(rule, metricValue, metrics.tenantId);
      case 'composite':
        return await this.evaluateCompositeRule(rule, metrics);
      default:
        return false;
    }
  }

  private evaluateThresholdRule(rule: AlertRule, value: number): boolean {
    const { operator, threshold } = rule.condition;
    
    switch (operator) {
      case '>': return value > (threshold || 0);
      case '<': return value < (threshold || 0);
      case '=': return value === (threshold || 0);
      case '!=': return value !== (threshold || 0);
      default: return false;
    }
  }

  private async evaluateAnomalyRule(rule: AlertRule, value: number, tenantId: string): Promise<boolean> {
    const detector = this.anomalyDetectors.get(`${tenantId}_${rule.metric}`);
    if (!detector) return false;

    // Simple anomaly detection using standard deviation
    const isAnomaly = Math.abs(value - detector.mean) > 2 * detector.stdDev;
    
    // Update detector with new value
    detector.values.push(value);
    if (detector.values.length > 100) {
      detector.values.shift();
    }
    
    detector.mean = detector.values.reduce((sum, v) => sum + v, 0) / detector.values.length;
    const variance = detector.values.reduce((sum, v) => sum + Math.pow(v - detector.mean, 2), 0) / detector.values.length;
    detector.stdDev = Math.sqrt(variance);

    return isAnomaly;
  }

  private async evaluatePatternRule(rule: AlertRule, value: number, tenantId: string): Promise<boolean> {
    const buffer = this.metricsBuffer.get(tenantId) || [];
    if (buffer.length < 5) return false; // Need at least 5 data points

    // Check for patterns like consecutive increases/decreases
    const recentValues = buffer.slice(-5).map(m => this.getMetricValue(rule.metric, m));
    
    // Example: Check for 5 consecutive increases
    let consecutiveIncreases = 0;
    for (let i = 1; i < recentValues.length; i++) {
      if (recentValues[i] > recentValues[i - 1]) {
        consecutiveIncreases++;
      } else {
        break;
      }
    }

    return consecutiveIncreases >= 4; // 4 increases = 5 consecutive increasing values
  }

  private async evaluateCompositeRule(rule: AlertRule, metrics: MonitoringMetrics): Promise<boolean> {
    // Composite rules can combine multiple conditions
    // For simplicity, we'll check if multiple metrics exceed thresholds
    const conditions = rule.condition.value as Array<{
      metric: string;
      operator: string;
      threshold: number;
    }>;

    let triggeredConditions = 0;
    for (const condition of conditions) {
      const value = this.getMetricValue(condition.metric, metrics);
      if (value !== undefined) {
        const conditionMet = this.evaluateThresholdRule({
          ...rule,
          condition: { operator: condition.operator as any, threshold: condition.threshold }
        } as AlertRule, value);
        
        if (conditionMet) triggeredConditions++;
      }
    }

    // Trigger if more than half of conditions are met
    return triggeredConditions > conditions.length / 2;
  }

  private getMetricValue(metric: string, metrics: MonitoringMetrics): number | undefined {
    const parts = metric.split('.');
    let value: any = metrics;
    
    for (const part of parts) {
      value = value?.[part];
    }
    
    return typeof value === 'number' ? value : undefined;
  }

  private async triggerAlert(rule: AlertRule, metrics: MonitoringMetrics): Promise<void> {
    const alert: Alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ruleId: rule.id,
      tenantId: rule.tenantId,
      severity: rule.severity,
      title: rule.name,
      description: rule.description,
      metric: rule.metric,
      currentValue: this.getMetricValue(rule.metric, metrics),
      threshold: rule.condition.threshold || rule.condition.value,
      timestamp: new Date(),
      status: 'active',
      metadata: {
        rule: rule.name,
        tenant: rule.tenantId,
        metricPath: rule.metric
      }
    };

    // Add to active alerts
    const tenantAlerts = this.activeAlerts.get(rule.tenantId) || [];
    tenantAlerts.push(alert);
    this.activeAlerts.set(rule.tenantId, tenantAlerts);

    // Update rule last triggered time
    rule.lastTriggered = new Date();

    // Execute alert actions
    await this.executeAlertActions(alert, rule.actions);

    // Broadcast alert via WebSocket
    this.broadcastAlert(alert);

    // Emit alert triggered event
    this.emit('alert_triggered', alert);

    console.log(`Alert triggered: ${alert.title} for tenant ${alert.tenantId}`);
  }

  private async executeAlertActions(alert: Alert, actions: AlertAction[]): Promise<void> {
    for (const action of actions) {
      if (!action.enabled) continue;

      try {
        switch (action.type) {
          case 'email':
            await this.sendEmailAlert(alert, action.config);
            break;
          case 'webhook':
            await this.sendWebhookAlert(alert, action.config);
            break;
          case 'slack':
            await this.sendSlackAlert(alert, action.config);
            break;
          case 'auto_scale':
            await this.executeAutoScale(alert, action.config);
            break;
          case 'workflow_pause':
            await this.pauseWorkflows(alert, action.config);
            break;
        }
      } catch (error) {
        console.error(`Error executing alert action ${action.type}:`, error);
      }
    }
  }

  private async sendEmailAlert(alert: Alert, config: any): Promise<void> {
    console.log(`Sending email alert: ${alert.title} to ${config.recipients}`);
    // In production, integrate with email service
  }

  private async sendWebhookAlert(alert: Alert, config: any): Promise<void> {
    console.log(`Sending webhook alert to ${config.url}`);
    // In production, make HTTP request to webhook URL
  }

  private async sendSlackAlert(alert: Alert, config: any): Promise<void> {
    console.log(`Sending Slack alert to ${config.channel}`);
    // In production, integrate with Slack API
  }

  private async executeAutoScale(alert: Alert, config: any): Promise<void> {
    console.log(`Executing auto-scale action for alert: ${alert.title}`);
    // In production, trigger scaling operations
    this.emit('auto_scale_triggered', { alert, config });
  }

  private async pauseWorkflows(alert: Alert, config: any): Promise<void> {
    console.log(`Pausing workflows for alert: ${alert.title}`);
    // In production, pause specified workflows
    this.emit('workflows_paused', { alert, config });
  }

  private broadcastAlert(alert: Alert): void {
    const message = JSON.stringify({
      type: 'alert',
      data: alert
    });

    this.wsServer.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  async acknowledgeAlert(alertId: string, userId: string): Promise<boolean> {
    for (const [tenantId, alerts] of this.activeAlerts.entries()) {
      const alert = alerts.find(a => a.id === alertId);
      if (alert && alert.status === 'active') {
        alert.status = 'acknowledged';
        alert.acknowledgedBy = userId;
        alert.acknowledgedAt = new Date();
        
        this.broadcastAlert(alert);
        this.emit('alert_acknowledged', alert);
        return true;
      }
    }
    return false;
  }

  async resolveAlert(alertId: string, userId: string): Promise<boolean> {
    for (const [tenantId, alerts] of this.activeAlerts.entries()) {
      const alertIndex = alerts.findIndex(a => a.id === alertId);
      if (alertIndex !== -1) {
        const alert = alerts[alertIndex];
        alert.status = 'resolved';
        alert.resolvedAt = new Date();
        
        // Remove from active alerts
        alerts.splice(alertIndex, 1);
        this.activeAlerts.set(tenantId, alerts);
        
        this.broadcastAlert(alert);
        this.emit('alert_resolved', alert);
        return true;
      }
    }
    return false;
  }

  private async loadAlertRules(): Promise<void> {
    // In production, load from database
    // For now, create some default rules
    const defaultRules: Omit<AlertRule, 'id'>[] = [
      {
        tenantId: 'default',
        name: 'High CPU Usage',
        description: 'CPU usage exceeds 80%',
        type: 'threshold',
        metric: 'systemMetrics.cpuUsage',
        condition: { operator: '>', threshold: 80 },
        severity: 'high',
        enabled: true,
        actions: [
          { type: 'email', config: { recipients: ['admin@example.com'] }, enabled: true }
        ],
        cooldownPeriod: 15
      },
      {
        tenantId: 'default',
        name: 'Low Success Rate',
        description: 'Workflow success rate below 90%',
        type: 'threshold',
        metric: 'workflowMetrics.successRate',
        condition: { operator: '<', threshold: 0.9 },
        severity: 'medium',
        enabled: true,
        actions: [
          { type: 'webhook', config: { url: 'https://example.com/webhook' }, enabled: true }
        ],
        cooldownPeriod: 30
      }
    ];

    for (const rule of defaultRules) {
      await this.createAlertRule(rule);
    }
  }

  private initializeAnomalyDetection(): void {
    // Initialize anomaly detectors for common metrics
    const metrics = [
      'workflowMetrics.avgExecutionTime',
      'workflowMetrics.successRate',
      'systemMetrics.cpuUsage',
      'systemMetrics.memoryUsage'
    ];

    for (const metric of metrics) {
      this.anomalyDetectors.set(`default_${metric}`, {
        values: [],
        mean: 0,
        stdDev: 1
      });
    }
  }

  private startMetricsCollection(): void {
    // Collect metrics every minute
    setInterval(async () => {
      await this.collectAllMetrics();
    }, 60 * 1000);
  }

  private startAlertProcessing(): void {
    // Process alerts every 30 seconds
    setInterval(async () => {
      await this.processAlerts();
    }, 30 * 1000);
  }

  private async collectAllMetrics(): Promise<void> {
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true }
      });

      for (const tenant of tenants) {
        try {
          const metrics = await this.collectMetrics(tenant.id);
          
          // Add to buffer
          const buffer = this.metricsBuffer.get(tenant.id) || [];
          buffer.push(metrics);
          
          // Keep only last 100 metrics
          if (buffer.length > 100) {
            buffer.shift();
          }
          
          this.metricsBuffer.set(tenant.id, buffer);
          
          // Broadcast metrics
          this.broadcastMetrics(metrics);
          
        } catch (error) {
          console.error(`Error collecting metrics for tenant ${tenant.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error in metrics collection:', error);
    }
  }

  private async processAlerts(): Promise<void> {
    try {
      for (const [tenantId, buffer] of this.metricsBuffer.entries()) {
        if (buffer.length > 0) {
          const latestMetrics = buffer[buffer.length - 1];
          await this.evaluateAlertRules(latestMetrics);
        }
      }
    } catch (error) {
      console.error('Error processing alerts:', error);
    }
  }

  private broadcastMetrics(metrics: MonitoringMetrics): void {
    const message = JSON.stringify({
      type: 'metrics',
      data: metrics
    });

    this.wsServer.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  // Public API methods
  async getActiveAlerts(tenantId: string): Promise<Alert[]> {
    return this.activeAlerts.get(tenantId) || [];
  }

  async getAlertRules(tenantId: string): Promise<AlertRule[]> {
    return this.alertRules.get(tenantId) || [];
  }

  async getMetricsHistory(tenantId: string, hours: number = 24): Promise<MonitoringMetrics[]> {
    const buffer = this.metricsBuffer.get(tenantId) || [];
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return buffer.filter(m => m.timestamp >= cutoff);
  }

  async getAlertStatistics(tenantId: string): Promise<{
    totalAlerts: number;
    activeAlerts: number;
    alertsByseverity: Record<string, number>;
    alertsByType: Record<string, number>;
  }> {
    const alerts = this.activeAlerts.get(tenantId) || [];
    const alertsByType = this.alertRules.get(tenantId)?.reduce((acc, rule) => {
      acc[rule.type] = (acc[rule.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};

    return {
      totalAlerts: alerts.length,
      activeAlerts: alerts.filter(a => a.status === 'active').length,
      alertsBySeverity: alerts.reduce((acc, alert) => {
        acc[alert.severity] = (acc[alert.severity] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      alertsByType
    };
  }

  async cleanup(): Promise<void> {
    this.wsServer.close();
    this.alertRules.clear();
    this.activeAlerts.clear();
    this.metricsBuffer.clear();
    this.anomalyDetectors.clear();
    await this.prisma.$disconnect();
  }
}
