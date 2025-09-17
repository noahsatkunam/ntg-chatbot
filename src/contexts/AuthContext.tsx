import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, AuthResponse } from '../types/api';
import { authApi } from '../lib/api/auth';
import webSocketManager from '../lib/websocket';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, twoFactorCode?: string) => Promise<void>;
  register: (userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    tenantName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user && authApi.isAuthenticated();

  // Initialize auth state on mount
  useEffect(() => {
    initializeAuth();
  }, []);

  // Update WebSocket auth when user changes
  useEffect(() => {
    if (user && authApi.isAuthenticated()) {
      const tokens = authApi.getTokens();
      if (tokens.accessToken) {
        webSocketManager.updateAuth(tokens.accessToken);
      }
    }
  }, [user]);

  const initializeAuth = async () => {
    try {
      if (authApi.isAuthenticated()) {
        const userData = await authApi.getCurrentUser();
        setUser(userData);
      }
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      // Clear invalid tokens
      authApi.logout();
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string, twoFactorCode?: string) => {
    setIsLoading(true);
    try {
      const authResponse: AuthResponse = await authApi.login({
        email,
        password,
        twoFactorCode,
      });
      
      setUser(authResponse.user);
      
      // Update WebSocket authentication
      webSocketManager.updateAuth(authResponse.tokens.accessToken);
    } catch (error) {
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    tenantName?: string;
  }) => {
    setIsLoading(true);
    try {
      const authResponse: AuthResponse = await authApi.register(userData);
      
      setUser(authResponse.user);
      
      // Update WebSocket authentication
      webSocketManager.updateAuth(authResponse.tokens.accessToken);
    } catch (error) {
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await authApi.logout();
      setUser(null);
      
      // Disconnect WebSocket
      webSocketManager.disconnect();
    } catch (error) {
      console.error('Logout error:', error);
      // Still clear local state even if API call fails
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const updateProfile = async (updates: Partial<User>) => {
    if (!user) throw new Error('No user logged in');
    
    try {
      const updatedUser = await authApi.updateProfile(updates);
      setUser(updatedUser);
    } catch (error) {
      throw error;
    }
  };

  const refreshUser = async () => {
    if (!authApi.isAuthenticated()) return;
    
    try {
      const userData = await authApi.getCurrentUser();
      setUser(userData);
    } catch (error) {
      console.error('Failed to refresh user:', error);
      // If refresh fails, user might need to re-authenticate
      setUser(null);
      authApi.logout();
    }
  };

  const value: AuthContextType = {
    user,
    isAuthenticated,
    isLoading,
    login,
    register,
    logout,
    updateProfile,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Higher-order component for protected routes
export const withAuth = <P extends object>(
  Component: React.ComponentType<P>
): React.FC<P> => {
  return (props: P) => {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
        </div>
      );
    }

    if (!isAuthenticated) {
      // Redirect to login or show login form
      window.location.href = '/login';
      return null;
    }

    return <Component {...props} />;
  };
};
