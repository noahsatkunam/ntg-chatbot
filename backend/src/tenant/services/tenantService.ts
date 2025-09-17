import { PrismaClient, Tenant, TenantStatus } from '@prisma/client';
import { AppError } from '../../middlewares/errorHandler';

const prisma = new PrismaClient();

// Simplified DTOs for the current schema
interface CreateTenantDto {
  name: string;
  slug: string;
  status?: TenantStatus;
  settings?: any;
}

interface UpdateTenantDto {
  name?: string;
  slug?: string;
  status?: TenantStatus;
  settings?: any;
}

// Utility functions
function validateSlug(slug: string): boolean {
  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  return slugRegex.test(slug) && slug.length >= 3 && slug.length <= 50;
}


export class TenantService {
  /**
   * Create a new tenant
   */
  async createTenant(data: CreateTenantDto): Promise<Tenant> {
    try {
      // Validate slug
      if (!validateSlug(data.slug)) {
        throw new AppError('Invalid slug format', 400);
      }

      // Check if slug already exists
      const existingTenant = await prisma.tenant.findUnique({
        where: { slug: data.slug }
      });

      if (existingTenant) {
        throw new AppError('Tenant with this slug already exists', 409);
      }

      const tenant = await prisma.tenant.create({
        data: {
          name: data.name,
          slug: data.slug,
          status: data.status || TenantStatus.ACTIVE,
          settings: data.settings || {}
        }
      });

      return tenant;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Failed to create tenant', 500);
    }
  }

  /**
   * Get tenant by ID
   */
  async getTenantById(id: string): Promise<Tenant | null> {
    try {
      return await prisma.tenant.findUnique({
        where: { id }
      });
    } catch (error) {
      throw new AppError('Failed to fetch tenant', 500);
    }
  }

  /**
   * Get tenant by slug
   */
  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    try {
      return await prisma.tenant.findUnique({
        where: { slug }
      });
    } catch (error) {
      throw new AppError('Failed to fetch tenant', 500);
    }
  }

  /**
   * Update tenant
   */
  async updateTenant(id: string, data: UpdateTenantDto): Promise<Tenant> {
    try {
      // Validate slug if provided
      if (data.slug && !validateSlug(data.slug)) {
        throw new AppError('Invalid slug format', 400);
      }

      // Check if new slug already exists
      if (data.slug) {
        const existingTenant = await prisma.tenant.findFirst({
          where: {
            slug: data.slug,
            NOT: { id }
          }
        });

        if (existingTenant) {
          throw new AppError('Tenant with this slug already exists', 409);
        }
      }

      const tenant = await prisma.tenant.update({
        where: { id },
        data: {
          ...(data.name && { name: data.name }),
          ...(data.slug && { slug: data.slug }),
          ...(data.status && { status: data.status }),
          ...(data.settings && { settings: data.settings })
        }
      });

      return tenant;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Failed to update tenant', 500);
    }
  }

  /**
   * Delete tenant
   */
  async deleteTenant(id: string): Promise<void> {
    try {
      await prisma.tenant.delete({
        where: { id }
      });
    } catch (error) {
      throw new AppError('Failed to delete tenant', 500);
    }
  }

  /**
   * List tenants with pagination
   */
  async listTenants(page: number = 1, limit: number = 10): Promise<{
    tenants: Tenant[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    try {
      const skip = (page - 1) * limit;
      
      const [tenants, total] = await Promise.all([
        prisma.tenant.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.tenant.count()
      ]);

      return {
        tenants,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      throw new AppError('Failed to list tenants', 500);
    }
  }

  /**
   * Suspend tenant
   */
  async suspendTenant(id: string): Promise<Tenant> {
    try {
      return await prisma.tenant.update({
        where: { id },
        data: { status: TenantStatus.SUSPENDED }
      });
    } catch (error) {
      throw new AppError('Failed to suspend tenant', 500);
    }
  }

  /**
   * Activate tenant
   */
  async activateTenant(id: string): Promise<Tenant> {
    try {
      return await prisma.tenant.update({
        where: { id },
        data: { status: TenantStatus.ACTIVE }
      });
    } catch (error) {
      throw new AppError('Failed to activate tenant', 500);
    }
  }

  /**
   * Get tenant statistics
   */
  async getTenantStats(): Promise<{
    total: number;
    active: number;
    trial: number;
    suspended: number;
    inactive: number;
  }> {
    try {
      const [total, active, suspended] = await Promise.all([
        prisma.tenant.count(),
        prisma.tenant.count({ where: { status: TenantStatus.ACTIVE } }),
        prisma.tenant.count({ where: { status: TenantStatus.SUSPENDED } })
      ]);

      return {
        total,
        active,
        trial: 0, // Not available in current schema
        suspended,
        inactive: 0 // Not available in current schema
      };
    } catch (error) {
      throw new AppError('Failed to get tenant statistics', 500);
    }
  }

  /**
   * Check if tenant exists
   */
  async tenantExists(identifier: string): Promise<boolean> {
    try {
      const tenant = await prisma.tenant.findFirst({
        where: {
          OR: [
            { id: identifier },
            { slug: identifier }
          ]
        }
      });

      return !!tenant;
    } catch (error) {
      return false;
    }
  }
}

export const tenantService = new TenantService();
