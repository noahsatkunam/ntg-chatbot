import apiClient from '../api-client';
import { 
  LoginRequest, 
  RegisterRequest, 
  AuthResponse, 
  User, 
  ApiResponse 
} from '../../types/api';

export const authApi = {
  // Login user
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>('/auth/login', credentials);
    
    if (response.success && response.data) {
      // Store tokens in the API client
      apiClient.setAuthTokens(
        response.data.tokens.accessToken,
        response.data.tokens.refreshToken
      );
      return response.data;
    }
    
    throw new Error(response.error || 'Login failed');
  },

  // Register new user
  async register(userData: RegisterRequest): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>('/auth/register', userData);
    
    if (response.success && response.data) {
      // Store tokens in the API client
      apiClient.setAuthTokens(
        response.data.tokens.accessToken,
        response.data.tokens.refreshToken
      );
      return response.data;
    }
    
    throw new Error(response.error || 'Registration failed');
  },

  // Logout user
  async logout(): Promise<void> {
    try {
      await apiClient.post('/auth/logout');
    } catch (error) {
      console.warn('Logout request failed:', error);
    } finally {
      // Always clear tokens locally
      apiClient.clearAuthTokens();
    }
  },

  // Get current user profile
  async getCurrentUser(): Promise<User> {
    const response = await apiClient.get<User>('/auth/me');
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to get user profile');
  },

  // Update user profile
  async updateProfile(updates: Partial<User>): Promise<User> {
    const response = await apiClient.patch<User>('/auth/profile', updates);
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to update profile');
  },

  // Change password
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const response = await apiClient.post('/auth/change-password', {
      currentPassword,
      newPassword,
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to change password');
    }
  },

  // Request password reset
  async requestPasswordReset(email: string): Promise<void> {
    const response = await apiClient.post('/auth/forgot-password', { email });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to request password reset');
    }
  },

  // Reset password with token
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const response = await apiClient.post('/auth/reset-password', {
      token,
      newPassword,
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to reset password');
    }
  },

  // Verify email
  async verifyEmail(token: string): Promise<void> {
    const response = await apiClient.post('/auth/verify-email', { token });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to verify email');
    }
  },

  // Resend verification email
  async resendVerificationEmail(): Promise<void> {
    const response = await apiClient.post('/auth/resend-verification');
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to resend verification email');
    }
  },

  // Enable 2FA
  async enable2FA(): Promise<{ qrCode: string; secret: string }> {
    const response = await apiClient.post<{ qrCode: string; secret: string }>('/auth/2fa/enable');
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to enable 2FA');
  },

  // Confirm 2FA setup
  async confirm2FA(token: string): Promise<{ backupCodes: string[] }> {
    const response = await apiClient.post<{ backupCodes: string[] }>('/auth/2fa/confirm', {
      token,
    });
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to confirm 2FA');
  },

  // Disable 2FA
  async disable2FA(token: string): Promise<void> {
    const response = await apiClient.post('/auth/2fa/disable', { token });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to disable 2FA');
    }
  },

  // Generate new backup codes
  async generateBackupCodes(): Promise<{ backupCodes: string[] }> {
    const response = await apiClient.post<{ backupCodes: string[] }>('/auth/2fa/backup-codes');
    
    if (response.success && response.data) {
      return response.data;
    }
    
    throw new Error(response.error || 'Failed to generate backup codes');
  },

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return !!localStorage.getItem('access_token');
  },

  // Get stored tokens
  getTokens(): { accessToken: string | null; refreshToken: string | null } {
    return {
      accessToken: localStorage.getItem('access_token'),
      refreshToken: localStorage.getItem('refresh_token'),
    };
  },
};
