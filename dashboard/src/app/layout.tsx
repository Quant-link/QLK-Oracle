import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'QuantLink Oracle Dashboard',
  description: 'Enterprise-grade Oracle monitoring and analytics platform',
  keywords: ['oracle', 'blockchain', 'defi', 'quantlink', 'real-time'],
  authors: [{ name: 'QuantLink Team' }],
  creator: 'QuantLink',
  publisher: 'QuantLink',
  robots: 'index, follow',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://oracle.quantlink.io',
    title: 'QuantLink Oracle Dashboard',
    description: 'Enterprise-grade Oracle monitoring and analytics platform',
    siteName: 'QuantLink Oracle',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'QuantLink Oracle Dashboard',
    description: 'Enterprise-grade Oracle monitoring and analytics platform',
    creator: '@quantlink',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#000000',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body className="font-sans antialiased bg-pure-white text-pure-black">
        {children}
      </body>
    </html>
  );
}
