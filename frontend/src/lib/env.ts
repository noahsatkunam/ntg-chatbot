// Environment variable utilities with safe defaults
export const env = {
  // API Configuration
  API_URL: import.meta.env.VITE_API_URL || '/api',
  WS_URL: import.meta.env.VITE_WS_URL || '',
  PORT: parseInt(import.meta.env.VITE_PORT || '5173'),

  // Authentication
  ENABLE_AUTH: import.meta.env.VITE_ENABLE_AUTH === 'true',
  MOCK_AUTH: import.meta.env.VITE_MOCK_AUTH === 'true',
  AUTH_REDIRECT_URL: import.meta.env.VITE_AUTH_REDIRECT_URL || '/auth/callback',

  // Features
  ENABLE_STREAMING: import.meta.env.VITE_ENABLE_STREAMING === 'true',
  ENABLE_FILE_UPLOAD: import.meta.env.VITE_ENABLE_FILE_UPLOAD === 'true',
  ENABLE_ANALYTICS: import.meta.env.VITE_ENABLE_ANALYTICS === 'true',
  ENABLE_WORKFLOWS: import.meta.env.VITE_ENABLE_WORKFLOWS === 'true',
  ENABLE_2FA: import.meta.env.VITE_ENABLE_2FA === 'true',
  ENABLE_MOCK_DATA: import.meta.env.VITE_ENABLE_MOCK_DATA === 'true',

  // Development
  ENABLE_DEV_TOOLS: import.meta.env.VITE_ENABLE_DEV_TOOLS === 'true',
  ENABLE_DEBUG: import.meta.env.VITE_ENABLE_DEBUG === 'true',
  MOCK_BACKEND: import.meta.env.VITE_MOCK_BACKEND === 'true',

  // File Upload
  MAX_FILE_SIZE: parseInt(import.meta.env.VITE_MAX_FILE_SIZE || '52428800'),
  ALLOWED_FILE_TYPES: import.meta.env.VITE_ALLOWED_FILE_TYPES || '.pdf,.doc,.docx,.txt,.md,.jpg,.jpeg,.png,.gif',

  // Chat
  CHAT_MODEL: import.meta.env.VITE_CHAT_MODEL || 'gpt-4',
  CHAT_MAX_TOKENS: parseInt(import.meta.env.VITE_CHAT_MAX_TOKENS || '4000'),
  CHAT_TEMPERATURE: parseFloat(import.meta.env.VITE_CHAT_TEMPERATURE || '0.7'),

  // Build
  PREVIEW_MODE: import.meta.env.VITE_PREVIEW_MODE === 'true',
  LOVABLE_PREVIEW: import.meta.env.VITE_LOVABLE_PREVIEW === 'true',
  BASE_URL: import.meta.env.VITE_BASE_URL || '/',

  // Runtime checks
  isDevelopment: import.meta.env.DEV,
  isProduction: import.meta.env.PROD,
  isPreview: import.meta.env.VITE_PREVIEW_MODE === 'true',
};

// Validation function to check critical environment variables
export function validateEnvironment(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check critical variables
  if (!env.API_URL) {
    errors.push('VITE_API_URL is required');
  }

  if (env.ENABLE_FILE_UPLOAD && env.MAX_FILE_SIZE <= 0) {
    errors.push('VITE_MAX_FILE_SIZE must be greater than 0 when file upload is enabled');
  }

  if (env.CHAT_MAX_TOKENS <= 0) {
    errors.push('VITE_CHAT_MAX_TOKENS must be greater than 0');
  }

  if (env.CHAT_TEMPERATURE < 0 || env.CHAT_TEMPERATURE > 2) {
    errors.push('VITE_CHAT_TEMPERATURE must be between 0 and 2');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Safe environment getter with fallbacks
export function getEnvVar(key: string, fallback: string = ''): string {
  try {
    return import.meta.env[key] || fallback;
  } catch {
    return fallback;
  }
}

// Type-safe boolean environment getter
export function getBooleanEnv(key: string, fallback: boolean = false): boolean {
  try {
    const value = import.meta.env[key];
    if (value === undefined) return fallback;
    return value === 'true' || value === '1';
  } catch {
    return fallback;
  }
}

// Type-safe number environment getter
export function getNumberEnv(key: string, fallback: number = 0): number {
  try {
    const value = import.meta.env[key];
    if (value === undefined) return fallback;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
  } catch {
    return fallback;
  }
}
