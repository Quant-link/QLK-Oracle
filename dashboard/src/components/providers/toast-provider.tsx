/**
 * @fileoverview Toast Provider for notifications
 * @author QuantLink Team
 * @version 1.0.0
 */

'use client';

import React from 'react';

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  return (
    <>
      {children}
      <div id="toast-container" className="fixed bottom-4 right-4 z-50 space-y-2" />
    </>
  );
}
