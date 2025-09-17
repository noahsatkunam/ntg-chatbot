export interface AIProvider {
  name: string;
  models: string[];
  maxTokens: number;
  supportsStreaming: boolean;
  costPerToken: {
    input: number;
    output: number;
  };
}

export interface AIModel {
  id: string;
  provider: string;
  name: string;
  maxTokens: number;
  contextWindow: number;
  costPerInputToken: number;
  costPerOutputToken: number;
  supportsStreaming: boolean;
}

export interface AIConfiguration {
  id: string;
  tenantId: string;
  model: string;
  provider: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  stopSequences: string[];
  responseFormat: 'text' | 'json';
  safetySettings: {
    contentFiltering: boolean;
    moderationLevel: 'low' | 'medium' | 'high';
    blockedCategories: string[];
  };
  rateLimits: {
    requestsPerMinute: number;
    tokensPerMinute: number;
    dailyTokenLimit: number;
  };
  fallbackModel?: string;
  customInstructions?: string;
  knowledgeBase?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationContext {
  conversationId: string;
  tenantId: string;
  userId: string;
  messages: ContextMessage[];
  totalTokens: number;
  maxContextTokens: number;
  systemPrompt: string;
  userPersona?: string;
  metadata: Record<string, any>;
}

export interface ContextMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  tokens: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface AIRequest {
  conversationId: string;
  tenantId: string;
  userId: string;
  message: string;
  stream?: boolean;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  context?: ContextMessage[];
}

export interface AIResponse {
  id: string;
  content: string;
  model: string;
  provider: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
  metadata: {
    processingTime: number;
    cached: boolean;
    filtered: boolean;
    moderationResults?: any;
  };
  createdAt: Date;
}

export interface StreamChunk {
  id: string;
  content: string;
  delta: string;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface TokenUsage {
  id: string;
  tenantId: string;
  userId?: string;
  conversationId?: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface ModerationResult {
  flagged: boolean;
  categories: {
    hate: boolean;
    hateThreatening: boolean;
    harassment: boolean;
    harassmentThreatening: boolean;
    selfHarm: boolean;
    selfHarmIntent: boolean;
    selfHarmInstructions: boolean;
    sexual: boolean;
    sexualMinors: boolean;
    violence: boolean;
    violenceGraphic: boolean;
  };
  scores: Record<string, number>;
}

export interface AIError {
  code: string;
  message: string;
  provider?: string;
  model?: string;
  retryable: boolean;
  details?: any;
}

export type AIProviderType = 'openai' | 'anthropic' | 'custom';

export interface ProviderCredentials {
  tenantId: string;
  provider: AIProviderType;
  apiKey: string;
  organizationId?: string;
  baseUrl?: string;
  encrypted: boolean;
  createdAt: Date;
  updatedAt: Date;
}
