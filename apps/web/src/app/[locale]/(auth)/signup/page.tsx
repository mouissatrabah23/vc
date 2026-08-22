import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SignupForm } from '@/components/auth/signup-form';
import { GoogleButton } from '@/components/auth/google-button';
import { Link } from '@/i18n/routing';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.signup' });
  return { title: t('title') };
}

export default async function SignupPage({
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

  const safeRedirect = redirectTo?.startsWith('/') ? redirectTo : undefined;

  return (
    <div className="space-y-7">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">{t('signup.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('signup.subtitle')}</p>
      </header>

      <SignupForm locale={locale} redirectTo={safeRedirect} />

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t('divider')}
        <span className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton locale={locale} redirectTo={safeRedirect} />

      <p className="text-center text-sm text-muted-foreground">
        {t('signup.hasAccount')}{' '}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          {t('signup.loginLink')}
        </Link>
      </p>
    </div>
  );
}
