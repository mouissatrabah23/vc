import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Coins, Mail, ShieldCheck, CalendarDays } from 'lucide-react';

import { getServerUser, getServerAccessToken } from '@/lib/auth/get-server-user';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { LocaleSwitcher } from '@/components/locale-switcher';

interface MePayload {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    createdAt: string;
    provider?: string;
  };
  wallet: { id: string; balanceCredits: string; updatedAt: string } | null;
}

/**
 * Fetches the caller's profile and wallet from our own API.
 *
 * The access token is forwarded as a bearer credential; the API verifies its
 * signature and reads the rows inside that user's RLS context. So this page
 * renders data the *database* decided the user may see, rather than data the
 * web tier selected on their behalf.
 */
async function fetchMe(): Promise<MePayload | null> {
  const token = await getServerAccessToken();
  if (!token) return null;

  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${base}/api/v1/me`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok: boolean; data: MePayload };
    return body.ok ? body.data : null;
  } catch {
    // API down: the page still renders the session-derived identity below.
    return null;
  }
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Middleware already gated this route; this is defence in depth. If the
  // matcher is ever edited, the page still refuses to render for a stranger.
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);

  const t = await getTranslations('dashboard');
  const me = await fetchMe();

  const displayName = me?.user.fullName ?? user.fullName ?? user.email?.split('@')[0] ?? '';
  const balance = me?.wallet?.balanceCredits ?? null;
  const memberSince = me?.user.createdAt ?? null;

  const facts = [
    { icon: Mail, label: t('accountEmail'), value: me?.user.email ?? user.email ?? '—', ltr: true },
    {
      icon: ShieldCheck,
      label: t('accountProvider'),
      value: me?.user.provider ?? user.provider ?? '—',
      ltr: true,
    },
    {
      icon: CalendarDays,
      label: t('memberSince'),
      value: memberSince
        ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-DZ' : 'fr-DZ', {
            dateStyle: 'long',
          }).format(new Date(memberSince))
        : '—',
      ltr: false,
    },
  ];

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold tracking-tight text-primary">صوتك</span>
          <div className="flex items-center gap-3">
            <LocaleSwitcher />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('welcome', { name: displayName })}</p>
        </div>

        {/* Credit balance — the one number that matters most, so it gets the
            accent colour and the largest type on the page. */}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center gap-4 p-6">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
              <Coins className="size-6" aria-hidden />
            </span>
            <div>
              <p className="text-sm text-muted-foreground">{t('balance')}</p>
              {balance !== null ? (
                <p className="text-3xl font-bold tracking-tight">
                  <span className="numeric">{balance}</span>{' '}
                  <span className="text-base font-medium text-muted-foreground">
                    {t('credits')}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-destructive">
                  {me ? t('walletMissing') : t('apiUnreachable')}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          {facts.map(({ icon: Icon, label, value, ltr }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Icon className="size-3.5" aria-hidden />
                {label}
              </p>
              <p
                className={`mt-1.5 truncate text-sm font-medium ${ltr ? 'numeric' : ''}`}
                title={value}
              >
                {value}
              </p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
