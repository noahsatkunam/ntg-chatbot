import { PrismaClient } from '@prisma/client';
import { AppError } from '../../middlewares/errorHandler';

/**
 * Create a tenant-scoped Prisma client that automatically includes tenant filters
 */
export function createTenantPrismaClient(tenantId: string) {
  const prisma = new PrismaClient();

  // Extend Prisma to add automatic tenant filtering
  return prisma.$extends({
    query: {
      // User model
      user: {
        async findMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findUnique({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async count({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async create({ args, query }) {
          args.data = { ...args.data, tenantId };
          return query(args);
        },
        async update({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async updateMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async delete({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async deleteMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
      },
      
      // Chatbot model
      chatbot: {
        async findMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findUnique({ args, query }) {
          const result = await query(args);
          if (result && result.tenantId !== tenantId) {
            throw new AppError('Access denied to this resource', 403);
          }
          return result;
        },
        async count({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async create({ args, query }) {
          args.data = { ...args.data, tenantId };
          return query(args);
        },
        async update({ args, query }) {
          // First check if the record belongs to the tenant
          const existing = await prisma.chatbot.findUnique({
            where: { id: args.where.id as string },
          });
          if (!existing || existing.tenantId !== tenantId) {
            throw new AppError('Access denied to this resource', 403);
          }
          return query(args);
        },
        async updateMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async delete({ args, query }) {
          // First check if the record belongs to the tenant
          const existing = await prisma.chatbot.findUnique({
            where: { id: args.where.id as string },
          });
          if (!existing || existing.tenantId !== tenantId) {
            throw new AppError('Access denied to this resource', 403);
          }
          return query(args);
        },
        async deleteMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
      },

      // ApiKey model
      apiKey: {
        async findMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findUnique({ args, query }) {
          const result = await query(args);
          if (result && result.tenantId !== tenantId) {
            throw new AppError('Access denied to this resource', 403);
          }
          return result;
        },
        async count({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async create({ args, query }) {
          args.data = { ...args.data, tenantId };
          return query(args);
        },
        async update({ args, query }) {
          const existing = await prisma.apiKey.findUnique({
            where: { id: args.where.id as string },
          });
          if (!existing || existing.tenantId !== tenantId) {
            throw new AppError('Access denied to this resource', 403);
          }
          return query(args);
        },
        async delete({ args, query }) {
          const existing = await prisma.apiKey.findUnique({
            where: { id: args.where.id as string },
          });
          if (!existing || existing.tenantId !== tenantId) {
            throw new AppError('Access denied to this resource', 403);
          }
          return query(args);
        },
      },

      // AuditLog model (read-only for tenants)
      auditLog: {
        async findMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async count({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async create({ args, query }) {
          args.data = { ...args.data, tenantId };
          return query(args);
        },
      },

      // TenantUsage model (read-only for tenants)
      tenantUsage: {
        async findMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
      },
    },
  });
}

/**
 * SQL template helper for row-level security
 */
export function tenantSecuritySQL(tenantId: string) {
  return {
    where: `tenant_id = '${tenantId}'`,
    join: `INNER JOIN tenants t ON t.id = '${tenantId}'`,
    check: `AND tenant_id = '${tenantId}'`,
  };
}

/**
 * Validate tenant access for a resource
 */
export async function validateTenantAccess<T extends { tenantId?: string | null }>(
  resource: T | null,
  tenantId: string,
  resourceName: string = 'resource'
): Promise<T> {
  if (!resource) {
    throw new AppError(`${resourceName} not found`, 404);
  }

  if (resource.tenantId !== tenantId) {
    throw new AppError(`Access denied to this ${resourceName}`, 403);
  }

  return resource;
}

/**
 * Create tenant-aware transaction
 */
export async function tenantTransaction<T>(
  tenantId: string,
  callback: (tx: any) => Promise<T>
): Promise<T> {
  const prisma = new PrismaClient();
  
  return prisma.$transaction(async (tx) => {
    // Set context for the transaction
    await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return callback(tx);
  });
}

/**
 * Middleware to inject tenant-scoped Prisma client
 */
export function injectTenantPrisma(req: any, res: any, next: any) {
  if (req.tenantId) {
    req.prisma = createTenantPrismaClient(req.tenantId);
  }
  next();
}
