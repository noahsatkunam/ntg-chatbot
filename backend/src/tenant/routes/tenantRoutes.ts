import { Router } from 'express';
import { tenantController } from '../controllers/tenantController';
import { authenticate, authorize } from '../../auth/middleware/authMiddleware';
import { 
  identifyTenant, 
  validateTenantMembership, 
  enforceTenantIsolation,
  requireTenantFeature,
  tenantRateLimit 
} from '../middleware/tenantMiddleware';
import { validateTenantRequest } from '../validators/tenantValidators';
import { auditLog } from '../../auth/middleware/authMiddleware';

const router = Router();

// Public routes (no auth required)
router.post(
  '/register',
  validateTenantRequest('createTenant'),
  tenantController.registerTenant
);

router.get(
  '/check-subdomain',
  tenantController.checkSubdomainAvailability
);

router.get(
  '/branding/:subdomain',
  tenantController.getTenantBranding
);

// Authenticated routes with tenant context
router.use(authenticate);

// Current tenant routes (uses tenant from context)
router.get(
  '/current',
  identifyTenant,
  validateTenantMembership,
  tenantController.getTenant
);

router.put(
  '/current',
  identifyTenant,
  validateTenantMembership,
  authorize('TENANT_ADMIN'),
  validateTenantRequest('updateTenant'),
  auditLog('TENANT_UPDATE'),
  tenantController.updateTenant
);

router.get(
  '/current/usage',
  identifyTenant,
  validateTenantMembership,
  tenantController.getTenantUsage
);

router.post(
  '/current/upgrade',
  identifyTenant,
  validateTenantMembership,
  authorize('TENANT_ADMIN'),
  validateTenantRequest('upgradePlan'),
  auditLog('TENANT_UPGRADE'),
  tenantController.upgradeTenantPlan
);

router.post(
  '/current/export',
  identifyTenant,
  validateTenantMembership,
  authorize('TENANT_ADMIN'),
  requireTenantFeature('exportData'),
  tenantRateLimit(10), // Export is expensive, higher cost
  auditLog('TENANT_DATA_EXPORT'),
  tenantController.exportTenantData
);

// Admin routes (super admin only)
router.post(
  '/',
  authorize('SUPER_ADMIN'),
  validateTenantRequest('createTenant'),
  auditLog('TENANT_CREATE'),
  tenantController.createTenant
);

router.get(
  '/',
  authorize('SUPER_ADMIN'),
  validateTenantRequest('tenantQuery'),
  tenantController.listTenants
);

router.get(
  '/statistics',
  authorize('SUPER_ADMIN'),
  tenantController.getTenantStatistics
);

// Specific tenant routes (by ID)
router.get(
  '/:id',
  enforceTenantIsolation,
  tenantController.getTenant
);

router.put(
  '/:id',
  authorize('SUPER_ADMIN', 'TENANT_ADMIN'),
  validateTenantRequest('updateTenant'),
  enforceTenantIsolation,
  auditLog('TENANT_UPDATE'),
  tenantController.updateTenant
);

router.get(
  '/:id/usage',
  enforceTenantIsolation,
  tenantController.getTenantUsage
);

router.post(
  '/:id/suspend',
  authorize('SUPER_ADMIN'),
  validateTenantRequest('suspendTenant'),
  auditLog('TENANT_SUSPEND'),
  tenantController.suspendTenant
);

router.post(
  '/:id/reactivate',
  authorize('SUPER_ADMIN'),
  auditLog('TENANT_REACTIVATE'),
  tenantController.reactivateTenant
);

router.post(
  '/:id/upgrade',
  authorize('SUPER_ADMIN', 'TENANT_ADMIN'),
  validateTenantRequest('upgradePlan'),
  enforceTenantIsolation,
  auditLog('TENANT_UPGRADE'),
  tenantController.upgradeTenantPlan
);

router.put(
  '/:id/usage',
  authorize('SUPER_ADMIN'),
  validateTenantRequest('updateUsage'),
  tenantController.updateUsageMetrics
);

router.post(
  '/:id/export',
  authorize('SUPER_ADMIN', 'TENANT_ADMIN'),
  enforceTenantIsolation,
  requireTenantFeature('exportData'),
  tenantRateLimit(10),
  auditLog('TENANT_DATA_EXPORT'),
  tenantController.exportTenantData
);

export default router;
