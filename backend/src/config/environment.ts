import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

// Load environment variables from multiple locations
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
dotenv.config();

// Environment validation schema
const envSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default("3001"),
  
  // Database Configuration
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  POSTGRES_DB: z.string().default('ntg_chatbot_dev'),
  POSTGRES_USER: z.string().default('ntg_user'),
  POSTGRES_PASSWORD: z.string().default('ntg_password'),
  
  // Redis Configuration
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),
  
  // JWT Configuration
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  REFRESH_TOKEN_SECRET: z.string().min(32, 'REFRESH_TOKEN_SECRET must be at least 32 characters'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),
  
  // Encryption
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),
  
  // AI API Configuration
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4'),
  OPENAI_MAX_TOKENS: z.string().transform(Number).default("4000"),
  ANTHROPIC_API_KEY: z.string().optional(),
  
  // Supabase Configuration
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  
  // Vector Database
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional(),
  
  // CORS and Security
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:3000'),
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default("900000"),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default("100"),
  
  // File Upload
  MAX_FILE_SIZE: z.string().transform(Number).default("52428800"),
  UPLOAD_PATH: z.string().default('./uploads'),
  ALLOWED_FILE_TYPES: z.string().default('.pdf,.doc,.docx,.txt,.md,.jpg,.jpeg,.png,.gif'),
  
  // Email Configuration
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  FROM_EMAIL: z.string().optional(),
  FROM_NAME: z.string().optional(),
  
  // Logging and Monitoring
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  ENABLE_METRICS: z.string().transform(val => val === 'true').default("true"),
  
  // Frontend URLs
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  BACKEND_URL: z.string().url().default('http://localhost:3001'),
});

// Validate environment variables
let env: z.infer<typeof envSchema>;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Environment validation failed:');
    error.errors.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

// Export validated environment configuration
export const config = {
  // Server
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
  IS_PRODUCTION: env.NODE_ENV === 'production',
  IS_DEVELOPMENT: env.NODE_ENV === 'development',
  IS_TEST: env.NODE_ENV === 'test',
  
  // Database
  DATABASE_URL: env.DATABASE_URL,
  POSTGRES: {
    DB: env.POSTGRES_DB,
    USER: env.POSTGRES_USER,
    PASSWORD: env.POSTGRES_PASSWORD,
  },
  
  // Redis
  REDIS_URL: env.REDIS_URL,
  REDIS_PASSWORD: env.REDIS_PASSWORD,
  
  // Authentication
  JWT: {
    SECRET: env.JWT_SECRET,
    EXPIRES_IN: env.JWT_EXPIRES_IN,
    REFRESH_SECRET: env.REFRESH_TOKEN_SECRET,
    REFRESH_EXPIRES_IN: env.REFRESH_TOKEN_EXPIRES_IN,
  },
  
  // Encryption
  ENCRYPTION_KEY: env.ENCRYPTION_KEY,
  
  // AI APIs
  OPENAI: {
    API_KEY: env.OPENAI_API_KEY,
    MODEL: env.OPENAI_MODEL,
    MAX_TOKENS: env.OPENAI_MAX_TOKENS,
  },
  ANTHROPIC: {
    API_KEY: env.ANTHROPIC_API_KEY,
  },
  
  // Supabase
  SUPABASE: {
    URL: env.SUPABASE_URL,
    ANON_KEY: env.SUPABASE_ANON_KEY,
    SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
  },
  
  // Vector Database
  QDRANT: {
    URL: env.QDRANT_URL,
    API_KEY: env.QDRANT_API_KEY,
  },
  
  // Security
  CORS_ORIGIN: env.CORS_ORIGIN.split(',').map(origin => origin.trim()),
  RATE_LIMIT: {
    WINDOW_MS: env.RATE_LIMIT_WINDOW_MS,
    MAX_REQUESTS: env.RATE_LIMIT_MAX_REQUESTS,
  },
  
  // File Upload
  UPLOAD: {
    MAX_FILE_SIZE: env.MAX_FILE_SIZE,
    PATH: env.UPLOAD_PATH,
    ALLOWED_TYPES: env.ALLOWED_FILE_TYPES.split(',').map(type => type.trim()),
  },
  
  // Email
  SMTP: {
    HOST: env.SMTP_HOST,
    PORT: env.SMTP_PORT,
    USER: env.SMTP_USER,
    PASS: env.SMTP_PASS,
    FROM_EMAIL: env.FROM_EMAIL,
    FROM_NAME: env.FROM_NAME,
  },
  
  // Logging
  LOG_LEVEL: env.LOG_LEVEL,
  ENABLE_METRICS: env.ENABLE_METRICS,
  
  // URLs
  FRONTEND_URL: env.FRONTEND_URL,
  BACKEND_URL: env.BACKEND_URL,
} as const;

// Runtime configuration validation
export function validateRuntimeConfig(): void {
  const errors: string[] = [];
  
  // Check required API keys based on features
  if (!config.OPENAI.API_KEY && !config.ANTHROPIC.API_KEY) {
    errors.push('At least one AI API key (OPENAI_API_KEY or ANTHROPIC_API_KEY) is required');
  }
  
  // Check email configuration if SMTP is partially configured
  const smtpFields = [config.SMTP.HOST, config.SMTP.USER, config.SMTP.PASS];
  const smtpConfigured = smtpFields.filter(Boolean).length;
  if (smtpConfigured > 0 && smtpConfigured < 3) {
    errors.push('Incomplete SMTP configuration. Provide HOST, USER, and PASS or leave all empty');
  }
  
  // Production-specific validations
  if (config.IS_PRODUCTION) {
    if (config.JWT.SECRET.includes('your-') || config.JWT.SECRET.includes('change-in-production')) {
      errors.push('JWT_SECRET contains placeholder value in production');
    }
    
    if (config.ENCRYPTION_KEY.includes('your-') || config.ENCRYPTION_KEY.includes('change-in-production')) {
      errors.push('ENCRYPTION_KEY contains placeholder value in production');
    }
    
    if (config.CORS_ORIGIN.includes('localhost')) {
      errors.push('CORS_ORIGIN contains localhost in production');
    }
  }
  
  if (errors.length > 0) {
    console.error('❌ Runtime configuration validation failed:');
    errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }
  
  console.log('✅ Configuration validation passed');
}

// Export individual configurations for convenience
export const {
  NODE_ENV,
  PORT,
  IS_PRODUCTION,
  IS_DEVELOPMENT,
  DATABASE_URL,
  JWT,
  OPENAI,
  SUPABASE,
  CORS_ORIGIN,
} = config;

export default config;
