import { ArrowRight, Database, Server, Workflow } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Placeholder landing page. It exists to prove the toolchain is wired end to
// end: Tailwind tokens, a shadcn component, lucide icons, and the workspace
// alias `@/*`. Replace it with the real product surface.

const workspaces = [
  {
    name: 'apps/web',
    description: 'Next.js App Router, Tailwind and shadcn/ui. You are looking at it.',
    icon: Workflow,
  },
  {
    name: 'apps/api',
    description: 'Express REST API. Owns HTTP, auth and Chargily; enqueues work.',
    icon: Server,
  },
  {
    name: 'apps/worker',
    description: 'BullMQ consumer. Runs krillinai-cli inside a sandboxed container.',
    icon: Database,
  },
];

export default function HomePage() {
  return (
    <main className="container flex min-h-screen flex-col justify-center gap-10 py-16">
      <header className="space-y-4">
        <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
          Scaffolding stage
        </span>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">SaaS Platform</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          A pnpm + Turborepo monorepo with three applications and two shared packages. No business
          logic yet — the structure, contracts and local dev loop are in place.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button>
            Get started
            <ArrowRight />
          </Button>
          <Button variant="outline">Read the README</Button>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {workspaces.map((workspace) => (
          <Card key={workspace.name}>
            <CardHeader>
              <workspace.icon className="mb-2 size-5 text-muted-foreground" />
              <CardTitle className="font-mono text-sm">{workspace.name}</CardTitle>
              <CardDescription>{workspace.description}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Shared contracts live in <code className="font-mono">@saas/types</code>.
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
