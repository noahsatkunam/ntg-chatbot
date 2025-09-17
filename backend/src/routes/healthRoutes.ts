import { Router } from 'express';
import { HealthCheckService } from '../utils/healthCheck';
import { asyncHandler } from '../utils/errorHandler';
import { authenticate } from '../middleware/auth';

const router = Router();
const healthCheckService = new HealthCheckService();

// Public health check endpoint (basic)
router.get('/health', asyncHandler(async (req, res) => {
  const health = await healthCheckService.checkSystemHealth();
  
  res.status(health.status === 'healthy' ? 200 : 503).json({
    success: health.status !== 'unhealthy',
    status: health.status,
    timestamp: health.timestamp,
    services: health.services.map(service => ({
      service: service.service,
      status: service.status,
      responseTime: service.responseTime
    })),
    summary: health.summary
  });
}));

// Detailed health check (requires authentication)
router.get('/health/detailed', authenticate, asyncHandler(async (req, res) => {
  const detailedInfo = await healthCheckService.getDetailedSystemInfo();
  
  res.json({
    success: true,
    ...detailedInfo
  });
}));

// Individual service health check
router.get('/health/:service', authenticate, asyncHandler(async (req, res) => {
  const { service } = req.params;
  const result = await healthCheckService.checkServiceHealth(service);
  
  res.status(result.status === 'healthy' ? 200 : 503).json({
    success: result.status !== 'unhealthy',
    service: result.service,
    status: result.status,
    responseTime: result.responseTime,
    details: result.details,
    error: result.error
  });
}));

// Readiness probe (for Kubernetes/Docker)
router.get('/ready', asyncHandler(async (req, res) => {
  const criticalServices = ['database', 'encryption'];
  const checks = await Promise.all(
    criticalServices.map(service => healthCheckService.checkServiceHealth(service))
  );
  
  const allHealthy = checks.every(check => check.status === 'healthy');
  
  res.status(allHealthy ? 200 : 503).json({
    ready: allHealthy,
    services: checks.map(check => ({
      service: check.service,
      status: check.status
    }))
  });
}));

// Liveness probe (for Kubernetes/Docker)
router.get('/live', asyncHandler(async (req, res) => {
  // Basic liveness check - just ensure the application is running
  res.json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
}));

export default router;
