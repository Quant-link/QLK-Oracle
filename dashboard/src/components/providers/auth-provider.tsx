/**
 * @fileoverview Authentication Provider with session management
 * @author QuantLink Team
 * @version 1.0.0
 */

'use client';

import React, { createContext, useContext, useEffect, useRef } from 'react';
import { useAuthStore } from '@/lib/store/auth-store';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: any;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkPermission: (permission: string) => boolean;
  checkRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const {
    isAuthenticated,
    isLoading,
    user,
    login,
    logout,
    checkPermission,
    checkRole,
    validateSession,
  } = useAuthStore();
  
  const sessionCheckRef = useRef<NodeJS.Timeout>();

  // Validate session on mount and periodically
  useEffect(() => {
    const checkSession = async () => {
      if (isAuthenticated) {
        try {
          await validateSession();
        } catch (error) {
          console.error('Session validation failed:', error);
        }
      }
    };

    // Initial session check
    checkSession();

    // Periodic session validation (every 5 minutes)
    sessionCheckRef.current = setInterval(checkSession, 5 * 60 * 1000);

    return () => {
      if (sessionCheckRef.current) {
        clearInterval(sessionCheckRef.current);
      }
    };
  }, [isAuthenticated, validateSession]);

  const contextValue: AuthContextType = {
    isAuthenticated,
    isLoading,
    user,
    login,
    logout,
    checkPermission,
    checkRole,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}
