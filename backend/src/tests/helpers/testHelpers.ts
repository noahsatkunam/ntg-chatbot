import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

export interface TestTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  settings: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function createTestTenant(
  prisma: PrismaClient,
  slug: string = 'test-tenant'
): Promise<TestTenant> {
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Test Tenant',
      slug: `${slug}-${Date.now()}`,
      status: 'active',
      settings: {
        features: {
          chat: true,
          workflows: true,
          knowledgeBase: true,
          integrations: true
        },
        limits: {
          users: 100,
          workflows: 50,
          documents: 1000,
          apiCalls: 10000
        }
      }
    }
  });

  return tenant as TestTenant;
}

export async function createTestUser(
  prisma: PrismaClient,
  tenantId: string,
  email: string = 'test@example.com',
  role: string = 'admin'
): Promise<TestUser> {
  const hashedPassword = await bcrypt.hash('TestPassword123!', 10);
  
  const user = await prisma.user.create({
    data: {
      email: `${Date.now()}-${email}`,
      password: hashedPassword,
      firstName: 'Test',
      lastName: 'User',
      fullName: 'Test User',
      tenantId,
      role,
      isActive: true,
      emailVerified: true,
      preferences: {
        theme: 'light',
        notifications: {
          email: true,
          push: false
        }
      }
    }
  });

  return user as TestUser;
}

export async function createTestWorkflow(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  name: string = 'Test Workflow'
): Promise<any> {
  const workflow = await prisma.workflow.create({
    data: {
      name: `${name} ${Date.now()}`,
      description: 'A test workflow for automated testing',
      tenantId,
      createdBy: userId,
      definition: {
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
            data: { actionType: 'log', message: 'Test workflow executed' }
          }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'action' }
        ]
      },
      status: 'active',
      version: 1,
      tags: ['test', 'automation'],
      metadata: {
        testWorkflow: true,
        createdForTesting: true
      }
    }
  });

  return workflow;
}

export async function createTestConversation(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  title: string = 'Test Conversation'
): Promise<any> {
  const conversation = await prisma.conversation.create({
    data: {
      title: `${title} ${Date.now()}`,
      tenantId,
      isGroup: false,
      metadata: {
        testConversation: true,
        createdForTesting: true
      }
    }
  });

  // Add user as participant
  await prisma.conversationParticipant.create({
    data: {
      conversationId: conversation.id,
      userId,
      tenantId,
      role: 'owner',
      joinedAt: new Date()
    }
  });

  return conversation;
}

export async function createTestDocument(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  title: string = 'Test Document'
): Promise<any> {
  const document = await prisma.document.create({
    data: {
      title: `${title} ${Date.now()}`,
      description: 'A test document for automated testing',
      content: 'This is test document content for knowledge base testing.',
      tenantId,
      uploadedBy: userId,
      fileType: 'text/plain',
      fileSize: 100,
      fileName: 'test-document.txt',
      filePath: '/test/documents/test-document.txt',
      status: 'processed',
      isPublic: false,
      tags: ['test', 'document'],
      metadata: {
        testDocument: true,
        createdForTesting: true,
        processingCompleted: true
      }
    }
  });

  return document;
}

export async function createTestApiConnection(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  name: string = 'Test API Connection'
): Promise<any> {
  const connection = await prisma.apiConnection.create({
    data: {
      name: `${name} ${Date.now()}`,
      type: 'rest',
      baseUrl: 'https://jsonplaceholder.typicode.com',
      tenantId,
      createdBy: userId,
      authentication: {
        type: 'none',
        credentials: {}
      },
      headers: {
        'Content-Type': 'application/json'
      },
      rateLimit: {
        requestsPerSecond: 1,
        requestsPerMinute: 60,
        requestsPerHour: 3600,
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
        testConnection: true,
        createdForTesting: true
      }
    }
  });

  return connection;
}

export async function createTestOAuth2Provider(
  prisma: PrismaClient,
  tenantId: string,
  name: string = 'Test OAuth2 Provider'
): Promise<any> {
  const provider = await prisma.oAuth2Provider.create({
    data: {
      name: `${name} ${Date.now()}`,
      tenantId,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret', // Will be encrypted by the service
      authorizationUrl: 'https://example.com/oauth/authorize',
      tokenUrl: 'https://example.com/oauth/token',
      scopes: ['read', 'write'],
      redirectUri: 'https://example.com/callback',
      metadata: {
        testProvider: true,
        createdForTesting: true
      }
    }
  });

  return provider;
}

export async function cleanupTestData(
  prisma: PrismaClient,
  tenantId: string
): Promise<void> {
  try {
    // Delete in reverse dependency order
    await prisma.workflowExecution.deleteMany({ where: { tenantId } });
    await prisma.workflowTrigger.deleteMany({ where: { tenantId } });
    await prisma.workflowConfirmation.deleteMany({ where: { tenantId } });
    await prisma.workflowPermission.deleteMany({ where: { tenantId } });
    await prisma.workflowCredential.deleteMany({ where: { tenantId } });
    await prisma.workflowAnalytics.deleteMany({ where: { tenantId } });
    await prisma.workflow.deleteMany({ where: { tenantId } });

    await prisma.message.deleteMany({ where: { tenantId } });
    await prisma.conversationParticipant.deleteMany({ where: { tenantId } });
    await prisma.conversation.deleteMany({ where: { tenantId } });

    await prisma.documentChunk.deleteMany({ where: { document: { tenantId } } });
    await prisma.document.deleteMany({ where: { tenantId } });

    await prisma.oAuth2Connection.deleteMany({ where: { tenantId } });
    await prisma.oAuth2Provider.deleteMany({ where: { tenantId } });
    await prisma.apiConnection.deleteMany({ where: { tenantId } });

    await prisma.userSession.deleteMany({ where: { user: { tenantId } } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });

    console.log(`Cleaned up test data for tenant: ${tenantId}`);
  } catch (error) {
    console.error('Error cleaning up test data:', error);
    // Don't throw error to avoid failing tests
  }
}

export async function waitForCondition(
  condition: () => Promise<boolean>,
  timeout: number = 10000,
  interval: number = 100
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  return false;
}

export async function createTestMessage(
  prisma: PrismaClient,
  conversationId: string,
  userId: string,
  tenantId: string,
  content: string = 'Test message'
): Promise<any> {
  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: userId,
      tenantId,
      content: `${content} ${Date.now()}`,
      type: 'text',
      metadata: {
        testMessage: true,
        createdForTesting: true
      }
    }
  });

  return message;
}

export async function createTestWorkflowExecution(
  prisma: PrismaClient,
  workflowId: string,
  tenantId: string,
  userId: string,
  status: string = 'completed'
): Promise<any> {
  const execution = await prisma.workflowExecution.create({
    data: {
      workflowId,
      tenantId,
      triggeredBy: userId,
      status,
      startTime: new Date(),
      endTime: status === 'completed' ? new Date() : null,
      inputData: {
        test: 'data',
        executionId: Date.now()
      },
      outputData: status === 'completed' ? {
        result: 'success',
        message: 'Test execution completed'
      } : null,
      metadata: {
        testExecution: true,
        createdForTesting: true,
        triggerType: 'manual'
      }
    }
  });

  return execution;
}

export const testConstants = {
  DEFAULT_PASSWORD: 'TestPassword123!',
  TEST_EMAIL_DOMAIN: '@test.example.com',
  TEST_TIMEOUT: 30000,
  WORKFLOW_EXECUTION_TIMEOUT: 10000,
  RATE_LIMIT_WINDOW: 60000,
  MAX_RATE_LIMIT_REQUESTS: 100
};

export function generateTestEmail(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${testConstants.TEST_EMAIL_DOMAIN}`;
}

export function generateTestSlug(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function mockExternalService(
  serviceName: string,
  responses: Record<string, any>
): Promise<void> {
  // Mock external service responses for testing
  // This would integrate with your mocking framework
  console.log(`Mocking ${serviceName} with responses:`, responses);
}

export function createMockFile(
  filename: string = 'test.txt',
  content: string = 'Test file content',
  mimetype: string = 'text/plain'
): Express.Multer.File {
  const buffer = Buffer.from(content);
  
  return {
    fieldname: 'file',
    originalname: filename,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: null as any
  };
}
