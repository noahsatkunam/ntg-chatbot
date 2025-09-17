import DOMPurify from 'isomorphic-dompurify';
import validator from 'validator';

/**
 * Sanitize user input to prevent XSS attacks
 */
export function sanitizeInput(input: string): string {
  if (!input) return '';

  // Remove any HTML tags and scripts
  let sanitized = DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  });

  // Additional sanitization
  sanitized = sanitized
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, ''); // Remove event handlers

  return sanitized.trim();
}

/**
 * Sanitize HTML content (for rich text)
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'blockquote',
      'ul', 'ol', 'li', 'a', 'code', 'pre', 'h1', 'h2', 'h3'
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
    ADD_ATTR: ['target'],
    ADD_TAGS: ['rel'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
  });
}

/**
 * Validate and sanitize email
 */
export function sanitizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  
  if (!validator.isEmail(trimmed)) {
    throw new Error('Invalid email format');
  }
  
  return validator.normalizeEmail(trimmed) || trimmed;
}

/**
 * Validate and sanitize URL
 */
export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  
  if (!validator.isURL(trimmed, {
    protocols: ['http', 'https'],
    require_protocol: true,
  })) {
    throw new Error('Invalid URL format');
  }
  
  return trimmed;
}

/**
 * Sanitize filename
 */
export function sanitizeFilename(filename: string): string {
  // Remove path traversal attempts
  let sanitized = filename.replace(/[\/\\]/g, '');
  
  // Remove special characters except dots and dashes
  sanitized = sanitized.replace(/[^a-zA-Z0-9.-]/g, '_');
  
  // Ensure it doesn't start with a dot (hidden file)
  if (sanitized.startsWith('.')) {
    sanitized = '_' + sanitized.substring(1);
  }
  
  // Limit length
  if (sanitized.length > 255) {
    const ext = sanitized.split('.').pop();
    const name = sanitized.substring(0, 250 - (ext?.length || 0));
    sanitized = ext ? `${name}.${ext}` : name;
  }
  
  return sanitized;
}

/**
 * Sanitize object keys (remove prototype pollution attempts)
 */
export function sanitizeObject(obj: any): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  const dangerous = ['__proto__', 'constructor', 'prototype'];
  const clean: any = Array.isArray(obj) ? [] : {};

  for (const key in obj) {
    if (obj.hasOwnProperty(key) && !dangerous.includes(key)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        clean[key] = sanitizeObject(obj[key]);
      } else if (typeof obj[key] === 'string') {
        clean[key] = sanitizeInput(obj[key]);
      } else {
        clean[key] = obj[key];
      }
    }
  }

  return clean;
}

/**
 * Escape SQL identifiers (table/column names)
 */
export function escapeIdentifier(identifier: string): string {
  return identifier.replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * Validate UUID
 */
export function isValidUuid(uuid: string): boolean {
  return validator.isUUID(uuid);
}

/**
 * Sanitize search query
 */
export function sanitizeSearchQuery(query: string): string {
  // Remove SQL wildcards and special characters
  let sanitized = query
    .replace(/[%_]/g, '') // Remove SQL wildcards
    .replace(/['"`;]/g, '') // Remove quotes and semicolons
    .trim();

  // Limit length
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }

  return sanitized;
}

/**
 * Rate limit key sanitizer
 */
export function sanitizeRateLimitKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9:_-]/g, '');
}
