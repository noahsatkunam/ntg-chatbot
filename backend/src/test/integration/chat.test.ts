import request from 'supertest';
import app from '../../app';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Chat Integration Tests', () => {
  let authToken: string;
  let userId: string;
  let conversationId: string;

  beforeAll(async () => {
    // Clean up test data
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.user.deleteMany({
      where: {
        email: 'chattest@example.com'
      }
    });

    // Create test user and get auth token
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'chattest@example.com',
        password: 'password123',
        name: 'Chat Test User'
      });

    authToken = registerResponse.body.token;
    userId = registerResponse.body.user.id;
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.user.deleteMany({
      where: {
        email: 'chattest@example.com'
      }
    });
    await prisma.$disconnect();
  });

  describe('POST /api/conversations', () => {
    it('should create a new conversation', async () => {
      const response = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Test Conversation'
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.title).toBe('Test Conversation');
      expect(response.body.userId).toBe(userId);
      
      conversationId = response.body.id;
    });

    it('should reject conversation creation without auth', async () => {
      const response = await request(app)
        .post('/api/conversations')
        .send({
          title: 'Test Conversation'
        })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/conversations', () => {
    it('should get user conversations', async () => {
      const response = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('title');
    });

    it('should reject request without auth', async () => {
      const response = await request(app)
        .get('/api/conversations')
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /api/conversations/:id/messages', () => {
    it('should send a message to conversation', async () => {
      const messageData = {
        content: 'Hello, this is a test message',
        type: 'user'
      };

      const response = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(messageData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.content).toBe(messageData.content);
      expect(response.body.type).toBe(messageData.type);
      expect(response.body.conversationId).toBe(conversationId);
    });

    it('should reject message without auth', async () => {
      const response = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .send({
          content: 'Test message',
          type: 'user'
        })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should reject empty message', async () => {
      const response = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: '',
          type: 'user'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/conversations/:id/messages', () => {
    it('should get conversation messages', async () => {
      const response = await request(app)
        .get(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('content');
      expect(response.body[0]).toHaveProperty('type');
    });

    it('should reject request without auth', async () => {
      const response = await request(app)
        .get(`/api/conversations/${conversationId}/messages`)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 404 for non-existent conversation', async () => {
      const response = await request(app)
        .get('/api/conversations/non-existent-id/messages')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/conversations/:id', () => {
    it('should delete conversation', async () => {
      const response = await request(app)
        .delete(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('message');
    });

    it('should reject deletion without auth', async () => {
      const response = await request(app)
        .delete(`/api/conversations/${conversationId}`)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 404 for non-existent conversation', async () => {
      const response = await request(app)
        .delete('/api/conversations/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });
});
