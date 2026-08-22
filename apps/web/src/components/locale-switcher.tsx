'use client';

import { useLocale } from 'next-intl';

import { routing, localeLabel, usePathname, useRouter } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * Minimal language toggle. With two locales a segmented control beats a
 * dropdown: both options stay visible, and each is written in its own script
 * so it is findable by someone who cannot read the current one.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const active = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5 text-xs',
        className,
      )}
      role="group"
      aria-label="Language"
    >
      {routing.locales.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => router.replace(pathname, { locale })}
          aria-pressed={locale === active}
          className={cn(
            'rounded-full px-2.5 py-1 font-medium transition-colors',
            locale === active
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {localeLabel[locale]}
        </button>
      ))}
    </div>
  );
}
