// Jest test setup
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Mock console methods to reduce noise during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
process.env.BCRYPT_ROUNDS = '4'; // Lower rounds for faster tests
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/chatbot_platform_test';
process.env.N8N_ENCRYPTION_KEY = 'ZGV2ZWxvcG1lbnRFbmNyeXB0aW9uS2V5MzJBQkNERUY=';
process.env.OAUTH2_ENCRYPTION_KEY = 'test-oauth2-encryption-key-32-bytes!!';

// Global test timeout
jest.setTimeout(30000);

// Clean up after all tests
afterAll(async () => {
  // Close any open handles
  await new Promise(resolve => setTimeout(resolve, 500));
});
