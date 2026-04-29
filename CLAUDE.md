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

Additional scripts in `src/scripts/` without package.json aliases — run them directly with `pnpm tsx src/scripts/<name>.ts`:

- Inspection: `inspect-db.ts`, `validate-pubkey-decoder.ts`
- Repair / one-off enrichment: `rebuild-marts.ts`, `backfill-sign-action-type.ts`, `backfill-sign-event-accounts.ts`, `backfill-provider-type.ts`, `delete-consumer-after.ts`
- **Destructive**: `wipe-db.ts` — wipes all indexer tables. Double-check before invoking.

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

`run-all.ts` runs **three collectors concurrently** via `Promise.all` (they hit disjoint upstreams and write to disjoint tables):

1. `near.ts` → `collectNearState` — scans NEAR blocks, persists raw `near_transactions`, decodes NEP-366 `DelegateAction` payloads (via `decode-sign-action.ts`) to derive `fastauth_sign_events`, extracts the relayer-submitted Delegate-wrapped meta-txs into `fastauth_consumer_transactions`, attributes any tx whose signer holds a FastAuth-derived MPC key into `fastauth_user_transactions` (with per-token USD value via `compute-tx-value.ts` + `token-prices.ts`), and finally calls `rebuildRelayerMarts` inline so the `relayers` / `relayer_dapps` marts are refreshed in the same run.
2. `public-key-accounts.ts` → `collectFastAuthPublicKeyAccounts` — resolves user-derived public keys seen in sign events to NEAR accounts via FastNEAR (with NearBlocks fallback through `http-endpoint-pool.ts`, the REST analog of `near-rpc-manager.ts`), populates `fastauth_public_key_accounts`, back-fills `user_account_id` onto historical sign-event rows, and upserts the `accounts` table.
3. `fastauth-head-status.ts` → `collectFastAuthChainHealth` — self-throttled chain-head probe (≥10 min between runs). Scans a 300-block rolling window at chain tip, classifies each FastAuth tx by guard-vs-MPC failure mode, and writes `fastauth_chain_health_snapshots` for the dashboard's MPC / Fast Auth status cards.

The Prisma schema still defines `Auth0Log`, `ServiceMetricSample`, and `AccountTvlDailySnapshot` models, but the corresponding collectors (`auth0.ts`, `service-metrics.ts`, `tvl.ts`, `dashboard-kpis.ts`) no longer exist in `src/lib/indexers/` — do not assume those tables are being populated by the current worker. If you're reviving any of them, add them back into `runAllIndexers` and wire a checkpoint key.

Every collector returns `IndexerRunResult` (`src/lib/indexers/types.ts`) with `status: "ok" | "skipped" | "error"`. Collectors must **never throw** out of `runAllIndexers` — wrap failures and return `status: "error"` so one broken source doesn't kill the whole run. `runIndexerWithLogs` wraps each collector with structured start/finish/heartbeat logs (15s heartbeat).

### NEAR RPC orchestration

`near-rpc-manager.ts` exposes `createNearRpcManager()` which returns a `NearRpcManager` configured against a **hardcoded pool** of public NEAR RPCs (see `NEAR_RPC_URLS` in that file). The pool uses **round-robin per request**: each `request()` call advances `currentIndex` atomically and uses the next healthy endpoint, so N concurrent callers spread ~N/endpoint-count per RPC. Endpoints that return 429, 5xx, connection errors, or JSON-RPC quota/usage-limit messages are blacklisted for 60s and excluded from rotation. On exhaustion, `request()` throws `NearRpcExhaustedError` carrying the set of endpoints that responded `UNKNOWN_BLOCK`; `near.ts` uses this to require **majority consensus** (≥`ceil(n/2)` distinct endpoints) before permanently skipping a height — this prevents a single pruning RPC from advancing the checkpoint past real blocks. Collectors must call through the manager, not raw `fetch`. Archival RPCs are intentionally not used.

### Crash recovery

All collectors are checkpoint-driven via the `indexer_checkpoints` key/value table. In particular:

- `near.ts` tracks `near_last_final_block_height`, `near_last_final_block_hash`, and `near_last_scanned_height`; on each run it backfills from the last scanned height up to latest final, respecting the hardcoded `NEAR_MAX_BLOCKS_PER_RUN`, and only advances checkpoints up to the highest contiguous successfully-persisted height.
- `public-key-accounts.ts` keeps two checkpoints. `fastauth_public_key_accounts_last_event_id` advances forward through new sign events (first-run lookback window controlled by `FASTAUTH_PUBLIC_KEY_LOOKBACK_DAYS`). `fastauth_orphan_retry_last_run_at` throttles a separate **orphan-retry sweep** that runs at most every 20 min (`ORPHAN_RETRY_MIN_INTERVAL_MS`): it picks up to `ORPHAN_RETRY_MAX_PUBKEYS` (500) sign events still missing `user_account_id` whose pubkey isn't in pka yet and re-queries FastNEAR/NearBlocks for them. Every cycle also runs an idempotent **back-stamp UPDATE** that fills `user_account_id` on any historical sign event whose pubkey is now known to pka — this is what makes the collector self-healing against transient FastNEAR/NearBlocks failures (which are now also logged via `console.warn`, no longer swallowed). When editing this collector, preserve all three: forward checkpoint, throttled orphan retry, and end-of-cycle back-stamp.
- `fastauth-head-status.ts` checkpoints `fastauth_chain_health_last_run_at` and short-circuits if the previous run was less than 10 minutes ago — so it only does real work on a small fraction of indexer ticks.

When editing collectors, preserve this checkpoint-first design — do not substitute in-memory state.

### Indexer tuning

Block concurrency, chunk concurrency, max-blocks-per-run, backfill seed, progress log cadence, RPC pool, request timeout, blacklist duration, and chain-health prober knobs are **hardcoded in source** (`near.ts`, `fastauth-head-status.ts`, `near-rpc-manager.ts`). They were previously env-driven but flipped to constants because they are deployment-invariant — change them in code, not via env vars.

See `FASTNEAR_RPC_LIMITS_RUNBOOK.md` for rate-limiting rules (treat 429/5xx as backpressure; scale conservatively).

### Signed indexer trigger

`POST /api/indexers/run` is an HMAC-gated fallback for environments without a long-running worker. The signature format is `HMAC-SHA256(INDEXER_CRON_SECRET, "${ts}:${pathname}")`, with a 5-minute timestamp skew window and optional `INDEXER_ALLOWED_IPS` source allowlist. `pnpm indexers:trigger` is the canonical client for this endpoint — use it rather than hand-rolling curl when testing.

### Data tables

Prisma schema in `prisma/schema.prisma`. The models split into:

- **Raw ingest** — `near_transactions` (populated by `near.ts`).
- **Derived from raw, by `near.ts`**:
  - `fastauth_sign_events` — decoded NEP-366 `FastAuth.sign()` calls; primary key `(tx_hash, action_index)`.
  - `fastauth_consumer_transactions` — relayer-submitted Delegate-wrapped meta-txs that consume a FastAuth signature on chain; mostly `AddKey` / `DeleteKey` from login/logout key churn. Links back to its sign event via `linked_sign_event_id`.
  - `fastauth_user_transactions` — any tx whose signer holds a FastAuth-derived MPC key (i.e. *real* user activity). Anchored on the account, not on session keys, so attribution survives session-key rotation. Carries per-token USD valuation populated at index-time.
- **Resolved, by `public-key-accounts.ts`** — `fastauth_public_key_accounts` (publicKey → accountId mapping with first/last-seen) and `accounts` (FastAuth user accounts; note: not NextAuth — there is no auth in this dashboard).
- **Marts** — `relayers`, `relayer_dapps` — rebuilt each NEAR run from sign events via `rebuildRelayerMarts` in `near.ts`.
- **Health** — `fastauth_chain_health_snapshots` — periodic 300-block-window probes; populated by `fastauth-head-status.ts`.
- **Ops** — `indexer_checkpoints` (key/value); `missing_block_ranges` (gap tracking, see Gap management below).
- **Declared but unpopulated** — `auth0_logs`, `service_metrics_timeseries`, `account_tvl_daily_snapshots`. The corresponding collectors no longer exist (see pipeline note above) — do not assume they have current data.

The dashboard reads marts, derived, resolved, and health tables via `src/lib/dashboard-data.ts`; it never reads raw `near_transactions` for KPIs.

The UI deliberately separates two activity streams that are easy to confuse: **consumer transactions** (`fastauth_consumer_transactions`) are the on-chain *consequences* of `FastAuth.sign()` — high volume but skewed by login key churn — while **real activity** (`fastauth_user_transactions`) is what FastAuth users actually do on chain afterward, with their own session keys, attributed to the underlying account.

## Conventions

- Path alias `@/*` → `src/*` (`tsconfig.json`). Use it in all internal imports.
- `src/lib/prisma.ts` exports a **singleton** `prisma` — always import from there, never `new PrismaClient()`, to avoid exhausting connections in dev with HMR.
- Collectors accept `prisma` as a parameter (not a module-global import) to make them testable and swappable.
- The `docs/` directory is a **separate Docusaurus sub-project** with its own `package.json` and `node_modules` — excluded from the root `tsconfig.json`. Do not try to build it with the root scripts.
- Security headers (CSP, HSTS, frame-ancestors=none, etc.) are set in `next.config.ts`. If you add third-party origins for scripts/fonts/images, update `connectSrc`/`contentSecurityPolicy` there.
