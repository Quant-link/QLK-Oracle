/**
 * @fileoverview Enterprise integration types and interfaces
 * @author QuantLink Team
 * @version 1.0.0
 */

import { Request } from 'express';

// ============================================================================
// API Gateway Types
// ============================================================================

export interface APIKey {
  id: string;
  key: string;
  secret: string;
  name: string;
  description?: string;
  clientId: string;
  permissions: string[];
  quotas: APIQuota;
  ipWhitelist?: string[];
  isActive: boolean;
  expiresAt?: Date;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface APIQuota {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  requestsPerMonth: number;
  dataTransferMB: number;
  concurrentConnections: number;
}

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  message: string;
  standardHeaders: boolean;
  legacyHeaders: boolean;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
}

export interface WebhookConfig {
  id: string;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
  retryPolicy: {
    maxRetries: number;
    backoffMultiplier: number;
    initialDelay: number;
  };
  headers?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CacheConfig {
  ttl: number;
  maxSize: number;
  strategy: 'LRU' | 'LFU' | 'FIFO';
  compression: boolean;
  tags?: string[];
}

// ============================================================================
// Authentication & Authorization Types
// ============================================================================

export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  permissions: Permission[];
  organizationId: string;
  isActive: boolean;
  isMfaEnabled: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  organizationId: string;
  isSystemRole: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  conditions?: Record<string, any>;
  description: string;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  authorizationURL: string;
  tokenURL: string;
  userInfoURL: string;
  scope: string[];
  callbackURL: string;
}

export interface SAMLConfig {
  entryPoint: string;
  issuer: string;
  cert: string;
  privateKey?: string;
  callbackUrl: string;
  logoutUrl?: string;
  signatureAlgorithm: string;
}

export interface MFAConfig {
  issuer: string;
  window: number;
  encoding: string;
  algorithm: string;
  digits: number;
  period: number;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  ipAddress: string;
  userAgent: string;
  metadata?: Record<string, any>;
  timestamp: Date;
  organizationId: string;
}

// ============================================================================
// Data Export & Reporting Types
// ============================================================================

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  type: 'scheduled' | 'on-demand';
  format: 'PDF' | 'CSV' | 'XLSX' | 'JSON';
  query: string;
  parameters: ReportParameter[];
  schedule?: CronSchedule;
  recipients: string[];
  organizationId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportParameter {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  required: boolean;
  defaultValue?: any;
  validation?: string;
  description: string;
}

export interface CronSchedule {
  expression: string;
  timezone: string;
  enabled: boolean;
}

export interface DataExportRequest {
  id: string;
  userId: string;
  organizationId: string;
  type: 'real-time' | 'historical' | 'report';
  format: 'CSV' | 'JSON' | 'XLSX' | 'PDF';
  filters: Record<string, any>;
  dateRange: {
    start: Date;
    end: Date;
  };
  status: 'pending' | 'processing' | 'completed' | 'failed';
  downloadUrl?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  groupId: string;
  topics: string[];
  ssl?: boolean;
  sasl?: {
    mechanism: string;
    username: string;
    password: string;
  };
}

// ============================================================================
// SLA Management Types
// ============================================================================

export interface SLAMetrics {
  uptime: number;
  availability: number;
  responseTime: {
    p50: number;
    p95: number;
    p99: number;
    average: number;
  };
  errorRate: number;
  throughput: number;
  period: {
    start: Date;
    end: Date;
  };
}

export interface SLATarget {
  id: string;
  name: string;
  description: string;
  metric: string;
  target: number;
  operator: '>=' | '<=' | '=' | '>' | '<';
  unit: string;
  organizationId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SLAViolation {
  id: string;
  targetId: string;
  actualValue: number;
  targetValue: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  resolvedAt?: Date;
  organizationId: string;
  createdAt: Date;
}

export interface AvailabilityZone {
  id: string;
  name: string;
  region: string;
  provider: string;
  isActive: boolean;
  priority: number;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  lastHealthCheck: Date;
}

// ============================================================================
// Enterprise Support Types
// ============================================================================

export interface Organization {
  id: string;
  name: string;
  domain: string;
  plan: 'starter' | 'professional' | 'enterprise' | 'custom';
  settings: OrganizationSettings;
  billing: BillingInfo;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationSettings {
  whiteLabel: WhiteLabelConfig;
  customDomain?: string;
  ssoEnabled: boolean;
  mfaRequired: boolean;
  ipWhitelist?: string[];
  dataRetentionDays: number;
  apiRateLimit: APIQuota;
  features: string[];
}

export interface WhiteLabelConfig {
  enabled: boolean;
  logo?: string;
  primaryColor?: string;
  secondaryColor?: string;
  companyName?: string;
  supportEmail?: string;
  customCss?: string;
}

export interface BillingInfo {
  plan: string;
  billingCycle: 'monthly' | 'yearly';
  nextBillingDate: Date;
  paymentMethod: string;
  billingAddress: Address;
  usage: UsageMetrics;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface UsageMetrics {
  apiCalls: number;
  dataTransferGB: number;
  storageGB: number;
  users: number;
  period: {
    start: Date;
    end: Date;
  };
}

export interface AdminDashboardConfig {
  widgets: DashboardWidget[];
  layout: string;
  refreshInterval: number;
  timezone: string;
}

export interface DashboardWidget {
  id: string;
  type: 'chart' | 'metric' | 'table' | 'alert';
  title: string;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  config: Record<string, any>;
  dataSource: string;
  refreshInterval: number;
}

// ============================================================================
// SDK Types
// ============================================================================

export interface SDKConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  userAgent: string;
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    requestId: string;
    timestamp: Date;
    rateLimit?: {
      remaining: number;
      reset: Date;
    };
  };
}

export interface PaginatedResponse<T = any> extends APIResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ============================================================================
// GraphQL Types
// ============================================================================

export interface GraphQLContext {
  user?: User;
  organization?: Organization;
  apiKey?: APIKey;
  requestId: string;
  startTime: number;
}

export interface GraphQLResolverInfo {
  fieldName: string;
  fieldNodes: any[];
  returnType: any;
  parentType: any;
  path: any;
  schema: any;
  fragments: any;
  rootValue: any;
  operation: any;
  variableValues: any;
}

// ============================================================================
// Monitoring & Observability Types
// ============================================================================

export interface MetricPoint {
  timestamp: Date;
  value: number;
  tags?: Record<string, string>;
}

export interface Alert {
  id: string;
  name: string;
  description: string;
  condition: string;
  threshold: number;
  severity: 'info' | 'warning' | 'error' | 'critical';
  isActive: boolean;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface HealthCheck {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  timestamp: Date;
  details?: Record<string, any>;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface EnterpriseConfig {
  server: {
    port: number;
    host: string;
    environment: string;
  };
  database: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl: boolean;
    poolSize: number;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
    keyPrefix: string;
  };
  kafka: KafkaConfig;
  auth: {
    jwtSecret: string;
    jwtExpiration: string;
    oauth2: OAuth2Config;
    saml: SAMLConfig;
    mfa: MFAConfig;
  };
  monitoring: {
    enabled: boolean;
    metricsPort: number;
    logLevel: string;
  };
  features: {
    rateLimiting: boolean;
    caching: boolean;
    webhooks: boolean;
    multiTenancy: boolean;
    whiteLabel: boolean;
  };
}
