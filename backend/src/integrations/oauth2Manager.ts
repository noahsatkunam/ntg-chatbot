import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import axios from 'axios';
import crypto from 'crypto';
import {
  decryptPayload,
  encryptPayload,
  ensureEncryptionKey,
  EncryptedPayload,
  isEncryptedPayload
} from '../utils/encryption';

export interface OAuth2Provider {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: string;
  isActive: boolean;
}

export interface OAuth2Token {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: Date;
  scope: string;
}

export interface OAuth2Connection {
  id: string;
  userId: string;
  tenantId: string;
  providerId: string;
  tokens: OAuth2Token;
  userInfo?: any;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class OAuth2Manager extends EventEmitter {
  private prisma: PrismaClient;
  private providers: Map<string, OAuth2Provider> = new Map();
  private pendingAuthorizations: Map<string, any> = new Map();
  private readonly encryptionKey: string | null;

  constructor(prismaClient?: PrismaClient) {
    super();
    this.prisma = prismaClient ?? new PrismaClient();
    const configuredKey =
      process.env.OAUTH2_ENCRYPTION_KEY ||
      process.env.API_CONNECTOR_ENCRYPTION_KEY ||
      process.env.ENCRYPTION_KEY ||
      '';
    const trimmedKey = configuredKey.trim();
    this.encryptionKey = trimmedKey.length > 0 ? trimmedKey : null;

    if (!this.encryptionKey) {
      console.warn(
        'OAuth2Manager encryption key is not configured. Provider registration and connection persistence will be blocked until a key is provided.'
      );
    }
    this.loadProviders();
  }

  // Register OAuth2 provider
  async registerProvider(
    tenantId: string,
    providerData: Omit<OAuth2Provider, 'id'>
  ): Promise<string> {
    try {
      const encryptionKey = this.requireEncryptionKey('OAuth2Manager.registerProvider');
      // Encrypt client secret
      const encryptedSecret = this.serializeEncryptedPayload(
        this.encryptSecret(providerData.clientSecret, encryptionKey)
      );

      const provider = await this.prisma.oAuth2Provider.create({
        data: {
          tenantId,
          name: providerData.name,
          authUrl: providerData.authUrl,
          tokenUrl: providerData.tokenUrl,
          clientId: providerData.clientId,
          clientSecret: encryptedSecret,
          scopes: providerData.scopes,
          redirectUri: providerData.redirectUri,
          isActive: providerData.isActive
        }
      });

      // Cache provider
      const oauth2Provider: OAuth2Provider = {
        id: provider.id,
        name: provider.name,
        authUrl: provider.authUrl,
        tokenUrl: provider.tokenUrl,
        clientId: provider.clientId,
        clientSecret: providerData.clientSecret, // Keep decrypted in memory
        scopes: provider.scopes,
        redirectUri: provider.redirectUri,
        isActive: provider.isActive
      };

      this.providers.set(provider.id, oauth2Provider);

      this.emit('provider:registered', {
        providerId: provider.id,
        tenantId,
        name: providerData.name
      });

      return provider.id;

    } catch (error) {
      console.error('Error registering OAuth2 provider:', error);
      throw error;
    }
  }

  // Generate authorization URL
  async generateAuthUrl(
    providerId: string,
    userId: string,
    tenantId: string,
    state?: string
  ): Promise<string> {
    const provider = await this.getProvider(providerId, tenantId);
    if (!provider) {
      throw new Error('Provider not found');
    }

    // Generate state parameter for security
    const authState = state || crypto.randomBytes(32).toString('hex');
    
    // Store pending authorization
    this.pendingAuthorizations.set(authState, {
      providerId,
      userId,
      tenantId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    });

    // Build authorization URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: provider.clientId,
      redirect_uri: provider.redirectUri,
      scope: provider.scopes.join(' '),
      state: authState,
      access_type: 'offline', // Request refresh token
      prompt: 'consent' // Force consent screen
    });

    const authUrl = `${provider.authUrl}?${params.toString()}`;

    this.emit('auth:url:generated', {
      providerId,
      userId,
      tenantId,
      authUrl,
      state: authState
    });

    return authUrl;
  }

  // Handle OAuth2 callback
  async handleCallback(
    code: string,
    state: string,
    error?: string
  ): Promise<OAuth2Connection> {
    if (error) {
      throw new Error(`OAuth2 error: ${error}`);
    }

    // Validate state
    const pendingAuth = this.pendingAuthorizations.get(state);
    if (!pendingAuth) {
      throw new Error('Invalid or expired state parameter');
    }

    // Check expiration
    if (new Date() > pendingAuth.expiresAt) {
      this.pendingAuthorizations.delete(state);
      throw new Error('Authorization request expired');
    }

    const { providerId, userId, tenantId } = pendingAuth;

    try {
      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(providerId, tenantId, code);
      
      // Get user info from provider
      const userInfo = await this.getUserInfo(providerId, tenantId, tokens.accessToken);

      // Save connection
      const connection = await this.saveConnection(
        userId,
        tenantId,
        providerId,
        tokens,
        userInfo
      );

      // Clean up pending authorization
      this.pendingAuthorizations.delete(state);

      this.emit('auth:completed', {
        connectionId: connection.id,
        providerId,
        userId,
        tenantId
      });

      return connection;

    } catch (error) {
      this.pendingAuthorizations.delete(state);
      
      this.emit('auth:failed', {
        providerId,
        userId,
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  // Refresh access token
  async refreshToken(connectionId: string, tenantId: string): Promise<OAuth2Token> {
    const connection = await this.prisma.oAuth2Connection.findFirst({
      where: { id: connectionId, tenantId },
      include: { provider: true }
    });

    if (!connection) {
      throw new Error('Connection not found or no refresh token available');
    }

    const storedRefreshToken = this.decryptConnectionToken(
      connection.refreshToken,
      'OAuth2Manager.refreshToken.refreshToken'
    );

    if (!storedRefreshToken) {
      throw new Error('Connection not found or no refresh token available');
    }

    const provider = await this.getProvider(connection.providerId, tenantId);
    if (!provider) {
      throw new Error('Provider not found');
    }

    try {
      const response = await axios.post(provider.tokenUrl, {
        grant_type: 'refresh_token',
        refresh_token: storedRefreshToken,
        client_id: provider.clientId,
        client_secret: provider.clientSecret
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const tokenData = response.data;
      const newTokens: OAuth2Token = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || storedRefreshToken,
        tokenType: tokenData.token_type || 'Bearer',
        expiresIn: tokenData.expires_in || 3600,
        expiresAt: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
        scope: tokenData.scope || connection.scope
      };

      const encryptionKey = this.requireEncryptionKey('OAuth2Manager.refreshToken.persist');
      const encryptedAccessToken = this.serializeEncryptedPayload(
        this.encryptToken(newTokens.accessToken, encryptionKey)
      );
      const encryptedRefreshToken = newTokens.refreshToken
        ? this.serializeEncryptedPayload(this.encryptToken(newTokens.refreshToken, encryptionKey))
        : null;

      // Update connection with new tokens
      await this.prisma.oAuth2Connection.update({
        where: { id: connectionId },
        data: {
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken ?? undefined,
          expiresAt: newTokens.expiresAt,
          scope: newTokens.scope,
          updatedAt: new Date()
        }
      });

      this.emit('token:refreshed', {
        connectionId,
        providerId: connection.providerId,
        tenantId
      });

      return newTokens;

    } catch (error) {
      console.error('Error refreshing token:', error);
      
      this.emit('token:refresh:failed', {
        connectionId,
        providerId: connection.providerId,
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  // Revoke OAuth2 connection
  async revokeConnection(connectionId: string, tenantId: string): Promise<void> {
    const connection = await this.prisma.oAuth2Connection.findFirst({
      where: { id: connectionId, tenantId },
      include: { provider: true }
    });

    if (!connection) {
      throw new Error('Connection not found');
    }

    const provider = await this.getProvider(connection.providerId, tenantId);
    const decryptedAccessToken = this.decryptConnectionToken(
      connection.accessToken,
      'OAuth2Manager.revokeConnection.accessToken'
    );

    try {
      // Revoke token with provider if supported
      if (provider && decryptedAccessToken && this.supportsTokenRevocation(provider.name)) {
        await this.revokeTokenWithProvider(provider, decryptedAccessToken);
      }

      // Delete connection from database
      await this.prisma.oAuth2Connection.delete({
        where: { id: connectionId }
      });

      this.emit('connection:revoked', {
        connectionId,
        providerId: connection.providerId,
        tenantId
      });

    } catch (error) {
      console.error('Error revoking connection:', error);
      throw error;
    }
  }

  // Get user connections
  async getUserConnections(userId: string, tenantId: string): Promise<OAuth2Connection[]> {
    const connections = await this.prisma.oAuth2Connection.findMany({
      where: { userId, tenantId, isActive: true },
      include: { provider: true },
      orderBy: { createdAt: 'desc' }
    });

    const decryptedConnections: OAuth2Connection[] = [];

    for (const conn of connections) {
      const accessToken = this.decryptConnectionToken(
        conn.accessToken,
        `OAuth2Manager.getUserConnections.${conn.id}.accessToken`
      );

      if (!accessToken) {
        console.error('Failed to decrypt OAuth2 access token', {
          connectionId: conn.id,
          tenantId: conn.tenantId
        });
        continue;
      }

      const refreshToken = this.decryptConnectionToken(
        conn.refreshToken,
        `OAuth2Manager.getUserConnections.${conn.id}.refreshToken`
      );

      decryptedConnections.push({
        id: conn.id,
        userId: conn.userId,
        tenantId: conn.tenantId,
        providerId: conn.providerId,
        tokens: {
          accessToken,
          refreshToken: refreshToken ?? undefined,
          tokenType: conn.tokenType,
          expiresIn: 0, // Calculate from expiresAt
          expiresAt: conn.expiresAt,
          scope: conn.scope
        },
        userInfo: conn.userInfo as any,
        isActive: conn.isActive,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt
      });
    }

    return decryptedConnections;
  }

  // Check if token is expired
  isTokenExpired(connection: OAuth2Connection): boolean {
    return new Date() >= connection.tokens.expiresAt;
  }

  // Get valid access token (refresh if needed)
  async getValidAccessToken(connectionId: string, tenantId: string): Promise<string> {
    const connections = await this.getUserConnections('', tenantId); // Get by connection ID
    const connection = connections.find(c => c.id === connectionId);

    if (!connection) {
      throw new Error('Connection not found');
    }

    if (this.isTokenExpired(connection)) {
      const newTokens = await this.refreshToken(connectionId, tenantId);
      return newTokens.accessToken;
    }

    return connection.tokens.accessToken;
  }

  // Private helper methods
  private async getProvider(providerId: string, tenantId: string): Promise<OAuth2Provider | null> {
    // Check cache first
    if (this.providers.has(providerId)) {
      return this.providers.get(providerId)!;
    }

    // Load from database
    const provider = await this.prisma.oAuth2Provider.findFirst({
      where: { id: providerId, tenantId }
    });

    if (!provider) {
      return null;
    }

    // Decrypt client secret
    let decryptedSecret: string;
    try {
      decryptedSecret = this.decryptClientSecret(provider.clientSecret);
    } catch (error) {
      console.error('Failed to decrypt OAuth2 provider client secret', {
        providerId: provider.id,
        tenantId
      });
      throw error;
    }

    const oauth2Provider: OAuth2Provider = {
      id: provider.id,
      name: provider.name,
      authUrl: provider.authUrl,
      tokenUrl: provider.tokenUrl,
      clientId: provider.clientId,
      clientSecret: decryptedSecret,
      scopes: provider.scopes,
      redirectUri: provider.redirectUri,
      isActive: provider.isActive
    };

    this.providers.set(providerId, oauth2Provider);
    return oauth2Provider;
  }

  private async exchangeCodeForTokens(
    providerId: string,
    tenantId: string,
    code: string
  ): Promise<OAuth2Token> {
    const provider = await this.getProvider(providerId, tenantId);
    if (!provider) {
      throw new Error('Provider not found');
    }

    const response = await axios.post(provider.tokenUrl, {
      grant_type: 'authorization_code',
      code,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      redirect_uri: provider.redirectUri
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const tokenData = response.data;
    
    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenType: tokenData.token_type || 'Bearer',
      expiresIn: tokenData.expires_in || 3600,
      expiresAt: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
      scope: tokenData.scope || provider.scopes.join(' ')
    };
  }

  private async getUserInfo(
    providerId: string,
    tenantId: string,
    accessToken: string
  ): Promise<any> {
    const provider = await this.getProvider(providerId, tenantId);
    if (!provider) {
      return null;
    }

    try {
      // Provider-specific user info endpoints
      const userInfoUrl = this.getUserInfoUrl(provider.name);
      if (!userInfoUrl) {
        return null;
      }

      const response = await axios.get(userInfoUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      return response.data;

    } catch (error) {
      console.error('Error getting user info:', error);
      return null;
    }
  }

  private getUserInfoUrl(providerName: string): string | null {
    const userInfoUrls: { [key: string]: string } = {
      'google': 'https://www.googleapis.com/oauth2/v2/userinfo',
      'microsoft': 'https://graph.microsoft.com/v1.0/me',
      'github': 'https://api.github.com/user',
      'slack': 'https://slack.com/api/users.identity'
    };

    return userInfoUrls[providerName.toLowerCase()] || null;
  }

  private async saveConnection(
    userId: string,
    tenantId: string,
    providerId: string,
    tokens: OAuth2Token,
    userInfo: any
  ): Promise<OAuth2Connection> {
    const encryptionKey = this.requireEncryptionKey('OAuth2Manager.saveConnection');
    const encryptedAccessToken = this.serializeEncryptedPayload(
      this.encryptToken(tokens.accessToken, encryptionKey)
    );
    const encryptedRefreshToken = tokens.refreshToken
      ? this.serializeEncryptedPayload(this.encryptToken(tokens.refreshToken, encryptionKey))
      : null;

    const connection = await this.prisma.oAuth2Connection.create({
      data: {
        userId,
        tenantId,
        providerId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken ?? undefined,
        tokenType: tokens.tokenType,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
        userInfo,
        isActive: true
      }
    });

    return {
      id: connection.id,
      userId: connection.userId,
      tenantId: connection.tenantId,
      providerId: connection.providerId,
      tokens,
      userInfo: connection.userInfo as any,
      isActive: connection.isActive,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt
    };
  }

  private supportsTokenRevocation(providerName: string): boolean {
    const supportedProviders = ['google', 'microsoft', 'github'];
    return supportedProviders.includes(providerName.toLowerCase());
  }

  private async revokeTokenWithProvider(
    provider: OAuth2Provider,
    accessToken: string
  ): Promise<void> {
    const revokeUrls: { [key: string]: string } = {
      'google': 'https://oauth2.googleapis.com/revoke',
      'microsoft': 'https://graph.microsoft.com/v1.0/me/revokeSignInSessions',
      'github': 'https://api.github.com/applications/{client_id}/grant'
    };

    const revokeUrl = revokeUrls[provider.name.toLowerCase()];
    if (!revokeUrl) {
      return;
    }

    try {
      await axios.post(revokeUrl, {
        token: accessToken
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
    } catch (error) {
      console.error('Error revoking token with provider:', error);
      // Don't throw - we still want to delete the local connection
    }
  }

  private requireEncryptionKey(context: string): string {
    return ensureEncryptionKey(this.encryptionKey, context);
  }

  private serializeEncryptedPayload(payload: EncryptedPayload): string {
    return JSON.stringify(payload);
  }

  private parseEncryptedPayload(value: unknown): EncryptedPayload | null {
    if (!value) {
      return null;
    }

    if (isEncryptedPayload(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      try {
        const parsed = JSON.parse(trimmed);
        if (isEncryptedPayload(parsed)) {
          return parsed;
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  private encryptSecret(secret: string, encryptionKey: string): EncryptedPayload {
    return encryptPayload(secret, encryptionKey);
  }

  private encryptToken(token: string, encryptionKey: string): EncryptedPayload {
    return encryptPayload(token, encryptionKey);
  }

  private decryptClientSecret(storedSecret: unknown): string {
    const encryptedPayload = this.parseEncryptedPayload(storedSecret);

    if (encryptedPayload) {
      const encryptionKey = this.requireEncryptionKey('OAuth2Manager.decryptClientSecret');
      return decryptPayload<string>(encryptedPayload, encryptionKey);
    }

    if (typeof storedSecret === 'string') {
      const trimmed = storedSecret.trim();
      if (!trimmed) {
        throw new Error('Stored client secret is empty');
      }

      try {
        const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
        if (
          decoded &&
          Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '') === trimmed.replace(/=+$/, '')
        ) {
          return decoded;
        }
      } catch {
        // Not base64 - fall through to return trimmed string
      }

      return trimmed;
    }

    throw new Error('Unsupported client secret format');
  }

  private decryptConnectionToken(storedToken: unknown, context: string): string | null {
    if (!storedToken) {
      return null;
    }

    const encryptedPayload = this.parseEncryptedPayload(storedToken);
    if (encryptedPayload) {
      const encryptionKey = this.requireEncryptionKey(context);
      return decryptPayload<string>(encryptedPayload, encryptionKey);
    }

    if (typeof storedToken === 'string') {
      return storedToken;
    }

    return null;
  }

  private async loadProviders(): Promise<void> {
    try {
      const providers = await this.prisma.oAuth2Provider.findMany({
        where: { isActive: true }
      });

      for (const provider of providers) {
        try {
          const decryptedSecret = this.decryptClientSecret(provider.clientSecret);

          this.providers.set(provider.id, {
            id: provider.id,
            name: provider.name,
            authUrl: provider.authUrl,
            tokenUrl: provider.tokenUrl,
            clientId: provider.clientId,
            clientSecret: decryptedSecret,
            scopes: provider.scopes,
            redirectUri: provider.redirectUri,
            isActive: provider.isActive
          });
        } catch (error) {
          console.error('Failed to cache OAuth2 provider', {
            providerId: provider.id,
            tenantId: provider.tenantId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    } catch (error) {
      console.error('Error loading OAuth2 providers:', error);
    }
  }

  // Cleanup expired pending authorizations
  private startCleanupTimer(): void {
    setInterval(() => {
      const now = new Date();
      for (const [state, auth] of this.pendingAuthorizations) {
        if (now > auth.expiresAt) {
          this.pendingAuthorizations.delete(state);
        }
      }
    }, 5 * 60 * 1000); // Clean up every 5 minutes
  }
}
