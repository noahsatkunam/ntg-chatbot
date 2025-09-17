import apiClient from '../api-client';
import { 
  KnowledgeDocument, 
  UploadDocumentRequest, 
  PaginatedResponse,
  PaginationParams,
  ApiResponse 
} from '../../types/api';

export const knowledgeApi = {
  // Get all documents
  async getDocuments(params?: PaginationParams): Promise<PaginatedResponse<KnowledgeDocument>> {
    const queryParams = new URLSearchParams();
    
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
    if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);

    const response = await apiClient.get<PaginatedResponse<KnowledgeDocument>>(
      `/knowledge/documents?${queryParams.toString()}`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get documents');
  },

  // Get a specific document
  async getDocument(documentId: string): Promise<KnowledgeDocument> {
    const response = await apiClient.get<KnowledgeDocument>(`/knowledge/documents/${documentId}`);
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get document');
  },

  // Upload a document
  async uploadDocument(
    request: UploadDocumentRequest,
    onProgress?: (progress: number) => void
  ): Promise<KnowledgeDocument> {
    const response = await apiClient.upload<KnowledgeDocument>(
      '/knowledge/documents/upload',
      request.file,
      onProgress
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to upload document');
  },

  // Update document metadata
  async updateDocument(
    documentId: string, 
    updates: { title?: string; metadata?: Record<string, any> }
  ): Promise<KnowledgeDocument> {
    const response = await apiClient.patch<KnowledgeDocument>(
      `/knowledge/documents/${documentId}`,
      updates
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to update document');
  },

  // Delete a document
  async deleteDocument(documentId: string): Promise<void> {
    const response = await apiClient.delete(`/knowledge/documents/${documentId}`);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete document');
    }
  },

  // Search documents
  async searchDocuments(
    query: string, 
    params?: PaginationParams
  ): Promise<PaginatedResponse<KnowledgeDocument>> {
    const queryParams = new URLSearchParams();
    queryParams.append('q', query);
    
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
    if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);

    const response = await apiClient.get<PaginatedResponse<KnowledgeDocument>>(
      `/knowledge/search?${queryParams.toString()}`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to search documents');
  },

  // Get document processing status
  async getProcessingStatus(documentId: string): Promise<{ status: string; progress?: number; error?: string }> {
    const response = await apiClient.get<{ status: string; progress?: number; error?: string }>(
      `/knowledge/documents/${documentId}/status`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get processing status');
  },

  // Reprocess a document
  async reprocessDocument(documentId: string): Promise<void> {
    const response = await apiClient.post(`/knowledge/documents/${documentId}/reprocess`);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to reprocess document');
    }
  },
};
