import { NextResponse } from 'next/server';

// Liveness probe for the web container itself — deliberately does not call the
// Express API, so a backend outage never restarts the front end.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ ok: true, data: { status: 'ok', service: 'web' } });
}
