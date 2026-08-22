import { NextResponse, type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { createServerClient } from '@supabase/ssr';
import { routing } from '@/i18n/routing';

/**
 * One middleware doing two jobs, in a deliberate order.
 *
 * 1. next-intl resolves the locale and may redirect (`/dashboard` -> `/ar/dashboard`).
 * 2. Supabase refreshes the session, writing cookies onto that same response.
 *
 * The order matters: if auth ran first, the intl redirect would create a fresh
 * response and discard the refreshed cookies, logging users out roughly every
 * hour when the access token expired.
 */
const intlMiddleware = createIntlMiddleware(routing);

/** Path segments that require a session, checked after the locale prefix. */
const PROTECTED_SEGMENTS = ['dashboard'];

/** Auth pages a signed-in user should be bounced away from. */
const AUTH_SEGMENTS = ['login', 'signup'];

function segmentsAfterLocale(pathname: string): string[] {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length > 0 && (routing.locales as readonly string[]).includes(parts[0]!)) {
    return parts.slice(1);
  }
  return parts;
}

function localeOf(pathname: string): string {
  const first = pathname.split('/').filter(Boolean)[0];
  return first && (routing.locales as readonly string[]).includes(first)
    ? first
    : routing.defaultLocale;
}

export async function middleware(request: NextRequest) {
  const response = intlMiddleware(request);

  // A redirect/rewrite from intl still carries cookies, so the session refresh
  // below attaches to whatever response we end up returning.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // getUser(), not getSession(): this decision gates access, so the token must
  // be validated rather than merely decoded from a cookie the client controls.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const locale = localeOf(pathname);
  const segments = segmentsAfterLocale(pathname);
  const first = segments[0];

  if (first && PROTECTED_SEGMENTS.includes(first) && !user) {
    const login = new URL(`/${locale}/login`, request.url);
    // Preserve the destination so sign-in can return the user where they were
    // headed instead of dumping everyone on the dashboard root.
    login.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(login);
  }

  if (first && AUTH_SEGMENTS.includes(first) && user) {
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url));
  }

  return response;
}

export const config = {
  /**
   * Skip Next internals, the auth callback route (it must run its own code to
   * exchange the OAuth code), and anything that looks like a static file.
   * Running auth checks on every image request would be pure latency.
   */
  matcher: ['/((?!api|_next|_vercel|auth/callback|.*\\..*).*)'],
};
