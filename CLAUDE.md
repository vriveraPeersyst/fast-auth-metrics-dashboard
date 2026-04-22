# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Next.js version warning

This project uses **Next.js 16.2.4 + React 19.2.4** — APIs, conventions, and file layout may differ from older Next.js knowledge. Before writing routing, data-fetching, or config code, read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices.

## Commands

Package manager is **pnpm 10** (declared in `package.json`'s `packageManager`). Use pnpm, not npm or yarn.

```bash
pnpm dev                       # Next.js dev server on :3000
pnpm build                     # Production build (output: standalone)
pnpm start                     # Run built app
pnpm lint                      # ESLint (flat config, eslint-config-next)

pnpm prisma:generate           # Regenerate Prisma client after schema.prisma edits
pnpm prisma migrate dev --name <name>    # Local dev migration
pnpm prisma:migrate            # `prisma migrate deploy` — for Railway / prod
pnpm prisma:studio             # Browse the DB

pnpm indexers:run              # One-shot run of all indexers, then exit
pnpm indexers:worker           # Long-running poll loop (production mode)
pnpm indexers:trigger          # Send signed HMAC POST to /api/indexers/run
pnpm indexers:trigger:dry      # Preview the signed request without sending
```

There is no test runner configured — do not invent `pnpm test`.

All indexer scripts are executed via `tsx` (see `src/scripts/*.ts`). They call `dotenv/config` at the top, so they read `.env` directly and do **not** need Next.js runtime.

## Architecture

Two services run from the **same repo and same Prisma schema**:

1. **Web dashboard** (`pnpm dev` / `pnpm start`) — Next.js App Router UI at `src/app/`. Server component `src/app/page.tsx` calls `getDashboardData()` which reads from pre-computed marts in Postgres. No client-side data fetching for KPIs.
2. **Indexer worker** (`pnpm indexers:worker`) — pure Node process (`src/scripts/indexer-worker.ts`) that loops `runAllIndexers()` every `INDEXER_POLL_INTERVAL_MS`. Railway deploys it as a separate service.

### Indexer pipeline (`src/lib/indexers/`)

`run-all.ts` orchestrates the collectors. Order matters:

1. `auth0.ts`, `service-metrics.ts`, `near.ts` run **in parallel** (independent source systems).
2. `tvl.ts` runs **after** `near.ts` — it discovers sponsored accounts from `fastauth_sign_events` rows produced by the NEAR collector.
3. `dashboard-kpis.ts` runs **last** — it rolls up the upstream tables into pre-aggregated marts that the dashboard reads.

Every collector returns `IndexerRunResult` (`src/lib/indexers/types.ts`) with `status: "ok" | "skipped" | "error"`. Collectors must **never throw** out of `runAllIndexers` — wrap failures and return `status: "error"` so one broken source doesn't kill the whole run.

### Crash recovery

All collectors are checkpoint-driven via the `indexer_checkpoints` key/value table. Specifically:

- Auth0 ingestion uses transactional checkpoints so resumption never drops or double-counts logs.
- `near.ts` tracks `near_last_final_block_height`, `near_last_final_block_hash`, and `near_last_scanned_height`; on each run it backfills from the last scanned height up to latest final, respecting `NEAR_MAX_BLOCKS_PER_RUN`.
- Service-metric collectors also persist `*_delta` samples so counter growth is preserved across downtime.

When editing collectors, preserve this checkpoint-first design — do not substitute in-memory state.

### NEAR RPC split

Two RPC endpoints with different roles (enforced at runtime):

- `NEAR_RPC_URL` — normal RPC for latest-final polling.
- `NEAR_ARCHIVAL_RPC_URL` — archival RPC for historical backfill queries.

See `FASTNEAR_RPC_LIMITS_RUNBOOK.md` for rate-limiting rules (treat 429/5xx as backpressure; scale conservatively).

### Auth

Closed to a single Google hosted-domain (default `peersyst.org`). The domain check happens in three places — all must stay consistent if you touch auth:

- `src/lib/auth.ts` — NextAuth `signIn` callback (email-ends-with-domain OR Google `hd` claim; also requires `email_verified`).
- `src/proxy.ts` — **this repo's middleware file is `src/proxy.ts`, not `middleware.ts`**. It runs `withAuth` and blocks non-domain tokens on every path except `api`, static assets, and `/sign-in`.
- `src/app/page.tsx` — server-side re-check before rendering, in case a token is stale.

### Signed indexer trigger

`POST /api/indexers/run` is an HMAC-gated fallback for environments without a long-running worker. The signature format is `HMAC-SHA256(INDEXER_CRON_SECRET, "${ts}:${pathname}")`, with a 5-minute timestamp skew window and optional `INDEXER_ALLOWED_IPS` source allowlist. `pnpm indexers:trigger` is the canonical client for this endpoint — use it rather than hand-rolling curl when testing.

### Data tables

Prisma schema in `prisma/schema.prisma`. The models split into **raw ingest** (`auth0_logs`, `service_metrics_timeseries`, `near_transactions`, `account_tvl_daily_snapshots`), **derived sign events** (`fastauth_sign_events` — produced by `near.ts` from raw transactions), **marts** (`relayers`, `relayer_dapps` — rebuilt each NEAR run from sign events), and **checkpoints** (`indexer_checkpoints`). The dashboard reads marts, never raw tables directly for KPIs.

## Conventions

- Path alias `@/*` → `src/*` (`tsconfig.json`). Use it in all internal imports.
- `src/lib/prisma.ts` exports a **singleton** `prisma` — always import from there, never `new PrismaClient()`, to avoid exhausting connections in dev with HMR.
- Collectors accept `prisma` as a parameter (not a module-global import) to make them testable and swappable.
- The `docs/` directory is a **separate Docusaurus sub-project** with its own `package.json` and `node_modules` — excluded from the root `tsconfig.json`. Do not try to build it with the root scripts.
- Security headers (CSP, HSTS, frame-ancestors=none, etc.) are set in `next.config.ts`. If you add third-party origins for scripts/fonts/images, update `connectSrc`/`contentSecurityPolicy` there.
