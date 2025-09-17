import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from '../../lib/api-client';
import { server } from '../mocks/server';
import { http, HttpResponse } from 'msw';

describe('API Client', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should make successful GET request', async () => {
    const response = await apiClient.get('/auth/me');
    
    expect(response.success).toBe(true);
    expect(response.data).toBeDefined();
    expect(response.data.email).toBe('test@example.com');
  });

  it('should make successful POST request', async () => {
    const loginData = {
      email: 'test@example.com',
      password: 'password123',
    };
    
    const response = await apiClient.post('/auth/login', loginData);
    
    expect(response.success).toBe(true);
    expect(response.data.user).toBeDefined();
    expect(response.data.tokens).toBeDefined();
  });

  it('should handle 401 unauthorized error', async () => {
    server.use(
      http.get('/api/auth/me', () => {
        return HttpResponse.json(
          { success: false, error: 'Unauthorized' },
          { status: 401 }
        );
      })
    );

    const response = await apiClient.get('/auth/me');
    
    expect(response.success).toBe(false);
    expect(response.error).toBe('Unauthorized');
  });

  it('should handle 500 server error', async () => {
    server.use(
      http.get('/api/test', () => {
        return HttpResponse.json(
          { success: false, error: 'Internal server error' },
          { status: 500 }
        );
      })
    );

    const response = await apiClient.get('/test');
    
    expect(response.success).toBe(false);
    expect(response.error).toBe('Internal server error');
  });

  it('should include authorization header when token is present', async () => {
    localStorage.setItem('accessToken', 'test-token');
    
    let capturedHeaders: Record<string, string> = {};
    
    server.use(
      http.get('/api/auth/me', ({ request }) => {
        capturedHeaders = Object.fromEntries(request.headers.entries());
        return HttpResponse.json({
          success: true,
          data: { id: '1', email: 'test@example.com' },
        });
      })
    );

    await apiClient.get('/auth/me');
    
    expect(capturedHeaders.authorization).toBe('Bearer test-token');
  });

  it('should retry failed requests', async () => {
    let attemptCount = 0;
    
    server.use(
      http.get('/api/retry-test', () => {
        attemptCount++;
        if (attemptCount < 3) {
          return HttpResponse.json(
            { success: false, error: 'Network error' },
            { status: 500 }
          );
        }
        return HttpResponse.json({
          success: true,
          data: { message: 'Success after retry' },
        });
      })
    );

    const response = await apiClient.get('/retry-test');
    
    expect(attemptCount).toBe(3);
    expect(response.success).toBe(true);
  });

  it('should handle file upload', async () => {
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', file);
    
    server.use(
      http.post('/api/upload', () => {
        return HttpResponse.json({
          success: true,
          data: { id: 'file-1', filename: 'test.txt' },
        });
      })
    );

    const response = await apiClient.uploadFile('/upload', formData);
    
    expect(response.success).toBe(true);
    expect(response.data.filename).toBe('test.txt');
  });

  it('should handle streaming response', async () => {
    const chunks: string[] = [];
    
    server.use(
      http.post('/api/stream', () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('chunk1\n'));
            controller.enqueue(encoder.encode('chunk2\n'));
            controller.close();
          },
        });
        
        return new Response(stream, {
          headers: { 'Content-Type': 'text/plain' },
        });
      })
    );

    await apiClient.streamRequest('/stream', {}, (chunk) => {
      chunks.push(chunk);
    });
    
    expect(chunks).toContain('chunk1');
    expect(chunks).toContain('chunk2');
  });
});
