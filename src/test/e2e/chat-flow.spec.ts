import { test, expect } from '@playwright/test';

test.describe('Chat Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication
    await page.addInitScript(() => {
      localStorage.setItem('accessToken', 'mock-access-token');
      localStorage.setItem('user', JSON.stringify({
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
      }));
    });

    await page.goto('/');
  });

  test('should create new conversation and send message', async ({ page }) => {
    // Mock API responses
    await page.route('**/api/conversations', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: 'conv-1',
              title: 'New Conversation',
              createdAt: new Date().toISOString(),
            },
          }),
        });
      }
    });

    await page.route('**/api/conversations/*/messages', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: 'msg-1',
              content: 'Hello! How can I help you today?',
              role: 'assistant',
              createdAt: new Date().toISOString(),
            },
          }),
        });
      }
    });

    // Navigate to chat
    await page.getByRole('button', { name: /chat/i }).click();
    
    // Create new conversation
    await page.getByRole('button', { name: /new conversation/i }).click();
    
    // Send a message
    await page.getByPlaceholder(/type your message/i).fill('Hello, how are you?');
    await page.getByRole('button', { name: /send/i }).click();
    
    // Verify message appears
    await expect(page.getByText('Hello, how are you?')).toBeVisible();
    await expect(page.getByText('Hello! How can I help you today?')).toBeVisible();
  });

  test('should upload file in chat', async ({ page }) => {
    await page.getByRole('button', { name: /chat/i }).click();
    
    // Mock file upload
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /attach/i }).click();
    const fileChooser = await fileChooserPromise;
    
    // Create a test file
    await fileChooser.setFiles({
      name: 'test-document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('test content'),
    });
    
    await expect(page.getByText('test-document.pdf')).toBeVisible();
  });

  test('should display typing indicator', async ({ page }) => {
    await page.getByRole('button', { name: /chat/i }).click();
    
    // Mock WebSocket typing event
    await page.evaluate(() => {
      // Simulate typing indicator
      window.dispatchEvent(new CustomEvent('typing', {
        detail: { userId: 'other-user', isTyping: true }
      }));
    });
    
    await expect(page.locator('.animate-bounce')).toBeVisible();
  });
});
