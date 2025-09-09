/**
 * @fileoverview Configuration loader with environment support
 * @author QuantLink Team
 * @version 1.0.0
 */

import { EnterpriseConfig } from '../types';

export async function loadConfig(): Promise<EnterpriseConfig> {
  const config: EnterpriseConfig = {
    server: {
      host: process.env.HOST || '0.0.0.0',
      port: parseInt(process.env.PORT || '3000'),
      environment: process.env.NODE_ENV || 'development',
    },
    
    database: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'quantlink_enterprise',
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      ssl: process.env.DB_SSL === 'true',
      pool: {
        min: parseInt(process.env.DB_POOL_MIN || '2'),
        max: parseInt(process.env.DB_POOL_MAX || '10'),
      },
    },
    
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      keyPrefix: process.env.REDIS_PREFIX || 'quantlink:',
    },
    
    auth: {
      jwt: {
        secret: process.env.JWT_SECRET || 'your-secret-key',
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
        issuer: process.env.JWT_ISSUER || 'quantlink',
        audience: process.env.JWT_AUDIENCE || 'quantlink-api',
      },
      session: {
        secret: process.env.SESSION_SECRET || 'your-session-secret',
        maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000'), // 24 hours
      },
      oauth2: {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID || '',
          clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
          callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
        },
        github: {
          clientId: process.env.GITHUB_CLIENT_ID || '',
          clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
          callbackURL: process.env.GITHUB_CALLBACK_URL || '/auth/github/callback',
        },
      },
      saml: {
        entryPoint: process.env.SAML_ENTRY_POINT || '',
        issuer: process.env.SAML_ISSUER || 'quantlink',
        callbackUrl: process.env.SAML_CALLBACK_URL || '/auth/saml/callback',
        cert: process.env.SAML_CERT || '',
        privateCert: process.env.SAML_PRIVATE_CERT || '',
      },
      mfa: {
        issuer: process.env.MFA_ISSUER || 'QuantLink',
        window: parseInt(process.env.MFA_WINDOW || '1'),
      },
    },
    
    kafka: {
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      clientId: process.env.KAFKA_CLIENT_ID || 'quantlink-enterprise',
      groupId: process.env.KAFKA_GROUP_ID || 'quantlink-enterprise-group',
      ssl: process.env.KAFKA_SSL === 'true',
      sasl: process.env.KAFKA_SASL_MECHANISM ? {
        mechanism: process.env.KAFKA_SASL_MECHANISM as any,
        username: process.env.KAFKA_SASL_USERNAME || '',
        password: process.env.KAFKA_SASL_PASSWORD || '',
      } : undefined,
    },
    
    features: {
      multiTenancy: process.env.FEATURE_MULTI_TENANCY === 'true',
      whiteLabel: process.env.FEATURE_WHITE_LABEL === 'true',
      customDomains: process.env.FEATURE_CUSTOM_DOMAINS === 'true',
      advancedAnalytics: process.env.FEATURE_ADVANCED_ANALYTICS === 'true',
      sso: process.env.FEATURE_SSO === 'true',
      mfa: process.env.FEATURE_MFA === 'true',
      apiVersioning: process.env.FEATURE_API_VERSIONING === 'true',
      webhooks: process.env.FEATURE_WEBHOOKS === 'true',
      realTimeStreaming: process.env.FEATURE_REAL_TIME_STREAMING === 'true',
      dataExport: process.env.FEATURE_DATA_EXPORT === 'true',
      slaManagement: process.env.FEATURE_SLA_MANAGEMENT === 'true',
      auditLogging: process.env.FEATURE_AUDIT_LOGGING === 'true',
    },
  };

  // Validate required configuration
  validateConfig(config);
  
  return config;
}

function validateConfig(config: EnterpriseConfig): void {
  const required = [
    'JWT_SECRET',
    'SESSION_SECRET',
    'DB_PASSWORD',
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate JWT secret strength
  if (config.auth.jwt.secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }

  // Validate session secret strength
  if (config.auth.session.secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters long');
  }
}
