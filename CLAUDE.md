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
pnpm backfill:user-keys        # Backfill derived user public keys from historical sign events
pnpm backfill:range            # Archival-RPC-backed backfill for a block range (gap-filler, one-shot)
pnpm indexer:skip-forward      # Advance the NEAR checkpoint to current chain tip (destructive; requires --confirm)
```

Additional maintenance scripts exist in `src/scripts/` (`inspect-db.ts`, `rebuild-marts.ts`, `wipe-db.ts`) without package.json aliases — run them directly with `pnpm tsx src/scripts/<name>.ts` when needed, and double-check the destructive ones before invoking.

### Gap management

The `missing_block_ranges` table is the source of truth for block ranges that were never indexed (pre-existing history, skip-forwards, etc.). Each row has `startHeight`, `endHeight`, `completedUpTo` / `completedDownTo` (resumable checkpoints for asc/desc walks), and `status: "open" | "closed"`. The dashboard renders this table in the System status section.

Three operational tools interact with it:

- `pnpm indexer:skip-forward` — **destructive**. Advances `near_last_scanned_height` to current chain tip and inserts a new "open" row into `missing_block_ranges` covering the skipped blocks. Use when the live indexer is stuck on pruned chunks and we accept a recent-history hole. Dry-run by default; pass `--confirm` to mutate.
- `pnpm backfill:range` — **additive**. Walks a range using a dedicated archival-RPC pool (separate from the live indexer's public pool). Idempotent via `skipDuplicates`. Supports `--range=START..END` for ad-hoc slices, or `--id=N` (or first open row by default) to resume a `missing_block_ranges` row. Updates the row's checkpoint per batch and marks it `closed` when done. Use `--direction=desc` to walk a range high→low (most recent blocks heal first; most useful for skip-forward gaps).
- `pnpm seed:missing-ranges` — **one-shot migration helper**. Reads any pre-DB `data/missing-block-ranges.json` file and upserts entries into `missing_block_ranges`. Skips rows that already exist. After running this, the JSON file can be deleted.

Historical note: ranges used to live in `data/missing-block-ranges.json`. They were migrated to the DB so progress updates from the backfill service are visible to the dashboard service without a redeploy.

There is no test runner configured — do not invent `pnpm test`.

All indexer scripts are executed via `tsx` (see `src/scripts/*.ts`). They call `dotenv/config` at the top, so they read `.env` directly and do **not** need Next.js runtime.

## Architecture

Two services run from the **same repo and same Prisma schema**:

1. **Web dashboard** (`pnpm dev` / `pnpm start`) — Next.js App Router UI at `src/app/`. Server component `src/app/page.tsx` calls `getDashboardData()` which reads from pre-computed marts in Postgres. No client-side data fetching for KPIs.
2. **Indexer worker** (`pnpm indexers:worker`) — pure Node process (`src/scripts/indexer-worker.ts`) that loops `runAllIndexers()` every `INDEXER_POLL_INTERVAL_MS`. Railway deploys it as a separate service.

### Indexer pipeline (`src/lib/indexers/`)

`run-all.ts` currently runs **two collectors concurrently** via `Promise.all` (they hit disjoint upstreams and write to disjoint tables):

1. `near.ts` → `collectNearState` — ingests FastAuth-related NEAR transactions, derives `fastauth_sign_events` rows, then calls `rebuildRelayerMarts` inline so the `relayers` / `relayer_dapps` marts are refreshed as part of the same run.
2. `public-key-accounts.ts` → `collectFastAuthPublicKeyAccounts` — resolves relayer public keys seen in sign events to NEAR accounts via FastNEAR, populating `fastauth_public_key_accounts`.

The Prisma schema still defines `Auth0Log`, `ServiceMetricSample`, and `AccountTvlDailySnapshot` models, but the corresponding collectors (`auth0.ts`, `service-metrics.ts`, `tvl.ts`, `dashboard-kpis.ts`) no longer exist in `src/lib/indexers/` — do not assume those tables are being populated by the current worker. If you're reviving any of them, add them back into `runAllIndexers` and wire a checkpoint key.

Every collector returns `IndexerRunResult` (`src/lib/indexers/types.ts`) with `status: "ok" | "skipped" | "error"`. Collectors must **never throw** out of `runAllIndexers` — wrap failures and return `status: "error"` so one broken source doesn't kill the whole run. `runIndexerWithLogs` wraps each collector with structured start/finish/heartbeat logs (15s heartbeat).

### NEAR RPC orchestration

`near-rpc-manager.ts` exposes `createNearRpcManager()` which returns a `NearRpcManager` configured against a **hardcoded pool** of public NEAR RPCs (see `NEAR_RPC_URLS` in that file). The pool uses **round-robin per request**: each `request()` call advances `currentIndex` atomically and uses the next healthy endpoint, so N concurrent callers spread ~N/endpoint-count per RPC. Endpoints that return 429, 5xx, connection errors, or JSON-RPC quota/usage-limit messages are blacklisted for 60s and excluded from rotation. On exhaustion, `request()` throws `NearRpcExhaustedError` carrying the set of endpoints that responded `UNKNOWN_BLOCK`; `near.ts` uses this to require **majority consensus** (≥`ceil(n/2)` distinct endpoints) before permanently skipping a height — this prevents a single pruning RPC from advancing the checkpoint past real blocks. Collectors must call through the manager, not raw `fetch`. Archival RPCs are intentionally not used.

### Crash recovery

All collectors are checkpoint-driven via the `indexer_checkpoints` key/value table. In particular:

- `near.ts` tracks `near_last_final_block_height`, `near_last_final_block_hash`, and `near_last_scanned_height`; on each run it backfills from the last scanned height up to latest final, respecting the hardcoded `NEAR_MAX_BLOCKS_PER_RUN`, and only advances checkpoints up to the highest contiguous successfully-persisted height.
- `public-key-accounts.ts` checkpoints incrementally on `fastauth_sign_events.id`, with a first-run lookback window controlled by `FASTAUTH_PUBLIC_KEY_LOOKBACK_DAYS`.

When editing collectors, preserve this checkpoint-first design — do not substitute in-memory state.

### Indexer tuning

Block concurrency, chunk concurrency, max-blocks-per-run, backfill seed, progress log cadence, RPC pool, request timeout, blacklist duration, and chain-health prober knobs are **hardcoded in source** (`near.ts`, `fastauth-head-status.ts`, `near-rpc-manager.ts`). They were previously env-driven but flipped to constants because they are deployment-invariant — change them in code, not via env vars.

See `FASTNEAR_RPC_LIMITS_RUNBOOK.md` for rate-limiting rules (treat 429/5xx as backpressure; scale conservatively).

### Signed indexer trigger

`POST /api/indexers/run` is an HMAC-gated fallback for environments without a long-running worker. The signature format is `HMAC-SHA256(INDEXER_CRON_SECRET, "${ts}:${pathname}")`, with a 5-minute timestamp skew window and optional `INDEXER_ALLOWED_IPS` source allowlist. `pnpm indexers:trigger` is the canonical client for this endpoint — use it rather than hand-rolling curl when testing.

### Data tables

Prisma schema in `prisma/schema.prisma`. The models split into:

- **Raw ingest** — `near_transactions` (populated by `near.ts`). `auth0_logs`, `service_metrics_timeseries`, and `account_tvl_daily_snapshots` are declared but not actively populated (see pipeline note above).
- **Derived** — `fastauth_sign_events` (produced by `near.ts` from raw transactions) and `fastauth_public_key_accounts` (produced by `public-key-accounts.ts`).
- **Marts** — `relayers`, `relayer_dapps` — rebuilt each NEAR run from sign events via `rebuildRelayerMarts` in `near.ts`.
- **Checkpoints** — `indexer_checkpoints` key/value table.
- **Accounts** — `accounts` model holds FastAuth user accounts (not NextAuth — there is no auth in this dashboard).

The dashboard reads marts and derived tables via `src/lib/dashboard-data.ts`; it never reads raw `near_transactions` for KPIs.

## Conventions

- Path alias `@/*` → `src/*` (`tsconfig.json`). Use it in all internal imports.
- `src/lib/prisma.ts` exports a **singleton** `prisma` — always import from there, never `new PrismaClient()`, to avoid exhausting connections in dev with HMR.
- Collectors accept `prisma` as a parameter (not a module-global import) to make them testable and swappable.
- The `docs/` directory is a **separate Docusaurus sub-project** with its own `package.json` and `node_modules` — excluded from the root `tsconfig.json`. Do not try to build it with the root scripts.
- Security headers (CSP, HSTS, frame-ancestors=none, etc.) are set in `next.config.ts`. If you add third-party origins for scripts/fonts/images, update `connectSrc`/`contentSecurityPolicy` there.
