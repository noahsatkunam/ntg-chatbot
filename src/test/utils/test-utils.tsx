import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../contexts/AuthContext';
import { TenantProvider } from '../../contexts/TenantContext';
import { ChatProvider } from '../../contexts/ChatContext';
import { NotificationProvider } from '../../components/ui/GlobalErrorHandler';

// Create a custom render function that includes providers
const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <NotificationProvider>
          <AuthProvider>
            <TenantProvider>
              <ChatProvider>
                {children}
              </ChatProvider>
            </TenantProvider>
          </AuthProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options });

export * from '@testing-library/react';
export { customRender as render };

// Mock user for authenticated tests
export const mockAuthenticatedUser = {
  id: '1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'user' as const,
  tenantId: 'tenant-1',
  isActive: true,
  lastLoginAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Mock tenant data
export const mockTenant = {
  id: 'tenant-1',
  name: 'Test Tenant',
  settings: {
    features: {
      chat: true,
      knowledgeBase: true,
      workflows: true,
      analytics: true,
      streaming: true,
    },
    limits: {
      users: 100,
      conversations: 1000,
      documents: 500,
      workflows: 50,
    },
    branding: {
      primaryColor: '#0f172a',
      secondaryColor: '#64748b',
      logo: null,
    },
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Helper function to create authenticated render
export const renderWithAuth = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) => {
  // Mock localStorage with auth tokens
  localStorage.setItem('accessToken', 'mock-access-token');
  localStorage.setItem('refreshToken', 'mock-refresh-token');
  localStorage.setItem('user', JSON.stringify(mockAuthenticatedUser));
  
  return customRender(ui, options);
};
