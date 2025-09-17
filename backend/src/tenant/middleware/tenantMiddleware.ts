import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { tenantService } from '../services/tenantService';
import { logger } from '../../utils/logger';
import { TenantContext } from '../models/tenantModel';

// Extend Express Request to include tenant context
declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      tenantId?: string;
      isSuperAdmin?: boolean;
    }
  }
}

/**
 * Extract subdomain from request
 */
export function extractSubdomain(req: Request): string | null {
  const host = req.get('host') || '';
  const hostname = req.hostname || host.split(':')[0];
  
  // Handle localhost development
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // Check for tenant header in development
    const tenantHeader = req.headers['x-tenant-subdomain'];
    return tenantHeader ? String(tenantHeader) : null;
  }
  
  // Extract subdomain from production URLs
  const parts = hostname.split('.');
  
  // If we have at least 3 parts (subdomain.domain.tld)
  if (parts.length >= 3) {
    // Check if it's a valid subdomain (not www, api, etc.)
    const subdomain = parts[0];
    const reservedSubdomains = ['www', 'api', 'app', 'admin', 'dashboard', 'mail', 'ftp'];
    
    if (!reservedSubdomains.includes(subdomain.toLowerCase())) {
      return subdomain;
    }
  }
  
  // Check for custom domain
  const customDomain = hostname;
  return customDomain;
}

/**
 * Tenant identification middleware
 */
export const identifyTenant = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Skip tenant identification for auth endpoints that don't require it
    const publicPaths = [
      '/api/auth/register',
      '/api/auth/login',
      '/api/tenants/register',
      '/health',
    ];
    
    if (publicPaths.some(path => req.path.startsWith(path))) {
      return next();
    }
    
    // Extract subdomain or custom domain
    const identifier = extractSubdomain(req);
    
    if (!identifier) {
      // Check if user is super admin accessing without tenant context
      if (req.user && req.user.role === 'SUPER_ADMIN') {
        req.isSuperAdmin = true;
        return next();
      }
      
      throw new AppError('Tenant not found', 404);
    }
    
    // Look up tenant by subdomain or custom domain
    const tenant = await tenantService.getTenantByIdentifier(identifier);
    
    if (!tenant) {
      throw new AppError('Tenant not found', 404);
    }
    
    // Check tenant status
    if (tenant.status === 'SUSPENDED') {
      throw new AppError('This account has been suspended. Please contact support.', 403);
    }
    
    if (tenant.status === 'INACTIVE') {
      throw new AppError('This account is inactive. Please contact support.', 403);
    }
    
    // Check trial expiration
    if (tenant.status === 'TRIAL' && tenant.trialEndsAt && new Date() > tenant.trialEndsAt) {
      // Update tenant status to inactive
      await tenantService.updateTenantStatus(tenant.id, 'INACTIVE');
      throw new AppError('Your trial has expired. Please upgrade to continue.', 403);
    }
    
    // Attach tenant context to request
    req.tenant = {
      id: tenant.id,
      slug: tenant.slug,
      subdomain: tenant.subdomain,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      settings: tenant.settings as any,
      features: tenant.features as any,
      limits: tenant.limits as any,
      branding: {
        logo: tenant.logo,
        favicon: tenant.favicon,
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
      } as any,
      customDomain: tenant.customDomain,
    };
    
    req.tenantId = tenant.id;
    
    logger.debug('Tenant identified', {
      tenantId: tenant.id,
      subdomain: tenant.subdomain,
      plan: tenant.plan,
      status: tenant.status,
    });
    
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Validate user belongs to tenant
 */
export const validateTenantMembership = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Skip for super admins
    if (req.user && req.user.role === 'SUPER_ADMIN') {
      req.isSuperAdmin = true;
      return next();
    }
    
    // Ensure tenant context exists
    if (!req.tenant) {
      throw new AppError('Tenant context not found', 500);
    }
    
    // Ensure user belongs to the tenant
    if (req.user && req.user.tenantId !== req.tenant.id) {
      throw new AppError('Access denied to this tenant', 403);
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Enforce tenant isolation in database queries
 */
export const enforceTenantIsolation = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Skip for super admins when accessing cross-tenant data
  if (req.isSuperAdmin && req.headers['x-admin-override'] === 'true') {
    return next();
  }
  
  // Ensure all database queries include tenant filter
  if (!req.tenantId && !req.isSuperAdmin) {
    throw new AppError('Tenant isolation error', 500);
  }
  
  next();
};

/**
 * Check tenant resource limits
 */
export const checkTenantLimits = (resource: keyof TenantContext['limits']) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenant) {
        throw new AppError('Tenant context not found', 500);
      }
      
      // Skip limit checks for enterprise plans
      if (req.tenant.plan === 'ENTERPRISE') {
        return next();
      }
      
      const limit = req.tenant.limits[resource];
      
      if (limit === -1) {
        // Unlimited
        return next();
      }
      
      // Get current usage
      const usage = await tenantService.getTenantResourceUsage(req.tenant.id, resource);
      
      if (usage >= limit) {
        throw new AppError(
          `Resource limit exceeded for ${resource}. Please upgrade your plan.`,
          429
        );
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Check tenant feature access
 */
export const requireTenantFeature = (feature: keyof TenantContext['features']) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.tenant) {
      throw new AppError('Tenant context not found', 500);
    }
    
    if (!req.tenant.features[feature]) {
      throw new AppError(
        `This feature is not available in your current plan. Please upgrade to access ${feature}.`,
        403
      );
    }
    
    next();
  };
};

/**
 * Rate limiting per tenant
 */
export const tenantRateLimit = (pointsPerRequest: number = 1) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenant) {
        return next();
      }
      
      // Check API rate limits based on plan
      const limit = req.tenant.limits.maxApiCallsPerHour;
      
      if (limit === -1) {
        // Unlimited
        return next();
      }
      
      const consumed = await tenantService.consumeRateLimit(
        req.tenant.id,
        pointsPerRequest,
        limit
      );
      
      res.setHeader('X-RateLimit-Limit', limit.toString());
      res.setHeader('X-RateLimit-Remaining', (limit - consumed).toString());
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + 3600000).toISOString());
      
      if (consumed > limit) {
        res.setHeader('Retry-After', '3600');
        throw new AppError('API rate limit exceeded', 429);
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Inject tenant context into response headers
 */
export const injectTenantHeaders = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.tenant) {
    res.setHeader('X-Tenant-ID', req.tenant.id);
    res.setHeader('X-Tenant-Plan', req.tenant.plan);
    res.setHeader('X-Tenant-Status', req.tenant.status);
  }
  
  next();
};

/**
 * Multi-tenant middleware stack
 */
export const multiTenantMiddleware = [
  identifyTenant,
  validateTenantMembership,
  enforceTenantIsolation,
  injectTenantHeaders,
];
