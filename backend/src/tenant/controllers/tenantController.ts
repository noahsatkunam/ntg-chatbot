import { Request, Response, NextFunction } from 'express';
import { tenantService } from '../services/tenantService';
import { AppError } from '../../middlewares/errorHandler';
import { logger } from '../../utils/logger';
import { TenantStatus } from '@prisma/client';

class TenantController {
  /**
   * Create a new tenant (admin only)
   */
  async createTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.user?.role !== 'SUPER_ADMIN') {
        throw new AppError('Only super admins can create tenants', 403);
      }

      const tenant = await tenantService.createTenant(req.body);

      res.status(201).json({
        success: true,
        message: 'Tenant created successfully',
        data: { tenant },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Register a new tenant (public endpoint)
   */
  async registerTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenant = await tenantService.createTenant(req.body);

      res.status(201).json({
        success: true,
        message: 'Tenant registered successfully. You can now create your admin account.',
        data: { 
          tenant: {
            id: tenant.id,
            subdomain: tenant.subdomain,
            name: tenant.name,
            plan: tenant.plan,
            trialEndsAt: tenant.trialEndsAt,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get tenant details
   */
  async getTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.params.id === 'current' ? req.tenantId : req.params.id;

      if (!tenantId) {
        throw new AppError('Tenant ID not found', 400);
      }

      // Check access rights
      if (req.user?.role !== 'SUPER_ADMIN' && req.tenantId !== tenantId) {
        throw new AppError('Access denied', 403);
      }

      const tenant = await tenantService.getTenant(tenantId);

      if (!tenant) {
        throw new AppError('Tenant not found', 404);
      }

      res.json({
        success: true,
        data: { tenant },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update tenant settings
   */
  async updateTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.params.id === 'current' ? req.tenantId : req.params.id;

      if (!tenantId) {
        throw new AppError('Tenant ID not found', 400);
      }

      // Check access rights
      const isTenantAdmin = req.user?.role === 'TENANT_ADMIN' && req.tenantId === tenantId;
      const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

      if (!isTenantAdmin && !isSuperAdmin) {
        throw new AppError('Only tenant admins can update tenant settings', 403);
      }

      // Restrict certain fields to super admin only
      if (!isSuperAdmin) {
        delete req.body.plan;
        delete req.body.status;
        delete req.body.limits;
      }

      const tenant = await tenantService.updateTenant(tenantId, req.body);

      res.json({
        success: true,
        message: 'Tenant updated successfully',
        data: { tenant },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get tenant usage statistics
   */
  async getTenantUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.params.id === 'current' ? req.tenantId : req.params.id;

      if (!tenantId) {
        throw new AppError('Tenant ID not found', 400);
      }

      // Check access rights
      if (req.user?.role !== 'SUPER_ADMIN' && req.tenantId !== tenantId) {
        throw new AppError('Access denied', 403);
      }

      const period = req.query.period ? new Date(req.query.period as string) : undefined;
      const usage = await tenantService.getTenantUsage(tenantId, period);

      res.json({
        success: true,
        data: { usage },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Upgrade tenant plan
   */
  async upgradeTenantPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.params.id === 'current' ? req.tenantId : req.params.id;

      if (!tenantId) {
        throw new AppError('Tenant ID not found', 400);
      }

      // Check access rights
      const isTenantAdmin = req.user?.role === 'TENANT_ADMIN' && req.tenantId === tenantId;
      const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

      if (!isTenantAdmin && !isSuperAdmin) {
        throw new AppError('Only tenant admins can upgrade plans', 403);
      }

      const { plan } = req.body;
      const tenant = await tenantService.upgradeTenantPlan(tenantId, plan);

      res.json({
        success: true,
        message: 'Tenant plan upgraded successfully',
        data: { tenant },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Suspend tenant (admin only)
   */
  async suspendTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.user?.role !== 'SUPER_ADMIN') {
        throw new AppError('Only super admins can suspend tenants', 403);
      }

      const { reason } = req.body;
      const tenant = await tenantService.updateTenantStatus(
        req.params.id,
        'SUSPENDED' as TenantStatus,
        reason
      );

      res.json({
        success: true,
        message: 'Tenant suspended successfully',
        data: { tenant },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reactivate tenant (admin only)
   */
  async reactivateTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.user?.role !== 'SUPER_ADMIN') {
        throw new AppError('Only super admins can reactivate tenants', 403);
      }

      const tenant = await tenantService.updateTenantStatus(
        req.params.id,
        'ACTIVE' as TenantStatus
      );

      res.json({
        success: true,
        message: 'Tenant reactivated successfully',
        data: { tenant },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List all tenants (admin only)
   */
  async listTenants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.user?.role !== 'SUPER_ADMIN') {
        throw new AppError('Only super admins can list all tenants', 403);
      }

      const {
        page = 1,
        limit = 20,
        status,
        plan,
        search,
      } = req.query;

      const result = await tenantService.listTenants(
        Number(page),
        Number(limit),
        {
          status: status as TenantStatus,
          plan: plan as any,
          search: search as string,
        }
      );

      res.json({
        success: true,
        data: {
          tenants: result.tenants,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: result.total,
            pages: Math.ceil(result.total / Number(limit)),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get tenant statistics (admin only)
   */
  async getTenantStatistics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.user?.role !== 'SUPER_ADMIN') {
        throw new AppError('Only super admins can view statistics', 403);
      }

      const stats = await tenantService.getTenantStatistics();

      res.json({
        success: true,
        data: { statistics: stats },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check subdomain availability
   */
  async checkSubdomainAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { subdomain } = req.query;

      if (!subdomain || typeof subdomain !== 'string') {
        throw new AppError('Subdomain is required', 400);
      }

      const tenant = await tenantService.getTenantByIdentifier(subdomain);
      const available = !tenant;

      res.json({
        success: true,
        data: { 
          subdomain,
          available,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update tenant usage metrics
   */
  async updateUsageMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.isSuperAdmin) {
        throw new AppError('Only internal services can update usage metrics', 403);
      }

      const tenantId = req.params.id;
      const { metric, value, increment } = req.body;

      await tenantService.updateTenantUsage(
        tenantId,
        metric,
        increment ? value : value
      );

      res.json({
        success: true,
        message: 'Usage metrics updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get tenant branding
   */
  async getTenantBranding(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const subdomain = req.params.subdomain || req.query.subdomain;

      if (!subdomain || typeof subdomain !== 'string') {
        throw new AppError('Subdomain is required', 400);
      }

      const tenant = await tenantService.getTenantByIdentifier(subdomain);

      if (!tenant) {
        throw new AppError('Tenant not found', 404);
      }

      res.json({
        success: true,
        data: {
          branding: {
            name: tenant.name,
            logo: tenant.logo,
            favicon: tenant.favicon,
            primaryColor: tenant.primaryColor,
            secondaryColor: tenant.secondaryColor,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Export tenant data (tenant admin only)
   */
  async exportTenantData(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.params.id === 'current' ? req.tenantId : req.params.id;

      if (!tenantId) {
        throw new AppError('Tenant ID not found', 400);
      }

      // Check access rights and feature availability
      const isTenantAdmin = req.user?.role === 'TENANT_ADMIN' && req.tenantId === tenantId;
      const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

      if (!isTenantAdmin && !isSuperAdmin) {
        throw new AppError('Only tenant admins can export data', 403);
      }

      // Check if export feature is enabled
      if (!req.tenant?.features.exportData && !isSuperAdmin) {
        throw new AppError('Data export is not available in your plan', 403);
      }

      // TODO: Implement actual data export logic
      res.json({
        success: true,
        message: 'Data export initiated. You will receive an email when ready.',
        data: {
          exportId: `export_${Date.now()}`,
          status: 'processing',
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const tenantController = new TenantController();
