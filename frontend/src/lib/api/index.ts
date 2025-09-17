// Export all API modules for easy importing
export { authApi } from './auth';
export { chatApi } from './chat';
export { knowledgeApi } from './knowledge';
export { tenantApi } from './tenant';

// Export API client for direct use if needed
export { default as apiClient } from '../api-client';

// Export WebSocket manager
export { default as webSocketManager } from '../websocket';

// Re-export types for convenience
export * from '../../types/api';
