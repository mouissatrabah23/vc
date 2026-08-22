import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

/**
 * Algeria is bilingual in practice: Arabic is official, French is widespread in
 * business and technical contexts. Arabic is the default rather than a
 * translation of an English original — the UI is written Arabic-first, which is
 * why `localePrefix` is 'always'. A bare `/login` would otherwise be ambiguous
 * about direction, and RTL is not something to resolve after first paint.
 */
export const routing = defineRouting({
  locales: ['ar', 'fr'],
  defaultLocale: 'ar',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

/** Text direction per locale. Drives <html dir> and RTL-aware layout. */
export const localeDirection: Record<Locale, 'rtl' | 'ltr'> = {
  ar: 'rtl',
  fr: 'ltr',
};

/** Endonyms — a language switcher should name languages in their own script. */
export const localeLabel: Record<Locale, string> = {
  ar: 'العربية',
  fr: 'Français',
};

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
