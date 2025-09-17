import { WorkflowExecutor, ExecutionRequest } from '../workflowExecutor';

const workflowFindFirstMock = jest.fn();
const userFindUniqueMock = jest.fn();
const workflowPermissionFindFirstMock = jest.fn();
const workflowExecutionCountMock = jest.fn();
const workflowConfirmationCreateMock = jest.fn();
const workflowConfirmationFindFirstMock = jest.fn();
const workflowConfirmationDeleteManyMock = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    workflow: {
      findFirst: workflowFindFirstMock,
    },
    user: {
      findUnique: userFindUniqueMock,
    },
    workflowPermission: {
      findFirst: workflowPermissionFindFirstMock,
    },
    workflowExecution: {
      count: workflowExecutionCountMock,
    },
    workflowConfirmation: {
      create: workflowConfirmationCreateMock,
      findFirst: workflowConfirmationFindFirstMock,
      deleteMany: workflowConfirmationDeleteManyMock,
    },
  })),
}));

const workflowServiceOnMock = jest.fn();
const workflowServiceExecuteMock = jest.fn();
const workflowServiceRetryMock = jest.fn();
const workflowServiceCancelMock = jest.fn();

jest.mock('../../workflows/workflowService', () => ({
  WorkflowService: jest.fn().mockImplementation(() => ({
    on: workflowServiceOnMock,
    executeWorkflow: workflowServiceExecuteMock,
    retryExecution: workflowServiceRetryMock,
    cancelExecution: workflowServiceCancelMock,
  })),
}));

const getConversationContextMock = jest.fn();
const getUserContextMock = jest.fn();

jest.mock('../contextManager', () => ({
  ContextManager: jest.fn().mockImplementation(() => ({
    getConversationContext: getConversationContextMock,
    getUserContext: getUserContextMock,
  })),
}));

const generateConfirmationRequestMock = jest.fn();
const generateCancellationResponseMock = jest.fn();
const generateSuccessResponseMock = jest.fn();
const generateErrorResponseMock = jest.fn();

jest.mock('../responseHandler', () => ({
  ResponseHandler: jest.fn().mockImplementation(() => ({
    generateConfirmationRequest: generateConfirmationRequestMock,
    generateCancellationResponse: generateCancellationResponseMock,
    generateSuccessResponse: generateSuccessResponseMock,
    generateErrorResponse: generateErrorResponseMock,
  })),
}));

describe('WorkflowExecutor persistence integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    workflowFindFirstMock.mockResolvedValue({
      id: 'wf-123',
      tenantId: 'tenant-1',
      status: 'active',
      riskLevel: 'low',
    });
    userFindUniqueMock.mockResolvedValue({
      id: 'user-1',
      role: 'TENANT_USER',
    });
    workflowPermissionFindFirstMock.mockResolvedValue(null);
    workflowExecutionCountMock.mockResolvedValue(0);
    workflowConfirmationCreateMock.mockResolvedValue({
      id: 'confirm-123',
    });
    workflowConfirmationFindFirstMock.mockResolvedValue(null);
    workflowConfirmationDeleteManyMock.mockResolvedValue({ count: 1 });
    workflowServiceExecuteMock.mockResolvedValue('exec-123');
    getConversationContextMock.mockResolvedValue({});
    getUserContextMock.mockResolvedValue({});
    generateConfirmationRequestMock.mockResolvedValue({
      type: 'confirmation',
      content: { message: 'confirm' },
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
    });
  });

  const buildRequest = (overrides: Partial<ExecutionRequest> = {}): ExecutionRequest => ({
    workflowId: 'wf-123',
    triggerMatch: {
      workflowId: 'wf-123',
      workflowName: 'Example Workflow',
      triggerType: 'keyword',
      matchedText: 'run workflow',
      confidence: 0.9,
      requiresConfirmation: false,
      parameters: {},
    },
    chatContext: {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      messageContent: 'please run workflow',
      messageType: 'user',
      timestamp: new Date('2024-01-01T10:00:00.000Z'),
      userId: 'user-1',
      tenantId: 'tenant-1',
      metadata: {},
      previousMessages: [],
    },
    parameters: {},
    ...overrides,
  });

  it('denies execution when a user-specific workflow permission forbids execution', async () => {
    workflowPermissionFindFirstMock.mockResolvedValueOnce({
      canExecute: false,
    });

    const executor = new WorkflowExecutor();
    const request = buildRequest();

    const result = await executor.executeWorkflow(request);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('No execute permission for this workflow');
    expect(workflowPermissionFindFirstMock).toHaveBeenCalledTimes(1);
    expect(workflowPermissionFindFirstMock).toHaveBeenCalledWith({
      where: {
        workflowId: 'wf-123',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    });
    expect(workflowServiceExecuteMock).not.toHaveBeenCalled();
    expect(workflowConfirmationCreateMock).not.toHaveBeenCalled();
  });

  it('persists confirmations and resumes execution after approval', async () => {
    workflowPermissionFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ canExecute: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ canExecute: true });

    const executor = new WorkflowExecutor();
    const request = buildRequest({
      triggerMatch: {
        workflowId: 'wf-123',
        workflowName: 'Example Workflow',
        triggerType: 'keyword',
        matchedText: 'run workflow',
        confidence: 0.9,
        requiresConfirmation: true,
        parameters: {},
      },
    });

    const pendingResult = await executor.executeWorkflow(request);

    expect(pendingResult.status).toBe('started');
    expect(pendingResult.executionId).toMatch(/^confirm_/);
    expect(generateConfirmationRequestMock).toHaveBeenCalledWith(
      request.triggerMatch,
      request.chatContext,
      pendingResult.executionId,
    );

    expect(workflowConfirmationCreateMock).toHaveBeenCalledTimes(1);
    const confirmationCreateArgs = workflowConfirmationCreateMock.mock.calls[0][0];
    expect(confirmationCreateArgs).toMatchObject({
      data: {
        workflowId: 'wf-123',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    });
    expect(confirmationCreateArgs.data.requestData.workflowId).toBe('wf-123');

    expect(workflowPermissionFindFirstMock).toHaveBeenNthCalledWith(1, {
      where: {
        workflowId: 'wf-123',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    });
    expect(workflowPermissionFindFirstMock).toHaveBeenNthCalledWith(2, {
      where: {
        workflowId: 'wf-123',
        tenantId: 'tenant-1',
        role: 'TENANT_USER',
      },
    });

    const confirmationId = pendingResult.executionId;
    const storedRequest: ExecutionRequest = {
      ...request,
      userConfirmed: undefined,
    };
    workflowConfirmationFindFirstMock.mockResolvedValueOnce({
      id: confirmationId,
      workflowId: 'wf-123',
      tenantId: 'tenant-1',
      userId: 'user-1',
      requestData: storedRequest,
      expiresAt: new Date(Date.now() + 60_000),
    });

    workflowServiceExecuteMock.mockResolvedValueOnce('exec-456');

    const confirmationContext = {
      ...request.chatContext,
      messageId: 'message-2',
      messageContent: 'yes',
      timestamp: new Date('2024-01-01T10:01:00.000Z'),
    };

    const confirmedResult = await executor.handleUserConfirmation(
      confirmationId,
      true,
      confirmationContext,
    );

    expect(workflowConfirmationFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: confirmationId,
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    });
    expect(workflowConfirmationDeleteManyMock).toHaveBeenCalledWith({
      where: {
        id: confirmationId,
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    });

    expect(workflowServiceExecuteMock).toHaveBeenCalledWith(
      'wf-123',
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        metadata: expect.objectContaining({
          triggerType: 'chat_message',
          conversationId: 'conversation-1',
          messageId: 'message-2',
          source: 'chat_integration',
        }),
      }),
    );
    expect(confirmedResult.executionId).toBe('exec-456');
    expect(confirmedResult.status).toBe('started');
  });
});

