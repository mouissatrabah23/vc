'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client.
 *
 * Uses @supabase/ssr rather than the plain createClient so the session is
 * persisted in cookies instead of localStorage. That is what lets middleware
 * and server components read the session at all — a localStorage session is
 * invisible to the server, which would make route protection impossible
 * without a client-side flash.
 *
 * Only the anon key is used here. It is public by design: every table is behind
 * Row Level Security, and privileged work happens in the API behind a verified
 * JWT.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Fail loudly at the call site. A misconfigured client otherwise surfaces
    // as an opaque "Failed to fetch" on the login form.
    throw new Error(
      'Supabase browser client is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
  }

  return createBrowserClient(url, anonKey);
}
