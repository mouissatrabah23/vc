'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

/** Google's mark. Inline so the button has no external asset dependency. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-[18px]" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * Google OAuth entry point.
 *
 * An additional option, never a replacement: the email/password form stays the
 * primary path. Many users in the target market do not have a Google account
 * tied to the address they want to bill.
 */
export function GoogleButton({ redirectTo, locale }: { redirectTo?: string; locale: string }) {
  const t = useTranslations('auth.google');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    try {
      const supabase = createClient();
      const callback = new URL('/auth/callback', window.location.origin);
      callback.searchParams.set('next', redirectTo ?? `/${locale}/dashboard`);

      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callback.toString() },
      });

      // On success the browser navigates away, so reaching here means it failed
      // — most often because the provider is not configured. Surfacing GoTrue's
      // reason beats a button that silently does nothing.
      if (err) {
        setError(t('disabled'));
        setPending(false);
      }
    } catch {
      setError(t('disabled'));
      setPending(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="outline"
        onClick={signIn}
        disabled={pending}
        className="h-11 w-full gap-2.5 border-input bg-card font-medium hover:bg-secondary"
      >
        <GoogleMark />
        {t('continue')}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-muted-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
