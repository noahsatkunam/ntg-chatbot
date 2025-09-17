import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { EventEmitter } from 'events';

interface SecurityValidationResult {
  isValid: boolean;
  violations: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
}

interface SecurityPolicy {
  id: string;
  name: string;
  description: string;
  rules: SecurityRule[];
  isActive: boolean;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

interface SecurityRule {
  id: string;
  type: 'rate_limit' | 'data_validation' | 'permission_check' | 'encryption' | 'audit_log';
  condition: any;
  action: 'allow' | 'deny' | 'log' | 'alert';
  parameters: Record<string, any>;
}

interface AuditEvent {
  id: string;
  tenantId: string;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export class IntegrationSecurity extends EventEmitter {
  private prisma: PrismaClient;
  private encryptionKey: string;
  private securityPolicies: Map<string, SecurityPolicy> = new Map();
  private rateLimitCache: Map<string, { count: number; resetTime: number }> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
    this.loadSecurityPolicies();
  }

  // Security Policy Management
  private async loadSecurityPolicies(): Promise<void> {
    const defaultPolicies: SecurityPolicy[] = [
      {
        id: 'api_rate_limit',
        name: 'API Rate Limiting',
        description: 'Enforce rate limits on API requests',
        rules: [
          {
            id: 'general_rate_limit',
            type: 'rate_limit',
            condition: { endpoint: '*' },
            action: 'deny',
            parameters: { maxRequests: 100, windowMs: 60000 }
          }
        ],
        isActive: true,
        severity: 'warning'
      },
      {
        id: 'sensitive_data_protection',
        name: 'Sensitive Data Protection',
        description: 'Protect sensitive data in API requests and responses',
        rules: [
          {
            id: 'encrypt_credentials',
            type: 'encryption',
            condition: { dataType: 'credentials' },
            action: 'allow',
            parameters: { algorithm: 'aes-256-gcm' }
          }
        ],
        isActive: true,
        severity: 'critical'
      },
      {
        id: 'tenant_isolation',
        name: 'Tenant Data Isolation',
        description: 'Ensure tenant data isolation in all operations',
        rules: [
          {
            id: 'validate_tenant_access',
            type: 'permission_check',
            condition: { operation: '*' },
            action: 'deny',
            parameters: { requireTenantId: true }
          }
        ],
        isActive: true,
        severity: 'critical'
      }
    ];

    defaultPolicies.forEach(policy => {
      this.securityPolicies.set(policy.id, policy);
    });
  }

  // Validation Methods
  async validateApiRequest(
    tenantId: string,
    userId: string,
    endpoint: string,
    method: string,
    data: any,
    ipAddress?: string
  ): Promise<SecurityValidationResult> {
    const violations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    const recommendations: string[] = [];

    try {
      // Rate limiting validation
      const rateLimitResult = await this.validateRateLimit(tenantId, userId, endpoint, ipAddress);
      if (!rateLimitResult.isValid) {
        violations.push(...rateLimitResult.violations);
        riskLevel = this.escalateRiskLevel(riskLevel, 'medium');
      }

      // Data validation
      const dataValidationResult = await this.validateRequestData(data, endpoint, method);
      if (!dataValidationResult.isValid) {
        violations.push(...dataValidationResult.violations);
        riskLevel = this.escalateRiskLevel(riskLevel, dataValidationResult.riskLevel);
      }

      // Permission validation
      const permissionResult = await this.validatePermissions(tenantId, userId, endpoint, method);
      if (!permissionResult.isValid) {
        violations.push(...permissionResult.violations);
        riskLevel = this.escalateRiskLevel(riskLevel, 'high');
      }

      // Suspicious activity detection
      const suspiciousActivityResult = await this.detectSuspiciousActivity(
        tenantId,
        userId,
        endpoint,
        ipAddress
      );
      if (!suspiciousActivityResult.isValid) {
        violations.push(...suspiciousActivityResult.violations);
        riskLevel = this.escalateRiskLevel(riskLevel, suspiciousActivityResult.riskLevel);
      }

      // Generate recommendations
      if (violations.length > 0) {
        recommendations.push('Review and address security violations');
        if (riskLevel === 'critical' || riskLevel === 'high') {
          recommendations.push('Consider blocking or limiting access');
        }
      }

      return {
        isValid: violations.length === 0,
        violations,
        riskLevel,
        recommendations
      };

    } catch (error) {
      console.error('Error validating API request:', error);
      return {
        isValid: false,
        violations: ['Security validation failed'],
        riskLevel: 'critical',
        recommendations: ['Contact system administrator']
      };
    }
  }

  private async validateRateLimit(
    tenantId: string,
    userId: string,
    endpoint: string,
    ipAddress?: string
  ): Promise<SecurityValidationResult> {
    const violations: string[] = [];
    const key = `${tenantId}:${userId}:${endpoint}`;
    const now = Date.now();

    const cached = this.rateLimitCache.get(key);
    if (cached) {
      if (now < cached.resetTime) {
        if (cached.count >= 100) { // Default rate limit
          violations.push(`Rate limit exceeded for ${endpoint}`);
        } else {
          cached.count++;
        }
      } else {
        // Reset window
        this.rateLimitCache.set(key, { count: 1, resetTime: now + 60000 });
      }
    } else {
      this.rateLimitCache.set(key, { count: 1, resetTime: now + 60000 });
    }

    return {
      isValid: violations.length === 0,
      violations,
      riskLevel: 'medium',
      recommendations: violations.length > 0 ? ['Reduce request frequency'] : []
    };
  }

  private async validateRequestData(
    data: any,
    endpoint: string,
    method: string
  ): Promise<SecurityValidationResult> {
    const violations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

    if (!data) {
      return { isValid: true, violations: [], riskLevel: 'low', recommendations: [] };
    }

    // Check for SQL injection patterns
    const sqlInjectionPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b)/i,
      /(UNION\s+SELECT)/i,
      /(\'\s*OR\s*\'\d*\'\s*=\s*\'\d*)/i
    ];

    const dataString = JSON.stringify(data);
    for (const pattern of sqlInjectionPatterns) {
      if (pattern.test(dataString)) {
        violations.push('Potential SQL injection detected');
        riskLevel = 'critical';
        break;
      }
    }

    // Check for XSS patterns
    const xssPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/i,
      /on\w+\s*=/i
    ];

    for (const pattern of xssPatterns) {
      if (pattern.test(dataString)) {
        violations.push('Potential XSS attack detected');
        riskLevel = this.escalateRiskLevel(riskLevel, 'high');
        break;
      }
    }

    // Check for sensitive data exposure
    const sensitivePatterns = [
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN
      /password\s*[:=]\s*[^\s,}]+/i,
      /api[_-]?key\s*[:=]\s*[^\s,}]+/i
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(dataString)) {
        violations.push('Sensitive data detected in request');
        riskLevel = this.escalateRiskLevel(riskLevel, 'high');
        break;
      }
    }

    return {
      isValid: violations.length === 0,
      violations,
      riskLevel,
      recommendations: violations.length > 0 ? ['Sanitize input data', 'Use proper data validation'] : []
    };
  }

  private async validatePermissions(
    tenantId: string,
    userId: string,
    endpoint: string,
    method: string
  ): Promise<SecurityValidationResult> {
    const violations: string[] = [];

    try {
      // Check if user belongs to tenant
      const user = await this.prisma.user.findFirst({
        where: { id: userId, tenantId }
      });

      if (!user) {
        violations.push('User does not belong to specified tenant');
      }

      // Check user permissions based on role
      if (user && this.isAdminOnlyEndpoint(endpoint) && user.role !== 'TENANT_ADMIN') {
        violations.push('Insufficient permissions for admin endpoint');
      }

      return {
        isValid: violations.length === 0,
        violations,
        riskLevel: violations.length > 0 ? 'high' : 'low',
        recommendations: violations.length > 0 ? ['Verify user permissions'] : []
      };

    } catch (error) {
      return {
        isValid: false,
        violations: ['Permission validation failed'],
        riskLevel: 'critical',
        recommendations: ['Contact system administrator']
      };
    }
  }

  private async detectSuspiciousActivity(
    tenantId: string,
    userId: string,
    endpoint: string,
    ipAddress?: string
  ): Promise<SecurityValidationResult> {
    const violations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

    try {
      // Check for unusual request patterns
      const recentRequests = await this.prisma.apiRequestLog.count({
        where: {
          tenantId,
          userId,
          createdAt: {
            gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
          }
        }
      });

      if (recentRequests > 50) {
        violations.push('Unusual high request frequency detected');
        riskLevel = 'medium';
      }

      // Check for failed requests
      const failedRequests = await this.prisma.apiRequestLog.count({
        where: {
          tenantId,
          userId,
          statusCode: { gte: 400 },
          createdAt: {
            gte: new Date(Date.now() - 10 * 60 * 1000) // Last 10 minutes
          }
        }
      });

      if (failedRequests > 10) {
        violations.push('High number of failed requests detected');
        riskLevel = this.escalateRiskLevel(riskLevel, 'medium');
      }

      return {
        isValid: violations.length === 0,
        violations,
        riskLevel,
        recommendations: violations.length > 0 ? ['Monitor user activity', 'Consider rate limiting'] : []
      };

    } catch (error) {
      return {
        isValid: true, // Don't block on detection errors
        violations: [],
        riskLevel: 'low',
        recommendations: []
      };
    }
  }

  // Encryption Methods
  encrypt(data: string): string {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher('aes-256-gcm', this.encryptionKey);
      cipher.setAAD(Buffer.from('integration-security'));
      
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  decrypt(encryptedData: string): string {
    try {
      const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
      
      if (!ivHex || !authTagHex || !encrypted) {
        throw new Error('Invalid encrypted data format');
      }
      
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      const decipher = crypto.createDecipher('aes-256-gcm', this.encryptionKey);
      decipher.setAAD(Buffer.from('integration-security'));
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  // Audit Logging
  async logAuditEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
    try {
      const auditEvent: AuditEvent = {
        ...event,
        id: crypto.randomUUID(),
        timestamp: new Date()
      };

      // Store in database (assuming we have an audit_logs table)
      // await this.prisma.auditLog.create({ data: auditEvent });

      // Emit event for real-time monitoring
      this.emit('audit_event', auditEvent);

      // Log to console for development
      console.log('Audit Event:', {
        action: auditEvent.action,
        resource: auditEvent.resource,
        tenantId: auditEvent.tenantId,
        userId: auditEvent.userId,
        riskLevel: auditEvent.riskLevel,
        timestamp: auditEvent.timestamp
      });

    } catch (error) {
      console.error('Failed to log audit event:', error);
    }
  }

  // Monitoring and Alerting
  async generateSecurityReport(tenantId: string, days: number = 7): Promise<any> {
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const apiRequests = await this.prisma.apiRequestLog.groupBy({
        by: ['statusCode'],
        where: {
          tenantId,
          createdAt: { gte: since }
        },
        _count: { id: true }
      });

      const failedRequests = apiRequests
        .filter(req => req.statusCode >= 400)
        .reduce((sum, req) => sum + req._count.id, 0);

      const totalRequests = apiRequests
        .reduce((sum, req) => sum + req._count.id, 0);

      const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;

      return {
        tenantId,
        period: { days, since },
        metrics: {
          totalRequests,
          failedRequests,
          errorRate: Math.round(errorRate * 100) / 100,
          successRate: Math.round((100 - errorRate) * 100) / 100
        },
        requestsByStatus: apiRequests.reduce((acc, req) => {
          acc[req.statusCode] = req._count.id;
          return acc;
        }, {} as Record<number, number>),
        recommendations: this.generateSecurityRecommendations(errorRate, failedRequests)
      };

    } catch (error) {
      console.error('Error generating security report:', error);
      throw new Error('Failed to generate security report');
    }
  }

  private generateSecurityRecommendations(errorRate: number, failedRequests: number): string[] {
    const recommendations: string[] = [];

    if (errorRate > 10) {
      recommendations.push('High error rate detected - review API usage patterns');
    }

    if (failedRequests > 100) {
      recommendations.push('High number of failed requests - consider implementing stricter rate limiting');
    }

    if (errorRate > 25) {
      recommendations.push('Critical error rate - immediate investigation required');
    }

    return recommendations;
  }

  // Utility Methods
  private escalateRiskLevel(
    current: 'low' | 'medium' | 'high' | 'critical',
    new_level: 'low' | 'medium' | 'high' | 'critical'
  ): 'low' | 'medium' | 'high' | 'critical' {
    const levels = { low: 1, medium: 2, high: 3, critical: 4 };
    return levels[new_level] > levels[current] ? new_level : current;
  }

  private isAdminOnlyEndpoint(endpoint: string): boolean {
    const adminEndpoints = [
      '/api/oauth2/providers',
      '/api/connections',
      '/integrations/stats'
    ];
    
    return adminEndpoints.some(adminEndpoint => endpoint.includes(adminEndpoint));
  }

  // Cleanup
  async cleanup(): Promise<void> {
    // Clear rate limit cache
    this.rateLimitCache.clear();
    
    // Close database connection
    await this.prisma.$disconnect();
  }
}
