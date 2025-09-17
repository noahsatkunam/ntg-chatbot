import { http, HttpResponse } from 'msw';
import { User, Tenant, Conversation, ChatMessage, KnowledgeDocument, Workflow } from '../../types/api';

// Mock data
const mockUser: User = {
  id: '1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'user',
  tenantId: 'tenant-1',
  isActive: true,
  lastLoginAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockTenant: Tenant = {
  id: 'tenant-1',
  name: 'Test Tenant',
  settings: {
    features: {
      chat: true,
      knowledgeBase: true,
      workflows: true,
      analytics: true,
      streaming: true,
    },
    limits: {
      users: 100,
      conversations: 1000,
      documents: 500,
      workflows: 50,
    },
    branding: {
      primaryColor: '#0f172a',
      secondaryColor: '#64748b',
      logo: null,
    },
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockConversations: Conversation[] = [
  {
    id: 'conv-1',
    title: 'Test Conversation',
    tenantId: 'tenant-1',
    userId: '1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockMessages: ChatMessage[] = [
  {
    id: 'msg-1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'Hello, how can you help me?',
    tenantId: 'tenant-1',
    userId: '1',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'msg-2',
    conversationId: 'conv-1',
    role: 'assistant',
    content: 'I can help you with various tasks. What would you like to know?',
    tenantId: 'tenant-1',
    createdAt: new Date().toISOString(),
  },
];

const mockDocuments: KnowledgeDocument[] = [
  {
    id: 'doc-1',
    name: 'Test Document',
    filename: 'test.pdf',
    contentType: 'application/pdf',
    size: 1024000,
    status: 'processed',
    metadata: {
      fileSize: 1024000,
      pageCount: 10,
      language: 'en',
      description: 'A test document',
      tags: ['test', 'sample'],
    },
    tenantId: 'tenant-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockWorkflows: Workflow[] = [
  {
    id: 'workflow-1',
    name: 'Test Workflow',
    description: 'A test workflow',
    status: 'active',
    trigger: {
      type: 'webhook',
      config: {},
    },
    nodes: [],
    tenantId: 'tenant-1',
    createdBy: '1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    executionCount: 5,
  },
];

export const handlers = [
  // Auth endpoints
  http.post('/api/auth/login', () => {
    return HttpResponse.json({
      success: true,
      data: {
        user: mockUser,
        tokens: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
      },
    });
  }),

  http.post('/api/auth/register', () => {
    return HttpResponse.json({
      success: true,
      data: {
        user: mockUser,
        tokens: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
      },
    });
  }),

  http.get('/api/auth/me', () => {
    return HttpResponse.json({
      success: true,
      data: mockUser,
    });
  }),

  http.post('/api/auth/logout', () => {
    return HttpResponse.json({
      success: true,
      data: null,
    });
  }),

  // Tenant endpoints
  http.get('/api/tenant', () => {
    return HttpResponse.json({
      success: true,
      data: mockTenant,
    });
  }),

  // Chat endpoints
  http.get('/api/conversations', () => {
    return HttpResponse.json({
      success: true,
      data: {
        items: mockConversations,
        total: mockConversations.length,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    });
  }),

  http.post('/api/conversations', () => {
    const newConversation: Conversation = {
      id: 'conv-new',
      title: 'New Conversation',
      tenantId: 'tenant-1',
      userId: '1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return HttpResponse.json({
      success: true,
      data: newConversation,
    });
  }),

  http.get('/api/conversations/:id/messages', () => {
    return HttpResponse.json({
      success: true,
      data: {
        items: mockMessages,
        total: mockMessages.length,
        page: 1,
        limit: 50,
        totalPages: 1,
      },
    });
  }),

  http.post('/api/conversations/:id/messages', () => {
    const newMessage: ChatMessage = {
      id: 'msg-new',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'This is a mock response',
      tenantId: 'tenant-1',
      createdAt: new Date().toISOString(),
    };
    return HttpResponse.json({
      success: true,
      data: newMessage,
    });
  }),

  // Knowledge base endpoints
  http.get('/api/knowledge/documents', () => {
    return HttpResponse.json({
      success: true,
      data: {
        items: mockDocuments,
        total: mockDocuments.length,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    });
  }),

  http.post('/api/knowledge/documents', () => {
    const newDocument: KnowledgeDocument = {
      id: 'doc-new',
      name: 'New Document',
      filename: 'new.pdf',
      contentType: 'application/pdf',
      size: 2048000,
      status: 'processing',
      metadata: {
        fileSize: 2048000,
        pageCount: 0,
        language: 'en',
      },
      tenantId: 'tenant-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return HttpResponse.json({
      success: true,
      data: newDocument,
    });
  }),

  http.delete('/api/knowledge/documents/:id', () => {
    return HttpResponse.json({
      success: true,
      data: null,
    });
  }),

  // Workflow endpoints
  http.get('/api/workflows', () => {
    return HttpResponse.json({
      success: true,
      data: {
        items: mockWorkflows,
        total: mockWorkflows.length,
        page: 1,
        limit: 50,
        totalPages: 1,
      },
    });
  }),

  http.post('/api/workflows', () => {
    const newWorkflow: Workflow = {
      id: 'workflow-new',
      name: 'New Workflow',
      description: 'A new workflow',
      status: 'draft',
      trigger: {
        type: 'manual',
        config: {},
      },
      nodes: [],
      tenantId: 'tenant-1',
      createdBy: '1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionCount: 0,
    };
    return HttpResponse.json({
      success: true,
      data: newWorkflow,
    });
  }),

  http.post('/api/workflows/:id/execute', () => {
    return HttpResponse.json({
      success: true,
      data: {
        id: 'exec-1',
        workflowId: 'workflow-1',
        status: 'running',
        startedAt: new Date().toISOString(),
        input: {},
        logs: [],
      },
    });
  }),

  // Error handlers for testing error states
  http.get('/api/error/500', () => {
    return HttpResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }),

  http.get('/api/error/401', () => {
    return HttpResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }),
];
