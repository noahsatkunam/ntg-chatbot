import FormData from 'form-data';

import { ApiConnector, ApiRequest, ApiResponse } from '../apiConnector';

export interface SlackMessage {
  channel: string;
  text: string;
  attachments?: any[];
  blocks?: any[];
  thread_ts?: string;
  reply_broadcast?: boolean;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  topic: string;
  purpose: string;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  email: string;
  is_bot: boolean;
  profile: any;
}

export class SlackConnector {
  private apiConnector: ApiConnector;

  constructor(apiConnector: ApiConnector) {
    this.apiConnector = apiConnector;
  }

  // Send message to Slack channel
  async sendMessage(
    connectionId: string,
    tenantId: string,
    message: SlackMessage
  ): Promise<ApiResponse> {
    const request: ApiRequest = {
      method: 'POST',
      endpoint: '/api/chat.postMessage',
      data: message,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    return await this.apiConnector.makeRequest(connectionId, request, tenantId);
  }

  // Get channel list
  async getChannels(
    connectionId: string,
    tenantId: string,
    excludeArchived: boolean = true
  ): Promise<SlackChannel[]> {
    const request: ApiRequest = {
      method: 'GET',
      endpoint: '/api/conversations.list',
      params: {
        exclude_archived: excludeArchived,
        types: 'public_channel,private_channel'
      }
    };

    const response = await this.apiConnector.makeRequest(connectionId, request, tenantId);
    
    if (response.success && response.data?.channels) {
      return response.data.channels.map((channel: any) => ({
        id: channel.id,
        name: channel.name,
        is_private: channel.is_private,
        is_member: channel.is_member,
        topic: channel.topic?.value || '',
        purpose: channel.purpose?.value || ''
      }));
    }

    return [];
  }

  // Get user list
  async getUsers(
    connectionId: string,
    tenantId: string
  ): Promise<SlackUser[]> {
    const request: ApiRequest = {
      method: 'GET',
      endpoint: '/api/users.list'
    };

    const response = await this.apiConnector.makeRequest(connectionId, request, tenantId);
    
    if (response.success && response.data?.members) {
      return response.data.members.map((user: any) => ({
        id: user.id,
        name: user.name,
        real_name: user.real_name || user.name,
        email: user.profile?.email || '',
        is_bot: user.is_bot,
        profile: user.profile
      }));
    }

    return [];
  }

  // Upload file to Slack
  async uploadFile(
    connectionId: string,
    tenantId: string,
    file: Buffer,
    filename: string,
    channels: string[],
    title?: string,
    initialComment?: string
  ): Promise<ApiResponse> {
    const formData = new FormData();
    formData.append('file', file, { filename });
    formData.append('channels', channels.join(','));

    if (title) formData.append('title', title);
    if (initialComment) formData.append('initial_comment', initialComment);

    const rawHeaders = formData.getHeaders();
    const headers = Object.entries(rawHeaders).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        const normalizedKey = key.toLowerCase() === 'content-type' ? 'Content-Type' : key;
        acc[normalizedKey] = String(value);
        return acc;
      },
      {}
    );

    const request: ApiRequest = {
      method: 'POST',
      endpoint: '/api/files.upload',
      data: formData,
      headers
    };

    return await this.apiConnector.makeRequest(connectionId, request, tenantId);
  }

  // Create Slack connection configuration with encrypted tokens
  static createConnectionConfig(botToken: string, encryptionKey?: string): any {
    // Import encryption utilities
    const { encryptPayload } = require('../../utils/encryption');
    
    let credentials: any = {
      token: botToken
    };

    // Encrypt bot token if encryption key is provided
    if (encryptionKey) {
      try {
        credentials = {
          token: encryptPayload(botToken, encryptionKey),
          encrypted: true
        };
      } catch (error) {
        console.warn('Failed to encrypt bot token for Slack connector:', error);
        // Fall back to unencrypted (should be avoided in production)
      }
    } else {
      console.warn('Slack connector: No encryption key provided. Bot token will be stored unencrypted.');
    }

    return {
      name: 'Slack Integration',
      type: 'slack',
      baseUrl: 'https://slack.com',
      authentication: {
        type: 'bearer',
        credentials
      },
      headers: {
        'Content-Type': 'application/json'
      },
      rateLimit: {
        requestsPerSecond: 1,
        requestsPerMinute: 50,
        requestsPerHour: 1000,
        burstLimit: 5
      },
      retryConfig: {
        maxRetries: 3,
        backoffMultiplier: 2,
        maxBackoffMs: 10000,
        retryableStatusCodes: [429, 500, 502, 503, 504]
      },
      isActive: true,
      metadata: {
        provider: 'slack',
        version: '1.0'
      }
    };
  }
}
