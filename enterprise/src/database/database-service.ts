/**
 * @fileoverview Database Service with PostgreSQL
 * @author QuantLink Team
 * @version 1.0.0
 */

import { Pool, PoolClient } from 'pg';
import { Logger } from '../utils/logger';
import { 
  Organization, 
  User, 
  APIKey, 
  SLATarget, 
  SLAViolation, 
  AvailabilityZone 
} from '../types';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  pool: {
    min: number;
    max: number;
  };
}

export class DatabaseService {
  private pool: Pool;
  private logger: Logger;
  private config: DatabaseConfig;

  constructor(config?: DatabaseConfig) {
    this.config = config || this.getDefaultConfig();
    this.logger = new Logger('DatabaseService');
    this.initializePool();
  }

  private getDefaultConfig(): DatabaseConfig {
    return {
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
    };
  }

  private initializePool(): void {
    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      ssl: this.config.ssl,
      min: this.config.pool.min,
      max: this.config.pool.max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err) => {
      this.logger.error('Database pool error', {
        error: err.message,
        stack: err.stack,
      });
    });
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      client.release();
      this.logger.info('Database connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.pool.end();
      this.logger.info('Database disconnected');
    } catch (error) {
      this.logger.error('Error disconnecting from database', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Organization methods
  async createOrganization(org: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>): Promise<Organization> {
    const query = `
      INSERT INTO organizations (name, domain, plan, settings, billing, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const values = [
      org.name,
      org.domain,
      org.plan,
      JSON.stringify(org.settings),
      JSON.stringify(org.billing),
      org.isActive,
    ];

    const result = await this.query<Organization>(query, values);
    return result[0];
  }

  async getOrganization(id: string): Promise<Organization | null> {
    const query = 'SELECT * FROM organizations WHERE id = $1';
    const result = await this.query<Organization>(query, [id]);
    return result[0] || null;
  }

  async updateOrganization(id: string, updates: Partial<Organization>): Promise<void> {
    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');
    
    const query = `UPDATE organizations SET ${setClause}, updated_at = NOW() WHERE id = $1`;
    const values = [id, ...Object.values(updates)];
    
    await this.query(query, values);
  }

  async getOrganizationCount(): Promise<number> {
    const result = await this.query<{ count: string }>('SELECT COUNT(*) as count FROM organizations');
    return parseInt(result[0].count);
  }

  async getActiveOrganizationCount(): Promise<number> {
    const result = await this.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM organizations WHERE is_active = true'
    );
    return parseInt(result[0].count);
  }

  async getNewOrganizationsCount(days: number): Promise<number> {
    const result = await this.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM organizations WHERE created_at >= NOW() - INTERVAL \'$1 days\'',
      [days]
    );
    return parseInt(result[0].count);
  }

  // User methods
  async createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const query = `
      INSERT INTO users (email, password, first_name, last_name, organization_id, roles, is_active, mfa_enabled)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    
    const values = [
      user.email,
      user.password,
      user.firstName,
      user.lastName,
      user.organizationId,
      JSON.stringify(user.roles),
      user.isActive,
      user.mfaEnabled,
    ];

    const result = await this.query<User>(query, values);
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await this.query<User>(query, [email]);
    return result[0] || null;
  }

  async getUserCount(): Promise<number> {
    const result = await this.query<{ count: string }>('SELECT COUNT(*) as count FROM users');
    return parseInt(result[0].count);
  }

  async getActiveUserCount(): Promise<number> {
    const result = await this.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM users WHERE is_active = true'
    );
    return parseInt(result[0].count);
  }

  async getNewUsersCount(days: number): Promise<number> {
    const result = await this.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL \'$1 days\'',
      [days]
    );
    return parseInt(result[0].count);
  }

  // API Key methods
  async createAPIKey(apiKey: Omit<APIKey, 'id' | 'createdAt' | 'updatedAt'>): Promise<APIKey> {
    const query = `
      INSERT INTO api_keys (name, key_hash, organization_id, user_id, permissions, quota, is_active, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    
    const values = [
      apiKey.name,
      apiKey.keyHash,
      apiKey.organizationId,
      apiKey.userId,
      JSON.stringify(apiKey.permissions),
      JSON.stringify(apiKey.quota),
      apiKey.isActive,
      apiKey.expiresAt,
    ];

    const result = await this.query<APIKey>(query, values);
    return result[0];
  }

  async getAPIKeyByHash(keyHash: string): Promise<APIKey | null> {
    const query = 'SELECT * FROM api_keys WHERE key_hash = $1 AND is_active = true';
    const result = await this.query<APIKey>(query, [keyHash]);
    return result[0] || null;
  }

  // SLA methods
  async getActiveSLATargets(): Promise<SLATarget[]> {
    const query = 'SELECT * FROM sla_targets WHERE is_active = true';
    return await this.query<SLATarget>(query);
  }

  async createSLAViolation(violation: Omit<SLAViolation, 'id' | 'createdAt'>): Promise<SLAViolation> {
    const query = `
      INSERT INTO sla_violations (target_id, actual_value, target_value, severity, description, organization_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const values = [
      violation.targetId,
      violation.actualValue,
      violation.targetValue,
      violation.severity,
      violation.description,
      violation.organizationId,
    ];

    const result = await this.query<SLAViolation>(query, values);
    return result[0];
  }

  async updateSLAViolation(id: string, updates: Partial<SLAViolation>): Promise<void> {
    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');
    
    const query = `UPDATE sla_violations SET ${setClause} WHERE id = $1`;
    const values = [id, ...Object.values(updates)];
    
    await this.query(query, values);
  }

  // Availability Zone methods
  async getAvailabilityZones(): Promise<AvailabilityZone[]> {
    const query = 'SELECT * FROM availability_zones WHERE is_active = true';
    return await this.query<AvailabilityZone>(query);
  }

  async updateAvailabilityZone(id: string, updates: Partial<AvailabilityZone>): Promise<void> {
    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');
    
    const query = `UPDATE availability_zones SET ${setClause} WHERE id = $1`;
    const values = [id, ...Object.values(updates)];
    
    await this.query(query, values);
  }

  // Analytics methods
  async getAPICallsCount(days: number, offset: number = 0): Promise<number> {
    const query = `
      SELECT COUNT(*) as count 
      FROM api_requests 
      WHERE created_at >= NOW() - INTERVAL '$1 days' 
      AND created_at < NOW() - INTERVAL '$2 days'
    `;
    const result = await this.query<{ count: string }>(query, [days + offset, offset]);
    return parseInt(result[0].count);
  }

  async getTopAPIUsers(limit: number): Promise<any[]> {
    const query = `
      SELECT organization_id, COUNT(*) as request_count
      FROM api_requests
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY organization_id
      ORDER BY request_count DESC
      LIMIT $1
    `;
    return await this.query(query, [limit]);
  }

  async getRevenueForPeriod(days: number, offset: number = 0): Promise<number> {
    const query = `
      SELECT COALESCE(SUM(amount), 0) as revenue
      FROM billing_transactions
      WHERE created_at >= NOW() - INTERVAL '$1 days'
      AND created_at < NOW() - INTERVAL '$2 days'
      AND status = 'completed'
    `;
    const result = await this.query<{ revenue: string }>(query, [days + offset, offset]);
    return parseFloat(result[0].revenue);
  }

  async getMonthlyRecurringRevenue(): Promise<number> {
    const query = `
      SELECT COALESCE(SUM(amount), 0) as mrr
      FROM subscriptions
      WHERE status = 'active'
      AND billing_cycle = 'monthly'
    `;
    const result = await this.query<{ mrr: string }>(query);
    return parseFloat(result[0].mrr);
  }

  async getAnnualRecurringRevenue(): Promise<number> {
    const query = `
      SELECT COALESCE(SUM(amount * 12), 0) as arr
      FROM subscriptions
      WHERE status = 'active'
      AND billing_cycle = 'monthly'
      UNION ALL
      SELECT COALESCE(SUM(amount), 0) as arr
      FROM subscriptions
      WHERE status = 'active'
      AND billing_cycle = 'annual'
    `;
    const result = await this.query<{ arr: string }>(query);
    return result.reduce((sum, row) => sum + parseFloat(row.arr), 0);
  }

  async getRecentAuditLogs(limit: number): Promise<any[]> {
    const query = `
      SELECT *
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT $1
    `;
    return await this.query(query, [limit]);
  }

  async getStatistics(): Promise<any> {
    const query = `
      SELECT 
        schemaname,
        tablename,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes
      FROM pg_stat_user_tables
      ORDER BY schemaname, tablename
    `;
    return await this.query(query);
  }

  async createOnboardingProcess(data: any): Promise<any> {
    const query = `
      INSERT INTO onboarding_processes (organization_id, plan, requirements, contacts, status, steps, current_step)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    
    const values = [
      data.organizationId,
      data.plan,
      JSON.stringify(data.requirements),
      JSON.stringify(data.contacts),
      data.status,
      JSON.stringify(data.steps),
      data.currentStep,
    ];

    const result = await this.query(query, values);
    return result[0];
  }
}
