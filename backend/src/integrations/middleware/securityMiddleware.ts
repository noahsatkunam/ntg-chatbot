import { Request, Response, NextFunction } from 'express';
import { IntegrationSecurity } from '../security/integrationSecurity';
import { IntegrationMonitor } from '../monitoring/integrationMonitor';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
  tenantId?: string;
}

export class SecurityMiddleware {
  private security: IntegrationSecurity;
  private monitor: IntegrationMonitor;

  constructor() {
    this.security = new IntegrationSecurity();
    this.monitor = new IntegrationMonitor();
  }

  // Main security validation middleware
  validateRequest = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const startTime = Date.now();
      
      // Extract request information
      const tenantId = req.user?.tenantId || req.body.tenantId || req.query.tenantId as string;
      const userId = req.user?.id || req.body.userId;
      const endpoint = req.path;
      const method = req.method;
      const ipAddress = req.ip || req.connection.remoteAddress;

      if (!tenantId || !userId) {
        return res.status(400).json({ 
          error: 'Missing required authentication information',
          code: 'MISSING_AUTH'
        });
      }

      // Perform security validation
      const validationResult = await this.security.validateApiRequest(
        tenantId,
        userId,
        endpoint,
        method,
        req.body,
        ipAddress
      );

      // Log audit event
      await this.security.logAuditEvent({
        tenantId,
        userId,
        action: `${method} ${endpoint}`,
        resource: 'api_request',
        details: {
          endpoint,
          method,
          ipAddress,
          userAgent: req.get('User-Agent'),
          validationResult
        },
        ipAddress,
        userAgent: req.get('User-Agent'),
        riskLevel: validationResult.riskLevel
      });

      // Handle validation failures
      if (!validationResult.isValid) {
        const statusCode = this.getStatusCodeForViolations(validationResult.violations);
        
        return res.status(statusCode).json({
          error: 'Security validation failed',
          violations: validationResult.violations,
          riskLevel: validationResult.riskLevel,
          recommendations: validationResult.recommendations,
          code: 'SECURITY_VIOLATION'
        });
      }

      // Add security context to request
      req.tenantId = tenantId;
      
      // Continue to next middleware
      next();

    } catch (error) {
      console.error('Security middleware error:', error);
      
      // Log critical security error
      if (req.user?.tenantId) {
        await this.security.logAuditEvent({
          tenantId: req.user.tenantId,
          userId: req.user.id,
          action: 'security_middleware_error',
          resource: 'security_system',
          details: { error: error instanceof Error ? error.message : 'Unknown error' },
          riskLevel: 'critical'
        });
      }

      res.status(500).json({
        error: 'Internal security error',
        code: 'SECURITY_ERROR'
      });
    }
  };

  // Rate limiting middleware
  rateLimitMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId || req.body.tenantId || req.query.tenantId as string;
      const userId = req.user?.id || req.body.userId;
      const endpoint = req.path;

      if (!tenantId || !userId) {
        return next();
      }

      // This would integrate with the rate limiting logic in IntegrationSecurity
      // For now, we'll use a simple implementation
      const rateLimitKey = `${tenantId}:${userId}:${endpoint}`;
      
      // Rate limiting is handled in the main validation, so we just continue
      next();

    } catch (error) {
      console.error('Rate limit middleware error:', error);
      next();
    }
  };

  // Tenant isolation middleware
  tenantIsolationMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userTenantId = req.user?.tenantId;
      const requestTenantId = req.body.tenantId || req.query.tenantId || req.params.tenantId;

      // Ensure user can only access their tenant's data
      if (userTenantId && requestTenantId && userTenantId !== requestTenantId) {
        await this.security.logAuditEvent({
          tenantId: userTenantId,
          userId: req.user?.id || 'unknown',
          action: 'tenant_isolation_violation',
          resource: 'tenant_data',
          details: {
            userTenantId,
            requestedTenantId: requestTenantId,
            endpoint: req.path
          },
          riskLevel: 'high'
        });

        return res.status(403).json({
          error: 'Access denied: Tenant isolation violation',
          code: 'TENANT_ISOLATION_VIOLATION'
        });
      }

      next();

    } catch (error) {
      console.error('Tenant isolation middleware error:', error);
      next();
    }
  };

  // Input sanitization middleware
  sanitizeInputMiddleware = (req: Request, res: Response, next: NextFunction) => {
    try {
      // Sanitize request body
      if (req.body && typeof req.body === 'object') {
        req.body = this.sanitizeObject(req.body);
      }

      // Sanitize query parameters
      if (req.query && typeof req.query === 'object') {
        req.query = this.sanitizeObject(req.query);
      }

      next();

    } catch (error) {
      console.error('Input sanitization error:', error);
      res.status(400).json({
        error: 'Invalid input data',
        code: 'INVALID_INPUT'
      });
    }
  };

  // CORS middleware for integration endpoints
  corsMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Set CORS headers for integration endpoints
    res.header('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    next();
  };

  // Request logging middleware
  requestLoggingMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    // Override res.end to capture response details
    const originalEnd = res.end;
    res.end = function(chunk?: any, encoding?: any) {
      const duration = Date.now() - startTime;
      
      // Log request details (async, don't block response)
      setImmediate(async () => {
        try {
          const tenantId = req.user?.tenantId || req.body.tenantId || req.query.tenantId as string;
          const userId = req.user?.id || req.body.userId;

          if (tenantId) {
            // This would typically be stored in the database
            console.log('API Request Log:', {
              tenantId,
              userId,
              method: req.method,
              endpoint: req.path,
              statusCode: res.statusCode,
              duration,
              userAgent: req.get('User-Agent'),
              ipAddress: req.ip
            });
          }
        } catch (error) {
          console.error('Request logging error:', error);
        }
      });

      originalEnd.call(this, chunk, encoding);
    };

    next();
  };

  // Error handling middleware
  errorHandlingMiddleware = async (error: any, req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId || req.body.tenantId;
      const userId = req.user?.id || req.body.userId;

      // Log error
      if (tenantId) {
        await this.security.logAuditEvent({
          tenantId,
          userId: userId || 'unknown',
          action: 'api_error',
          resource: 'api_request',
          details: {
            error: error.message,
            stack: error.stack,
            endpoint: req.path,
            method: req.method
          },
          riskLevel: 'medium'
        });
      }

      // Don't expose internal errors in production
      const isDevelopment = process.env.NODE_ENV === 'development';
      
      res.status(error.status || 500).json({
        error: isDevelopment ? error.message : 'Internal server error',
        code: error.code || 'INTERNAL_ERROR',
        ...(isDevelopment && { stack: error.stack })
      });

    } catch (logError) {
      console.error('Error handling middleware error:', logError);
      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  };

  // Utility methods
  private getStatusCodeForViolations(violations: string[]): number {
    // Determine appropriate HTTP status code based on violations
    if (violations.some(v => v.includes('Rate limit'))) {
      return 429; // Too Many Requests
    }
    if (violations.some(v => v.includes('permission') || v.includes('tenant'))) {
      return 403; // Forbidden
    }
    if (violations.some(v => v.includes('SQL injection') || v.includes('XSS'))) {
      return 400; // Bad Request
    }
    return 400; // Default to Bad Request
  }

  private sanitizeObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return this.sanitizeValue(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const sanitizedKey = this.sanitizeValue(key);
      sanitized[sanitizedKey] = this.sanitizeObject(value);
    }

    return sanitized;
  }

  private sanitizeValue(value: any): any {
    if (typeof value !== 'string') {
      return value;
    }

    // Basic XSS prevention
    return value
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
  }

  // Cleanup
  async cleanup(): Promise<void> {
    await this.security.cleanup();
    await this.monitor.cleanup();
  }
}
