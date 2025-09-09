/**
 * @fileoverview Dashboard Shell layout component
 * @author QuantLink Team
 * @version 1.0.0
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface DashboardShellProps {
  children: React.ReactNode;
  className?: string;
}

export function DashboardShell({ children, className }: DashboardShellProps) {
  return (
    <div className={cn('min-h-screen bg-background', className)}>
      <div className="container mx-auto px-4 py-6 space-y-6">
        {children}
      </div>
    </div>
  );
}
