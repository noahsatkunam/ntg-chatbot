// Main workflow module exports
export { WorkflowService } from './workflowService';
export { WorkflowManager } from './workflowManager';
export { ExecutionMonitor } from './executionMonitor';
export { TemplateManager } from './templateManager';
export { N8nClient } from './n8nClient';

// Chat integration
export { ChatIntegration } from './chatIntegration';
export { ResponseHandler } from './responseHandler';

// Security and isolation
export { TenantIsolationService } from './security/tenantIsolation';
export { WorkflowSecurityService } from './security/workflowSecurity';

// Resource management
export { ResourceManager } from './resourceManager';

// Analytics
export { WorkflowAnalyticsService } from './analytics/workflowAnalytics';

// Deployment
export { DeploymentManager } from './deployment/deploymentManager';

// External integrations
export { ExternalApiConnector } from './integrations/externalApiConnector';

// Routes
export { workflowRoutes } from './routes/workflowRoutes';
export { executionRoutes } from './routes/executionRoutes';
export { templateRoutes } from './routes/templateRoutes';
export { webhookRoutes } from './routes/webhookRoutes';

// Types
export type { 
  WorkflowExecutionContext,
  WorkflowDeploymentOptions 
} from './workflowService';

export type { 
  TenantContext,
  WorkflowSecurityConfig 
} from './security/tenantIsolation';

export type { 
  ResourceLimits,
  ResourceUsage,
  TenantResourceQuota 
} from './resourceManager';

export type { 
  WorkflowMetrics,
  ExecutionTrend,
  WorkflowPerformance 
} from './analytics/workflowAnalytics';

export type { 
  DeploymentConfig,
  DeploymentResult,
  RollbackOptions 
} from './deployment/deploymentManager';

export type { 
  ApiConnectorConfig,
  ApiRequest,
  ApiResponse 
} from './integrations/externalApiConnector';
