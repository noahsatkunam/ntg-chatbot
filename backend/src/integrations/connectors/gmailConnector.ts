import { ApiConnector, ApiRequest, ApiResponse } from '../apiConnector';

export interface GmailMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  attachments?: GmailAttachment[];
  threadId?: string;
  labelIds?: string[];
}

export interface GmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  size: number;
}

export interface GmailThread {
  id: string;
  snippet: string;
  historyId: string;
  messages: any[];
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
  messagesTotal: number;
  messagesUnread: number;
}

export class GmailConnector {
  private apiConnector: ApiConnector;

  constructor(apiConnector: ApiConnector) {
    this.apiConnector = apiConnector;
  }

  // Send email
  async sendEmail(
    connectionId: string,
    tenantId: string,
    message: GmailMessage
  ): Promise<ApiResponse> {
    const emailData = this.formatEmailMessage(message);

    const request: ApiRequest = {
      method: 'POST',
      endpoint: '/gmail/v1/users/me/messages/send',
      data: {
        raw: Buffer.from(emailData).toString('base64url')
      },
      headers: {
        'Content-Type': 'application/json'
      }
    };

    return await this.apiConnector.makeRequest(connectionId, request, tenantId);
  }

  // Get messages
  async getMessages(
    connectionId: string,
    tenantId: string,
    query?: string,
    maxResults: number = 10,
    labelIds?: string[]
  ): Promise<any[]> {
    const params: any = {
      maxResults,
      q: query
    };

    if (labelIds && labelIds.length > 0) {
      params.labelIds = labelIds;
    }

    const request: ApiRequest = {
      method: 'GET',
      endpoint: '/gmail/v1/users/me/messages',
      params
    };

    const response = await this.apiConnector.makeRequest(connectionId, request, tenantId);
    
    if (response.success && response.data?.messages) {
      // Get full message details
      const messages = [];
      for (const msg of response.data.messages.slice(0, maxResults)) {
        const fullMessage = await this.getMessage(connectionId, tenantId, msg.id);
        if (fullMessage) {
          messages.push(fullMessage);
        }
      }
      return messages;
    }

    return [];
  }

  // Get single message
  async getMessage(
    connectionId: string,
    tenantId: string,
    messageId: string
  ): Promise<any> {
    const request: ApiRequest = {
      method: 'GET',
      endpoint: `/gmail/v1/users/me/messages/${messageId}`,
      params: {
        format: 'full'
      }
    };

    const response = await this.apiConnector.makeRequest(connectionId, request, tenantId);
    return response.success ? response.data : null;
  }

  // Get labels
  async getLabels(
    connectionId: string,
    tenantId: string
  ): Promise<GmailLabel[]> {
    const request: ApiRequest = {
      method: 'GET',
      endpoint: '/gmail/v1/users/me/labels'
    };

    const response = await this.apiConnector.makeRequest(connectionId, request, tenantId);
    
    if (response.success && response.data?.labels) {
      return response.data.labels.map((label: any) => ({
        id: label.id,
        name: label.name,
        type: label.type,
        messagesTotal: label.messagesTotal || 0,
        messagesUnread: label.messagesUnread || 0
      }));
    }

    return [];
  }

  // Create label
  async createLabel(
    connectionId: string,
    tenantId: string,
    name: string,
    labelListVisibility: string = 'labelShow',
    messageListVisibility: string = 'show'
  ): Promise<ApiResponse> {
    const request: ApiRequest = {
      method: 'POST',
      endpoint: '/gmail/v1/users/me/labels',
      data: {
        name,
        labelListVisibility,
        messageListVisibility
      }
    };

    return await this.apiConnector.makeRequest(connectionId, request, tenantId);
  }

  // Add labels to message
  async addLabelsToMessage(
    connectionId: string,
    tenantId: string,
    messageId: string,
    labelIds: string[]
  ): Promise<ApiResponse> {
    const request: ApiRequest = {
      method: 'POST',
      endpoint: `/gmail/v1/users/me/messages/${messageId}/modify`,
      data: {
        addLabelIds: labelIds
      }
    };

    return await this.apiConnector.makeRequest(connectionId, request, tenantId);
  }

  // Remove labels from message
  async removeLabelsFromMessage(
    connectionId: string,
    tenantId: string,
    messageId: string,
    labelIds: string[]
  ): Promise<ApiResponse> {
    const request: ApiRequest = {
      method: 'POST',
      endpoint: `/gmail/v1/users/me/messages/${messageId}/modify`,
      data: {
        removeLabelIds: labelIds
      }
    };

    return await this.apiConnector.makeRequest(connectionId, request, tenantId);
  }

  // Get threads
  async getThreads(
    connectionId: string,
    tenantId: string,
    query?: string,
    maxResults: number = 10
  ): Promise<GmailThread[]> {
    const request: ApiRequest = {
      method: 'GET',
      endpoint: '/gmail/v1/users/me/threads',
      params: {
        maxResults,
        q: query
      }
    };

    const response = await this.apiConnector.makeRequest(connectionId, request, tenantId);
    
    if (response.success && response.data?.threads) {
      return response.data.threads.map((thread: any) => ({
        id: thread.id,
        snippet: thread.snippet,
        historyId: thread.historyId,
        messages: thread.messages || []
      }));
    }

    return [];
  }

  // Mark message as read
  async markAsRead(
    connectionId: string,
    tenantId: string,
    messageId: string
  ): Promise<ApiResponse> {
    return await this.removeLabelsFromMessage(connectionId, tenantId, messageId, ['UNREAD']);
  }

  // Mark message as unread
  async markAsUnread(
    connectionId: string,
    tenantId: string,
    messageId: string
  ): Promise<ApiResponse> {
    return await this.addLabelsToMessage(connectionId, tenantId, messageId, ['UNREAD']);
  }

  // Delete message
  async deleteMessage(
    connectionId: string,
    tenantId: string,
    messageId: string
  ): Promise<ApiResponse> {
    const request: ApiRequest = {
      method: 'DELETE',
      endpoint: `/gmail/v1/users/me/messages/${messageId}`
    };

    return await this.apiConnector.makeRequest(connectionId, request, tenantId);
  }

  // Private helper methods
  private formatEmailMessage(message: GmailMessage): string {
    const headers = [
      `To: ${message.to.join(', ')}`,
      `Subject: ${message.subject}`
    ];

    if (message.cc && message.cc.length > 0) {
      headers.push(`Cc: ${message.cc.join(', ')}`);
    }

    if (message.bcc && message.bcc.length > 0) {
      headers.push(`Bcc: ${message.bcc.join(', ')}`);
    }

    headers.push(`Content-Type: ${message.isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`);
    headers.push('');

    return headers.join('\r\n') + message.body;
  }

  // Create Gmail connection configuration with encrypted OAuth2 tokens
  static createConnectionConfig(accessToken: string, refreshToken?: string, encryptionKey?: string): any {
    // Import encryption utilities
    const { encryptPayload } = require('../../utils/encryption');
    
    let credentials: any = {
      accessToken,
      refreshToken,
      tokenType: 'Bearer'
    };

    // Encrypt OAuth2 tokens if encryption key is provided
    if (encryptionKey) {
      try {
        credentials = {
          accessToken: encryptPayload(accessToken, encryptionKey),
          refreshToken: refreshToken ? encryptPayload(refreshToken, encryptionKey) : undefined,
          tokenType: 'Bearer',
          encrypted: true
        };
      } catch (error) {
        console.warn('Failed to encrypt OAuth2 tokens for Gmail connector:', error);
        // Fall back to unencrypted (should be avoided in production)
      }
    } else {
      console.warn('Gmail connector: No encryption key provided. OAuth2 tokens will be stored unencrypted.');
    }

    return {
      name: 'Gmail Integration',
      type: 'gmail',
      baseUrl: 'https://www.googleapis.com',
      authentication: {
        type: 'oauth2',
        credentials
      },
      headers: {
        'Content-Type': 'application/json'
      },
      rateLimit: {
        requestsPerSecond: 5,
        requestsPerMinute: 250,
        requestsPerHour: 1000000,
        burstLimit: 10
      },
      retryConfig: {
        maxRetries: 3,
        backoffMultiplier: 2,
        maxBackoffMs: 10000,
        retryableStatusCodes: [429, 500, 502, 503, 504]
      },
      isActive: true,
      metadata: {
        provider: 'gmail',
        version: '1.0',
        scopes: ['https://www.googleapis.com/auth/gmail.modify']
      }
    };
  }
}
