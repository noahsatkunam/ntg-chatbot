import apiClient from '../api-client';
import { 
  PaginatedResponse,
  PaginationParams,
  ApiResponse 
} from '../../types/api';

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'inactive' | 'draft';
  trigger: {
    type: 'webhook' | 'schedule' | 'manual' | 'chat_message';
    config: Record<string, any>;
  };
  nodes: WorkflowNode[];
  tenantId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastExecuted?: string;
  executionCount: number;
}

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
  connections: {
    input: string[];
    output: string[];
  };
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  input: Record<string, any>;
  output?: Record<string, any>;
  error?: string;
  logs: WorkflowLog[];
}

export interface WorkflowLog {
  id: string;
  nodeId: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: string;
  data?: Record<string, any>;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  workflow: Omit<Workflow, 'id' | 'tenantId' | 'createdBy' | 'createdAt' | 'updatedAt'>;
  isPublic: boolean;
}

export const workflowsApi = {
  // Get all workflows
  async getWorkflows(params?: PaginationParams): Promise<PaginatedResponse<Workflow>> {
    const queryParams = new URLSearchParams();
    
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
    if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);

    const response = await apiClient.get<PaginatedResponse<Workflow>>(
      `/workflows?${queryParams.toString()}`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get workflows');
  },

  // Get a specific workflow
  async getWorkflow(workflowId: string): Promise<Workflow> {
    const response = await apiClient.get<Workflow>(`/workflows/${workflowId}`);
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get workflow');
  },

  // Create a new workflow
  async createWorkflow(workflow: Omit<Workflow, 'id' | 'tenantId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'executionCount'>): Promise<Workflow> {
    const response = await apiClient.post<Workflow>('/workflows', workflow);
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to create workflow');
  },

  // Update a workflow
  async updateWorkflow(workflowId: string, updates: Partial<Workflow>): Promise<Workflow> {
    const response = await apiClient.patch<Workflow>(`/workflows/${workflowId}`, updates);
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to update workflow');
  },

  // Delete a workflow
  async deleteWorkflow(workflowId: string): Promise<void> {
    const response = await apiClient.delete(`/workflows/${workflowId}`);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete workflow');
    }
  },

  // Execute a workflow
  async executeWorkflow(workflowId: string, input?: Record<string, any>): Promise<WorkflowExecution> {
    const response = await apiClient.post<WorkflowExecution>(`/workflows/${workflowId}/execute`, {
      input: input || {},
    });
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to execute workflow');
  },

  // Get workflow executions
  async getWorkflowExecutions(
    workflowId: string, 
    params?: PaginationParams
  ): Promise<PaginatedResponse<WorkflowExecution>> {
    const queryParams = new URLSearchParams();
    
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
    if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);

    const response = await apiClient.get<PaginatedResponse<WorkflowExecution>>(
      `/workflows/${workflowId}/executions?${queryParams.toString()}`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get workflow executions');
  },

  // Get a specific execution
  async getExecution(executionId: string): Promise<WorkflowExecution> {
    const response = await apiClient.get<WorkflowExecution>(`/workflows/executions/${executionId}`);
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get execution');
  },

  // Cancel a workflow execution
  async cancelExecution(executionId: string): Promise<void> {
    const response = await apiClient.post(`/workflows/executions/${executionId}/cancel`);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to cancel execution');
    }
  },

  // Get workflow templates
  async getTemplates(category?: string): Promise<WorkflowTemplate[]> {
    const queryParams = new URLSearchParams();
    if (category) queryParams.append('category', category);

    const response = await apiClient.get<WorkflowTemplate[]>(
      `/workflows/templates?${queryParams.toString()}`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get workflow templates');
  },

  // Create workflow from template
  async createFromTemplate(templateId: string, name: string): Promise<Workflow> {
    const response = await apiClient.post<Workflow>(`/workflows/templates/${templateId}/create`, {
      name,
    });
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to create workflow from template');
  },

  // Test workflow connection
  async testConnection(workflowId: string, nodeId: string): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.post<{ success: boolean; message: string }>(
      `/workflows/${workflowId}/nodes/${nodeId}/test`
    );
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to test connection');
  },
};
