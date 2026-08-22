import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowLeft, ArrowRight, Captions, Mic2, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Link, localeDirection, type Locale } from '@/i18n/routing';
import { LocaleSwitcher } from '@/components/locale-switcher';

/**
 * Public landing page. Deliberately thin at this phase — its job is to route
 * visitors into the auth flow; the marketing surface comes later.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const rtl = localeDirection[locale as Locale] === 'rtl';
  const Arrow = rtl ? ArrowLeft : ArrowRight;

  const features = [
    { icon: Captions, label: t('brand.feature_subtitles') },
    { icon: Mic2, label: t('brand.feature_dubbing') },
    { icon: Wallet, label: t('brand.feature_pricing') },
  ];

  return (
    <main className="relative flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-4 sm:px-10">
        <span className="text-xl font-bold tracking-tight text-primary">{t('brand.name')}</span>
        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">{t('auth.login.title')}</Link>
          </Button>
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-24 text-center">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">
            {t('brand.tagline')}
          </p>
          <h1 className="mx-auto max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            {t('brand.pitch')}
          </h1>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
          {features.map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-2">
              <Icon className="size-4 text-primary" aria-hidden />
              {label}
            </span>
          ))}
        </div>

        <Button asChild size="lg" className="h-12 px-8 text-base">
          <Link href="/signup">
            {t('auth.signup.title')}
            <Arrow />
          </Link>
        </Button>
      </section>
    </main>
  );
}
