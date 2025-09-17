import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { app } from '../../index';
import { createTestUser, createTestTenant, cleanupTestData } from '../helpers/testHelpers';

describe('End-to-End Platform Tests', () => {
  let prisma: PrismaClient;
  let testTenant: any;
  let testUser: any;
  let authToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    
    // Create test tenant and user
    testTenant = await createTestTenant(prisma);
    testUser = await createTestUser(prisma, testTenant.id);
    
    // Get auth token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: testUser.email,
        password: 'TestPassword123!'
      });
    
    authToken = loginResponse.body.token;
  });

  afterAll(async () => {
    await cleanupTestData(prisma, testTenant.id);
    await prisma.$disconnect();
  });

  describe('Authentication Flow', () => {
    it('should register a new user', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@test.com',
          password: 'TestPassword123!',
          firstName: 'New',
          lastName: 'User',
          tenantId: testTenant.id
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe('newuser@test.com');
    });

    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'TestPassword123!'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'wrongpassword'
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Chat System', () => {
    let conversationId: string;

    it('should create a new conversation', async () => {
      const response = await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Test Conversation',
          isGroup: false
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.conversation.title).toBe('Test Conversation');
      
      conversationId = response.body.conversation.id;
    });

    it('should send a message', async () => {
      const response = await request(app)
        .post('/api/chat/messages')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          conversationId,
          content: 'Hello, this is a test message',
          type: 'text'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message.content).toBe('Hello, this is a test message');
    });

    it('should retrieve conversation history', async () => {
      const response = await request(app)
        .get(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.messages).toHaveLength(1);
    });
  });

  describe('Workflow System', () => {
    let workflowId: string;
    let executionId: string;

    it('should create a workflow', async () => {
      const workflowDefinition = {
        nodes: [
          {
            id: 'start',
            type: 'trigger',
            position: { x: 100, y: 100 },
            data: { triggerType: 'manual' }
          },
          {
            id: 'action',
            type: 'action',
            position: { x: 300, y: 100 },
            data: { actionType: 'log', message: 'Hello World' }
          }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'action' }
        ]
      };

      const response = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Workflow',
          description: 'A simple test workflow',
          definition: workflowDefinition,
          isActive: true
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.workflow.name).toBe('Test Workflow');
      
      workflowId = response.body.workflow.id;
    });

    it('should execute a workflow', async () => {
      const response = await request(app)
        .post(`/api/workflows/${workflowId}/execute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          inputData: { test: 'data' }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.execution.status).toBe('started');
      
      executionId = response.body.execution.id;
    });

    it('should retrieve workflow execution status', async () => {
      const response = await request(app)
        .get(`/api/workflows/executions/${executionId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.execution.id).toBe(executionId);
    });
  });

  describe('Knowledge Base', () => {
    let documentId: string;

    it('should upload a document', async () => {
      const response = await request(app)
        .post('/api/knowledge/documents')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', Buffer.from('Test document content'), 'test.txt')
        .field('title', 'Test Document')
        .field('description', 'A test document for e2e testing');

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.document.title).toBe('Test Document');
      
      documentId = response.body.document.id;
    });

    it('should search documents', async () => {
      // Wait a bit for document processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      const response = await request(app)
        .post('/api/knowledge/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'test document',
          options: {
            limit: 10,
            searchType: 'hybrid'
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.results.length).toBeGreaterThan(0);
    });
  });

  describe('API Connectors', () => {
    let connectionId: string;

    it('should create an API connection', async () => {
      const response = await request(app)
        .post('/api/integrations/connections')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test API Connection',
          type: 'rest',
          baseUrl: 'https://jsonplaceholder.typicode.com',
          authentication: {
            type: 'none',
            credentials: {}
          },
          rateLimit: {
            requestsPerSecond: 1,
            requestsPerMinute: 60
          },
          isActive: true
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.connection.name).toBe('Test API Connection');
      
      connectionId = response.body.connection.id;
    });

    it('should make an API request through connector', async () => {
      const response = await request(app)
        .post(`/api/integrations/connections/${connectionId}/request`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          method: 'GET',
          endpoint: '/posts/1'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('Chat-Workflow Integration', () => {
    let workflowId: string;
    let conversationId: string;

    beforeAll(async () => {
      // Create a workflow with chat trigger
      const workflowResponse = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Chat Triggered Workflow',
          description: 'Workflow triggered by chat messages',
          definition: {
            nodes: [
              {
                id: 'chat-trigger',
                type: 'trigger',
                position: { x: 100, y: 100 },
                data: { triggerType: 'chat', keywords: ['hello', 'hi'] }
              },
              {
                id: 'response',
                type: 'action',
                position: { x: 300, y: 100 },
                data: { actionType: 'chat_response', message: 'Hello! How can I help you?' }
              }
            ],
            edges: [
              { id: 'e1', source: 'chat-trigger', target: 'response' }
            ]
          },
          isActive: true
        });

      workflowId = workflowResponse.body.workflow.id;

      // Create trigger rule
      await request(app)
        .post(`/api/workflows/${workflowId}/triggers`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          triggerType: 'keyword',
          configuration: {
            keywords: ['hello', 'hi'],
            caseSensitive: false,
            requireExactMatch: false
          },
          isActive: true,
          priority: 10,
          requiresConfirmation: false
        });

      // Create conversation
      const conversationResponse = await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Workflow Test Conversation',
          isGroup: false
        });

      conversationId = conversationResponse.body.conversation.id;
    });

    it('should trigger workflow from chat message', async () => {
      const response = await request(app)
        .post('/api/chat/messages')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          conversationId,
          content: 'hello there',
          type: 'text'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      // Wait for workflow processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if workflow was triggered
      const executionsResponse = await request(app)
        .get(`/api/workflows/${workflowId}/executions`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(executionsResponse.status).toBe(200);
      expect(executionsResponse.body.executions.length).toBeGreaterThan(0);
    });
  });

  describe('OAuth2 Integration', () => {
    let providerId: string;

    it('should register OAuth2 provider', async () => {
      const response = await request(app)
        .post('/api/integrations/oauth2/providers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test OAuth Provider',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token',
          scopes: ['read', 'write']
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.provider.name).toBe('Test OAuth Provider');
      
      providerId = response.body.provider.id;
    });

    it('should get OAuth2 authorization URL', async () => {
      const response = await request(app)
        .get(`/api/integrations/oauth2/providers/${providerId}/authorize`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          redirectUri: 'https://example.com/callback',
          state: 'test-state'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.authorizationUrl).toContain('https://example.com/oauth/authorize');
    });
  });

  describe('Analytics and Monitoring', () => {
    it('should retrieve workflow analytics', async () => {
      const response = await request(app)
        .get('/api/workflows/analytics')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date().toISOString()
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.analytics).toBeDefined();
    });

    it('should retrieve chat analytics', async () => {
      const response = await request(app)
        .get('/api/chat/analytics')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          period: '24h'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.analytics).toBeDefined();
    });

    it('should retrieve system health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('healthy');
      expect(response.body.services).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid authentication', async () => {
      const response = await request(app)
        .get('/api/workflows')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('should handle tenant isolation violations', async () => {
      // Create another tenant and user
      const otherTenant = await createTestTenant(prisma, 'other-tenant');
      const otherUser = await createTestUser(prisma, otherTenant.id, 'other@test.com');
      
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: otherUser.email,
          password: 'TestPassword123!'
        });

      const otherToken = loginResponse.body.token;

      // Try to access first tenant's resources
      const response = await request(app)
        .get('/api/workflows')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(response.status).toBe(200);
      expect(response.body.workflows.length).toBe(0); // Should only see own tenant's workflows
    });

    it('should handle validation errors', async () => {
      const response = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          // Missing required fields
          description: 'Invalid workflow'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle rate limiting', async () => {
      // Make multiple rapid requests
      const promises = Array.from({ length: 20 }, () =>
        request(app)
          .get('/api/workflows')
          .set('Authorization', `Bearer ${authToken}`)
      );

      const responses = await Promise.all(promises);
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('Performance Tests', () => {
    it('should handle concurrent chat messages', async () => {
      const conversationResponse = await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Performance Test Conversation',
          isGroup: false
        });

      const conversationId = conversationResponse.body.conversation.id;

      const startTime = Date.now();
      const promises = Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post('/api/chat/messages')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            conversationId,
            content: `Performance test message ${i}`,
            type: 'text'
          })
      );

      const responses = await Promise.all(promises);
      const endTime = Date.now();

      expect(responses.every(r => r.status === 201)).toBe(true);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle large document upload', async () => {
      const largeContent = 'A'.repeat(1024 * 1024); // 1MB content
      
      const response = await request(app)
        .post('/api/knowledge/documents')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', Buffer.from(largeContent), 'large-test.txt')
        .field('title', 'Large Test Document')
        .field('description', 'A large document for performance testing');

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });
});
