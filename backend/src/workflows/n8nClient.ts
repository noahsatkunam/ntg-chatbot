import axios, { AxiosInstance, AxiosResponse } from 'axios';
import crypto from 'crypto';

interface EncryptedCredentialPayload {
  iv: string;
  ciphertext: string;
}

export interface N8nWorkflow {
  id?: string;
  name: string;
  nodes: any[];
  connections: any;
  active: boolean;
  settings?: any;
  staticData?: any;
  tags?: string[];
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  mode: string;
  retryOf?: string;
  retrySuccessId?: string;
  startedAt: Date;
  stoppedAt?: Date;
  finished: boolean;
  data?: any;
  status: 'running' | 'success' | 'error' | 'canceled' | 'waiting';
}

export interface N8nCredential {
  id?: string;
  name: string;
  type: string;
  data: any;
}

export class N8nClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private encryptionKey: Buffer;
  private readonly encryptionKeyRaw: string;

  constructor(
    baseUrl: string = process.env.N8N_URL || 'http://n8n:5678',
    username: string = process.env.N8N_BASIC_AUTH_USER || 'admin',
    password: string = process.env.N8N_BASIC_AUTH_PASSWORD || 'admin',
    encryptionKey: string = process.env.N8N_ENCRYPTION_KEY || ''
  ) {
    this.baseUrl = baseUrl;
    const normalizedEncryptionKey = encryptionKey.trim();
    this.encryptionKeyRaw = normalizedEncryptionKey;
    this.encryptionKey = this.resolveEncryptionKey(normalizedEncryptionKey);
    
    this.client = axios.create({
      baseURL: baseUrl,
      auth: {
        username,
        password
      },
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // Add request/response interceptors for logging and error handling
    this.client.interceptors.request.use(
      (config) => {
        console.log(`N8N API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('N8N API Request Error:', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        console.log(`N8N API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        console.error('N8N API Response Error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  // Workflow Management
  async createWorkflow(workflow: N8nWorkflow): Promise<N8nWorkflow> {
    try {
      const response: AxiosResponse<N8nWorkflow> = await this.client.post('/api/v1/workflows', workflow);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to create workflow: ${error}`);
    }
  }

  async getWorkflow(workflowId: string): Promise<N8nWorkflow> {
    try {
      const response: AxiosResponse<N8nWorkflow> = await this.client.get(`/api/v1/workflows/${workflowId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get workflow: ${error}`);
    }
  }

  async updateWorkflow(workflowId: string, workflow: Partial<N8nWorkflow>): Promise<N8nWorkflow> {
    try {
      const response: AxiosResponse<N8nWorkflow> = await this.client.patch(`/api/v1/workflows/${workflowId}`, workflow);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to update workflow: ${error}`);
    }
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    try {
      await this.client.delete(`/api/v1/workflows/${workflowId}`);
    } catch (error) {
      throw new Error(`Failed to delete workflow: ${error}`);
    }
  }

  async listWorkflows(): Promise<N8nWorkflow[]> {
    try {
      const response: AxiosResponse<N8nWorkflow[]> = await this.client.get('/api/v1/workflows');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to list workflows: ${error}`);
    }
  }

  async activateWorkflow(workflowId: string): Promise<void> {
    try {
      await this.client.patch(`/api/v1/workflows/${workflowId}`, { active: true });
    } catch (error) {
      throw new Error(`Failed to activate workflow: ${error}`);
    }
  }

  async deactivateWorkflow(workflowId: string): Promise<void> {
    try {
      await this.client.patch(`/api/v1/workflows/${workflowId}`, { active: false });
    } catch (error) {
      throw new Error(`Failed to deactivate workflow: ${error}`);
    }
  }

  // Execution Management
  async executeWorkflow(workflowId: string, data?: any): Promise<N8nExecution> {
    try {
      const response: AxiosResponse<N8nExecution> = await this.client.post(`/api/v1/workflows/${workflowId}/execute`, {
        data: data || {}
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to execute workflow: ${error}`);
    }
  }

  async getExecution(executionId: string): Promise<N8nExecution> {
    try {
      const response: AxiosResponse<N8nExecution> = await this.client.get(`/api/v1/executions/${executionId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get execution: ${error}`);
    }
  }

  async listExecutions(workflowId?: string, limit: number = 20): Promise<N8nExecution[]> {
    try {
      const params = new URLSearchParams();
      if (workflowId) params.append('workflowId', workflowId);
      params.append('limit', limit.toString());

      const response: AxiosResponse<N8nExecution[]> = await this.client.get(`/api/v1/executions?${params}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to list executions: ${error}`);
    }
  }

  async stopExecution(executionId: string): Promise<void> {
    try {
      await this.client.post(`/api/v1/executions/${executionId}/stop`);
    } catch (error) {
      throw new Error(`Failed to stop execution: ${error}`);
    }
  }

  async retryExecution(executionId: string): Promise<N8nExecution> {
    try {
      const response: AxiosResponse<N8nExecution> = await this.client.post(`/api/v1/executions/${executionId}/retry`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to retry execution: ${error}`);
    }
  }

  async deleteExecution(executionId: string): Promise<void> {
    try {
      await this.client.delete(`/api/v1/executions/${executionId}`);
    } catch (error) {
      throw new Error(`Failed to delete execution: ${error}`);
    }
  }

  // Credential Management
  async createCredential(credential: N8nCredential): Promise<N8nCredential> {
    try {
      // Encrypt credential data before sending
      const encryptedCredential = {
        ...credential,
        data: this.encryptCredentialData(credential.data)
      };

      const response: AxiosResponse<N8nCredential> = await this.client.post('/api/v1/credentials', encryptedCredential);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to create credential: ${error}`);
    }
  }

  async getCredential(credentialId: string): Promise<N8nCredential> {
    try {
      const response: AxiosResponse<N8nCredential> = await this.client.get(`/api/v1/credentials/${credentialId}`);
      
      // Decrypt credential data
      const credential = response.data;
      if (credential.data) {
        credential.data = this.decryptCredentialData(credential.data);
      }
      
      return credential;
    } catch (error) {
      throw new Error(`Failed to get credential: ${error}`);
    }
  }

  async updateCredential(credentialId: string, credential: Partial<N8nCredential>): Promise<N8nCredential> {
    try {
      // Encrypt credential data if provided
      const updateData = { ...credential };
      if (updateData.data) {
        updateData.data = this.encryptCredentialData(updateData.data);
      }

      const response: AxiosResponse<N8nCredential> = await this.client.patch(`/api/v1/credentials/${credentialId}`, updateData);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to update credential: ${error}`);
    }
  }

  async deleteCredential(credentialId: string): Promise<void> {
    try {
      await this.client.delete(`/api/v1/credentials/${credentialId}`);
    } catch (error) {
      throw new Error(`Failed to delete credential: ${error}`);
    }
  }

  async listCredentials(): Promise<N8nCredential[]> {
    try {
      const response: AxiosResponse<N8nCredential[]> = await this.client.get('/api/v1/credentials');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to list credentials: ${error}`);
    }
  }

  // Webhook Management
  async createWebhook(workflowId: string, path: string): Promise<string> {
    try {
      // Generate unique webhook path for tenant isolation
      const webhookPath = `/webhook/${path}`;
      
      // Update workflow to include webhook trigger
      const workflow = await this.getWorkflow(workflowId);
      
      // Add webhook node if not exists
      const hasWebhookTrigger = workflow.nodes.some(node => node.type === 'n8n-nodes-base.webhook');
      
      if (!hasWebhookTrigger) {
        const webhookNode = {
          id: crypto.randomUUID(),
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [250, 300],
          parameters: {
            path: webhookPath,
            httpMethod: 'POST',
            responseMode: 'responseNode'
          }
        };
        
        workflow.nodes.unshift(webhookNode);
        await this.updateWorkflow(workflowId, workflow);
      }
      
      return `${this.baseUrl}${webhookPath}`;
    } catch (error) {
      throw new Error(`Failed to create webhook: ${error}`);
    }
  }

  // Health Check
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/healthz');
      return response.status === 200;
    } catch (error) {
      console.error('N8N health check failed:', error);
      return false;
    }
  }

  // Utility Methods
  private encryptCredentialData(data: any): EncryptedCredentialPayload {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
      const encryptedBuffer = Buffer.concat([
        cipher.update(JSON.stringify(data), 'utf8'),
        cipher.final()
      ]);

      return {
        iv: iv.toString('base64'),
        ciphertext: encryptedBuffer.toString('base64')
      };
    } catch (error) {
      throw new Error(`Failed to encrypt credential data: ${error}`);
    }
  }

  private decryptCredentialData(encryptedData: unknown): any {
    const payload = this.parseEncryptedPayload(encryptedData);

    if (payload) {
      try {
        const iv = Buffer.from(payload.iv, 'base64');
        const ciphertext = Buffer.from(payload.ciphertext, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
        const decryptedBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return JSON.parse(decryptedBuffer.toString('utf8'));
      } catch (error) {
        throw new Error(`Failed to decrypt credential data: ${error}`);
      }
    }

    if (typeof encryptedData === 'string' && this.encryptionKeyRaw) {
      try {
        return this.decryptLegacyCredentialData(encryptedData);
      } catch (error) {
        throw new Error(`Failed to decrypt credential data: ${error}`);
      }
    }

    throw new Error('Failed to decrypt credential data: Unsupported encrypted payload format');
  }

  generateTenantWebhookPath(tenantId: string, workflowId: string): string {
    return `tenant-${tenantId}/workflow-${workflowId}`;
  }

  validateWorkflowDefinition(workflow: N8nWorkflow): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!workflow.name || workflow.name.trim().length === 0) {
      errors.push('Workflow name is required');
    }

    if (!workflow.nodes || workflow.nodes.length === 0) {
      errors.push('Workflow must have at least one node');
    }

    if (workflow.nodes) {
      // Check for required trigger node
      const hasTrigger = workflow.nodes.some(node => 
        node.type?.includes('trigger') || 
        node.type?.includes('webhook') ||
        node.type?.includes('schedule')
      );
      
      if (!hasTrigger) {
        errors.push('Workflow must have at least one trigger node');
      }

      // Validate node structure
      workflow.nodes.forEach((node, index) => {
        if (!node.id) {
          errors.push(`Node at index ${index} is missing an ID`);
        }
        if (!node.type) {
          errors.push(`Node at index ${index} is missing a type`);
        }
        if (!node.name) {
          errors.push(`Node at index ${index} is missing a name`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private resolveEncryptionKey(encryptionKey: string): Buffer {
    if (!encryptionKey) {
      throw new Error('N8N_ENCRYPTION_KEY environment variable must be set to a strong 32-byte value.');
    }

    const normalizedKey = encryptionKey.startsWith('base64:')
      ? encryptionKey.slice(7)
      : encryptionKey;

    const base64Key = this.tryDecodeBase64Key(normalizedKey);
    if (base64Key) {
      return base64Key;
    }

    if (/^[0-9a-fA-F]{64}$/.test(normalizedKey)) {
      return Buffer.from(normalizedKey, 'hex');
    }

    if (Buffer.byteLength(normalizedKey, 'utf8') === 32) {
      return Buffer.from(normalizedKey, 'utf8');
    }

    throw new Error('N8N_ENCRYPTION_KEY must be a 32-byte key encoded as base64, 64-character hex, or a 32-character UTF-8 string.');
  }

  private tryDecodeBase64Key(value: string): Buffer | null {
    if (!/^[A-Za-z0-9+/=]+$/.test(value)) {
      return null;
    }

    try {
      const buffer = Buffer.from(value, 'base64');
      if (buffer.length !== 32) {
        return null;
      }

      const normalizedInput = value.replace(/=+$/, '');
      const normalizedOutput = buffer.toString('base64').replace(/=+$/, '');
      return normalizedInput === normalizedOutput ? buffer : null;
    } catch {
      return null;
    }
  }

  private parseEncryptedPayload(encryptedData: unknown): EncryptedCredentialPayload | null {
    if (!encryptedData) {
      return null;
    }

    if (this.isEncryptedCredentialPayload(encryptedData)) {
      return encryptedData;
    }

    if (typeof encryptedData === 'string') {
      try {
        const parsed = JSON.parse(encryptedData);
        return this.isEncryptedCredentialPayload(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }

    return null;
  }

  private isEncryptedCredentialPayload(value: unknown): value is EncryptedCredentialPayload {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as EncryptedCredentialPayload).iv === 'string' &&
      typeof (value as EncryptedCredentialPayload).ciphertext === 'string'
    );
  }

  private decryptLegacyCredentialData(encryptedData: string): any {
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKeyRaw);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }
}
