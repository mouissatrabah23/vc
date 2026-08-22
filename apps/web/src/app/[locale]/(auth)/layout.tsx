import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Captions, Mic2, Wallet } from 'lucide-react';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { Link } from '@/i18n/routing';

/**
 * Auth shell: brand panel + form column.
 *
 * The brand panel carries the visual identity (deep teal, grid texture, the
 * product pitch) so the form column can stay quiet — inputs on a calm surface,
 * nothing competing with the primary action. On mobile the panel collapses to
 * a slim header; nobody signs up on a phone to admire a mural.
 *
 * Under RTL the flex order flips automatically, which is exactly right: the
 * brand panel leads in reading order in both directions.
 */
export default async function AuthLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('brand');

  const features = [
    { icon: Captions, label: t('feature_subtitles') },
    { icon: Mic2, label: t('feature_dubbing') },
    { icon: Wallet, label: t('feature_pricing') },
  ];

  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel */}
      <aside className="relative flex flex-col justify-between overflow-hidden bg-primary px-8 py-6 text-primary-foreground lg:w-[44%] lg:px-12 lg:py-10">
        <div className="brand-grid pointer-events-none absolute inset-0" aria-hidden />
        {/* Radial glow anchoring the wordmark corner */}
        <div
          className="pointer-events-none absolute -top-32 start-[-8rem] size-96 rounded-full bg-primary-foreground/10 blur-3xl"
          aria-hidden
        />

        <div className="relative z-10 flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold tracking-tight">
            {t('name')}
          </Link>
          <LocaleSwitcher className="border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground [&_button[aria-pressed=true]]:bg-primary-foreground [&_button[aria-pressed=true]]:text-primary" />
        </div>

        <div className="relative z-10 hidden space-y-8 lg:block">
          <div className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">
              {t('tagline')}
            </p>
            <p className="max-w-md text-2xl font-semibold leading-snug">{t('pitch')}</p>
          </div>

          <ul className="space-y-3 text-sm text-primary-foreground/85">
            {features.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-md bg-primary-foreground/12">
                  <Icon className="size-4" aria-hidden />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        {/* Spacer keeps the wordmark pinned top on mobile without the feature list */}
        <div className="lg:hidden" />
      </aside>

      {/* Form column */}
      <section className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[380px]">{children}</div>
      </section>
    </main>
  );
}
