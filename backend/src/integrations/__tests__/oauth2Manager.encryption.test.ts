import { OAuth2Manager } from '../oauth2Manager';
import { encryptPayload, isEncryptedPayload } from '../../utils/encryption';

jest.mock(
  'axios',
  () => ({
    post: jest.fn(),
    get: jest.fn()
  }),
  { virtual: true }
);

describe('OAuth2Manager encryption', () => {
  let prismaMock: any;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock = {
      oAuth2Provider: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn()
      },
      oAuth2Connection: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      }
    };
  });

  it('encrypts client secrets when registering providers', async () => {
    const manager = new OAuth2Manager(prismaMock as any);
    const providerData = {
      name: 'Test Provider',
      authUrl: 'https://example.com/auth',
      tokenUrl: 'https://example.com/token',
      clientId: 'client-id',
      clientSecret: 'super-secret',
      scopes: ['email'],
      redirectUri: 'https://app.example.com/callback',
      isActive: true
    };

    (prismaMock.oAuth2Provider.create as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 'provider-1',
      tenantId: data.tenantId,
      name: data.name,
      authUrl: data.authUrl,
      tokenUrl: data.tokenUrl,
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      scopes: data.scopes,
      redirectUri: data.redirectUri,
      isActive: data.isActive,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const providerId = await manager.registerProvider('tenant-1', providerData);
    expect(providerId).toBe('provider-1');

    const storedSecret = (prismaMock.oAuth2Provider.create as jest.Mock).mock.calls[0][0].data
      .clientSecret;

    expect(typeof storedSecret).toBe('string');
    expect(storedSecret).not.toContain(providerData.clientSecret);

    const parsed = JSON.parse(storedSecret);
    expect(isEncryptedPayload(parsed)).toBe(true);

    const cachedProvider = (manager as any).providers.get(providerId);
    expect(cachedProvider.clientSecret).toBe(providerData.clientSecret);

    expect((console.error as jest.Mock).mock.calls.join('')).not.toContain(providerData.clientSecret);
  });

  it('encrypts access and refresh tokens when saving connections', async () => {
    const manager = new OAuth2Manager(prismaMock as any);
    const tokens = {
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
      tokenType: 'Bearer',
      expiresIn: 3600,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      scope: 'email'
    };

    (prismaMock.oAuth2Connection.create as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 'connection-1',
      userId: data.userId,
      tenantId: data.tenantId,
      providerId: data.providerId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tokenType: data.tokenType,
      expiresAt: data.expiresAt,
      scope: data.scope,
      userInfo: data.userInfo,
      isActive: data.isActive,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const connection = await (manager as any).saveConnection(
      'user-1',
      'tenant-1',
      'provider-1',
      tokens,
      { email: 'user@example.com' }
    );

    const savedData = (prismaMock.oAuth2Connection.create as jest.Mock).mock.calls[0][0].data;
    const accessPayload = JSON.parse(savedData.accessToken);
    expect(isEncryptedPayload(accessPayload)).toBe(true);
    expect(savedData.accessToken).not.toContain(tokens.accessToken);

    const refreshPayload = JSON.parse(savedData.refreshToken);
    expect(isEncryptedPayload(refreshPayload)).toBe(true);
    expect(savedData.refreshToken).not.toContain(tokens.refreshToken as string);

    expect(connection.tokens.accessToken).toBe(tokens.accessToken);
    expect(connection.tokens.refreshToken).toBe(tokens.refreshToken);

    expect((console.error as jest.Mock).mock.calls.join('')).not.toContain(tokens.accessToken);
    expect((console.error as jest.Mock).mock.calls.join('')).not.toContain(tokens.refreshToken as string);
  });

  it('decrypts encrypted providers during load', async () => {
    const encryptionKey = process.env.OAUTH2_ENCRYPTION_KEY as string;
    const encryptedSecret = JSON.stringify(encryptPayload('cached-secret', encryptionKey));

    (prismaMock.oAuth2Provider.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'provider-42',
        tenantId: 'tenant-42',
        name: 'Encrypted Provider',
        authUrl: 'https://example.com/auth',
        tokenUrl: 'https://example.com/token',
        clientId: 'client-42',
        clientSecret: encryptedSecret,
        scopes: ['profile'],
        redirectUri: 'https://app.example.com/callback',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    const manager = new OAuth2Manager(prismaMock as any);
    await (manager as any).loadProviders();

    const cached = (manager as any).providers.get('provider-42');
    expect(cached).toBeDefined();
    expect(cached.clientSecret).toBe('cached-secret');
  });

  it('decodes legacy base64 client secrets during load', async () => {
    const legacySecret = Buffer.from('legacy-secret', 'utf8').toString('base64');

    (prismaMock.oAuth2Provider.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'provider-legacy',
        tenantId: 'tenant-legacy',
        name: 'Legacy Provider',
        authUrl: 'https://example.com/auth',
        tokenUrl: 'https://example.com/token',
        clientId: 'legacy-client',
        clientSecret: legacySecret,
        scopes: ['email'],
        redirectUri: 'https://app.example.com/callback',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    const manager = new OAuth2Manager(prismaMock as any);
    await (manager as any).loadProviders();

    const cached = (manager as any).providers.get('provider-legacy');
    expect(cached).toBeDefined();
    expect(cached.clientSecret).toBe('legacy-secret');
  });

  it('decrypts stored tokens when retrieving user connections', async () => {
    const manager = new OAuth2Manager(prismaMock as any);
    const encryptionKey = process.env.OAUTH2_ENCRYPTION_KEY as string;
    const encryptedAccess = JSON.stringify(encryptPayload('stored-access', encryptionKey));
    const encryptedRefresh = JSON.stringify(encryptPayload('stored-refresh', encryptionKey));

    (prismaMock.oAuth2Connection.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 'connection-55',
        userId: 'user-55',
        tenantId: 'tenant-55',
        providerId: 'provider-55',
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 1000),
        scope: 'email',
        userInfo: { email: 'user@example.com' },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    const connections = await manager.getUserConnections('user-55', 'tenant-55');
    expect(connections).toHaveLength(1);
    expect(connections[0].tokens.accessToken).toBe('stored-access');
    expect(connections[0].tokens.refreshToken).toBe('stored-refresh');
  });
});
