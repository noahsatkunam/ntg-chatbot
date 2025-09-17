import axios from 'axios';
import { logger } from '../utils/logger';

export interface N8nWorkflowExecution {
  workflowId: string;
  data: any;
  waitTill?: Date;
}

export interface N8nWebhookPayload {
  event: string;
  data: any;
  timestamp: string;
  source: 'chatbot' | 'user' | 'system';
}

export class N8nService {
  private baseUrl: string;
  private apiKey?: string;
  private enabled: boolean;

  constructor() {
    this.baseUrl = process.env.N8N_URL || 'http://localhost:5678';
    this.apiKey = process.env.N8N_API_KEY;
    this.enabled = process.env.N8N_ENABLED !== 'false';
  }

  /**
   * Check if N8N is available and healthy
   */
  async healthCheck(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/healthz`, {
        timeout: 5000,
        headers: this.getHeaders()
      });
      return response.status === 200;
    } catch (error) {
      logger.warn('N8N health check failed', { error: error.message });
      return false;
    }
  }

  /**
   * Execute a workflow by ID
   */
  async executeWorkflow(execution: N8nWorkflowExecution): Promise<any> {
    if (!this.enabled) {
      logger.info('N8N is disabled, skipping workflow execution');
      return null;
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/workflows/${execution.workflowId}/execute`,
        {
          data: execution.data,
          waitTill: execution.waitTill
        },
        {
          headers: this.getHeaders(),
          timeout: 30000
        }
      );

      logger.info('N8N workflow executed successfully', {
        workflowId: execution.workflowId,
        executionId: response.data.executionId
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to execute N8N workflow', {
        workflowId: execution.workflowId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Send data to N8N webhook
   */
  async sendWebhook(webhookUrl: string, payload: N8nWebhookPayload): Promise<any> {
    if (!this.enabled) {
      logger.info('N8N is disabled, skipping webhook');
      return null;
    }

    try {
      const response = await axios.post(webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'NTG-Chatbot-Backend'
        },
        timeout: 15000
      });

      logger.info('N8N webhook sent successfully', {
        webhookUrl,
        event: payload.event,
        status: response.status
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to send N8N webhook', {
        webhookUrl,
        event: payload.event,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get list of available workflows
   */
  async getWorkflows(): Promise<any[]> {
    if (!this.enabled) {
      return [];
    }

    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/workflows`, {
        headers: this.getHeaders(),
        timeout: 10000
      });

      return response.data.data || [];
    } catch (error) {
      logger.error('Failed to get N8N workflows', { error: error.message });
      return [];
    }
  }

  /**
   * Trigger chatbot integration workflow
   */
  async triggerChatbotIntegration(data: any): Promise<any> {
    const webhookUrl = `${this.baseUrl}/webhook/chatbot-webhook`;
    
    const payload: N8nWebhookPayload = {
      event: 'chatbot_message',
      data,
      timestamp: new Date().toISOString(),
      source: 'chatbot'
    };

    return this.sendWebhook(webhookUrl, payload);
  }

  /**
   * Get authentication headers
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'NTG-Chatbot-Backend'
    };

    if (this.apiKey) {
      headers['X-N8N-API-KEY'] = this.apiKey;
    }

    return headers;
  }

  /**
   * Enable/disable N8N integration
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info(`N8N integration ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get N8N status
   */
  getStatus(): { enabled: boolean; baseUrl: string; hasApiKey: boolean } {
    return {
      enabled: this.enabled,
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey
    };
  }
}

// Export singleton instance
export const n8nService = new N8nService();
