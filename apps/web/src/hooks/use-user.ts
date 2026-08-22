'use client';

import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

export interface UseUserResult {
  user: User | null;
  /** True until the first resolution. Render skeletons on this, not on `!user`. */
  loading: boolean;
  error: Error | null;
  signOut: () => Promise<void>;
}

/**
 * Client-side session hook.
 *
 * Subscribes to `onAuthStateChange` rather than fetching once, so a sign-out in
 * another tab, a token refresh, or the OAuth redirect all propagate without a
 * reload.
 *
 * This is for RENDERING only. Never gate anything that matters on it — a
 * client hook is trivially manipulated. Route protection lives in middleware
 * and every privileged read is authorised server-side by the API.
 */
export function useUser(): UseUserResult {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth
      .getUser()
      .then(({ data, error: err }) => {
        if (!active) return;
        // "no session" is not an error state; it is simply signed out.
        if (err && err.name !== 'AuthSessionMissingError') setError(err);
        setUser(data.user ?? null);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Full reload rather than router.push: it clears every cached server
    // component payload, so no stale personalised markup survives the sign-out.
    window.location.assign('/');
  }, []);

  return { user, loading, error, signOut };
}
