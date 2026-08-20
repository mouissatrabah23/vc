import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

// Next.js only reads .env files inside the app directory. Loading the repo-root
// .env here — before the config object is evaluated — keeps a single source of
// truth for the whole monorepo. It runs early enough that NEXT_PUBLIC_* values
// are still inlined into the client bundle at build time.
// `override: false` so real environment variables (CI, hosting) always win.
loadDotenv({ path: path.join(repoRoot, '.env'), override: false });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Only what the browser is allowed to know. Server-only secrets are read
  // through process.env in server components / route handlers instead.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  },

  // Standalone emits a minimal self-contained server bundle for Docker. It is
  // opt-in because the trace step creates symlinks, which Windows refuses
  // without Developer Mode or an elevated shell — it would break `pnpm build`
  // on a stock Windows machine for a benefit only the container image needs.
  //
  //   NEXT_OUTPUT_STANDALONE=true pnpm --filter @saas/web build
  ...(process.env.NEXT_OUTPUT_STANDALONE === 'true' ? { output: 'standalone' } : {}),

  // File tracing must start at the workspace root or pnpm's symlinked
  // node_modules layout makes Next miss transitive dependencies.
  outputFileTracingRoot: repoRoot,

  eslint: {
    // Lint is a separate CI step (`pnpm lint`); do not pay for it twice.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
