-- Minimal Supabase compatibility shim for the LOCAL dev cluster only.
--
-- Supabase provides an `auth` schema, an `auth.uid()` helper and the roles
-- anon / authenticated / service_role. Plain Postgres does not, so without this
-- the RLS migration cannot be applied locally and you would only discover
-- broken policies after pointing at a real Supabase project.
--
-- Runs once, when the postgres-data volume is first created. Re-run with:
--   docker compose down -v && docker compose up -d
--
-- NEVER apply this to a real Supabase database — it already has all of it, and
-- CREATE OR REPLACE on auth.uid() would overwrite theirs.

-- ---------------------------------------------------------------------------
-- Roles — cluster-wide, so created once and shared by every database here
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  -- BYPASSRLS mirrors Supabase: the backend's service_role is not subject to
  -- row level security. Policies restrict end users, not our own API.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

GRANT anon, authenticated, service_role TO postgres;

-- ---------------------------------------------------------------------------
-- auth objects in the main development database
-- ---------------------------------------------------------------------------
\echo '>> applying auth shim to saas_dev'
\i /docker-entrypoint-initdb.d/auth-objects.psql

-- ---------------------------------------------------------------------------
-- Shadow database for `prisma migrate dev`
-- ---------------------------------------------------------------------------
-- Prisma replays the full migration history into a throwaway "shadow" database
-- to detect drift. Our RLS migration references auth.users, which would not
-- exist in a database Prisma created from nothing — migrate dev would fail with
-- `schema "auth" does not exist`.
--
-- Pre-creating the shadow database WITH the shim, and pointing
-- shadowDatabaseUrl at it, is the fix Supabase documents for exactly this.
-- Prisma will drop and recreate the *contents*, never the database itself.
CREATE DATABASE saas_shadow OWNER postgres;

\connect saas_shadow
\echo '>> applying auth shim to saas_shadow'
\i /docker-entrypoint-initdb.d/auth-objects.psql
