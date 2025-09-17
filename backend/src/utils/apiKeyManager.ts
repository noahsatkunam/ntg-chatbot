import { config } from '../config/environment.js';
import { logger } from './logger.js';

export interface ApiKeyValidation {
  isValid: boolean;
  service: string;
  error?: string;
}

export class ApiKeyManager {
  private static instance: ApiKeyManager;
  private validatedKeys = new Map<string, boolean>();

  private constructor() {}

  static getInstance(): ApiKeyManager {
    if (!ApiKeyManager.instance) {
      ApiKeyManager.instance = new ApiKeyManager();
    }
    return ApiKeyManager.instance;
  }

  /**
   * Validate OpenAI API key
   */
  async validateOpenAIKey(apiKey?: string): Promise<ApiKeyValidation> {
    const key = apiKey || config.OPENAI.API_KEY;
    
    if (!key) {
      return {
        isValid: false,
        service: 'OpenAI',
        error: 'API key not provided'
      };
    }

    // Check cache first
    const cacheKey = `openai_${key.slice(-8)}`;
    if (this.validatedKeys.has(cacheKey)) {
      return {
        isValid: this.validatedKeys.get(cacheKey)!,
        service: 'OpenAI'
      };
    }

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        }
      });

      const isValid = response.ok;
      this.validatedKeys.set(cacheKey, isValid);

      if (!isValid) {
        const errorData = await response.text();
        logger.warn('OpenAI API key validation failed', { 
          status: response.status,
          error: errorData 
        });
        
        return {
          isValid: false,
          service: 'OpenAI',
          error: `Invalid API key (${response.status})`
        };
      }

      logger.info('OpenAI API key validated successfully');
      return {
        isValid: true,
        service: 'OpenAI'
      };

    } catch (error) {
      logger.error('Error validating OpenAI API key', { error });
      return {
        isValid: false,
        service: 'OpenAI',
        error: 'Network error during validation'
      };
    }
  }

  /**
   * Validate Anthropic API key
   */
  async validateAnthropicKey(apiKey?: string): Promise<ApiKeyValidation> {
    const key = apiKey || config.ANTHROPIC.API_KEY;
    
    if (!key) {
      return {
        isValid: false,
        service: 'Anthropic',
        error: 'API key not provided'
      };
    }

    const cacheKey = `anthropic_${key.slice(-8)}`;
    if (this.validatedKeys.has(cacheKey)) {
      return {
        isValid: this.validatedKeys.get(cacheKey)!,
        service: 'Anthropic'
      };
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }]
        })
      });

      // Anthropic returns 400 for valid keys with invalid requests
      // 401/403 indicates invalid key
      const isValid = response.status !== 401 && response.status !== 403;
      this.validatedKeys.set(cacheKey, isValid);

      if (!isValid) {
        const errorData = await response.text();
        logger.warn('Anthropic API key validation failed', { 
          status: response.status,
          error: errorData 
        });
        
        return {
          isValid: false,
          service: 'Anthropic',
          error: `Invalid API key (${response.status})`
        };
      }

      logger.info('Anthropic API key validated successfully');
      return {
        isValid: true,
        service: 'Anthropic'
      };

    } catch (error) {
      logger.error('Error validating Anthropic API key', { error });
      return {
        isValid: false,
        service: 'Anthropic',
        error: 'Network error during validation'
      };
    }
  }

  /**
   * Validate Supabase connection
   */
  async validateSupabaseKey(): Promise<ApiKeyValidation> {
    if (!config.SUPABASE.URL || !config.SUPABASE.ANON_KEY) {
      return {
        isValid: false,
        service: 'Supabase',
        error: 'Supabase URL or anon key not provided'
      };
    }

    const cacheKey = `supabase_${config.SUPABASE.ANON_KEY.slice(-8)}`;
    if (this.validatedKeys.has(cacheKey)) {
      return {
        isValid: this.validatedKeys.get(cacheKey)!,
        service: 'Supabase'
      };
    }

    try {
      const response = await fetch(`${config.SUPABASE.URL}/rest/v1/`, {
        headers: {
          'apikey': config.SUPABASE.ANON_KEY,
          'Authorization': `Bearer ${config.SUPABASE.ANON_KEY}`
        }
      });

      const isValid = response.ok;
      this.validatedKeys.set(cacheKey, isValid);

      if (!isValid) {
        logger.warn('Supabase connection validation failed', { 
          status: response.status 
        });
        
        return {
          isValid: false,
          service: 'Supabase',
          error: `Connection failed (${response.status})`
        };
      }

      logger.info('Supabase connection validated successfully');
      return {
        isValid: true,
        service: 'Supabase'
      };

    } catch (error) {
      logger.error('Error validating Supabase connection', { error });
      return {
        isValid: false,
        service: 'Supabase',
        error: 'Network error during validation'
      };
    }
  }

  /**
   * Validate Qdrant connection
   */
  async validateQdrantConnection(): Promise<ApiKeyValidation> {
    if (!config.QDRANT.URL) {
      return {
        isValid: false,
        service: 'Qdrant',
        error: 'Qdrant URL not provided'
      };
    }

    const cacheKey = `qdrant_${config.QDRANT.URL}`;
    if (this.validatedKeys.has(cacheKey)) {
      return {
        isValid: this.validatedKeys.get(cacheKey)!,
        service: 'Qdrant'
      };
    }

    try {
      const headers: Record<string, string> = {};
      if (config.QDRANT.API_KEY) {
        headers['api-key'] = config.QDRANT.API_KEY;
      }

      const response = await fetch(`${config.QDRANT.URL}/collections`, {
        headers
      });

      const isValid = response.ok;
      this.validatedKeys.set(cacheKey, isValid);

      if (!isValid) {
        logger.warn('Qdrant connection validation failed', { 
          status: response.status 
        });
        
        return {
          isValid: false,
          service: 'Qdrant',
          error: `Connection failed (${response.status})`
        };
      }

      logger.info('Qdrant connection validated successfully');
      return {
        isValid: true,
        service: 'Qdrant'
      };

    } catch (error) {
      logger.error('Error validating Qdrant connection', { error });
      return {
        isValid: false,
        service: 'Qdrant',
        error: 'Network error during validation'
      };
    }
  }

  /**
   * Validate all configured API keys and services
   */
  async validateAllServices(): Promise<ApiKeyValidation[]> {
    const validations: Promise<ApiKeyValidation>[] = [];

    // Always validate Supabase as it's required
    validations.push(this.validateSupabaseKey());

    // Validate AI services if keys are provided
    if (config.OPENAI.API_KEY) {
      validations.push(this.validateOpenAIKey());
    }

    if (config.ANTHROPIC.API_KEY) {
      validations.push(this.validateAnthropicKey());
    }

    // Validate Qdrant if URL is provided
    if (config.QDRANT.URL) {
      validations.push(this.validateQdrantConnection());
    }

    const results = await Promise.all(validations);
    
    // Log summary
    const valid = results.filter(r => r.isValid).length;
    const total = results.length;
    
    logger.info(`API validation complete: ${valid}/${total} services validated`, {
      results: results.map(r => ({
        service: r.service,
        valid: r.isValid,
        error: r.error
      }))
    });

    return results;
  }

  /**
   * Get available AI services
   */
  getAvailableAIServices(): string[] {
    const services: string[] = [];
    
    if (config.OPENAI.API_KEY) {
      services.push('openai');
    }
    
    if (config.ANTHROPIC.API_KEY) {
      services.push('anthropic');
    }
    
    return services;
  }

  /**
   * Clear validation cache
   */
  clearCache(): void {
    this.validatedKeys.clear();
    logger.info('API key validation cache cleared');
  }

  /**
   * Get preferred AI service based on availability
   */
  getPreferredAIService(): string | null {
    const available = this.getAvailableAIServices();
    
    // Prefer OpenAI if available, then Anthropic
    if (available.includes('openai')) {
      return 'openai';
    }
    
    if (available.includes('anthropic')) {
      return 'anthropic';
    }
    
    return null;
  }
}

export const apiKeyManager = ApiKeyManager.getInstance();
