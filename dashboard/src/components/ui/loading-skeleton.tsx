/**
 * @fileoverview Loading Skeleton component
 * @author QuantLink Team
 * @version 1.0.0
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface LoadingSkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: boolean;
}

export function LoadingSkeleton({ 
  className, 
  width, 
  height, 
  rounded = true 
}: LoadingSkeletonProps) {
  return (
    <div
      className={cn(
        'loading-skeleton',
        rounded && 'rounded',
        className
      )}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
      aria-hidden="true"
    />
  );
}
