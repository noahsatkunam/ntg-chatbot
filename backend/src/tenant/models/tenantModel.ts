import { Tenant, TenantStatus, TenantPlan, TenantUsage } from '@prisma/client';

export interface ITenant extends Tenant {
  usage?: ITenantUsage[];
}

export interface ITenantUsage extends TenantUsage {}

export interface TenantSettings {
  allowCustomBranding?: boolean;
  enableApiAccess?: boolean;
  enableWebhooks?: boolean;
  enableAdvancedAnalytics?: boolean;
  enableCustomDomains?: boolean;
  maxUsers?: number;
  maxChatbots?: number;
  maxMessagesPerMonth?: number;
  maxStorageGB?: number;
  maxApiCallsPerMonth?: number;
  dataRetentionDays?: number;
  allowFileUploads?: boolean;
  maxFileUploadSizeMB?: number;
  customIntegrations?: string[];
  ipWhitelist?: string[];
  enforceSSO?: boolean;
  ssoProvider?: string;
  webhookUrl?: string;
  webhookSecret?: string;
}

export interface TenantFeatures {
  chatbots?: boolean;
  analytics?: boolean;
  customBranding?: boolean;
  apiAccess?: boolean;
  webhooks?: boolean;
  fileUploads?: boolean;
  customIntegrations?: boolean;
  multiLanguage?: boolean;
  voiceChat?: boolean;
  videoChat?: boolean;
  screenSharing?: boolean;
  cobrowsing?: boolean;
  sentimentAnalysis?: boolean;
  autoTranslation?: boolean;
  customReports?: boolean;
  exportData?: boolean;
  bulkOperations?: boolean;
  auditLogs?: boolean;
  customRoles?: boolean;
  sso?: boolean;
  twoFactorAuth?: boolean;
  ipWhitelisting?: boolean;
}

export interface TenantLimits {
  maxUsers: number;
  maxChatbots: number;
  maxConversationsPerDay: number;
  maxMessagesPerMonth: number;
  maxStorageGB: number;
  maxApiCallsPerHour: number;
  maxApiCallsPerMonth: number;
  maxFileUploadSizeMB: number;
  maxConcurrentConversations: number;
  maxWebhooksPerHour: number;
  cpuQuotaMinutes: number;
  bandwidthQuotaGB: number;
}

export interface TenantBranding {
  logo?: string;
  favicon?: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily?: string;
  customCSS?: string;
  emailLogo?: string;
  emailFooter?: string;
  loginBackground?: string;
  appName?: string;
  supportEmail?: string;
  supportUrl?: string;
  termsUrl?: string;
  privacyUrl?: string;
}

export interface CreateTenantDto {
  name: string;
  slug: string;
  subdomain: string;
  contactEmail?: string;
  plan?: TenantPlan;
  trialDays?: number;
}

export interface UpdateTenantDto {
  name?: string;
  contactEmail?: string;
  contactPhone?: string;
  billingEmail?: string;
  plan?: TenantPlan;
  status?: TenantStatus;
  settings?: Partial<TenantSettings>;
  features?: Partial<TenantFeatures>;
  limits?: Partial<TenantLimits>;
  logo?: string;
  primaryColor?: string;
  secondaryColor?: string;
  favicon?: string;
  customDomain?: string;
}

export interface TenantContext {
  id: string;
  slug: string;
  subdomain: string;
  name: string;
  plan: TenantPlan;
  status: TenantStatus;
  settings: TenantSettings;
  features: TenantFeatures;
  limits: TenantLimits;
  branding: TenantBranding;
  customDomain?: string | null;
}

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  allowCustomBranding: false,
  enableApiAccess: false,
  enableWebhooks: false,
  enableAdvancedAnalytics: false,
  enableCustomDomains: false,
  maxUsers: 5,
  maxChatbots: 1,
  maxMessagesPerMonth: 1000,
  maxStorageGB: 1,
  maxApiCallsPerMonth: 1000,
  dataRetentionDays: 30,
  allowFileUploads: false,
  maxFileUploadSizeMB: 10,
  customIntegrations: [],
  ipWhitelist: [],
  enforceSSO: false,
};

export const DEFAULT_TENANT_FEATURES: TenantFeatures = {
  chatbots: true,
  analytics: true,
  customBranding: false,
  apiAccess: false,
  webhooks: false,
  fileUploads: false,
  customIntegrations: false,
  multiLanguage: false,
  voiceChat: false,
  videoChat: false,
  screenSharing: false,
  cobrowsing: false,
  sentimentAnalysis: false,
  autoTranslation: false,
  customReports: false,
  exportData: false,
  bulkOperations: false,
  auditLogs: false,
  customRoles: false,
  sso: false,
  twoFactorAuth: true,
  ipWhitelisting: false,
};

export const TENANT_PLAN_LIMITS: Record<TenantPlan, TenantLimits> = {
  FREE: {
    maxUsers: 5,
    maxChatbots: 1,
    maxConversationsPerDay: 100,
    maxMessagesPerMonth: 1000,
    maxStorageGB: 1,
    maxApiCallsPerHour: 100,
    maxApiCallsPerMonth: 1000,
    maxFileUploadSizeMB: 10,
    maxConcurrentConversations: 10,
    maxWebhooksPerHour: 10,
    cpuQuotaMinutes: 100,
    bandwidthQuotaGB: 5,
  },
  STARTER: {
    maxUsers: 20,
    maxChatbots: 5,
    maxConversationsPerDay: 500,
    maxMessagesPerMonth: 10000,
    maxStorageGB: 10,
    maxApiCallsPerHour: 500,
    maxApiCallsPerMonth: 10000,
    maxFileUploadSizeMB: 50,
    maxConcurrentConversations: 50,
    maxWebhooksPerHour: 50,
    cpuQuotaMinutes: 500,
    bandwidthQuotaGB: 50,
  },
  PROFESSIONAL: {
    maxUsers: 100,
    maxChatbots: 20,
    maxConversationsPerDay: 2000,
    maxMessagesPerMonth: 100000,
    maxStorageGB: 100,
    maxApiCallsPerHour: 2000,
    maxApiCallsPerMonth: 100000,
    maxFileUploadSizeMB: 200,
    maxConcurrentConversations: 200,
    maxWebhooksPerHour: 200,
    cpuQuotaMinutes: 2000,
    bandwidthQuotaGB: 500,
  },
  ENTERPRISE: {
    maxUsers: -1, // Unlimited
    maxChatbots: -1,
    maxConversationsPerDay: -1,
    maxMessagesPerMonth: -1,
    maxStorageGB: -1,
    maxApiCallsPerHour: -1,
    maxApiCallsPerMonth: -1,
    maxFileUploadSizeMB: 1000,
    maxConcurrentConversations: -1,
    maxWebhooksPerHour: -1,
    cpuQuotaMinutes: -1,
    bandwidthQuotaGB: -1,
  },
};

export const TENANT_PLAN_FEATURES: Record<TenantPlan, TenantFeatures> = {
  FREE: {
    ...DEFAULT_TENANT_FEATURES,
  },
  STARTER: {
    ...DEFAULT_TENANT_FEATURES,
    customBranding: true,
    apiAccess: true,
    webhooks: true,
    fileUploads: true,
    multiLanguage: true,
    auditLogs: true,
  },
  PROFESSIONAL: {
    ...DEFAULT_TENANT_FEATURES,
    customBranding: true,
    apiAccess: true,
    webhooks: true,
    fileUploads: true,
    customIntegrations: true,
    multiLanguage: true,
    voiceChat: true,
    sentimentAnalysis: true,
    autoTranslation: true,
    customReports: true,
    exportData: true,
    bulkOperations: true,
    auditLogs: true,
    customRoles: true,
    sso: true,
  },
  ENTERPRISE: {
    chatbots: true,
    analytics: true,
    customBranding: true,
    apiAccess: true,
    webhooks: true,
    fileUploads: true,
    customIntegrations: true,
    multiLanguage: true,
    voiceChat: true,
    videoChat: true,
    screenSharing: true,
    cobrowsing: true,
    sentimentAnalysis: true,
    autoTranslation: true,
    customReports: true,
    exportData: true,
    bulkOperations: true,
    auditLogs: true,
    customRoles: true,
    sso: true,
    twoFactorAuth: true,
    ipWhitelisting: true,
  },
};
