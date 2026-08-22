import 'server-only';

import { createClient } from '@/lib/supabase/server';

export interface ServerUser {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  provider: string | null;
}

/**
 * The signed-in user for server components, route handlers and server actions.
 * Returns null when nobody is signed in.
 *
 * Uses `getUser()`, NOT `getSession()`. `getSession()` decodes whatever JWT is
 * in the cookie without verifying it, so a forged cookie would be believed.
 * `getUser()` revalidates against the Auth server, which is the difference
 * between a display hint and an authorisation decision.
 */
export async function getServerUser(): Promise<ServerUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

  return {
    id: user.id,
    email: user.email ?? null,
    // Email sign-up sends full_name; Google returns name/full_name plus a picture.
    fullName: str(meta.full_name) ?? str(meta.name),
    avatarUrl: str(meta.avatar_url) ?? str(meta.picture),
    provider: str(user.app_metadata?.provider),
  };
}

/**
 * The raw access token, for calling our own API.
 *
 * The API verifies this signature itself, so unlike `getServerUser` a decoded
 * session is sufficient here — the token is being forwarded, not trusted.
 */
export async function getServerAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
