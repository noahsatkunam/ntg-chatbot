// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Authentication Types
export interface User {
  id: string;
  email: string;
  name?: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'user' | 'tenant_admin';
  tenantId: string;
  isEmailVerified: boolean;
  twoFactorEnabled: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  attachments?: any[];
  sources?: any[];
  responseType?: string;
  confidenceLevel?: string;
  relatedDocuments?: any[];
  reactions?: any[];
  status?: string;
  isEdited?: boolean;
  timestamp: Date;
  replyTo?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginRequest {
  email: string;
  password: string;
  twoFactorCode?: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  tenantName?: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

// Tenant Types
export interface Tenant {
  id: string;
  name: string;
  plan: string;
  domain: string;
  settings: TenantSettings;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  allowRegistration: boolean;
  maxUsers: number;
  features: string[];
  streaming?: boolean;
  branding?: {
    logo?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };
}

// Workflow Types  
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  status?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input?: Record<string, any>;
  output?: Record<string, any>;
  items?: any[];
  createdAt: string;
  completedAt?: string;
}

// ... keep existing code (Chat Types)
export interface ChatMessage {
  id: string;
  conversationId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  tenantId?: string;
  metadata?: {
    sources?: string[];
    confidence?: number;
    processingTime?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  userId: string;
  tenantId: string;
  messages: ChatMessage[];
  metadata?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
  metadata?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
  };
}

export interface ChatResponse {
  message: ChatMessage;
  conversation: Conversation;
}

// Knowledge Base Types
export interface KnowledgeDocument {
  id: string;
  name: string;
  filename: string;
  contentType: string;
  size: number;
  status: 'processing' | 'ready' | 'error' | 'processed' | 'failed';
  metadata: {
    fileSize?: number;
    pageCount?: number;
    language?: string;
    description?: string;
    tags?: string[];
  };
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface UploadDocumentRequest {
  file: File;
  title?: string;
  metadata?: Record<string, any>;
}

// API Integration Types
export interface ApiIntegration {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'custom';
  config: Record<string, any>;
  isActive: boolean;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

// Pagination
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// WebSocket Types
export interface WebSocketMessage {
  type: 'chat_message' | 'typing' | 'error' | 'connection_status';
  payload: any;
  conversationId?: string;
  userId?: string;
}

export interface TypingIndicator {
  userId: string;
  conversationId: string;
  isTyping: boolean;
}

// Error Types
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

// Analytics Types
export interface ChatAnalytics {
  totalConversations: number;
  totalMessages: number;
  averageResponseTime: number;
  userSatisfactionScore: number;
  topQuestions: Array<{
    question: string;
    count: number;
  }>;
  usageByDay: Array<{
    date: string;
    conversations: number;
    messages: number;
  }>;
}
