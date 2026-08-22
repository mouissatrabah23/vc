-- Supabase compatibility shim for the LOCAL dev cluster only.
--
-- Hosted Supabase gives you an `auth` schema, `auth.uid()`, and the roles
-- anon / authenticated / service_role. Locally we assemble the same surface
-- from parts: GoTrue (the `auth` service in docker-compose) owns auth.users,
-- and this file supplies the roles and the platform helper functions.
--
-- Runs once, when the postgres-data volume is first created. Re-run with:
--   docker compose down -v && docker compose up -d
--
-- NEVER apply this to a real Supabase database.

-- ---------------------------------------------------------------------------
-- Roles — cluster-wide, shared by every database here
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
  -- GoTrue connects as this role on hosted Supabase. Created so the local
  -- setup can move to a least-privilege connection later without a migration.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT CREATEROLE;
  END IF;
END
$$;

GRANT anon, authenticated, service_role, supabase_auth_admin TO postgres;

-- ---------------------------------------------------------------------------
-- saas_dev — helpers only. GoTrue creates auth.users here at startup.
-- ---------------------------------------------------------------------------
\echo '>> saas_dev: auth schema + helper functions (GoTrue owns auth.users)'
\i /docker-entrypoint-initdb.d/auth-common.psql

-- ---------------------------------------------------------------------------
-- saas_shadow — for `prisma migrate dev`
-- ---------------------------------------------------------------------------
-- Prisma replays the full migration history into a throwaway database to
-- detect drift. That database needs auth.users to exist, and GoTrue never
-- touches it, so it gets the stub as well as the helpers.
CREATE DATABASE saas_shadow OWNER postgres;

\connect saas_shadow
\echo '>> saas_shadow: auth schema + helpers + auth.users stub'
\i /docker-entrypoint-initdb.d/auth-common.psql
\i /docker-entrypoint-initdb.d/auth-users-stub.psql
