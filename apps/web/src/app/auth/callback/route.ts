import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * OAuth landing point (PKCE flow).
 *
 * Google -> GoTrue -> here with `?code=...`. The code is exchanged for a
 * session server-side, which sets the auth cookies, then the user continues to
 * wherever they were headed.
 *
 * Deliberately outside the [locale] segment and excluded from the middleware
 * matcher: it must run exactly once, without locale redirects consuming the
 * one-time code.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');

  // Same-origin paths only — an absolute URL here would be an open redirect.
  const destination = next?.startsWith('/') ? next : '/ar/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(destination, url.origin));
    }
  }

  // Missing or stale code (e.g. refresh on this URL): back to login rather
  // than an error page — the fix for the user is simply to try again.
  return NextResponse.redirect(new URL('/ar/login', url.origin));
}
