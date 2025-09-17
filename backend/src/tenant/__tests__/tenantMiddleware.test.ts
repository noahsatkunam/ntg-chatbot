import { Request, Response } from 'express';
import { identifyTenant, validateTenantMembership, enforceTenantIsolation } from '../middleware/tenantMiddleware';
import { tenantService } from '../services/tenantService';
import { AppError } from '../../middlewares/errorHandler';

// Mock dependencies
jest.mock('../services/tenantService');

describe('Tenant Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: jest.Mock;

  beforeEach(() => {
    mockRequest = {
      get: jest.fn(),
      hostname: 'test.example.com',
      headers: {},
      path: '/api/test',
      user: undefined,
    };
    mockResponse = {
      setHeader: jest.fn(),
    };
    nextFunction = jest.fn();
    jest.clearAllMocks();
  });

  describe('identifyTenant', () => {
    it('should extract subdomain from hostname', async () => {
      mockRequest.hostname = 'acme.platform.com';
      const mockTenant = {
        id: '123',
        name: 'Acme Corp',
        subdomain: 'acme',
        slug: 'acme',
        plan: 'PROFESSIONAL',
        status: 'ACTIVE',
        settings: {},
        features: {},
        limits: {},
      };

      (tenantService.getTenantByIdentifier as jest.Mock).mockResolvedValue(mockTenant);

      await identifyTenant(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(tenantService.getTenantByIdentifier).toHaveBeenCalledWith('acme');
      expect(mockRequest.tenant).toBeDefined();
      expect(mockRequest.tenantId).toBe('123');
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should skip tenant identification for public paths', async () => {
      mockRequest.path = '/api/auth/login';

      await identifyTenant(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(tenantService.getTenantByIdentifier).not.toHaveBeenCalled();
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should throw error for suspended tenant', async () => {
      mockRequest.hostname = 'suspended.platform.com';
      const mockTenant = {
        id: '123',
        subdomain: 'suspended',
        status: 'SUSPENDED',
      };

      (tenantService.getTenantByIdentifier as jest.Mock).mockResolvedValue(mockTenant);

      await identifyTenant(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'This account has been suspended. Please contact support.',
          statusCode: 403,
        })
      );
    });

    it('should handle localhost development with tenant header', async () => {
      mockRequest.hostname = 'localhost';
      mockRequest.headers = { 'x-tenant-subdomain': 'dev-tenant' };
      const mockTenant = {
        id: '123',
        subdomain: 'dev-tenant',
        status: 'ACTIVE',
      };

      (tenantService.getTenantByIdentifier as jest.Mock).mockResolvedValue(mockTenant);

      await identifyTenant(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(tenantService.getTenantByIdentifier).toHaveBeenCalledWith('dev-tenant');
      expect(mockRequest.tenantId).toBe('123');
    });
  });

  describe('validateTenantMembership', () => {
    it('should allow super admin access', async () => {
      mockRequest.user = { id: '1', role: 'SUPER_ADMIN' };

      await validateTenantMembership(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockRequest.isSuperAdmin).toBe(true);
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should validate user belongs to tenant', async () => {
      mockRequest.user = { id: '1', role: 'TENANT_USER', tenantId: '123' };
      mockRequest.tenant = { id: '123' } as any;

      await validateTenantMembership(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should deny access to wrong tenant', async () => {
      mockRequest.user = { id: '1', role: 'TENANT_USER', tenantId: '456' };
      mockRequest.tenant = { id: '123' } as any;

      await validateTenantMembership(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Access denied to this tenant',
          statusCode: 403,
        })
      );
    });
  });

  describe('enforceTenantIsolation', () => {
    it('should enforce tenant isolation', () => {
      mockRequest.tenantId = '123';

      enforceTenantIsolation(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should allow super admin override', () => {
      mockRequest.isSuperAdmin = true;
      mockRequest.headers = { 'x-admin-override': 'true' };

      enforceTenantIsolation(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should throw error when tenant context missing', () => {
      mockRequest.tenantId = undefined;
      mockRequest.isSuperAdmin = false;

      expect(() => {
        enforceTenantIsolation(mockRequest as Request, mockResponse as Response, nextFunction);
      }).toThrow('Tenant isolation error');
    });
  });
});
