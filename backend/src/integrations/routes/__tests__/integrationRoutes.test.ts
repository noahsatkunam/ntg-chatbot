import express from 'express';
import request from 'supertest';

const workflowFindManyMock = jest.fn();
const hasRequiredContextMock = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    workflow: {
      findMany: workflowFindManyMock,
    },
  })),
}));

jest.mock('../../contextManager', () => ({
  ContextManager: jest.fn().mockImplementation(() => ({
    hasRequiredContext: hasRequiredContextMock,
    getWorkflowContext: jest.fn(),
  })),
}));

jest.mock('../../workflowExecutor', () => ({
  WorkflowExecutor: jest.fn().mockImplementation(() => ({
    executeWorkflow: jest.fn(),
  })),
}));

jest.mock('../../chatTriggerService', () => ({
  ChatTriggerService: jest.fn().mockImplementation(() => ({
    detectTriggers: jest.fn(),
    on: jest.fn(),
  })),
}));

jest.mock('../../responseHandler', () => ({
  ResponseHandler: jest.fn().mockImplementation(() => ({
    processResponse: jest.fn(),
  })),
}));

jest.mock('../../intentDetector', () => ({
  IntentDetector: jest.fn().mockImplementation(() => ({
    detectIntent: jest.fn(),
  })),
}));

import integrationRoutes from '../integrationRoutes';

describe('GET /workflows/available', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
    workflowFindManyMock.mockReset();
    hasRequiredContextMock.mockReset();
  });

  it('returns active workflows using metadata from definitions', async () => {
    const createdAt = new Date('2024-01-01T00:00:00.000Z');

    workflowFindManyMock.mockResolvedValue([
      {
        id: 'workflow-1',
        name: 'Active Workflow',
        description: 'Example workflow',
        definition: {
          metadata: {
            type: 'automatic',
            requiresConfirmation: true,
            estimatedDuration: 300,
            tags: ['metadata-tag'],
          },
        },
        tags: ['db-tag'],
        status: 'active',
        createdAt,
      },
    ]);

    hasRequiredContextMock.mockResolvedValue(true);

    const response = await request(app)
      .get('/api/integrations/workflows/available')
      .query({ tenantId: 'tenant-123', conversationId: 'conversation-1' })
      .expect(200);

    expect(workflowFindManyMock).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-123',
        status: 'active',
      },
      select: {
        id: true,
        name: true,
        description: true,
        definition: true,
        tags: true,
        status: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });

    expect(hasRequiredContextMock).toHaveBeenCalledWith('conversation-1', 'workflow-1');

    expect(response.body).toEqual({
      workflows: [
        {
          id: 'workflow-1',
          name: 'Active Workflow',
          description: 'Example workflow',
          type: 'automatic',
          isActive: true,
          requiresConfirmation: true,
          estimatedDuration: 300,
          tags: ['db-tag', 'metadata-tag'],
        },
      ],
    });
  });

  it('skips workflows without required context and uses defaults when metadata is missing', async () => {
    workflowFindManyMock.mockResolvedValue([
      {
        id: 'workflow-2',
        name: 'Manual Workflow',
        description: 'Fallback workflow',
        definition: {},
        tags: null,
        status: 'active',
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
      },
    ]);

    hasRequiredContextMock.mockResolvedValue(false);

    const response = await request(app)
      .get('/api/integrations/workflows/available')
      .query({ tenantId: 'tenant-456', conversationId: 'conversation-2' })
      .expect(200);

    expect(hasRequiredContextMock).toHaveBeenCalledWith('conversation-2', 'workflow-2');
    expect(response.body).toEqual({ workflows: [] });

    hasRequiredContextMock.mockReset();
    hasRequiredContextMock.mockResolvedValue(true);

    const secondResponse = await request(app)
      .get('/api/integrations/workflows/available')
      .query({ tenantId: 'tenant-456', conversationId: 'conversation-2' })
      .expect(200);

    expect(hasRequiredContextMock).toHaveBeenCalledWith('conversation-2', 'workflow-2');
    expect(secondResponse.body).toEqual({
      workflows: [
        {
          id: 'workflow-2',
          name: 'Manual Workflow',
          description: 'Fallback workflow',
          type: 'manual',
          isActive: true,
          requiresConfirmation: false,
          tags: [],
        },
      ],
    });
    expect(secondResponse.body.workflows[0].estimatedDuration).toBeUndefined();
  });
});
