import { ApiConnector, ApiConnection, ApiRequest } from '../apiConnector';

const findManyMock = jest.fn();
const findFirstMock = jest.fn();
const createMock = jest.fn();
const updateMock = jest.fn();
const deleteManyMock = jest.fn();
const logCreateMock = jest.fn();

jest.mock(
  'axios',
  () => ({
    create: jest.fn(() => ({
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      },
      request: jest.fn()
    }))
  }),
  { virtual: true }
);

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    apiConnection: {
      create: createMock,
      findFirst: findFirstMock,
      findMany: findManyMock,
      update: updateMock,
      deleteMany: deleteManyMock
    },
    apiRequestLog: {
      create: logCreateMock
    }
  }))
}));

describe('ApiConnector tenant cache isolation', () => {
  const baseConnection: ApiConnection = {
    id: 'connection-1',
    name: 'Test Connection',
    type: 'api_key',
    baseUrl: 'https://example.com',
    authentication: {
      type: 'api_key',
      credentials: {
        headerName: 'X-API-KEY',
        apiKey: 'secret-key'
      }
    },
    headers: {},
    rateLimit: {
      requestsPerSecond: 5,
      requestsPerMinute: 100,
      requestsPerHour: 1000,
      burstLimit: 10
    },
    retryConfig: {
      maxRetries: 1,
      backoffMultiplier: 2,
      maxBackoffMs: 2000,
      retryableStatusCodes: [500]
    },
    isActive: true,
    metadata: {}
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findManyMock.mockReset();
    findFirstMock.mockReset();
    createMock.mockReset();
    updateMock.mockReset();
    deleteManyMock.mockReset();
    logCreateMock.mockReset();
    findManyMock.mockResolvedValue([]);
    process.env.API_CONNECTOR_ENCRYPTION_KEY = 'test-api-connector-key';
  });

  afterEach(() => {
    delete process.env.API_CONNECTOR_ENCRYPTION_KEY;
  });

  it('does not return cached connection when tenant differs', async () => {
    const connector = new ApiConnector();
    const connectionId = 'connection-1';
    const tenantB = 'tenant-b';

    const cache = (connector as any).connections as Map<string, any>;
    cache.set(connectionId, { ...baseConnection, id: connectionId });

    findFirstMock.mockResolvedValueOnce(null);

    const result = await connector.getConnection(connectionId, tenantB);

    expect(result).toBeNull();
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: connectionId, tenantId: tenantB }
    });
  });

  it('blocks makeRequest for cached connection owned by another tenant', async () => {
    const connector = new ApiConnector();
    const connectionId = 'connection-1';
    const tenantB = 'tenant-b';

    const cache = (connector as any).connections as Map<string, any>;
    cache.set(connectionId, { ...baseConnection, id: connectionId });

    const clientMock = {
      request: jest.fn().mockResolvedValue({
        status: 200,
        data: { success: true },
        headers: {}
      })
    };

    const clientCache = (connector as any).clients as Map<string, any>;
    clientCache.set(connectionId, clientMock);

    findFirstMock.mockResolvedValueOnce(null);

    const request: ApiRequest = {
      method: 'GET',
      endpoint: '/data'
    };

    const response = await connector.makeRequest(connectionId, request, tenantB);

    expect(response.success).toBe(false);
    expect(response.error).toBe('Connection not found or inactive');
    expect(clientMock.request).not.toHaveBeenCalled();
  });
});
