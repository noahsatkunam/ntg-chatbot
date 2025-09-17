import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Tenant, TenantSettings, ApiIntegration } from '../types/api';
import { tenantApi } from '../lib/api/tenant';
import { useAuth } from './AuthContext';

interface TenantContextType {
  tenant: Tenant | null;
  settings: TenantSettings | null;
  integrations: ApiIntegration[];
  isLoading: boolean;
  
  // Tenant management
  updateSettings: (settings: Partial<TenantSettings>) => Promise<void>;
  refreshTenant: () => Promise<void>;
  
  // Integration management
  createIntegration: (integration: Omit<ApiIntegration, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>) => Promise<ApiIntegration>;
  updateIntegration: (integrationId: string, updates: Partial<ApiIntegration>) => Promise<void>;
  deleteIntegration: (integrationId: string) => Promise<void>;
  testIntegration: (integrationId: string) => Promise<{ success: boolean; message: string }>;
  
  // Branding helpers
  getBrandingStyles: () => React.CSSProperties;
  getLogoUrl: () => string | null;
}

const TenantContext = createContext<TenantContextType | null>(null);

interface TenantProviderProps {
  children: ReactNode;
}

export const TenantProvider: React.FC<TenantProviderProps> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [integrations, setIntegrations] = useState<ApiIntegration[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const settings = tenant?.settings || null;

  // Load tenant data when user is authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      loadTenantData();
    } else {
      setTenant(null);
      setIntegrations([]);
    }
  }, [isAuthenticated, user]);

  // Apply tenant branding to document
  useEffect(() => {
    if (tenant?.settings?.branding) {
      applyBranding(tenant.settings.branding);
    }
    
    return () => {
      // Cleanup branding on unmount
      removeBranding();
    };
  }, [tenant?.settings?.branding]);

  const loadTenantData = async () => {
    setIsLoading(true);
    try {
      const [tenantData, integrationsData] = await Promise.all([
        tenantApi.getCurrentTenant(),
        tenantApi.getIntegrations(),
      ]);
      
      setTenant(tenantData);
      setIntegrations(integrationsData);
    } catch (error) {
      console.error('Failed to load tenant data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updateSettings = async (newSettings: Partial<TenantSettings>) => {
    if (!tenant) throw new Error('No tenant loaded');
    
    try {
      const updatedTenant = await tenantApi.updateTenantSettings(newSettings);
      setTenant(updatedTenant);
    } catch (error) {
      console.error('Failed to update tenant settings:', error);
      throw error;
    }
  };

  const refreshTenant = async () => {
    await loadTenantData();
  };

  const createIntegration = async (integration: Omit<ApiIntegration, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>) => {
    try {
      const newIntegration = await tenantApi.createIntegration(integration);
      setIntegrations(prev => [...prev, newIntegration]);
      return newIntegration;
    } catch (error) {
      console.error('Failed to create integration:', error);
      throw error;
    }
  };

  const updateIntegration = async (integrationId: string, updates: Partial<ApiIntegration>) => {
    try {
      const updatedIntegration = await tenantApi.updateIntegration(integrationId, updates);
      setIntegrations(prev => 
        prev.map(integration => 
          integration.id === integrationId ? updatedIntegration : integration
        )
      );
    } catch (error) {
      console.error('Failed to update integration:', error);
      throw error;
    }
  };

  const deleteIntegration = async (integrationId: string) => {
    try {
      await tenantApi.deleteIntegration(integrationId);
      setIntegrations(prev => prev.filter(integration => integration.id !== integrationId));
    } catch (error) {
      console.error('Failed to delete integration:', error);
      throw error;
    }
  };

  const testIntegration = async (integrationId: string) => {
    try {
      return await tenantApi.testIntegration(integrationId);
    } catch (error) {
      console.error('Failed to test integration:', error);
      throw error;
    }
  };

  const getBrandingStyles = (): React.CSSProperties => {
    if (!tenant?.settings?.branding) return {};
    
    const { primaryColor, secondaryColor } = tenant.settings.branding;
    
    return {
      '--primary': primaryColor || '#0f172a',
      '--secondary': secondaryColor || '#64748b',
    } as React.CSSProperties;
  };

  const getLogoUrl = (): string | null => {
    return tenant?.settings?.branding?.logo || null;
  };

  const applyBranding = (branding: NonNullable<TenantSettings['branding']>) => {
    const root = document.documentElement;
    
    if (branding.primaryColor) {
      root.style.setProperty('--primary', branding.primaryColor);
    }
    
    if (branding.secondaryColor) {
      root.style.setProperty('--secondary', branding.secondaryColor);
    }
    
    // Set favicon if logo is provided
    if (branding.logo) {
      const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      if (favicon) {
        favicon.href = branding.logo;
      }
    }
  };

  const removeBranding = () => {
    const root = document.documentElement;
    root.style.removeProperty('--primary');
    root.style.removeProperty('--secondary');
  };

  const value: TenantContextType = {
    tenant,
    settings,
    integrations,
    isLoading,
    
    updateSettings,
    refreshTenant,
    
    createIntegration,
    updateIntegration,
    deleteIntegration,
    testIntegration,
    
    getBrandingStyles,
    getLogoUrl,
  };

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = (): TenantContextType => {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};

// Higher-order component for tenant-aware components
export const withTenant = <P extends object>(
  Component: React.ComponentType<P>
): React.FC<P> => {
  return (props: P) => {
    const { tenant, isLoading } = useTenant();

    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
        </div>
      );
    }

    if (!tenant) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h2 className="text-xl font-semibold mb-2">No Tenant Access</h2>
            <p className="text-muted-foreground">You don't have access to any tenant.</p>
          </div>
        </div>
      );
    }

    return <Component {...props} />;
  };
};
