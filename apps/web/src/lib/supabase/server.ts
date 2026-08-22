import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Server-side Supabase client, for server components, route handlers and
 * server actions.
 *
 * The cookie adapter is where the subtlety lives. Server Components may READ
 * cookies but may not SET them — Next throws if you try. Supabase wants to
 * write refreshed tokens back, so `setAll` swallows that specific failure: the
 * refresh still happened in memory for this render, and middleware (which CAN
 * set cookies) persists it on the next request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase server client is missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY');
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component, which cannot mutate cookies.
          // Safe to ignore: middleware refreshes the session on every request.
        }
      },
    },
  });
}
