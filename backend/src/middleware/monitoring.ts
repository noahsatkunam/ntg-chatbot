import { Request, Response, NextFunction } from 'express';
import { logger, logPerformance } from './logging';

// Prometheus metrics (if using prometheus)
interface Metrics {
  httpRequestsTotal: any;
  httpRequestDuration: any;
  activeConnections: any;
  databaseQueries: any;
}

let metrics: Metrics | null = null;

// Initialize metrics if prometheus is available
try {
  const client = require('prom-client');
  
  // Create a Registry to register the metrics
  const register = new client.Registry();
  
  // Add default metrics
  client.collectDefaultMetrics({ register });
  
  metrics = {
    httpRequestsTotal: new client.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [register]
    }),
    
    httpRequestDuration: new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.5, 1, 2, 5],
      registers: [register]
    }),
    
    activeConnections: new client.Gauge({
      name: 'active_connections',
      help: 'Number of active connections',
      registers: [register]
    }),
    
    databaseQueries: new client.Histogram({
      name: 'database_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['operation'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1],
      registers: [register]
    })
  };
  
  // Export register for /metrics endpoint
  (global as any).metricsRegister = register;
} catch (error) {
  logger.warn('Prometheus metrics not available', { error: error instanceof Error ? error.message : 'Unknown error' });
}

// Performance monitoring middleware
export const performanceMonitoring = (req: Request, res: Response, next: NextFunction) => {
  const startTime = process.hrtime.bigint();

  // Track active connections
  if (metrics?.activeConnections) {
    metrics.activeConnections.inc();
  }

  // Override res.end to capture metrics
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any) {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    const durationSeconds = duration / 1000;

    // Log performance
    logPerformance('http_request', duration, {
      method: req.method,
      route: req.route?.path || req.path,
      statusCode: res.statusCode,
      userAgent: req.get('User-Agent'),
      contentLength: res.get('Content-Length')
    });

    // Update Prometheus metrics
    if (metrics) {
      const labels = {
        method: req.method,
        route: req.route?.path || req.path,
        status_code: res.statusCode.toString()
      };

      metrics.httpRequestsTotal.inc(labels);
      metrics.httpRequestDuration.observe(labels, durationSeconds);
      metrics.activeConnections.dec();
    }

    // Call original end
    return originalEnd.call(this, chunk, encoding);
  };

  next();
};

// Database query monitoring
export const monitorDatabaseQuery = async <T>(
  operation: string,
  queryFn: () => Promise<T>
): Promise<T> => {
  const startTime = process.hrtime.bigint();
  
  try {
    const result = await queryFn();
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    const durationSeconds = duration / 1000;

    // Log database performance
    logPerformance('database_query', duration, { operation });

    // Update Prometheus metrics
    if (metrics?.databaseQueries) {
      metrics.databaseQueries.observe({ operation }, durationSeconds);
    }

    return result;
  } catch (error) {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000;

    logPerformance('database_query_error', duration, { 
      operation, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });

    throw error;
  }
};

// Memory usage monitoring
export const logMemoryUsage = () => {
  const usage = process.memoryUsage();
  
  logger.info('Memory usage', {
    rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100, // MB
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100, // MB
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100, // MB
    external: Math.round(usage.external / 1024 / 1024 * 100) / 100, // MB
    arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024 * 100) / 100 // MB
  });
};

// Start memory monitoring
export const startMemoryMonitoring = (intervalMs: number = 60000) => {
  setInterval(logMemoryUsage, intervalMs);
};

// Health check metrics
export const getHealthMetrics = () => {
  const usage = process.memoryUsage();
  
  return {
    uptime: process.uptime(),
    memory: {
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers
    },
    cpu: process.cpuUsage(),
    version: process.version,
    pid: process.pid
  };
};

export default performanceMonitoring;
