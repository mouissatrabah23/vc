import { getTranslations, setRequestLocale } from 'next-intl/server';

import { LoginForm } from '@/components/auth/login-form';
import { GoogleButton } from '@/components/auth/google-button';
import { Link } from '@/i18n/routing';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.login' });
  return { title: t('title') };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { locale } = await params;
  const { redirectTo } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  // Only ever redirect within our own origin: a full URL here would let a
  // crafted link bounce a freshly signed-in user to an attacker's site.
  const safeRedirect = redirectTo?.startsWith('/') ? redirectTo : undefined;

  return (
    <div className="space-y-7">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">{t('login.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('login.subtitle')}</p>
      </header>

      <LoginForm locale={locale} redirectTo={safeRedirect} />

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t('divider')}
        <span className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton locale={locale} redirectTo={safeRedirect} />

      <p className="text-center text-sm text-muted-foreground">
        {t('login.noAccount')}{' '}
        <Link href="/signup" className="font-semibold text-primary hover:underline">
          {t('login.signupLink')}
        </Link>
      </p>
    </div>
  );
}
