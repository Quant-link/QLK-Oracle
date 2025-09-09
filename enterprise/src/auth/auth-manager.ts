/**
 * @fileoverview Enterprise Authentication & Authorization Manager
 * @author QuantLink Team
 * @version 1.0.0
 */

import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import { Strategy as SamlStrategy } from 'passport-saml';
import { Strategy as LocalStrategy } from 'passport-local';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

import { Logger } from '../utils/logger';
import { MetricsCollector } from '../monitoring/metrics';
import { DatabaseService } from '../database/database-service';
import { RedisService } from '../cache/redis-service';
import { AuditLogger } from './audit-logger';
import { 
  User, 
  Role, 
  Permission, 
  OAuth2Config, 
  SAMLConfig, 
  MFAConfig,
  AuditLog 
} from '../types';

export interface AuthConfig {
  jwt: {
    secret: string;
    expiresIn: string;
    refreshExpiresIn: string;
  };
  oauth2: OAuth2Config;
  saml: SAMLConfig;
  mfa: MFAConfig;
  session: {
    secret: string;
    maxAge: number;
  };
  passwordPolicy: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    maxAge: number;
  };
}

export class AuthManager {
  public router: Router;
  private logger: Logger;
  private metrics: MetricsCollector;
  private database: DatabaseService;
  private redis: RedisService;
  private auditLogger: AuditLogger;
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
    this.router = Router();
    this.logger = new Logger('AuthManager');
    this.metrics = new MetricsCollector('auth');
    this.database = new DatabaseService();
    this.redis = new RedisService();
    this.auditLogger = new AuditLogger();
    
    this.initializePassport();
    this.setupRoutes();
  }

  /**
   * Initialize Passport strategies
   */
  private initializePassport(): void {
    // Local strategy for username/password
    passport.use(new LocalStrategy({
      usernameField: 'email',
      passwordField: 'password',
    }, async (email, password, done) => {
      try {
        const user = await this.database.getUserByEmail(email);
        
        if (!user || !user.isActive) {
          return done(null, false, { message: 'Invalid credentials' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        
        if (!isValidPassword) {
          await this.auditLogger.log({
            userId: user.id,
            action: 'LOGIN_FAILED',
            resource: 'auth',
            metadata: { reason: 'invalid_password' },
          });
          return done(null, false, { message: 'Invalid credentials' });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }));

    // OAuth2 strategy
    passport.use('oauth2', new OAuth2Strategy({
      authorizationURL: this.config.oauth2.authorizationURL,
      tokenURL: this.config.oauth2.tokenURL,
      clientID: this.config.oauth2.clientId,
      clientSecret: this.config.oauth2.clientSecret,
      callbackURL: this.config.oauth2.callbackURL,
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        // Fetch user info from OAuth2 provider
        const userInfo = await this.fetchOAuth2UserInfo(accessToken);
        
        let user = await this.database.getUserByEmail(userInfo.email);
        
        if (!user) {
          // Create new user from OAuth2 profile
          user = await this.database.createUser({
            email: userInfo.email,
            username: userInfo.username || userInfo.email,
            firstName: userInfo.firstName || '',
            lastName: userInfo.lastName || '',
            isActive: true,
            isMfaEnabled: false,
            organizationId: userInfo.organizationId,
          });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }));

    // SAML strategy for enterprise SSO
    passport.use('saml', new SamlStrategy({
      entryPoint: this.config.saml.entryPoint,
      issuer: this.config.saml.issuer,
      cert: this.config.saml.cert,
      privateKey: this.config.saml.privateKey,
      callbackUrl: this.config.saml.callbackUrl,
      logoutUrl: this.config.saml.logoutUrl,
      signatureAlgorithm: this.config.saml.signatureAlgorithm,
    }, async (profile, done) => {
      try {
        const email = profile.nameID || profile.email;
        
        let user = await this.database.getUserByEmail(email);
        
        if (!user) {
          // Create new user from SAML profile
          user = await this.database.createUser({
            email,
            username: profile.username || email,
            firstName: profile.firstName || '',
            lastName: profile.lastName || '',
            isActive: true,
            isMfaEnabled: false,
            organizationId: profile.organizationId,
          });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }));

    passport.serializeUser((user: any, done) => {
      done(null, user.id);
    });

    passport.deserializeUser(async (id: string, done) => {
      try {
        const user = await this.database.getUserById(id);
        done(null, user);
      } catch (error) {
        done(error);
      }
    });
  }

  /**
   * Setup authentication routes
   */
  private setupRoutes(): void {
    // Local login
    this.router.post('/login', this.login.bind(this));
    
    // Logout
    this.router.post('/logout', this.logout.bind(this));
    
    // Refresh token
    this.router.post('/refresh', this.refreshToken.bind(this));
    
    // OAuth2 routes
    this.router.get('/oauth2', passport.authenticate('oauth2'));
    this.router.get('/oauth2/callback', 
      passport.authenticate('oauth2', { session: false }),
      this.oauthCallback.bind(this)
    );
    
    // SAML routes
    this.router.get('/saml', passport.authenticate('saml'));
    this.router.post('/saml/callback',
      passport.authenticate('saml', { session: false }),
      this.samlCallback.bind(this)
    );
    
    // MFA routes
    this.router.post('/mfa/setup', this.requireAuth, this.setupMFA.bind(this));
    this.router.post('/mfa/verify', this.verifyMFA.bind(this));
    this.router.post('/mfa/disable', this.requireAuth, this.disableMFA.bind(this));
    
    // Password management
    this.router.post('/password/change', this.requireAuth, this.changePassword.bind(this));
    this.router.post('/password/reset', this.resetPassword.bind(this));
    this.router.post('/password/reset/confirm', this.confirmPasswordReset.bind(this));
    
    // User management
    this.router.get('/me', this.requireAuth, this.getCurrentUser.bind(this));
    this.router.put('/me', this.requireAuth, this.updateCurrentUser.bind(this));
    
    // Session management
    this.router.get('/sessions', this.requireAuth, this.getUserSessions.bind(this));
    this.router.delete('/sessions/:sessionId', this.requireAuth, this.revokeSession.bind(this));
  }

  /**
   * Local login handler
   */
  private async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, mfaToken } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Email and password are required',
          },
        });
      }

      const user = await this.database.getUserByEmail(email);
      
      if (!user || !user.isActive) {
        await this.auditLogger.log({
          action: 'LOGIN_FAILED',
          resource: 'auth',
          metadata: { email, reason: 'user_not_found' },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent') || '',
        });
        
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      
      if (!isValidPassword) {
        await this.auditLogger.log({
          userId: user.id,
          action: 'LOGIN_FAILED',
          resource: 'auth',
          metadata: { reason: 'invalid_password' },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent') || '',
        });
        
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        });
      }

      // Check if MFA is required
      if (user.isMfaEnabled) {
        if (!mfaToken) {
          return res.status(200).json({
            success: true,
            requiresMFA: true,
            tempToken: await this.generateTempToken(user.id),
          });
        }

        const isMFAValid = await this.verifyMFAToken(user.id, mfaToken);
        if (!isMFAValid) {
          await this.auditLogger.log({
            userId: user.id,
            action: 'MFA_FAILED',
            resource: 'auth',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || '',
          });
          
          return res.status(401).json({
            success: false,
            error: {
              code: 'INVALID_MFA_TOKEN',
              message: 'Invalid MFA token',
            },
          });
        }
      }

      // Generate tokens
      const tokens = await this.generateTokens(user);
      
      // Update last login
      await this.database.updateUser(user.id, {
        lastLoginAt: new Date(),
      });

      // Store session
      await this.storeSession(user.id, tokens.refreshToken, req);

      await this.auditLogger.log({
        userId: user.id,
        action: 'LOGIN_SUCCESS',
        resource: 'auth',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || '',
      });

      this.metrics.incrementCounter('login_success');

      res.json({
        success: true,
        data: {
          user: this.sanitizeUser(user),
          tokens,
        },
      });
    } catch (error) {
      this.logger.error('Login error', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      this.metrics.incrementCounter('login_errors');
      
      res.status(500).json({
        success: false,
        error: {
          code: 'LOGIN_ERROR',
          message: 'Login failed',
        },
      });
    }
  }

  /**
   * Logout handler
   */
  private async logout(req: Request, res: Response): Promise<void> {
    try {
      const token = this.extractToken(req);
      
      if (token) {
        // Blacklist the token
        await this.blacklistToken(token);
        
        // Remove session
        const decoded = jwt.verify(token, this.config.jwt.secret) as any;
        await this.removeSession(decoded.userId, decoded.sessionId);
        
        await this.auditLogger.log({
          userId: decoded.userId,
          action: 'LOGOUT',
          resource: 'auth',
          ipAddress: req.ip,
          userAgent: req.get('User-Agent') || '',
        });
      }

      this.metrics.incrementCounter('logout_success');

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      this.logger.error('Logout error', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'LOGOUT_ERROR',
          message: 'Logout failed',
        },
      });
    }
  }

  /**
   * Refresh token handler
   */
  private async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Refresh token is required',
          },
        });
      }

      const decoded = jwt.verify(refreshToken, this.config.jwt.secret) as any;
      
      // Check if session exists
      const session = await this.getSession(decoded.userId, decoded.sessionId);
      if (!session) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_SESSION',
            message: 'Session not found or expired',
          },
        });
      }

      const user = await this.database.getUserById(decoded.userId);
      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'USER_INACTIVE',
            message: 'User is inactive',
          },
        });
      }

      // Generate new tokens
      const tokens = await this.generateTokens(user);
      
      // Update session
      await this.updateSession(decoded.userId, decoded.sessionId, tokens.refreshToken);

      this.metrics.incrementCounter('token_refresh_success');

      res.json({
        success: true,
        data: { tokens },
      });
    } catch (error) {
      this.logger.error('Token refresh error', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      this.metrics.incrementCounter('token_refresh_errors');
      
      res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_REFRESH_ERROR',
          message: 'Failed to refresh token',
        },
      });
    }
  }

  /**
   * Setup MFA for user
   */
  private async setupMFA(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user as User;
      
      if (user.isMfaEnabled) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MFA_ALREADY_ENABLED',
            message: 'MFA is already enabled',
          },
        });
      }

      const secret = speakeasy.generateSecret({
        name: `QuantLink (${user.email})`,
        issuer: this.config.mfa.issuer,
        length: 32,
      });

      // Store temporary secret
      await this.redis.setex(`mfa_setup:${user.id}`, 300, secret.base32); // 5 minutes

      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!);

      res.json({
        success: true,
        data: {
          secret: secret.base32,
          qrCode: qrCodeUrl,
          backupCodes: await this.generateBackupCodes(user.id),
        },
      });
    } catch (error) {
      this.logger.error('MFA setup error', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'MFA_SETUP_ERROR',
          message: 'Failed to setup MFA',
        },
      });
    }
  }

  /**
   * Verify MFA token
   */
  private async verifyMFA(req: Request, res: Response): Promise<void> {
    try {
      const { tempToken, mfaToken } = req.body;

      if (!tempToken || !mfaToken) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Temp token and MFA token are required',
          },
        });
      }

      const decoded = jwt.verify(tempToken, this.config.jwt.secret) as any;
      const user = await this.database.getUserById(decoded.userId);

      if (!user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid temp token',
          },
        });
      }

      const isValid = await this.verifyMFAToken(user.id, mfaToken);
      
      if (!isValid) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_MFA_TOKEN',
            message: 'Invalid MFA token',
          },
        });
      }

      // Complete MFA setup if this is setup verification
      const setupSecret = await this.redis.get(`mfa_setup:${user.id}`);
      if (setupSecret) {
        await this.database.updateUser(user.id, {
          isMfaEnabled: true,
          mfaSecret: setupSecret,
        });
        await this.redis.del(`mfa_setup:${user.id}`);
      }

      // Generate full tokens
      const tokens = await this.generateTokens(user);
      
      await this.auditLogger.log({
        userId: user.id,
        action: 'MFA_VERIFIED',
        resource: 'auth',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || '',
      });

      res.json({
        success: true,
        data: {
          user: this.sanitizeUser(user),
          tokens,
        },
      });
    } catch (error) {
      this.logger.error('MFA verification error', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'MFA_VERIFICATION_ERROR',
          message: 'Failed to verify MFA',
        },
      });
    }
  }

  /**
   * Authentication middleware
   */
  public requireAuth = async (req: any, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = this.extractToken(req);
      
      if (!token) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'TOKEN_REQUIRED',
            message: 'Authentication token is required',
          },
        });
      }

      // Check if token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(token);
      if (isBlacklisted) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'TOKEN_BLACKLISTED',
            message: 'Token has been revoked',
          },
        });
      }

      const decoded = jwt.verify(token, this.config.jwt.secret) as any;
      const user = await this.database.getUserById(decoded.userId);

      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'USER_INACTIVE',
            message: 'User is inactive',
          },
        });
      }

      req.user = user;
      req.sessionId = decoded.sessionId;
      next();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid authentication token',
          },
        });
      }

      this.logger.error('Authentication error', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: 'Authentication failed',
        },
      });
    }
  };

  /**
   * Authorization middleware
   */
  public requirePermission = (resource: string, action: string) => {
    return async (req: any, res: Response, next: NextFunction): Promise<void> => {
      try {
        const user = req.user as User;
        
        if (!user) {
          return res.status(401).json({
            success: false,
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'Authentication required',
            },
          });
        }

        const hasPermission = await this.checkPermission(user, resource, action);
        
        if (!hasPermission) {
          await this.auditLogger.log({
            userId: user.id,
            action: 'ACCESS_DENIED',
            resource,
            metadata: { requiredAction: action },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || '',
          });
          
          return res.status(403).json({
            success: false,
            error: {
              code: 'INSUFFICIENT_PERMISSIONS',
              message: 'Insufficient permissions',
            },
          });
        }

        next();
      } catch (error) {
        this.logger.error('Authorization error', {
          error: error instanceof Error ? error.message : String(error),
        });
        
        res.status(500).json({
          success: false,
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'Authorization failed',
          },
        });
      }
    };
  };

  // Helper methods would continue here...
  // Due to length constraints, I'll continue with the remaining methods in the next file

  /**
   * Generate JWT tokens
   */
  private async generateTokens(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const sessionId = this.generateSessionId();
    
    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        organizationId: user.organizationId,
        sessionId,
      },
      this.config.jwt.secret,
      { expiresIn: this.config.jwt.expiresIn }
    );

    const refreshToken = jwt.sign(
      {
        userId: user.id,
        sessionId,
        type: 'refresh',
      },
      this.config.jwt.secret,
      { expiresIn: this.config.jwt.refreshExpiresIn }
    );

    return { accessToken, refreshToken };
  }

  /**
   * Extract token from request
   */
  private extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    
    return null;
  }

  /**
   * Sanitize user object for response
   */
  private sanitizeUser(user: User): Partial<User> {
    const { password, mfaSecret, ...sanitized } = user as any;
    return sanitized;
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check user permissions
   */
  private async checkPermission(user: User, resource: string, action: string): Promise<boolean> {
    // Check direct permissions
    const hasDirectPermission = user.permissions.some(
      permission => permission.resource === resource && permission.action === action
    );
    
    if (hasDirectPermission) {
      return true;
    }

    // Check role-based permissions
    for (const role of user.roles) {
      const hasRolePermission = role.permissions.some(
        permission => permission.resource === resource && permission.action === action
      );
      
      if (hasRolePermission) {
        return true;
      }
    }

    return false;
  }

  // Additional helper methods for session management, MFA, etc. would be implemented here
  private async storeSession(userId: string, refreshToken: string, req: Request): Promise<void> {
    // Implementation for storing session in Redis
  }

  private async getSession(userId: string, sessionId: string): Promise<any> {
    // Implementation for retrieving session from Redis
  }

  private async removeSession(userId: string, sessionId: string): Promise<void> {
    // Implementation for removing session from Redis
  }

  private async updateSession(userId: string, sessionId: string, refreshToken: string): Promise<void> {
    // Implementation for updating session in Redis
  }

  private async blacklistToken(token: string): Promise<void> {
    // Implementation for blacklisting tokens
  }

  private async isTokenBlacklisted(token: string): Promise<boolean> {
    // Implementation for checking if token is blacklisted
    return false;
  }

  private async verifyMFAToken(userId: string, token: string): Promise<boolean> {
    // Implementation for verifying MFA tokens
    return true;
  }

  private async generateTempToken(userId: string): Promise<string> {
    return jwt.sign({ userId, type: 'temp' }, this.config.jwt.secret, { expiresIn: '5m' });
  }

  private async generateBackupCodes(userId: string): Promise<string[]> {
    // Implementation for generating backup codes
    return [];
  }

  private async fetchOAuth2UserInfo(accessToken: string): Promise<any> {
    // Implementation for fetching user info from OAuth2 provider
    return {};
  }

  private async getCurrentUser(req: Request, res: Response): Promise<void> {
    // Implementation for getting current user
  }

  private async updateCurrentUser(req: Request, res: Response): Promise<void> {
    // Implementation for updating current user
  }

  private async changePassword(req: Request, res: Response): Promise<void> {
    // Implementation for changing password
  }

  private async resetPassword(req: Request, res: Response): Promise<void> {
    // Implementation for password reset
  }

  private async confirmPasswordReset(req: Request, res: Response): Promise<void> {
    // Implementation for confirming password reset
  }

  private async disableMFA(req: Request, res: Response): Promise<void> {
    // Implementation for disabling MFA
  }

  private async getUserSessions(req: Request, res: Response): Promise<void> {
    // Implementation for getting user sessions
  }

  private async revokeSession(req: Request, res: Response): Promise<void> {
    // Implementation for revoking session
  }

  private async oauthCallback(req: Request, res: Response): Promise<void> {
    // Implementation for OAuth callback
  }

  private async samlCallback(req: Request, res: Response): Promise<void> {
    // Implementation for SAML callback
  }
}
