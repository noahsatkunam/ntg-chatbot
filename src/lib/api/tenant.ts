import apiClient from '../api-client';
import { 
  Tenant, 
  TenantSettings, 
  ApiIntegration,
  PaginatedResponse,
  PaginationParams,
  ApiResponse 
} from '../../types/api';

export const tenantApi = {
  // Get current tenant information
  async getCurrentTenant(): Promise<Tenant> {
    const response = await apiClient.get<Tenant>('/tenant/current');
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get tenant information');
  },

  // Update tenant settings
  async updateTenantSettings(settings: Partial<TenantSettings>): Promise<Tenant> {
    const response = await apiClient.patch<Tenant>('/tenant/settings', settings);
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to update tenant settings');
  },

  // Get tenant users
  async getTenantUsers(params?: PaginationParams): Promise<PaginatedResponse<any>> {
    const queryParams = new URLSearchParams();
    
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
    if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);

    const response = await apiClient.get<PaginatedResponse<any>>(
      `/tenant/users?${queryParams.toString()}`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get tenant users');
  },

  // Get API integrations
  async getIntegrations(): Promise<ApiIntegration[]> {
    const response = await apiClient.get<ApiIntegration[]>('/tenant/integrations');
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get integrations');
  },

  // Create API integration
  async createIntegration(integration: Omit<ApiIntegration, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>): Promise<ApiIntegration> {
    const response = await apiClient.post<ApiIntegration>('/tenant/integrations', integration);
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to create integration');
  },

  // Update API integration
  async updateIntegration(integrationId: string, updates: Partial<ApiIntegration>): Promise<ApiIntegration> {
    const response = await apiClient.patch<ApiIntegration>(
      `/tenant/integrations/${integrationId}`,
      updates
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to update integration');
  },

  // Delete API integration
  async deleteIntegration(integrationId: string): Promise<void> {
    const response = await apiClient.delete(`/tenant/integrations/${integrationId}`);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete integration');
    }
  },

  // Test API integration
  async testIntegration(integrationId: string): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.post<{ success: boolean; message: string }>(
      `/tenant/integrations/${integrationId}/test`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to test integration');
  },
};
