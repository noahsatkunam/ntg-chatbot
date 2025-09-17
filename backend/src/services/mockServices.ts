import { logger } from '../utils/logger.js';
import { config } from '../config/environment.js';

// Mock Redis Service
export class MockRedisService {
  private cache = new Map<string, { value: any; expiry?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (item.expiry && Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
  }

  async set(key: string, value: any, options?: { EX?: number }): Promise<void> {
    const expiry = options?.EX ? Date.now() + (options.EX * 1000) : undefined;
    this.cache.set(key, { value, expiry });
    logger.debug(`Mock Redis SET: ${key}`);
  }

  async del(key: string): Promise<number> {
    const deleted = this.cache.delete(key);
    logger.debug(`Mock Redis DEL: ${key}`);
    return deleted ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    return this.cache.has(key) ? 1 : 0;
  }

  async flushall(): Promise<void> {
    this.cache.clear();
    logger.debug('Mock Redis FLUSHALL');
  }

  async ping(): Promise<string> {
    return 'PONG';
  }
}

// Mock Vector Database Service
export class MockVectorService {
  private collections = new Map<string, any[]>();

  async createCollection(name: string, config: any): Promise<void> {
    this.collections.set(name, []);
    logger.debug(`Mock Vector DB: Created collection ${name}`);
  }

  async upsertPoints(collection: string, points: any[]): Promise<void> {
    if (!this.collections.has(collection)) {
      await this.createCollection(collection, {});
    }
    
    const existing = this.collections.get(collection) || [];
    existing.push(...points);
    this.collections.set(collection, existing);
    logger.debug(`Mock Vector DB: Upserted ${points.length} points to ${collection}`);
  }

  async search(collection: string, vector: number[], limit: number = 10): Promise<any[]> {
    const points = this.collections.get(collection) || [];
    
    // Mock similarity search - return random subset
    const shuffled = [...points].sort(() => 0.5 - Math.random());
    const results = shuffled.slice(0, Math.min(limit, points.length));
    
    logger.debug(`Mock Vector DB: Search in ${collection} returned ${results.length} results`);
    return results.map((point, index) => ({
      ...point,
      score: 0.9 - (index * 0.1) // Mock decreasing relevance scores
    }));
  }

  async deleteCollection(name: string): Promise<void> {
    this.collections.delete(name);
    logger.debug(`Mock Vector DB: Deleted collection ${name}`);
  }
}

// Mock AI Service
export class MockAIService {
  async generateResponse(prompt: string, options?: any): Promise<string> {
    logger.debug('Mock AI: Generating response for prompt');
    
    // Simple mock responses based on prompt content
    if (prompt.toLowerCase().includes('hello') || prompt.toLowerCase().includes('hi')) {
      return "Hello! I'm a mock AI assistant. How can I help you today?";
    }
    
    if (prompt.toLowerCase().includes('weather')) {
      return "I'm a mock AI, so I can't check real weather data. But I'd imagine it's a lovely day wherever you are!";
    }
    
    if (prompt.toLowerCase().includes('help')) {
      return "I'm here to help! As a mock AI service, I can provide sample responses for testing purposes. What would you like to know?";
    }
    
    if (prompt.toLowerCase().includes('error') || prompt.toLowerCase().includes('problem')) {
      return "I understand you're experiencing an issue. As a mock AI, I can simulate helpful troubleshooting responses. Please describe the problem in more detail.";
    }
    
    // Default response
    return `Thank you for your message. This is a mock AI response to: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}". In a real implementation, this would be processed by OpenAI or Anthropic.`;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    logger.debug('Mock AI: Generating embedding for text');
    
    // Generate a mock embedding vector (1536 dimensions like OpenAI)
    const embedding = new Array(1536).fill(0).map(() => Math.random() * 2 - 1);
    return embedding;
  }

  async streamResponse(prompt: string, onChunk: (chunk: string) => void): Promise<void> {
    logger.debug('Mock AI: Streaming response');
    
    const response = await this.generateResponse(prompt);
    const words = response.split(' ');
    
    // Simulate streaming by sending words with delays
    for (let i = 0; i < words.length; i++) {
      const chunk = words[i] + (i < words.length - 1 ? ' ' : '');
      onChunk(chunk);
      
      // Small delay to simulate streaming
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

// Mock Email Service
export class MockEmailService {
  private sentEmails: any[] = [];

  async sendEmail(to: string, subject: string, content: string, options?: any): Promise<void> {
    const email = {
      to,
      subject,
      content,
      options,
      sentAt: new Date(),
      messageId: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    
    this.sentEmails.push(email);
    logger.info(`Mock Email sent to ${to}: ${subject}`);
  }

  async sendTemplateEmail(to: string, template: string, data: any): Promise<void> {
    await this.sendEmail(to, `Template: ${template}`, `Template data: ${JSON.stringify(data)}`);
  }

  getSentEmails(): any[] {
    return [...this.sentEmails];
  }

  clearSentEmails(): void {
    this.sentEmails = [];
  }
}

// Mock File Storage Service
export class MockFileStorageService {
  private files = new Map<string, { content: Buffer; metadata: any }>();

  async uploadFile(key: string, content: Buffer, metadata?: any): Promise<string> {
    this.files.set(key, { content, metadata });
    logger.debug(`Mock Storage: Uploaded file ${key}`);
    return `mock://storage/${key}`;
  }

  async downloadFile(key: string): Promise<Buffer | null> {
    const file = this.files.get(key);
    if (!file) return null;
    
    logger.debug(`Mock Storage: Downloaded file ${key}`);
    return file.content;
  }

  async deleteFile(key: string): Promise<boolean> {
    const deleted = this.files.delete(key);
    logger.debug(`Mock Storage: Deleted file ${key}`);
    return deleted;
  }

  async listFiles(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.files.keys());
    return prefix ? keys.filter(key => key.startsWith(prefix)) : keys;
  }

  async getFileMetadata(key: string): Promise<any | null> {
    const file = this.files.get(key);
    return file?.metadata || null;
  }
}

// Service Factory
export class MockServiceFactory {
  private static redisService: MockRedisService;
  private static vectorService: MockVectorService;
  private static aiService: MockAIService;
  private static emailService: MockEmailService;
  private static storageService: MockFileStorageService;

  static getRedisService(): MockRedisService {
    if (!this.redisService) {
      this.redisService = new MockRedisService();
      logger.info('Mock Redis service initialized');
    }
    return this.redisService;
  }

  static getVectorService(): MockVectorService {
    if (!this.vectorService) {
      this.vectorService = new MockVectorService();
      logger.info('Mock Vector service initialized');
    }
    return this.vectorService;
  }

  static getAIService(): MockAIService {
    if (!this.aiService) {
      this.aiService = new MockAIService();
      logger.info('Mock AI service initialized');
    }
    return this.aiService;
  }

  static getEmailService(): MockEmailService {
    if (!this.emailService) {
      this.emailService = new MockEmailService();
      logger.info('Mock Email service initialized');
    }
    return this.emailService;
  }

  static getStorageService(): MockFileStorageService {
    if (!this.storageService) {
      this.storageService = new MockFileStorageService();
      logger.info('Mock Storage service initialized');
    }
    return this.storageService;
  }

  static initializeAllServices(): void {
    this.getRedisService();
    this.getVectorService();
    this.getAIService();
    this.getEmailService();
    this.getStorageService();
    logger.info('All mock services initialized for local development');
  }
}

// Export singleton instances
export const mockRedis = MockServiceFactory.getRedisService();
export const mockVector = MockServiceFactory.getVectorService();
export const mockAI = MockServiceFactory.getAIService();
export const mockEmail = MockServiceFactory.getEmailService();
export const mockStorage = MockServiceFactory.getStorageService();
