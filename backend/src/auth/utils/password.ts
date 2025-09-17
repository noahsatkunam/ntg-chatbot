import bcrypt from 'bcrypt';
import { logger } from '../../utils/logger';

// Configuration
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const MIN_PASSWORD_LENGTH = parseInt(process.env.MIN_PASSWORD_LENGTH || '8', 10);

// Password strength requirements
const PASSWORD_REQUIREMENTS = {
  minLength: MIN_PASSWORD_LENGTH,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
};

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    if (BCRYPT_ROUNDS < 12) {
      logger.warn('Bcrypt rounds is less than recommended minimum of 12', { rounds: BCRYPT_ROUNDS });
    }
    
    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    return hashedPassword;
  } catch (error) {
    logger.error('Error hashing password', { error });
    throw new Error('Failed to hash password');
  }
}

/**
 * Compare a plain text password with a hashed password
 */
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch (error) {
    logger.error('Error verifying password', { error });
    return false;
  }
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = [];
  
  // Check minimum length
  if (password.length < PASSWORD_REQUIREMENTS.minLength) {
    errors.push(`Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters long`);
  }
  
  // Check for uppercase letter
  if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  // Check for lowercase letter
  if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  // Check for number
  if (PASSWORD_REQUIREMENTS.requireNumbers && !/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  // Check for special character
  if (PASSWORD_REQUIREMENTS.requireSpecialChars) {
    const specialCharRegex = new RegExp(`[${PASSWORD_REQUIREMENTS.specialChars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`);
    if (!specialCharRegex.test(password)) {
      errors.push('Password must contain at least one special character');
    }
  }
  
  // Check for common passwords
  if (isCommonPassword(password)) {
    errors.push('Password is too common. Please choose a more unique password');
  }
  
  // Check for sequential characters
  if (hasSequentialCharacters(password)) {
    errors.push('Password should not contain sequential characters');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Generate a secure random password
 */
export function generateSecurePassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = PASSWORD_REQUIREMENTS.specialChars;
  const allChars = uppercase + lowercase + numbers + special;
  
  let password = '';
  
  // Ensure at least one character from each required category
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Check if password is in common passwords list
 */
function isCommonPassword(password: string): boolean {
  const commonPasswords = [
    'password', 'password123', '123456', '12345678', 'qwerty', 'abc123',
    'password1', 'admin', 'letmein', 'welcome', '123456789', 'password123',
    'admin123', 'root', 'toor', 'pass', 'test', 'guest', 'master',
    'password1234', '1234567890', 'qwerty123', 'password!', 'p@ssw0rd',
  ];
  
  const lowerPassword = password.toLowerCase();
  return commonPasswords.some(common => lowerPassword.includes(common));
}

/**
 * Check for sequential characters
 */
function hasSequentialCharacters(password: string, maxSequence: number = 3): boolean {
  for (let i = 0; i < password.length - maxSequence + 1; i++) {
    let isSequential = true;
    
    for (let j = 0; j < maxSequence - 1; j++) {
      const currentChar = password.charCodeAt(i + j);
      const nextChar = password.charCodeAt(i + j + 1);
      
      if (nextChar - currentChar !== 1) {
        isSequential = false;
        break;
      }
    }
    
    if (isSequential) {
      return true;
    }
  }
  
  return false;
}

/**
 * Calculate password entropy
 */
export function calculatePasswordEntropy(password: string): number {
  const charsetSize = getCharsetSize(password);
  const entropy = password.length * Math.log2(charsetSize);
  return Math.round(entropy);
}

/**
 * Get charset size based on password characters
 */
function getCharsetSize(password: string): number {
  let size = 0;
  
  if (/[a-z]/.test(password)) size += 26;
  if (/[A-Z]/.test(password)) size += 26;
  if (/\d/.test(password)) size += 10;
  if (/[^a-zA-Z0-9]/.test(password)) size += 32;
  
  return size;
}

/**
 * Get password strength score (0-100)
 */
export function getPasswordStrength(password: string): number {
  const validation = validatePasswordStrength(password);
  if (!validation.isValid) return 0;
  
  const entropy = calculatePasswordEntropy(password);
  const lengthScore = Math.min(password.length / 20, 1) * 25;
  const entropyScore = Math.min(entropy / 100, 1) * 75;
  
  return Math.round(lengthScore + entropyScore);
}
