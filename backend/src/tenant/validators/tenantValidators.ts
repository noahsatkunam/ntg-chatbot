import Joi from 'joi';
import { TenantPlan, TenantStatus } from '@prisma/client';
import { validateSubdomain, validateCustomDomain } from '../utils/tenantUtils';

// Custom validators
const subdomainValidator = (value: string, helpers: any) => {
  if (!validateSubdomain(value)) {
    return helpers.error('any.invalid');
  }
  return value.toLowerCase();
};

const customDomainValidator = (value: string, helpers: any) => {
  if (!validateCustomDomain(value)) {
    return helpers.error('any.invalid');
  }
  return value.toLowerCase();
};

// Common schemas
const tenantNameSchema = Joi.string()
  .trim()
  .min(2)
  .max(100)
  .pattern(/^[a-zA-Z0-9\s\-_&.]+$/)
  .messages({
    'string.min': 'Tenant name must be at least 2 characters long',
    'string.max': 'Tenant name must be less than 100 characters',
    'string.pattern.base': 'Tenant name contains invalid characters',
  });

const subdomainSchema = Joi.string()
  .trim()
  .lowercase()
  .min(3)
  .max(63)
  .custom(subdomainValidator)
  .messages({
    'string.min': 'Subdomain must be at least 3 characters long',
    'string.max': 'Subdomain must be less than 63 characters',
    'any.invalid': 'Invalid subdomain format or reserved subdomain',
  });

const emailSchema = Joi.string()
  .email()
  .lowercase()
  .trim()
  .max(255)
  .messages({
    'string.email': 'Please provide a valid email address',
    'string.max': 'Email must be less than 255 characters',
  });

// Tenant validation schemas
export const tenantValidationSchemas = {
  createTenant: Joi.object({
    name: tenantNameSchema.required(),
    slug: Joi.string()
      .trim()
      .lowercase()
      .pattern(/^[a-z0-9-]+$/)
      .optional(),
    subdomain: subdomainSchema.required(),
    contactEmail: emailSchema.optional(),
    plan: Joi.string()
      .valid(...Object.values(TenantPlan))
      .optional()
      .default(TenantPlan.FREE),
    trialDays: Joi.number()
      .integer()
      .min(0)
      .max(90)
      .optional()
      .default(14),
  }),

  updateTenant: Joi.object({
    name: tenantNameSchema.optional(),
    contactEmail: emailSchema.optional(),
    contactPhone: Joi.string()
      .pattern(/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{4,6}$/)
      .optional()
      .messages({
        'string.pattern.base': 'Please provide a valid phone number',
      }),
    billingEmail: emailSchema.optional(),
    plan: Joi.string()
      .valid(...Object.values(TenantPlan))
      .optional(),
    status: Joi.string()
      .valid(...Object.values(TenantStatus))
      .optional(),
    logo: Joi.string().uri().optional().allow(null, ''),
    primaryColor: Joi.string()
      .pattern(/^#[0-9A-Fa-f]{6}$/)
      .optional()
      .messages({
        'string.pattern.base': 'Color must be a valid hex color (e.g., #3B82F6)',
      }),
    secondaryColor: Joi.string()
      .pattern(/^#[0-9A-Fa-f]{6}$/)
      .optional()
      .messages({
        'string.pattern.base': 'Color must be a valid hex color (e.g., #10B981)',
      }),
    favicon: Joi.string().uri().optional().allow(null, ''),
    customDomain: Joi.string()
      .custom(customDomainValidator)
      .optional()
      .allow(null, '')
      .messages({
        'any.invalid': 'Invalid domain format',
      }),
    settings: Joi.object().optional(),
    features: Joi.object().optional(),
    limits: Joi.object().optional(),
  }),

  updateTenantSettings: Joi.object({
    allowCustomBranding: Joi.boolean().optional(),
    enableApiAccess: Joi.boolean().optional(),
    enableWebhooks: Joi.boolean().optional(),
    enableAdvancedAnalytics: Joi.boolean().optional(),
    enableCustomDomains: Joi.boolean().optional(),
    maxUsers: Joi.number().integer().min(1).optional(),
    maxChatbots: Joi.number().integer().min(0).optional(),
    maxMessagesPerMonth: Joi.number().integer().min(0).optional(),
    maxStorageGB: Joi.number().min(0).optional(),
    maxApiCallsPerMonth: Joi.number().integer().min(0).optional(),
    dataRetentionDays: Joi.number().integer().min(1).max(3650).optional(),
    allowFileUploads: Joi.boolean().optional(),
    maxFileUploadSizeMB: Joi.number().min(1).max(5000).optional(),
    customIntegrations: Joi.array().items(Joi.string()).optional(),
    ipWhitelist: Joi.array().items(
      Joi.string().ip({ version: ['ipv4', 'ipv6'], cidr: 'optional' })
    ).optional(),
    enforceSSO: Joi.boolean().optional(),
    ssoProvider: Joi.string().valid('saml', 'oauth2', 'oidc').optional(),
    webhookUrl: Joi.string().uri().optional().allow(null, ''),
    webhookSecret: Joi.string().min(16).optional(),
  }),

  upgradePlan: Joi.object({
    plan: Joi.string()
      .valid(...Object.values(TenantPlan))
      .required(),
    billingCycle: Joi.string()
      .valid('monthly', 'yearly')
      .optional()
      .default('monthly'),
    paymentMethodId: Joi.string().optional(),
  }),

  suspendTenant: Joi.object({
    reason: Joi.string()
      .trim()
      .min(10)
      .max(500)
      .required()
      .messages({
        'string.min': 'Suspension reason must be at least 10 characters',
        'string.max': 'Suspension reason must be less than 500 characters',
      }),
  }),

  tenantQuery: Joi.object({
    page: Joi.number().integer().min(1).optional().default(1),
    limit: Joi.number().integer().min(1).max(100).optional().default(20),
    status: Joi.string()
      .valid(...Object.values(TenantStatus))
      .optional(),
    plan: Joi.string()
      .valid(...Object.values(TenantPlan))
      .optional(),
    search: Joi.string().trim().optional(),
    sortBy: Joi.string()
      .valid('name', 'createdAt', 'updatedAt', 'plan', 'status')
      .optional()
      .default('createdAt'),
    sortOrder: Joi.string()
      .valid('asc', 'desc')
      .optional()
      .default('desc'),
  }),

  inviteUser: Joi.object({
    email: emailSchema.required(),
    role: Joi.string()
      .valid('TENANT_ADMIN', 'TENANT_USER', 'END_USER')
      .required(),
    fullName: Joi.string().trim().min(2).max(100).optional(),
    sendInvite: Joi.boolean().optional().default(true),
    message: Joi.string().trim().max(500).optional(),
  }),

  updateUsage: Joi.object({
    metric: Joi.string()
      .valid(
        'activeUsers',
        'apiCalls',
        'messagesCount',
        'storageUsed',
        'cpuMinutes',
        'bandwidthBytes'
      )
      .required(),
    value: Joi.number().min(0).required(),
    increment: Joi.boolean().optional().default(true),
  }),
};

// Validation middleware factory
export function validateTenantRequest(schema: keyof typeof tenantValidationSchemas) {
  return (req: any, res: any, next: any) => {
    const validationSchema = tenantValidationSchemas[schema];
    const target = schema === 'tenantQuery' ? req.query : req.body;
    
    const { error, value } = validationSchema.validate(target, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    // Replace with validated values
    if (schema === 'tenantQuery') {
      req.query = value;
    } else {
      req.body = value;
    }
    
    next();
  };
}

// Helper validation functions
export function isValidTenantId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function isValidPlan(plan: string): boolean {
  return Object.values(TenantPlan).includes(plan as TenantPlan);
}

export function isValidStatus(status: string): boolean {
  return Object.values(TenantStatus).includes(status as TenantStatus);
}
