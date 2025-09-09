/**
 * @fileoverview Authentication Store with Web3 wallet support and JWT management
 * @author QuantLink Team
 * @version 1.0.0
 */

import { create } from 'zustand';
import { subscribeWithSelector, devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { createJSONStorage } from 'zustand/middleware';
import { jwtDecode } from 'jwt-decode';

export interface User {
  id: string;
  email?: string;
  walletAddress?: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
  permissions: string[];
  organizationId?: string;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLogin?: Date;
  createdAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: 'Bearer';
}

export interface WalletConnection {
  address: string;
  chainId: number;
  connector: string;
  isConnected: boolean;
  balance?: string;
}

export interface AuthSession {
  user: User;
  tokens: AuthTokens;
  wallet?: WalletConnection;
  sessionId: string;
  createdAt: Date;
  lastActivity: Date;
  expiresAt: Date;
}

export interface AuthState {
  // Authentication state
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  session: AuthSession | null;
  tokens: AuthTokens | null;
  
  // Wallet state
  wallet: WalletConnection | null;
  isWalletConnecting: boolean;
  supportedWallets: string[];
  
  // MFA state
  mfaRequired: boolean;
  mfaToken: string | null;
  mfaBackupCodes: string[];
  
  // Error state
  lastError: Error | null;
  authErrors: Map<string, string>;
  
  // Permissions
  permissions: Set<string>;
  roles: Set<string>;
  
  // Actions
  login: (email: string, password: string) => Promise<void>;
  loginWithWallet: (address: string, signature: string, message: string) => Promise<void>;
  loginWithMFA: (token: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshTokens: () => Promise<void>;
  connectWallet: (connector: string) => Promise<void>;
  disconnectWallet: () => void;
  switchChain: (chainId: number) => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  enableMFA: () => Promise<{ secret: string; qrCode: string; backupCodes: string[] }>;
  disableMFA: (code: string) => Promise<void>;
  verifyMFA: (code: string) => Promise<boolean>;
  generateBackupCodes: () => Promise<string[]>;
  checkPermission: (permission: string) => boolean;
  checkRole: (role: string) => boolean;
  clearErrors: () => void;
  validateSession: () => Promise<boolean>;
}

// Encryption utilities for sensitive data
const encryptionKey = 'quantlink-dashboard-encryption-key';

const encryptData = (data: any): string => {
  // Simple encryption - in production use proper encryption
  return btoa(JSON.stringify(data));
};

const decryptData = (encryptedData: string): any => {
  try {
    return JSON.parse(atob(encryptedData));
  } catch {
    return null;
  }
};

// Custom storage with encryption for sensitive data
const createEncryptedStorage = () => ({
  getItem: (name: string): string | null => {
    const item = localStorage.getItem(name);
    if (!item) return null;
    
    // Decrypt sensitive fields
    const data = JSON.parse(item);
    if (data.state?.tokens) {
      data.state.tokens = decryptData(data.state.tokens);
    }
    if (data.state?.session) {
      data.state.session = decryptData(data.state.session);
    }
    
    return JSON.stringify(data);
  },
  setItem: (name: string, value: string): void => {
    const data = JSON.parse(value);
    
    // Encrypt sensitive fields
    if (data.state?.tokens) {
      data.state.tokens = encryptData(data.state.tokens);
    }
    if (data.state?.session) {
      data.state.session = encryptData(data.state.session);
    }
    
    localStorage.setItem(name, JSON.stringify(data));
  },
  removeItem: (name: string): void => {
    localStorage.removeItem(name);
  },
});

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      subscribeWithSelector(
        immer((set, get) => ({
          // Initial state
          isAuthenticated: false,
          isLoading: false,
          user: null,
          session: null,
          tokens: null,
          
          wallet: null,
          isWalletConnecting: false,
          supportedWallets: ['MetaMask', 'WalletConnect', 'Coinbase Wallet'],
          
          mfaRequired: false,
          mfaToken: null,
          mfaBackupCodes: [],
          
          lastError: null,
          authErrors: new Map(),
          
          permissions: new Set(),
          roles: new Set(),

          // Actions
          login: async (email: string, password: string) => {
            set((draft) => {
              draft.isLoading = true;
              draft.lastError = null;
              draft.authErrors.clear();
            });

            try {
              const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
              });

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Login failed');
              }

              const data = await response.json();

              if (data.mfaRequired) {
                set((draft) => {
                  draft.mfaRequired = true;
                  draft.mfaToken = data.mfaToken;
                  draft.isLoading = false;
                });
                return;
              }

              const decodedToken = jwtDecode(data.tokens.accessToken) as any;
              
              set((draft) => {
                draft.isAuthenticated = true;
                draft.isLoading = false;
                draft.user = data.user;
                draft.tokens = data.tokens;
                draft.session = {
                  user: data.user,
                  tokens: data.tokens,
                  sessionId: data.sessionId,
                  createdAt: new Date(),
                  lastActivity: new Date(),
                  expiresAt: new Date(decodedToken.exp * 1000),
                };
                draft.permissions = new Set(data.user.permissions);
                draft.roles = new Set(data.user.roles);
                draft.mfaRequired = false;
                draft.mfaToken = null;
              });

              // Store tokens securely
              localStorage.setItem('auth_token', data.tokens.accessToken);
              localStorage.setItem('refresh_token', data.tokens.refreshToken);

            } catch (error) {
              set((draft) => {
                draft.isLoading = false;
                draft.lastError = error as Error;
                draft.authErrors.set('login', (error as Error).message);
              });
              throw error;
            }
          },

          loginWithWallet: async (address: string, signature: string, message: string) => {
            set((draft) => {
              draft.isLoading = true;
              draft.lastError = null;
              draft.authErrors.clear();
            });

            try {
              const response = await fetch('/api/auth/wallet-login', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ address, signature, message }),
              });

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Wallet login failed');
              }

              const data = await response.json();
              const decodedToken = jwtDecode(data.tokens.accessToken) as any;

              set((draft) => {
                draft.isAuthenticated = true;
                draft.isLoading = false;
                draft.user = data.user;
                draft.tokens = data.tokens;
                draft.session = {
                  user: data.user,
                  tokens: data.tokens,
                  wallet: draft.wallet,
                  sessionId: data.sessionId,
                  createdAt: new Date(),
                  lastActivity: new Date(),
                  expiresAt: new Date(decodedToken.exp * 1000),
                };
                draft.permissions = new Set(data.user.permissions);
                draft.roles = new Set(data.user.roles);
              });

              // Store tokens securely
              localStorage.setItem('auth_token', data.tokens.accessToken);
              localStorage.setItem('refresh_token', data.tokens.refreshToken);

            } catch (error) {
              set((draft) => {
                draft.isLoading = false;
                draft.lastError = error as Error;
                draft.authErrors.set('wallet_login', (error as Error).message);
              });
              throw error;
            }
          },

          loginWithMFA: async (token: string, code: string) => {
            set((draft) => {
              draft.isLoading = true;
              draft.lastError = null;
            });

            try {
              const response = await fetch('/api/auth/mfa-verify', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ token, code }),
              });

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'MFA verification failed');
              }

              const data = await response.json();
              const decodedToken = jwtDecode(data.tokens.accessToken) as any;

              set((draft) => {
                draft.isAuthenticated = true;
                draft.isLoading = false;
                draft.user = data.user;
                draft.tokens = data.tokens;
                draft.session = {
                  user: data.user,
                  tokens: data.tokens,
                  sessionId: data.sessionId,
                  createdAt: new Date(),
                  lastActivity: new Date(),
                  expiresAt: new Date(decodedToken.exp * 1000),
                };
                draft.permissions = new Set(data.user.permissions);
                draft.roles = new Set(data.user.roles);
                draft.mfaRequired = false;
                draft.mfaToken = null;
              });

              // Store tokens securely
              localStorage.setItem('auth_token', data.tokens.accessToken);
              localStorage.setItem('refresh_token', data.tokens.refreshToken);

            } catch (error) {
              set((draft) => {
                draft.isLoading = false;
                draft.lastError = error as Error;
                draft.authErrors.set('mfa', (error as Error).message);
              });
              throw error;
            }
          },

          logout: async () => {
            const state = get();
            
            try {
              if (state.tokens?.refreshToken) {
                await fetch('/api/auth/logout', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.tokens.accessToken}`,
                  },
                  body: JSON.stringify({ refreshToken: state.tokens.refreshToken }),
                });
              }
            } catch (error) {
              console.error('Logout error:', error);
            }

            // Clear all auth data
            set((draft) => {
              draft.isAuthenticated = false;
              draft.user = null;
              draft.session = null;
              draft.tokens = null;
              draft.permissions.clear();
              draft.roles.clear();
              draft.mfaRequired = false;
              draft.mfaToken = null;
              draft.mfaBackupCodes = [];
              draft.lastError = null;
              draft.authErrors.clear();
            });

            // Clear stored tokens
            localStorage.removeItem('auth_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('api_key');
          },

          refreshTokens: async () => {
            const state = get();
            
            if (!state.tokens?.refreshToken) {
              throw new Error('No refresh token available');
            }

            try {
              const response = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ refreshToken: state.tokens.refreshToken }),
              });

              if (!response.ok) {
                throw new Error('Token refresh failed');
              }

              const data = await response.json();
              const decodedToken = jwtDecode(data.tokens.accessToken) as any;

              set((draft) => {
                draft.tokens = data.tokens;
                if (draft.session) {
                  draft.session.tokens = data.tokens;
                  draft.session.expiresAt = new Date(decodedToken.exp * 1000);
                  draft.session.lastActivity = new Date();
                }
              });

              // Update stored tokens
              localStorage.setItem('auth_token', data.tokens.accessToken);
              localStorage.setItem('refresh_token', data.tokens.refreshToken);

            } catch (error) {
              // Refresh failed, logout user
              await get().logout();
              throw error;
            }
          },

          connectWallet: async (connector: string) => {
            set((draft) => {
              draft.isWalletConnecting = true;
              draft.lastError = null;
            });

            try {
              // This would integrate with wagmi/web3 libraries
              // For now, simulate wallet connection
              const mockWallet: WalletConnection = {
                address: '0x1234567890123456789012345678901234567890',
                chainId: 1,
                connector,
                isConnected: true,
                balance: '1.5',
              };

              set((draft) => {
                draft.wallet = mockWallet;
                draft.isWalletConnecting = false;
                if (draft.session) {
                  draft.session.wallet = mockWallet;
                }
              });

            } catch (error) {
              set((draft) => {
                draft.isWalletConnecting = false;
                draft.lastError = error as Error;
                draft.authErrors.set('wallet_connect', (error as Error).message);
              });
              throw error;
            }
          },

          disconnectWallet: () => {
            set((draft) => {
              draft.wallet = null;
              if (draft.session) {
                draft.session.wallet = undefined;
              }
            });
          },

          switchChain: async (chainId: number) => {
            const state = get();
            
            if (!state.wallet) {
              throw new Error('No wallet connected');
            }

            try {
              // This would integrate with wallet switching logic
              set((draft) => {
                if (draft.wallet) {
                  draft.wallet.chainId = chainId;
                }
                if (draft.session?.wallet) {
                  draft.session.wallet.chainId = chainId;
                }
              });

            } catch (error) {
              set((draft) => {
                draft.lastError = error as Error;
                draft.authErrors.set('chain_switch', (error as Error).message);
              });
              throw error;
            }
          },

          updateProfile: async (updates: Partial<User>) => {
            const state = get();
            
            if (!state.tokens?.accessToken) {
              throw new Error('Not authenticated');
            }

            try {
              const response = await fetch('/api/auth/profile', {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${state.tokens.accessToken}`,
                },
                body: JSON.stringify(updates),
              });

              if (!response.ok) {
                throw new Error('Profile update failed');
              }

              const updatedUser = await response.json();

              set((draft) => {
                draft.user = updatedUser;
                if (draft.session) {
                  draft.session.user = updatedUser;
                }
              });

            } catch (error) {
              set((draft) => {
                draft.lastError = error as Error;
                draft.authErrors.set('profile_update', (error as Error).message);
              });
              throw error;
            }
          },

          changePassword: async (currentPassword: string, newPassword: string) => {
            const state = get();
            
            if (!state.tokens?.accessToken) {
              throw new Error('Not authenticated');
            }

            try {
              const response = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${state.tokens.accessToken}`,
                },
                body: JSON.stringify({ currentPassword, newPassword }),
              });

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Password change failed');
              }

            } catch (error) {
              set((draft) => {
                draft.lastError = error as Error;
                draft.authErrors.set('password_change', (error as Error).message);
              });
              throw error;
            }
          },

          enableMFA: async () => {
            const state = get();
            
            if (!state.tokens?.accessToken) {
              throw new Error('Not authenticated');
            }

            try {
              const response = await fetch('/api/auth/mfa/enable', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${state.tokens.accessToken}`,
                },
              });

              if (!response.ok) {
                throw new Error('MFA enable failed');
              }

              const data = await response.json();

              set((draft) => {
                draft.mfaBackupCodes = data.backupCodes;
                if (draft.user) {
                  draft.user.mfaEnabled = true;
                }
              });

              return data;

            } catch (error) {
              set((draft) => {
                draft.lastError = error as Error;
                draft.authErrors.set('mfa_enable', (error as Error).message);
              });
              throw error;
            }
          },

          disableMFA: async (code: string) => {
            const state = get();
            
            if (!state.tokens?.accessToken) {
              throw new Error('Not authenticated');
            }

            try {
              const response = await fetch('/api/auth/mfa/disable', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${state.tokens.accessToken}`,
                },
                body: JSON.stringify({ code }),
              });

              if (!response.ok) {
                throw new Error('MFA disable failed');
              }

              set((draft) => {
                draft.mfaBackupCodes = [];
                if (draft.user) {
                  draft.user.mfaEnabled = false;
                }
              });

            } catch (error) {
              set((draft) => {
                draft.lastError = error as Error;
                draft.authErrors.set('mfa_disable', (error as Error).message);
              });
              throw error;
            }
          },

          verifyMFA: async (code: string) => {
            const state = get();
            
            if (!state.tokens?.accessToken) {
              throw new Error('Not authenticated');
            }

            try {
              const response = await fetch('/api/auth/mfa/verify', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${state.tokens.accessToken}`,
                },
                body: JSON.stringify({ code }),
              });

              return response.ok;

            } catch (error) {
              return false;
            }
          },

          generateBackupCodes: async () => {
            const state = get();
            
            if (!state.tokens?.accessToken) {
              throw new Error('Not authenticated');
            }

            try {
              const response = await fetch('/api/auth/mfa/backup-codes', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${state.tokens.accessToken}`,
                },
              });

              if (!response.ok) {
                throw new Error('Backup codes generation failed');
              }

              const data = await response.json();

              set((draft) => {
                draft.mfaBackupCodes = data.backupCodes;
              });

              return data.backupCodes;

            } catch (error) {
              set((draft) => {
                draft.lastError = error as Error;
                draft.authErrors.set('backup_codes', (error as Error).message);
              });
              throw error;
            }
          },

          checkPermission: (permission: string) => {
            const state = get();
            return state.permissions.has(permission);
          },

          checkRole: (role: string) => {
            const state = get();
            return state.roles.has(role);
          },

          clearErrors: () => {
            set((draft) => {
              draft.lastError = null;
              draft.authErrors.clear();
            });
          },

          validateSession: async () => {
            const state = get();
            
            if (!state.session || !state.tokens) {
              return false;
            }

            // Check if session is expired
            if (new Date() > state.session.expiresAt) {
              try {
                await state.refreshTokens();
                return true;
              } catch {
                await state.logout();
                return false;
              }
            }

            // Update last activity
            set((draft) => {
              if (draft.session) {
                draft.session.lastActivity = new Date();
              }
            });

            return true;
          },
        }))
      ),
      {
        name: 'auth-store',
        storage: createJSONStorage(() => createEncryptedStorage()),
        partialize: (state) => ({
          user: state.user,
          session: state.session,
          tokens: state.tokens,
          wallet: state.wallet,
          permissions: Array.from(state.permissions),
          roles: Array.from(state.roles),
        }),
        onRehydrateStorage: () => (state) => {
          if (state) {
            // Restore Sets from arrays
            state.permissions = new Set(state.permissions as any);
            state.roles = new Set(state.roles as any);
            
            // Validate session on rehydration
            state.validateSession();
          }
        },
      }
    ),
    {
      name: 'auth-store',
    }
  )
);

// Auto-refresh tokens before expiry
setInterval(() => {
  const state = useAuthStore.getState();
  if (state.isAuthenticated && state.tokens) {
    const expiresIn = state.tokens.expiresAt - Date.now();
    // Refresh if token expires in less than 5 minutes
    if (expiresIn < 5 * 60 * 1000) {
      state.refreshTokens().catch(() => {
        // Auto-logout on refresh failure
        state.logout();
      });
    }
  }
}, 60000); // Check every minute
