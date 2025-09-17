#!/usr/bin/env node

/**
 * Environment Variable Validation Script
 * Validates that all required environment variables are properly configured
 */

import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

// Load environment variables
config();

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}[WARNING]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`)
};

// Required environment variables
const requiredVars = [
  'DATABASE_URL',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'JWT_SECRET',
  'REFRESH_TOKEN_SECRET',
  'ENCRYPTION_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY'
];

// Optional but recommended variables
const recommendedVars = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'SUPABASE_SERVICE_KEY',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS'
];

// Variables that should have specific formats
const formatValidations = {
  'DATABASE_URL': /^postgresql:\/\/.+:.+@.+:\d+\/.+$/,
  'REDIS_URL': /^redis:\/\/.+:\d+$/,
  'JWT_SECRET': /.{32,}/,
  'REFRESH_TOKEN_SECRET': /.{32,}/,
  'ENCRYPTION_KEY': /.{32,}/,
  'SUPABASE_URL': /^https:\/\/.+\.supabase\.co$/,
  'VITE_SUPABASE_URL': /^https:\/\/.+\.supabase\.co$/,
  'PORT': /^\d+$/,
  'MAX_FILE_SIZE': /^\d+$/
};

// Variables that should not contain default/placeholder values
const placeholderPatterns = [
  /your-.+-here/,
  /your-.+-key/,
  /your-.+-password/,
  /your-.+-secret/,
  /change-in-production/,
  /example/,
  /placeholder/
];

function validateEnvironment() {
  log.info('Starting environment validation...\n');
  
  let hasErrors = false;
  let hasWarnings = false;

  // Check required variables
  log.info('Checking required environment variables:');
  for (const varName of requiredVars) {
    const value = process.env[varName];
    
    if (!value) {
      log.error(`Missing required variable: ${varName}`);
      hasErrors = true;
    } else if (containsPlaceholder(value)) {
      log.error(`${varName} contains placeholder value: ${value}`);
      hasErrors = true;
    } else if (formatValidations[varName] && !formatValidations[varName].test(value)) {
      log.error(`${varName} has invalid format: ${value}`);
      hasErrors = true;
    } else {
      log.success(`${varName} ✓`);
    }
  }

  console.log();

  // Check recommended variables
  log.info('Checking recommended environment variables:');
  for (const varName of recommendedVars) {
    const value = process.env[varName];
    
    if (!value) {
      log.warning(`Missing recommended variable: ${varName}`);
      hasWarnings = true;
    } else if (containsPlaceholder(value)) {
      log.warning(`${varName} contains placeholder value: ${value}`);
      hasWarnings = true;
    } else {
      log.success(`${varName} ✓`);
    }
  }

  console.log();

  // Check format validations for all variables
  log.info('Checking variable formats:');
  for (const [varName, pattern] of Object.entries(formatValidations)) {
    const value = process.env[varName];
    
    if (value && !pattern.test(value)) {
      log.error(`${varName} format validation failed`);
      hasErrors = true;
    } else if (value) {
      log.success(`${varName} format ✓`);
    }
  }

  console.log();

  // Security checks
  log.info('Running security checks:');
  
  // Check JWT secret strength
  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret && jwtSecret.length < 32) {
    log.warning('JWT_SECRET should be at least 32 characters long');
    hasWarnings = true;
  } else if (jwtSecret) {
    log.success('JWT_SECRET length ✓');
  }

  // Check encryption key strength
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (encryptionKey && encryptionKey.length < 32) {
    log.warning('ENCRYPTION_KEY should be at least 32 characters long');
    hasWarnings = true;
  } else if (encryptionKey) {
    log.success('ENCRYPTION_KEY length ✓');
  }

  // Check for development values in production
  if (process.env.NODE_ENV === 'production') {
    const devPatterns = [/localhost/, /127\.0\.0\.1/, /admin123/, /password123/];
    
    for (const [key, value] of Object.entries(process.env)) {
      if (value && devPatterns.some(pattern => pattern.test(value))) {
        log.error(`${key} contains development value in production: ${value}`);
        hasErrors = true;
      }
    }
  }

  console.log();

  // Summary
  if (hasErrors) {
    log.error('Environment validation failed! Please fix the errors above.');
    process.exit(1);
  } else if (hasWarnings) {
    log.warning('Environment validation passed with warnings. Consider addressing the warnings above.');
    process.exit(0);
  } else {
    log.success('Environment validation passed! All variables are properly configured.');
    process.exit(0);
  }
}

function containsPlaceholder(value) {
  return placeholderPatterns.some(pattern => pattern.test(value));
}

// Generate secure keys helper
function generateSecureKeys() {
  log.info('Generating secure keys for development:');
  console.log();
  
  console.log('# Add these to your .env file:');
  console.log(`JWT_SECRET="${randomBytes(32).toString('base64')}"`);
  console.log(`REFRESH_TOKEN_SECRET="${randomBytes(32).toString('base64')}"`);
  console.log(`ENCRYPTION_KEY="${randomBytes(32).toString('base64')}"`);
  console.log(`N8N_ENCRYPTION_KEY="${randomBytes(32).toString('base64')}"`);
  console.log();
}

// Check if running with --generate-keys flag
if (process.argv.includes('--generate-keys')) {
  generateSecureKeys();
} else {
  validateEnvironment();
}
