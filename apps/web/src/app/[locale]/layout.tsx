import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Inter, IBM_Plex_Sans_Arabic } from 'next/font/google';

import { routing, localeDirection, type Locale } from '@/i18n/routing';
import '../globals.css';

// Latin UI font. Self-hosted at build time by next/font — no runtime request.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

// Arabic UI font. IBM Plex Sans Arabic is designed for interfaces (clear at
// small sizes, true bold weights) rather than being a naskh display face —
// Arabic set in a default system font is the fastest way for an RTL app to
// look unfinished.
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'صوتك — Sawtak',
    template: '%s · Sawtak',
  },
  description: 'AI video translation and dubbing — Arabic, French, English.',
};

// Pre-render both locales at build time.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const dir = localeDirection[locale as Locale];
  // The whole document takes the locale's script font; Latin fragments inside
  // Arabic text (emails, URLs) fall back through Plex Arabic's Latin glyphs.
  const font = locale === 'ar' ? plexArabic : inter;

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className={`${font.className} min-h-screen antialiased`}>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
