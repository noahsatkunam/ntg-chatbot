import { PrismaClient } from '@prisma/client';
import { TenantIsolationService, TenantContext } from './tenantIsolation';
import crypto from 'crypto';

export interface SecurityValidationResult {
  isValid: boolean;
  violations: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

export interface WorkflowPermissions {
  canRead: boolean;
  canWrite: boolean;
  canExecute: boolean;
  canDelete: boolean;
  canShare: boolean;
}

export class WorkflowSecurityService {
  private prisma: PrismaClient;
  private tenantIsolation: TenantIsolationService;

  constructor() {
    this.prisma = new PrismaClient();
    this.tenantIsolation = new TenantIsolationService();
  }

  // Comprehensive workflow security validation
  async validateWorkflowSecurity(
    definition: any,
    tenantContext: TenantContext
  ): Promise<SecurityValidationResult> {
    const violations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    // Basic tenant isolation check
    const tenantValidation = this.tenantIsolation.validateWorkflowSecurity(
      definition,
      tenantContext.tenantId
    );
    violations.push(...tenantValidation.violations);

    // Check for dangerous operations
    const dangerousOps = this.checkDangerousOperations(definition);
    violations.push(...dangerousOps.violations);
    if (dangerousOps.riskLevel === 'high') riskLevel = 'high';
    else if (dangerousOps.riskLevel === 'medium' && riskLevel === 'low') riskLevel = 'medium';

    // Check for data exposure risks
    const dataExposure = this.checkDataExposureRisks(definition);
    violations.push(...dataExposure.violations);
    if (dataExposure.riskLevel === 'high') riskLevel = 'high';
    else if (dataExposure.riskLevel === 'medium' && riskLevel === 'low') riskLevel = 'medium';

    // Check for resource abuse potential
    const resourceAbuse = this.checkResourceAbuseRisks(definition);
    violations.push(...resourceAbuse.violations);
    if (resourceAbuse.riskLevel === 'high') riskLevel = 'high';
    else if (resourceAbuse.riskLevel === 'medium' && riskLevel === 'low') riskLevel = 'medium';

    // Check for injection vulnerabilities
    const injectionRisks = this.checkInjectionVulnerabilities(definition);
    violations.push(...injectionRisks.violations);
    if (injectionRisks.riskLevel === 'high') riskLevel = 'high';
    else if (injectionRisks.riskLevel === 'medium' && riskLevel === 'low') riskLevel = 'medium';

    return {
      isValid: violations.length === 0,
      violations,
      riskLevel
    };
  }

  // Check for dangerous operations in workflow
  private checkDangerousOperations(definition: any): SecurityValidationResult {
    const violations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    const dangerousNodeTypes = {
      high: [
        'n8n-nodes-base.executeCommand',
        'n8n-nodes-base.ssh',
        'n8n-nodes-base.ftp'
      ],
      medium: [
        'n8n-nodes-base.function',
        'n8n-nodes-base.code',
        'n8n-nodes-base.executeWorkflow'
      ]
    };

    if (definition.nodes) {
      for (const node of definition.nodes) {
        if (dangerousNodeTypes.high.includes(node.type)) {
          violations.push(`High-risk node type detected: ${node.type} in node "${node.name}"`);
          riskLevel = 'high';
        } else if (dangerousNodeTypes.medium.includes(node.type)) {
          violations.push(`Medium-risk node type detected: ${node.type} in node "${node.name}"`);
          if (riskLevel === 'low') riskLevel = 'medium';
        }

        // Check for dangerous parameters
        if (node.parameters) {
          const dangerousParams = this.checkDangerousParameters(node);
          violations.push(...dangerousParams);
          if (dangerousParams.length > 0 && riskLevel === 'low') {
            riskLevel = 'medium';
          }
        }
      }
    }

    return { isValid: violations.length === 0, violations, riskLevel };
  }

  // Check for data exposure risks
  private checkDataExposureRisks(definition: any): SecurityValidationResult {
    const violations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    if (definition.nodes) {
      for (const node of definition.nodes) {
        // Check for external data transmission
        if (node.type === 'n8n-nodes-base.httpRequest') {
          const url = node.parameters?.url;
          if (url && this.isExternalUrl(url)) {
            violations.push(`External data transmission detected in node "${node.name}" to ${url}`);
            riskLevel = 'medium';
          }
        }

        // Check for email/messaging nodes that might leak data
        const dataLeakNodes = [
          'n8n-nodes-base.emailSend',
          'n8n-nodes-base.slack',
          'n8n-nodes-base.discord',
          'n8n-nodes-base.telegram'
        ];

        if (dataLeakNodes.includes(node.type)) {
          violations.push(`Potential data exposure via ${node.type} in node "${node.name}"`);
          if (riskLevel === 'low') riskLevel = 'medium';
        }

        // Check for database operations that might expose sensitive data
        const dbNodes = [
          'n8n-nodes-base.postgres',
          'n8n-nodes-base.mysql',
          'n8n-nodes-base.mongodb'
        ];

        if (dbNodes.includes(node.type)) {
          const query = node.parameters?.query || node.parameters?.operation;
          if (query && this.containsSensitiveDataAccess(query)) {
            violations.push(`Sensitive data access detected in node "${node.name}"`);
            riskLevel = 'high';
          }
        }
      }
    }

    return { isValid: violations.length === 0, violations, riskLevel };
  }

  // Check for resource abuse risks
  private checkResourceAbuseRisks(definition: any): SecurityValidationResult {
    const violations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    if (definition.nodes) {
      let loopCount = 0;
      let httpRequestCount = 0;

      for (const node of definition.nodes) {
        // Count loops
        if (node.type === 'n8n-nodes-base.splitInBatches' || 
            node.type === 'n8n-nodes-base.itemLists') {
          loopCount++;
        }

        // Count HTTP requests
        if (node.type === 'n8n-nodes-base.httpRequest') {
          httpRequestCount++;
        }

        // Check for infinite loop potential
        if (this.hasInfiniteLoopRisk(node, definition)) {
          violations.push(`Infinite loop risk detected in node "${node.name}"`);
          riskLevel = 'high';
        }

        // Check for excessive resource usage
        if (node.parameters?.batchSize && node.parameters.batchSize > 1000) {
          violations.push(`Large batch size (${node.parameters.batchSize}) in node "${node.name}"`);
          if (riskLevel === 'low') riskLevel = 'medium';
        }
      }

      // Check overall resource usage patterns
      if (loopCount > 3) {
        violations.push(`Excessive loop operations detected (${loopCount})`);
        if (riskLevel === 'low') riskLevel = 'medium';
      }

      if (httpRequestCount > 10) {
        violations.push(`Excessive HTTP requests detected (${httpRequestCount})`);
        if (riskLevel === 'low') riskLevel = 'medium';
      }
    }

    return { isValid: violations.length === 0, violations, riskLevel };
  }

  // Check for injection vulnerabilities
  private checkInjectionVulnerabilities(definition: any): SecurityValidationResult {
    const violations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    if (definition.nodes) {
      for (const node of definition.nodes) {
        // Check for SQL injection risks
        if (this.isSqlNode(node.type)) {
          const query = node.parameters?.query;
          if (query && this.hasSqlInjectionRisk(query)) {
            violations.push(`SQL injection risk detected in node "${node.name}"`);
            riskLevel = 'high';
          }
        }

        // Check for command injection risks
        if (node.type === 'n8n-nodes-base.executeCommand') {
          const command = node.parameters?.command;
          if (command && this.hasCommandInjectionRisk(command)) {
            violations.push(`Command injection risk detected in node "${node.name}"`);
            riskLevel = 'high';
          }
        }

        // Check for XSS risks in HTTP responses
        if (node.type === 'n8n-nodes-base.httpRequest') {
          const responseFormat = node.parameters?.responseFormat;
          if (responseFormat === 'string' && this.hasXssRisk(node.parameters)) {
            violations.push(`XSS risk detected in node "${node.name}"`);
            if (riskLevel === 'low') riskLevel = 'medium';
          }
        }
      }
    }

    return { isValid: violations.length === 0, violations, riskLevel };
  }

  // Get workflow permissions for user
  async getWorkflowPermissions(
    workflowId: string,
    tenantContext: TenantContext
  ): Promise<WorkflowPermissions> {
    const [canRead, canWrite, canExecute, canDelete] = await Promise.all([
      this.tenantIsolation.validateWorkflowAccess(workflowId, tenantContext, 'read'),
      this.tenantIsolation.validateWorkflowAccess(workflowId, tenantContext, 'write'),
      this.tenantIsolation.validateWorkflowAccess(workflowId, tenantContext, 'execute'),
      this.tenantIsolation.validateWorkflowAccess(workflowId, tenantContext, 'delete')
    ]);

    return {
      canRead,
      canWrite,
      canExecute,
      canDelete,
      canShare: canWrite // For now, write permission includes share
    };
  }

  // Encrypt sensitive workflow data
  encryptSensitiveData(data: any, tenantId: string): string {
    const key = this.getTenantEncryptionKey(tenantId);
    const cipher = crypto.createCipher('aes-256-cbc', key);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  // Decrypt sensitive workflow data
  decryptSensitiveData(encryptedData: string, tenantId: string): any {
    try {
      const key = this.getTenantEncryptionKey(tenantId);
      const decipher = crypto.createDecipher('aes-256-cbc', key);
      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    } catch (error) {
      console.error('Failed to decrypt sensitive data:', error);
      return null;
    }
  }

  // Generate secure webhook token
  generateWebhookToken(workflowId: string, tenantId: string): string {
    const data = `${workflowId}:${tenantId}:${Date.now()}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // Validate webhook token
  validateWebhookToken(token: string, workflowId: string, tenantId: string): boolean {
    // In production, this would validate against stored tokens
    // For now, we'll do a basic format check
    return token.length === 64 && /^[a-f0-9]+$/.test(token);
  }

  // Audit workflow access
  async auditWorkflowAccess(
    workflowId: string,
    tenantContext: TenantContext,
    operation: string,
    success: boolean,
    details?: any
  ): Promise<void> {
    await this.tenantIsolation.logSecurityEvent(
      tenantContext.tenantId,
      tenantContext.userId,
      `workflow_${operation}`,
      {
        workflowId,
        success,
        operation,
        ...details
      }
    );
  }

  // Helper methods
  private checkDangerousParameters(node: any): string[] {
    const violations: string[] = [];
    const params = node.parameters;

    // Check for dangerous file operations
    if (params.filePath && (params.filePath.includes('..') || params.filePath.startsWith('/'))) {
      violations.push(`Dangerous file path in node "${node.name}": ${params.filePath}`);
    }

    // Check for dangerous URLs
    if (params.url && this.isDangerousUrl(params.url)) {
      violations.push(`Dangerous URL in node "${node.name}": ${params.url}`);
    }

    // Check for credential exposure
    if (this.hasCredentialExposure(params)) {
      violations.push(`Potential credential exposure in node "${node.name}"`);
    }

    return violations;
  }

  private isExternalUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      
      // Check if it's an internal/private IP
      const privateRanges = [
        /^127\./,
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^192\.168\./,
        /^localhost$/i
      ];

      return !privateRanges.some(range => range.test(hostname));
    } catch {
      return false;
    }
  }

  private containsSensitiveDataAccess(query: string): boolean {
    const sensitivePatterns = [
      /password/i,
      /secret/i,
      /token/i,
      /api[_-]?key/i,
      /credit[_-]?card/i,
      /ssn/i,
      /social[_-]?security/i
    ];

    return sensitivePatterns.some(pattern => pattern.test(query));
  }

  private hasInfiniteLoopRisk(node: any, definition: any): boolean {
    // Simple check for potential infinite loops
    if (node.type === 'n8n-nodes-base.splitInBatches') {
      return !node.parameters?.batchSize || node.parameters.batchSize <= 0;
    }
    return false;
  }

  private isSqlNode(nodeType: string): boolean {
    return [
      'n8n-nodes-base.postgres',
      'n8n-nodes-base.mysql',
      'n8n-nodes-base.mssql',
      'n8n-nodes-base.mongodb'
    ].includes(nodeType);
  }

  private hasSqlInjectionRisk(query: string): boolean {
    // Basic SQL injection pattern detection
    const injectionPatterns = [
      /['"];?\s*(drop|delete|update|insert|create|alter)\s/i,
      /union\s+select/i,
      /'\s*or\s*'1'\s*=\s*'1/i,
      /--/,
      /\/\*/
    ];

    return injectionPatterns.some(pattern => pattern.test(query));
  }

  private hasCommandInjectionRisk(command: string): boolean {
    const injectionPatterns = [
      /[;&|`$()]/,
      /\.\./,
      /\/etc\/passwd/,
      /\/bin\//
    ];

    return injectionPatterns.some(pattern => pattern.test(command));
  }

  private hasXssRisk(parameters: any): boolean {
    const xssPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i
    ];

    const paramString = JSON.stringify(parameters);
    return xssPatterns.some(pattern => pattern.test(paramString));
  }

  private isDangerousUrl(url: string): boolean {
    const dangerousPatterns = [
      /file:\/\//i,
      /ftp:\/\//i,
      /localhost/i,
      /127\.0\.0\.1/,
      /metadata\.google\.internal/i,
      /169\.254\./
    ];

    return dangerousPatterns.some(pattern => pattern.test(url));
  }

  private hasCredentialExposure(params: any): boolean {
    const paramString = JSON.stringify(params).toLowerCase();
    const credentialPatterns = [
      /password\s*[:=]\s*[^,}]+/,
      /api[_-]?key\s*[:=]\s*[^,}]+/,
      /secret\s*[:=]\s*[^,}]+/,
      /token\s*[:=]\s*[^,}]+/
    ];

    return credentialPatterns.some(pattern => pattern.test(paramString));
  }

  private getTenantEncryptionKey(tenantId: string): string {
    // In production, this would be retrieved from a secure key management system
    const baseKey = process.env.WORKFLOW_ENCRYPTION_KEY || 'default-key';
    return crypto.createHash('sha256').update(`${baseKey}:${tenantId}`).digest('hex');
  }
}
