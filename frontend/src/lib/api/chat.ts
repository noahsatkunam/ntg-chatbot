import apiClient from '../api-client';
import { 
  ChatRequest, 
  ChatResponse, 
  Conversation, 
  ChatMessage, 
  PaginatedResponse,
  PaginationParams,
  ApiResponse 
} from '../../types/api';

export const chatApi = {
  // Send a chat message
  async sendMessage(request: ChatRequest): Promise<ChatResponse> {
    const response = await apiClient.post<ChatResponse>('/chat/message', request);
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to send message');
  },

  // Stream a chat message
  async streamMessage(
    request: ChatRequest, 
    onMessage: (content: string) => void,
    onComplete?: (message: ChatMessage) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    try {
      await apiClient.stream('/chat/stream', request, onMessage);
      
      // Get the final message after streaming completes
      if (onComplete && request.conversationId) {
        const conversation = await this.getConversation(request.conversationId);
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          onComplete(lastMessage);
        }
      }
    } catch (error) {
      if (onError) {
        onError(error as Error);
      } else {
        throw error;
      }
    }
  },

  // Get all conversations for the current user
  async getConversations(params?: PaginationParams): Promise<PaginatedResponse<Conversation>> {
    const queryParams = new URLSearchParams();
    
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
    if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);

    const response = await apiClient.get<PaginatedResponse<Conversation>>(
      `/chat/conversations?${queryParams.toString()}`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get conversations');
  },

  // Get a specific conversation
  async getConversation(conversationId: string): Promise<Conversation> {
    const response = await apiClient.get<Conversation>(`/chat/conversations/${conversationId}`);
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get conversation');
  },

  // Create a new conversation
  async createConversation(title?: string): Promise<Conversation> {
    const response = await apiClient.post<Conversation>('/chat/conversations', {
      title: title || 'New Conversation',
    });
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to create conversation');
  },

  // Update conversation title
  async updateConversation(conversationId: string, updates: { title?: string }): Promise<Conversation> {
    const response = await apiClient.patch<Conversation>(
      `/chat/conversations/${conversationId}`, 
      updates
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to update conversation');
  },

  // Delete a conversation
  async deleteConversation(conversationId: string): Promise<void> {
    const response = await apiClient.delete(`/chat/conversations/${conversationId}`);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete conversation');
    }
  },

  // Get messages for a conversation with pagination
  async getMessages(
    conversationId: string, 
    params?: PaginationParams
  ): Promise<PaginatedResponse<ChatMessage>> {
    const queryParams = new URLSearchParams();
    
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
    if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);

    const response = await apiClient.get<PaginatedResponse<ChatMessage>>(
      `/chat/conversations/${conversationId}/messages?${queryParams.toString()}`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get messages');
  },

  // Delete a specific message
  async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    const response = await apiClient.delete(
      `/chat/conversations/${conversationId}/messages/${messageId}`
    );
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete message');
    }
  },

  // Regenerate the last assistant response
  async regenerateResponse(conversationId: string): Promise<ChatMessage> {
    const response = await apiClient.post<ChatMessage>(
      `/chat/conversations/${conversationId}/regenerate`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to regenerate response');
  },

  // Stream regenerated response
  async streamRegenerateResponse(
    conversationId: string,
    onMessage: (content: string) => void,
    onComplete?: (message: ChatMessage) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    try {
      await apiClient.stream(
        `/chat/conversations/${conversationId}/regenerate`, 
        { stream: true }, 
        onMessage
      );
      
      // Get the final message after streaming completes
      if (onComplete) {
        const conversation = await this.getConversation(conversationId);
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          onComplete(lastMessage);
        }
      }
    } catch (error) {
      if (onError) {
        onError(error as Error);
      } else {
        throw error;
      }
    }
  },

  // Search conversations
  async searchConversations(query: string, params?: PaginationParams): Promise<PaginatedResponse<Conversation>> {
    const queryParams = new URLSearchParams();
    queryParams.append('q', query);
    
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
    if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);

    const response = await apiClient.get<PaginatedResponse<Conversation>>(
      `/chat/search?${queryParams.toString()}`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to search conversations');
  },

  // Get chat analytics
  async getAnalytics(startDate?: string, endDate?: string): Promise<any> {
    const queryParams = new URLSearchParams();
    
    if (startDate) queryParams.append('startDate', startDate);
    if (endDate) queryParams.append('endDate', endDate);

    const response = await apiClient.get(`/chat/analytics?${queryParams.toString()}`);
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get analytics');
  },

  // Export conversation
  async exportConversation(conversationId: string, format: 'json' | 'txt' | 'pdf' = 'json'): Promise<Blob> {
    const response = await apiClient.get(
      `/chat/conversations/${conversationId}/export?format=${format}`,
      { responseType: 'blob' }
    );
    
    if (response.success && response.data) {
      return response.data as any; // Blob type
    }
    
    throw new Error(response.error || 'Failed to export conversation');
  },
};
