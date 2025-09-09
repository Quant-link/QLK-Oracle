/**
 * @fileoverview Dashboard Content wrapper component
 * @author QuantLink Team
 * @version 1.0.0
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface DashboardContentProps {
  children: React.ReactNode;
  className?: string;
}

export function DashboardContent({ children, className }: DashboardContentProps) {
  return (
    <div className={cn('space-y-8', className)}>
      {children}
    </div>
  );
}
