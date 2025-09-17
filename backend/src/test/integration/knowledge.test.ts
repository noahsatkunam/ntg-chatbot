import request from 'supertest';
import app from '../../app';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();

describe('Knowledge Base Integration Tests', () => {
  let authToken: string;
  let userId: string;
  let documentId: string;

  beforeAll(async () => {
    // Clean up test data
    await prisma.document.deleteMany();
    await prisma.user.deleteMany({
      where: {
        email: 'knowledgetest@example.com'
      }
    });

    // Create test user and get auth token
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'knowledgetest@example.com',
        password: 'password123',
        name: 'Knowledge Test User'
      });

    authToken = registerResponse.body.token;
    userId = registerResponse.body.user.id;
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.document.deleteMany();
    await prisma.user.deleteMany({
      where: {
        email: 'knowledgetest@example.com'
      }
    });
    await prisma.$disconnect();
  });

  describe('POST /api/knowledge/documents', () => {
    it('should upload a document successfully', async () => {
      // Create a test file
      const testContent = 'This is a test document for knowledge base testing.';
      const testFilePath = path.join(__dirname, 'test-document.txt');
      fs.writeFileSync(testFilePath, testContent);

      const response = await request(app)
        .post('/api/knowledge/documents')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', testFilePath)
        .field('name', 'Test Document')
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Test Document');
      expect(response.body.status).toBe('processing');
      expect(response.body.userId).toBe(userId);

      documentId = response.body.id;

      // Clean up test file
      fs.unlinkSync(testFilePath);
    });

    it('should reject upload without auth', async () => {
      const testContent = 'Test content';
      const testFilePath = path.join(__dirname, 'test-document2.txt');
      fs.writeFileSync(testFilePath, testContent);

      const response = await request(app)
        .post('/api/knowledge/documents')
        .attach('file', testFilePath)
        .field('name', 'Test Document')
        .expect(401);

      expect(response.body).toHaveProperty('error');

      // Clean up test file
      fs.unlinkSync(testFilePath);
    });

    it('should reject upload without file', async () => {
      const response = await request(app)
        .post('/api/knowledge/documents')
        .set('Authorization', `Bearer ${authToken}`)
        .field('name', 'Test Document')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/knowledge/documents', () => {
    it('should get user documents', async () => {
      const response = await request(app)
        .get('/api/knowledge/documents')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('name');
      expect(response.body[0]).toHaveProperty('status');
    });

    it('should reject request without auth', async () => {
      const response = await request(app)
        .get('/api/knowledge/documents')
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/knowledge/documents?page=1&limit=10')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('POST /api/knowledge/search', () => {
    it('should search documents', async () => {
      const searchData = {
        query: 'test document',
        limit: 10
      };

      const response = await request(app)
        .post('/api/knowledge/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send(searchData)
        .expect(200);

      expect(response.body).toHaveProperty('results');
      expect(Array.isArray(response.body.results)).toBe(true);
    });

    it('should reject search without auth', async () => {
      const response = await request(app)
        .post('/api/knowledge/search')
        .send({
          query: 'test',
          limit: 10
        })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should reject empty search query', async () => {
      const response = await request(app)
        .post('/api/knowledge/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: '',
          limit: 10
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/knowledge/documents/:id/status', () => {
    it('should get document processing status', async () => {
      const response = await request(app)
        .get(`/api/knowledge/documents/${documentId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('progress');
    });

    it('should reject request without auth', async () => {
      const response = await request(app)
        .get(`/api/knowledge/documents/${documentId}/status`)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 404 for non-existent document', async () => {
      const response = await request(app)
        .get('/api/knowledge/documents/non-existent-id/status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/knowledge/documents/:id', () => {
    it('should delete document', async () => {
      const response = await request(app)
        .delete(`/api/knowledge/documents/${documentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('message');
    });

    it('should reject deletion without auth', async () => {
      const response = await request(app)
        .delete(`/api/knowledge/documents/${documentId}`)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 404 for non-existent document', async () => {
      const response = await request(app)
        .delete('/api/knowledge/documents/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });
});
