import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

// next/font self-hosts the font at build time — no runtime request to Google,
// no layout shift, and it keeps the CSP simple.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'SaaS Platform',
    template: '%s · SaaS Platform',
  },
  description: 'Media processing SaaS — scaffolding.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} min-h-screen font-sans antialiased`}>{children}</body>
    </html>
  );
}
