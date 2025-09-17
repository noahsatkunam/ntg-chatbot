import { PrismaClient } from '@prisma/client';
import { WorkflowSecurityService } from '../security/workflowSecurity';
import { EventEmitter } from 'events';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

export interface ApiConnectorConfig {
  name: string;
  baseUrl: string;
  authType: 'none' | 'basic' | 'bearer' | 'oauth2' | 'api_key';
  authConfig: any;
  rateLimits: {
    requestsPerSecond: number;
    requestsPerMinute: number;
    requestsPerHour: number;
  };
  timeout: number;
  retryConfig: {
    maxRetries: number;
    retryDelay: number;
    retryOn: number[];
  };
  headers: Record<string, string>;
}

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  endpoint: string;
  data?: any;
  headers?: Record<string, string>;
  params?: Record<string, any>;
  timeout?: number;
}

export interface ApiResponse {
  success: boolean;
  data?: any;
  error?: string;
  statusCode: number;
  headers: Record<string, string>;
  duration: number;
}

export interface RateLimitState {
  requestsThisSecond: number;
  requestsThisMinute: number;
  requestsThisHour: number;
  lastSecondReset: number;
  lastMinuteReset: number;
  lastHourReset: number;
}

export class ExternalApiConnector extends EventEmitter {
  private prisma: PrismaClient;
  private securityService: WorkflowSecurityService;
  private connectors: Map<string, ApiConnectorConfig> = new Map();
  private rateLimitStates: Map<string, RateLimitState> = new Map();
  private requestQueues: Map<string, Array<() => Promise<void>>> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.securityService = new WorkflowSecurityService();
    this.initializeBuiltInConnectors();
  }

  // Initialize built-in API connectors
  private initializeBuiltInConnectors(): void {
    const builtInConnectors: ApiConnectorConfig[] = [
      {
        name: 'slack',
        baseUrl: 'https://slack.com/api',
        authType: 'bearer',
        authConfig: {},
        rateLimits: {
          requestsPerSecond: 1,
          requestsPerMinute: 50,
          requestsPerHour: 1000
        },
        timeout: 10000,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 1000,
          retryOn: [429, 500, 502, 503, 504]
        },
        headers: {
          'Content-Type': 'application/json'
        }
      },
      {
        name: 'discord',
        baseUrl: 'https://discord.com/api/v10',
        authType: 'bearer',
        authConfig: {},
        rateLimits: {
          requestsPerSecond: 5,
          requestsPerMinute: 300,
          requestsPerHour: 5000
        },
        timeout: 10000,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 1000,
          retryOn: [429, 500, 502, 503, 504]
        },
        headers: {
          'Content-Type': 'application/json'
        }
      },
      {
        name: 'sendgrid',
        baseUrl: 'https://api.sendgrid.com/v3',
        authType: 'bearer',
        authConfig: {},
        rateLimits: {
          requestsPerSecond: 10,
          requestsPerMinute: 600,
          requestsPerHour: 10000
        },
        timeout: 30000,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 2000,
          retryOn: [429, 500, 502, 503, 504]
        },
        headers: {
          'Content-Type': 'application/json'
        }
      },
      {
        name: 'hubspot',
        baseUrl: 'https://api.hubapi.com',
        authType: 'bearer',
        authConfig: {},
        rateLimits: {
          requestsPerSecond: 10,
          requestsPerMinute: 100,
          requestsPerHour: 40000
        },
        timeout: 15000,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 1500,
          retryOn: [429, 500, 502, 503, 504]
        },
        headers: {
          'Content-Type': 'application/json'
        }
      },
      {
        name: 'salesforce',
        baseUrl: 'https://api.salesforce.com',
        authType: 'oauth2',
        authConfig: {},
        rateLimits: {
          requestsPerSecond: 20,
          requestsPerMinute: 1000,
          requestsPerHour: 15000
        },
        timeout: 20000,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 2000,
          retryOn: [429, 500, 502, 503, 504]
        },
        headers: {
          'Content-Type': 'application/json'
        }
      }
    ];

    builtInConnectors.forEach(connector => {
      this.connectors.set(connector.name, connector);
      this.initializeRateLimitState(connector.name);
    });
  }

  // Register custom API connector
  async registerConnector(
    tenantId: string,
    config: ApiConnectorConfig
  ): Promise<void> {
    // Validate connector configuration
    const validation = await this.validateConnectorConfig(config, tenantId);
    if (!validation.isValid) {
      throw new Error(`Invalid connector configuration: ${validation.errors.join(', ')}`);
    }

    // Store connector configuration
    await this.prisma.workflowCredential.create({
      data: {
        tenantId,
        name: `api_connector_${config.name}`,
        type: 'api_connector',
        encryptedData: this.securityService.encryptSensitiveData(config, tenantId)
      }
    });

    this.connectors.set(`${tenantId}_${config.name}`, config);
    this.initializeRateLimitState(`${tenantId}_${config.name}`);

    this.emit('connector:registered', {
      tenantId,
      connectorName: config.name
    });
  }

  // Make API request with rate limiting and retry logic
  async makeRequest(
    connectorName: string,
    request: ApiRequest,
    tenantId?: string
  ): Promise<ApiResponse> {
    const startTime = Date.now();
    const fullConnectorName = tenantId ? `${tenantId}_${connectorName}` : connectorName;
    
    try {
      // Get connector configuration
      const connector = this.connectors.get(fullConnectorName);
      if (!connector) {
        throw new Error(`Connector '${connectorName}' not found`);
      }

      // Check rate limits
      await this.checkRateLimit(fullConnectorName, connector);

      // Prepare request configuration
      const config = await this.prepareRequestConfig(connector, request, tenantId);

      // Execute request with retry logic
      const response = await this.executeWithRetry(config, connector.retryConfig);

      // Update rate limit counters
      this.updateRateLimitCounters(fullConnectorName);

      // Log successful request
      await this.logApiRequest(tenantId, connectorName, request, response, Date.now() - startTime);

      this.emit('api:request:success', {
        connectorName,
        tenantId,
        duration: Date.now() - startTime
      });

      return {
        success: true,
        data: response.data,
        statusCode: response.status,
        headers: response.headers as Record<string, string>,
        duration: Date.now() - startTime
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Log failed request
      await this.logApiRequest(tenantId, connectorName, request, null, duration, error);

      this.emit('api:request:error', {
        connectorName,
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: axios.isAxiosError(error) ? error.response?.status || 0 : 0,
        headers: axios.isAxiosError(error) ? error.response?.headers as Record<string, string> || {} : {},
        duration
      };
    }
  }

  // Validate connector configuration
  private async validateConnectorConfig(
    config: ApiConnectorConfig,
    tenantId: string
  ): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Basic validation
    if (!config.name || config.name.trim().length === 0) {
      errors.push('Connector name is required');
    }

    if (!config.baseUrl || !this.isValidUrl(config.baseUrl)) {
      errors.push('Valid base URL is required');
    }

    // Security validation
    if (config.baseUrl && this.isRestrictedUrl(config.baseUrl)) {
      errors.push('Base URL points to restricted/internal resource');
    }

    // Rate limit validation
    if (!config.rateLimits || 
        config.rateLimits.requestsPerSecond <= 0 ||
        config.rateLimits.requestsPerMinute <= 0 ||
        config.rateLimits.requestsPerHour <= 0) {
      errors.push('Valid rate limits are required');
    }

    // Auth configuration validation
    if (config.authType !== 'none' && !config.authConfig) {
      errors.push('Auth configuration is required for non-none auth types');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Check rate limits before making request
  private async checkRateLimit(
    connectorName: string,
    connector: ApiConnectorConfig
  ): Promise<void> {
    const state = this.rateLimitStates.get(connectorName);
    if (!state) {
      this.initializeRateLimitState(connectorName);
      return;
    }

    const now = Date.now();

    // Reset counters if time windows have passed
    if (now - state.lastSecondReset >= 1000) {
      state.requestsThisSecond = 0;
      state.lastSecondReset = now;
    }

    if (now - state.lastMinuteReset >= 60000) {
      state.requestsThisMinute = 0;
      state.lastMinuteReset = now;
    }

    if (now - state.lastHourReset >= 3600000) {
      state.requestsThisHour = 0;
      state.lastHourReset = now;
    }

    // Check limits
    if (state.requestsThisSecond >= connector.rateLimits.requestsPerSecond) {
      const waitTime = 1000 - (now - state.lastSecondReset);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    if (state.requestsThisMinute >= connector.rateLimits.requestsPerMinute) {
      throw new Error('Rate limit exceeded: requests per minute');
    }

    if (state.requestsThisHour >= connector.rateLimits.requestsPerHour) {
      throw new Error('Rate limit exceeded: requests per hour');
    }
  }

  // Prepare axios request configuration
  private async prepareRequestConfig(
    connector: ApiConnectorConfig,
    request: ApiRequest,
    tenantId?: string
  ): Promise<AxiosRequestConfig> {
    const config: AxiosRequestConfig = {
      method: request.method,
      url: `${connector.baseUrl}${request.endpoint}`,
      timeout: request.timeout || connector.timeout,
      headers: {
        ...connector.headers,
        ...request.headers
      },
      params: request.params,
      data: request.data
    };

    // Add authentication
    await this.addAuthentication(config, connector, tenantId);

    return config;
  }

  // Add authentication to request
  private async addAuthentication(
    config: AxiosRequestConfig,
    connector: ApiConnectorConfig,
    tenantId?: string
  ): Promise<void> {
    if (!config.headers) config.headers = {};

    switch (connector.authType) {
      case 'basic':
        if (connector.authConfig.username && connector.authConfig.password) {
          const credentials = Buffer.from(
            `${connector.authConfig.username}:${connector.authConfig.password}`
          ).toString('base64');
          config.headers['Authorization'] = `Basic ${credentials}`;
        }
        break;

      case 'bearer':
        if (connector.authConfig.token) {
          config.headers['Authorization'] = `Bearer ${connector.authConfig.token}`;
        }
        break;

      case 'api_key':
        if (connector.authConfig.key && connector.authConfig.header) {
          config.headers[connector.authConfig.header] = connector.authConfig.key;
        }
        break;

      case 'oauth2':
        // OAuth2 token would be retrieved from stored credentials
        if (tenantId) {
          const token = await this.getOAuth2Token(connector.name, tenantId);
          if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
          }
        }
        break;
    }
  }

  // Execute request with retry logic
  private async executeWithRetry(
    config: AxiosRequestConfig,
    retryConfig: ApiConnectorConfig['retryConfig']
  ): Promise<AxiosResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        return await axios(config);
      } catch (error) {
        lastError = error as Error;

        if (attempt === retryConfig.maxRetries) {
          break;
        }

        // Check if error is retryable
        if (axios.isAxiosError(error) && error.response) {
          if (!retryConfig.retryOn.includes(error.response.status)) {
            break;
          }
        }

        // Wait before retry with exponential backoff
        const delay = retryConfig.retryDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  // Initialize rate limit state
  private initializeRateLimitState(connectorName: string): void {
    const now = Date.now();
    this.rateLimitStates.set(connectorName, {
      requestsThisSecond: 0,
      requestsThisMinute: 0,
      requestsThisHour: 0,
      lastSecondReset: now,
      lastMinuteReset: now,
      lastHourReset: now
    });
  }

  // Update rate limit counters
  private updateRateLimitCounters(connectorName: string): void {
    const state = this.rateLimitStates.get(connectorName);
    if (state) {
      state.requestsThisSecond++;
      state.requestsThisMinute++;
      state.requestsThisHour++;
    }
  }

  // Log API request for analytics
  private async logApiRequest(
    tenantId: string | undefined,
    connectorName: string,
    request: ApiRequest,
    response: AxiosResponse | null,
    duration: number,
    error?: any
  ): Promise<void> {
    try {
      // In production, this would log to a dedicated API request log table
      console.log('API Request Log:', {
        tenantId,
        connectorName,
        method: request.method,
        endpoint: request.endpoint,
        statusCode: response?.status || (error ? 0 : null),
        duration,
        success: !!response,
        error: error ? (error instanceof Error ? error.message : String(error)) : null,
        timestamp: new Date()
      });
    } catch (logError) {
      console.error('Failed to log API request:', logError);
    }
  }

  // Get OAuth2 token (placeholder implementation)
  private async getOAuth2Token(connectorName: string, tenantId: string): Promise<string | null> {
    try {
      const credential = await this.prisma.workflowCredential.findFirst({
        where: {
          tenantId,
          name: `oauth2_${connectorName}`,
          type: 'oauth2_token'
        }
      });

      if (credential) {
        const decrypted = this.securityService.decryptSensitiveData(
          credential.encryptedData,
          tenantId
        );
        return decrypted?.access_token || null;
      }

      return null;
    } catch (error) {
      console.error('Failed to get OAuth2 token:', error);
      return null;
    }
  }

  // Utility methods
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private isRestrictedUrl(url: string): boolean {
    const restrictedPatterns = [
      /localhost/i,
      /127\.0\.0\.1/,
      /192\.168\./,
      /10\./,
      /172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /metadata\.google\.internal/i,
      /169\.254\./
    ];

    return restrictedPatterns.some(pattern => pattern.test(url));
  }

  // Get connector statistics
  async getConnectorStats(tenantId: string): Promise<any> {
    // This would query actual API request logs in production
    return {
      totalConnectors: this.connectors.size,
      activeConnectors: Array.from(this.connectors.keys()).filter(name => 
        name.startsWith(tenantId)
      ).length,
      requestsToday: 0, // Would be calculated from logs
      successRate: 0.95, // Would be calculated from logs
      averageResponseTime: 250 // Would be calculated from logs
    };
  }

  // Get available connectors
  getAvailableConnectors(tenantId?: string): string[] {
    const builtInConnectors = Array.from(this.connectors.keys())
      .filter(name => !name.includes('_'));

    if (tenantId) {
      const customConnectors = Array.from(this.connectors.keys())
        .filter(name => name.startsWith(`${tenantId}_`))
        .map(name => name.replace(`${tenantId}_`, ''));

      return [...builtInConnectors, ...customConnectors];
    }

    return builtInConnectors;
  }

  // Test connector connection
  async testConnection(
    connectorName: string,
    tenantId?: string
  ): Promise<{ success: boolean; message: string; responseTime?: number }> {
    try {
      const startTime = Date.now();
      
      // Make a simple test request (usually a health check or user info endpoint)
      const testEndpoints: Record<string, string> = {
        slack: '/auth.test',
        discord: '/users/@me',
        sendgrid: '/user/profile',
        hubspot: '/contacts/v1/lists/all/contacts/all',
        salesforce: '/services/data/v52.0/'
      };

      const endpoint = testEndpoints[connectorName] || '/';
      
      const response = await this.makeRequest(connectorName, {
        method: 'GET',
        endpoint
      }, tenantId);

      const responseTime = Date.now() - startTime;

      return {
        success: response.success,
        message: response.success ? 'Connection successful' : response.error || 'Connection failed',
        responseTime
      };

    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed'
      };
    }
  }
}
