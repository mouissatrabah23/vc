-- Minimal Supabase compatibility shim for the LOCAL dev database only.
--
-- Supabase provides an `auth` schema, an `auth.uid()` helper and the roles
-- anon / authenticated / service_role. Plain Postgres does not, so without this
-- the RLS migration cannot even be applied locally and you would only discover
-- broken policies after pointing at a real Supabase project.
--
-- Runs once, when the postgres-data volume is first created. Re-run with:
--   docker compose down -v && docker compose up -d
--
-- NEVER apply this to a real Supabase database — it already has all of it.

-- ---------------------------------------------------------------------------
-- Roles (NOLOGIN: assumed via SET ROLE in tests, never connected to directly)
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
-- auth schema
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

-- Only the columns this project actually references. Supabase's real table has
-- many more; adding them here would just invite drift.
CREATE TABLE IF NOT EXISTS auth.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         varchar(320) UNIQUE,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Supabase derives the current user from the request JWT, which PostgREST
-- exposes as the `request.jwt.claims` GUC. Tests set it directly:
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<uuid>"}';
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.jwt.claim.sub', true),
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claim.role', true),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  )
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;
