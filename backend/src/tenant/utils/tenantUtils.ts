import crypto from 'crypto';

/**
 * Generate a URL-safe slug from a string
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/--+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+/, '') // Trim hyphens from start
    .replace(/-+$/, ''); // Trim hyphens from end
}

/**
 * Validate subdomain format
 */
export function validateSubdomain(subdomain: string): boolean {
  // Subdomain rules:
  // - 3-63 characters long
  // - Lowercase letters, numbers, and hyphens only
  // - Cannot start or end with hyphen
  // - Cannot contain consecutive hyphens
  const subdomainRegex = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;
  
  // Reserved subdomains
  const reserved = [
    'www', 'api', 'app', 'admin', 'dashboard', 'mail', 'ftp', 'blog',
    'shop', 'store', 'help', 'support', 'docs', 'status', 'dev',
    'staging', 'test', 'demo', 'portal', 'my', 'account', 'billing',
    'pay', 'payment', 'checkout', 'cart', 'order', 'download',
    'login', 'register', 'signup', 'signin', 'auth', 'oauth',
    'sso', 'connect', 'link', 'share', 'invite', 'join',
  ];
  
  if (!subdomainRegex.test(subdomain)) {
    return false;
  }
  
  if (reserved.includes(subdomain.toLowerCase())) {
    return false;
  }
  
  return true;
}

/**
 * Generate a random subdomain
 */
export function generateRandomSubdomain(prefix: string = 'tenant'): string {
  const randomString = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${randomString}`;
}

/**
 * Validate custom domain format
 */
export function validateCustomDomain(domain: string): boolean {
  // Basic domain validation
  const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;
  
  // Check for IP addresses (not allowed)
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  
  if (ipRegex.test(domain)) {
    return false;
  }
  
  return domainRegex.test(domain);
}

/**
 * Extract tenant identifier from host
 */
export function extractTenantFromHost(host: string, baseDomain: string): string | null {
  // Remove port if present
  const hostname = host.split(':')[0];
  
  // Check if it's a subdomain of the base domain
  if (hostname.endsWith(`.${baseDomain}`)) {
    const subdomain = hostname.replace(`.${baseDomain}`, '');
    const parts = subdomain.split('.');
    
    // Return the first part as subdomain
    if (parts.length > 0 && parts[0] !== 'www') {
      return parts[0];
    }
  }
  
  // Otherwise, treat entire hostname as potential custom domain
  return hostname;
}

/**
 * Generate tenant-specific cache key
 */
export function getTenantCacheKey(tenantId: string, key: string): string {
  return `tenant:${tenantId}:${key}`;
}

/**
 * Format tenant display name
 */
export function formatTenantName(name: string): string {
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Calculate storage size in human-readable format
 */
export function formatStorageSize(bytes: bigint | number): string {
  const size = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  
  if (size === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(size) / Math.log(k));
  
  return `${parseFloat((size / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Calculate percentage of limit used
 */
export function calculateUsagePercentage(used: number, limit: number): number {
  if (limit === -1) return 0; // Unlimited
  if (limit === 0) return 100; // No limit means fully used
  
  return Math.min(Math.round((used / limit) * 100), 100);
}

/**
 * Get color based on usage percentage
 */
export function getUsageColor(percentage: number): string {
  if (percentage < 50) return 'green';
  if (percentage < 80) return 'yellow';
  if (percentage < 95) return 'orange';
  return 'red';
}

/**
 * Check if tenant has feature
 */
export function hasTenantFeature(features: any, feature: string): boolean {
  return features && features[feature] === true;
}

/**
 * Get tenant limit value
 */
export function getTenantLimit(limits: any, limit: string): number {
  return limits && typeof limits[limit] === 'number' ? limits[limit] : 0;
}

/**
 * Format trial days remaining
 */
export function getTrialDaysRemaining(trialEndsAt: Date | null): number {
  if (!trialEndsAt) return 0;
  
  const now = new Date();
  const end = new Date(trialEndsAt);
  const diffTime = end.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays);
}

/**
 * Generate tenant invitation token
 */
export function generateInvitationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash tenant API key
 */
export function hashApiKey(apiKey: string): string {
  return crypto
    .createHash('sha256')
    .update(apiKey)
    .digest('hex');
}

/**
 * Generate tenant API key
 */
export function generateApiKey(prefix: string = 'sk'): { key: string; hash: string } {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const key = `${prefix}_${randomBytes}`;
  const hash = hashApiKey(key);
  
  return { key, hash };
}
