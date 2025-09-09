/**
 * @fileoverview Root Layout with theme provider and global providers
 * @author QuantLink Team
 * @version 1.0.0
 */

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { WebSocketProvider } from '@/components/providers/websocket-provider';
import { ToastProvider } from '@/components/providers/toast-provider';
import { ServiceWorkerProvider } from '@/components/providers/service-worker-provider';
import { ErrorBoundary } from '@/components/error-boundary';
import { SkipLink } from '@/components/accessibility/skip-link';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
});

export const metadata: Metadata = {
  title: {
    default: 'QuantLink Oracle Dashboard',
    template: '%s | QuantLink Oracle Dashboard',
  },
  description: 'Production-ready enterprise dashboard for QuantLink Oracle with real-time data monitoring and analytics.',
  keywords: [
    'QuantLink',
    'Oracle',
    'Dashboard',
    'Real-time',
    'Analytics',
    'Blockchain',
    'DeFi',
    'CEX',
    'DEX',
    'Trading',
  ],
  authors: [{ name: 'QuantLink Team' }],
  creator: 'QuantLink',
  publisher: 'QuantLink',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: '/',
    title: 'QuantLink Oracle Dashboard',
    description: 'Production-ready enterprise dashboard for QuantLink Oracle with real-time data monitoring and analytics.',
    siteName: 'QuantLink Oracle Dashboard',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'QuantLink Oracle Dashboard',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'QuantLink Oracle Dashboard',
    description: 'Production-ready enterprise dashboard for QuantLink Oracle with real-time data monitoring and analytics.',
    images: ['/og-image.png'],
    creator: '@quantlink',
  },
  robots: {
    index: process.env.NODE_ENV === 'production',
    follow: process.env.NODE_ENV === 'production',
    googleBot: {
      index: process.env.NODE_ENV === 'production',
      follow: process.env.NODE_ENV === 'production',
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: process.env.GOOGLE_VERIFICATION_ID,
  },
  category: 'technology',
  classification: 'Business',
  referrer: 'origin-when-cross-origin',
  generator: 'Next.js',
  applicationName: 'QuantLink Oracle Dashboard',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'QuantLink Oracle',
  },
  other: {
    'msapplication-TileColor': '#000000',
    'theme-color': '#000000',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
  colorScheme: 'light dark',
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html 
      lang="en" 
      className={inter.variable}
      suppressHydrationWarning
    >
      <head>
        {/* Preload critical resources */}
        <link
          rel="preload"
          href="/fonts/inter-var.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        
        {/* DNS prefetch for external resources */}
        <link rel="dns-prefetch" href="//fonts.googleapis.com" />
        <link rel="dns-prefetch" href="//fonts.gstatic.com" />
        
        {/* Preconnect to critical third-party origins */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        
        {/* Favicon and app icons */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        
        {/* Security headers */}
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta httpEquiv="X-Frame-Options" content="DENY" />
        <meta httpEquiv="X-XSS-Protection" content="1; mode=block" />
        <meta httpEquiv="Referrer-Policy" content="strict-origin-when-cross-origin" />
        <meta httpEquiv="Permissions-Policy" content="camera=(), microphone=(), geolocation=()" />
        
        {/* Performance hints */}
        <meta httpEquiv="Accept-CH" content="DPR, Viewport-Width, Width" />
        
        {/* Critical CSS for above-the-fold content */}
        <style dangerouslySetInnerHTML={{
          __html: `
            /* Critical CSS for initial render */
            body { 
              font-family: var(--font-inter), system-ui, sans-serif;
              background-color: hsl(var(--background));
              color: hsl(var(--foreground));
              margin: 0;
              padding: 0;
              overflow-x: hidden;
            }
            
            /* Loading state */
            .loading-skeleton {
              background: linear-gradient(90deg, 
                hsl(var(--muted)) 25%, 
                hsl(var(--muted-foreground) / 0.1) 50%, 
                hsl(var(--muted)) 75%
              );
              background-size: 200% 100%;
              animation: loading 1.5s infinite;
            }
            
            @keyframes loading {
              0% { background-position: 200% 0; }
              100% { background-position: -200% 0; }
            }
            
            /* Prevent layout shift */
            .dashboard-container {
              min-height: 100vh;
              display: flex;
              flex-direction: column;
            }
            
            /* Focus management */
            .focus-visible {
              outline: 2px solid hsl(var(--ring));
              outline-offset: 2px;
            }
            
            /* Reduced motion */
            @media (prefers-reduced-motion: reduce) {
              *, *::before, *::after {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
                scroll-behavior: auto !important;
              }
            }
          `
        }} />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        {/* Skip to main content link for accessibility */}
        <SkipLink />
        
        {/* Error boundary for the entire application */}
        <ErrorBoundary>
          {/* Theme provider for dark/light mode */}
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange={false}
          >
            {/* Service worker provider for offline functionality */}
            <ServiceWorkerProvider>
              {/* Authentication provider */}
              <AuthProvider>
                {/* WebSocket provider for real-time data */}
                <WebSocketProvider>
                  {/* Toast notifications provider */}
                  <ToastProvider>
                    <div className="dashboard-container">
                      {/* Main application content */}
                      <main id="main-content" className="flex-1">
                        {children}
                      </main>
                      
                      {/* Global loading indicator */}
                      <div 
                        id="global-loading" 
                        className="fixed top-0 left-0 w-full h-1 bg-primary z-50 transform -translate-x-full transition-transform duration-300"
                        aria-hidden="true"
                      />
                      
                      {/* Connection status indicator */}
                      <div 
                        id="connection-status"
                        className="fixed bottom-4 right-4 z-40"
                        role="status"
                        aria-live="polite"
                      />
                      
                      {/* Accessibility announcements */}
                      <div 
                        id="a11y-announcements"
                        className="sr-only"
                        aria-live="assertive"
                        aria-atomic="true"
                      />
                    </div>
                  </ToastProvider>
                </WebSocketProvider>
              </AuthProvider>
            </ServiceWorkerProvider>
          </ThemeProvider>
        </ErrorBoundary>
        
        {/* Performance monitoring script */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Web Vitals monitoring
              if ('PerformanceObserver' in window) {
                // Monitor Largest Contentful Paint
                new PerformanceObserver((list) => {
                  for (const entry of list.getEntries()) {
                    if (entry.entryType === 'largest-contentful-paint') {
                      console.log('LCP:', entry.startTime);
                    }
                  }
                }).observe({ entryTypes: ['largest-contentful-paint'] });
                
                // Monitor First Input Delay
                new PerformanceObserver((list) => {
                  for (const entry of list.getEntries()) {
                    if (entry.entryType === 'first-input') {
                      console.log('FID:', entry.processingStart - entry.startTime);
                    }
                  }
                }).observe({ entryTypes: ['first-input'] });
                
                // Monitor Cumulative Layout Shift
                new PerformanceObserver((list) => {
                  let clsValue = 0;
                  for (const entry of list.getEntries()) {
                    if (!entry.hadRecentInput) {
                      clsValue += entry.value;
                    }
                  }
                  console.log('CLS:', clsValue);
                }).observe({ entryTypes: ['layout-shift'] });
              }
              
              // Connection monitoring
              if ('navigator' in window && 'connection' in navigator) {
                const connection = navigator.connection;
                console.log('Network:', {
                  effectiveType: connection.effectiveType,
                  downlink: connection.downlink,
                  rtt: connection.rtt,
                  saveData: connection.saveData
                });
              }
              
              // Memory monitoring
              if ('memory' in performance) {
                console.log('Memory:', {
                  used: Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB',
                  total: Math.round(performance.memory.totalJSHeapSize / 1048576) + ' MB',
                  limit: Math.round(performance.memory.jsHeapSizeLimit / 1048576) + ' MB'
                });
              }
            `
          }}
        />
        
        {/* Development tools */}
        {process.env.NODE_ENV === 'development' && (
          <script
            dangerouslySetInnerHTML={{
              __html: `
                // Development helpers
                window.__QUANTLINK_DEBUG__ = {
                  version: '1.0.0',
                  environment: 'development',
                  features: {
                    websocket: true,
                    protobuf: true,
                    serviceWorker: true,
                    authentication: true
                  }
                };
                
                // Console styling
                console.log(
                  '%cQuantLink Oracle Dashboard%c\\nDevelopment Mode',
                  'color: #000; font-size: 16px; font-weight: bold; background: #fff; padding: 4px 8px; border-radius: 4px;',
                  'color: #666; font-size: 12px; margin-top: 4px;'
                );
              `
            }}
          />
        )}
      </body>
    </html>
  );
}
