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
- MPC consensus inspection (prefixed `_`, throwaway-grade): `_inspect-mpc.ts` (raw mpc_transactions snapshot), `_validate-mpc-logs.ts` (sign/respond log format check), `_validate-mpc-parser.ts` (parser fixture test against real txs), `_inspect-mpc-parse-failures.ts` (diagnose why a tx didn't yield a parseable sign log).
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

`run-all.ts` runs **seven collectors concurrently** via `Promise.all` (they hit disjoint upstreams and write to disjoint tables):

1. `near.ts` → `collectNearState` — scans NEAR blocks, persists raw `near_transactions`, decodes NEP-366 `DelegateAction` payloads (via `decode-sign-action.ts`) to derive `fastauth_sign_events`, extracts the relayer-submitted Delegate-wrapped meta-txs into `fastauth_consumer_transactions`, attributes any tx whose signer holds a FastAuth-derived MPC key into `fastauth_user_transactions` (with per-token USD value via `compute-tx-value.ts` + `token-prices.ts`), and finally calls `rebuildRelayerMarts` inline so the `relayers` / `relayer_dapps` marts are refreshed in the same run. The same scan loop also runs **Path 4**: any tx whose `receiver_id ∈ MPC_CONTRACT_IDS` (= `{v1.signer}` on mainnet) is persisted to `mpc_transactions` — the raw landing table for the MPC consensus dashboard. Cero costo RPC adicional; reuses the existing chunk decode.
2. `public-key-accounts.ts` → `collectFastAuthPublicKeyAccounts` — resolves user-derived public keys seen in sign events to NEAR accounts via **FastNEAR only** (NearBlocks was removed; it got Cloudflare-walled and rate-limited generating noise without resolving anything FastNEAR didn't already cover). Populates `fastauth_public_key_accounts`, back-fills `user_account_id` onto historical sign-event rows, and upserts the `accounts` table.
3. `fastauth-health.ts` → `collectFastAuthHealth` — derives per-tx receipt-level classification (success / guard_failure / mpc_failure / other_failure / rpc_pending) from `near_transactions` (FA-receiver tx) into `fastauth_health_tx`. Source of truth for the MPC Status / Fast Auth Status cards.
4. `fastauth-consumer-health.ts` → `collectFastAuthConsumerHealth` — same per-tx receipt-walk pattern, sourced from `fastauth_consumer_transactions` (relayer-submitted Delegate-wrapped meta-txs). Outcome enum is simpler (`success | failure | rpc_pending`) since these don't touch the FA → MPC pipeline. Source of truth for the Consumer Outcomes panel's Failed counts.
5. `fastauth-user-health.ts` → `collectFastAuthUserHealth` — same shape, sourced from `fastauth_user_transactions` (real user activity). Source of truth for the Real Activity panel's Failed counts.
6. `mpc-consensus.ts` → `collectMpcConsensus` — populates the consensus-dashboard derived tables. Four bounded discovery passes per cycle (anti-join, no checkpoint): (a) `respond` from `mpc_transactions` → `mpc_sign_responses` (RPC `tx` for logs); (b) direct `sign` from `mpc_transactions` → `mpc_sign_requests` with `source = 'direct'` (RPC for logs); (c) FastAuth `sign` from `near_transactions` → `mpc_sign_requests` with `source = 'fastauth'` (RPC for logs); (d) **governance** from `mpc_transactions` (methods in `MPC_GOVERNANCE_METHODS`) → `mpc_consensus_events` — args base64-decoded inline from the chunk payload, **no RPC needed**. Lookback for governance is 30d (vs 24h for the other passes) because events are rare and the dashboard wants full history. Parses the Rust `Debug`-format logs (`sign:`/`respond:`) using `parse-mpc-logs.ts` to extract a `requestKey = {scheme}:{hex(payload)}` for matching (Path B' — see "MPC consensus correlation" below). When a tx has no `v1.signer` receipt or no parseable log (e.g. FastAuth signs that the guard rejected before the cross-contract call to MPC), it's tombstoned in `mpc_log_parse_skipped` so subsequent cycles skip it. After persisting responses, rebuilds the `mpc_nodes` mart from aggregates.
7. `fastauth-contract-state.ts` → `collectFastAuthContractState` — periodic view-call snapshot of the three FastAuth contracts on mainnet (`fast-auth.near`, `jwt.fast-auth.near`, `auth0.jwt.fast-auth.near`). For each: `view_account` (balance, storage, code_hash), `view_access_key_list` (full-access key count → "locked" derivation), `contract_source_metadata` (NEP-330 version + source link), and per-contract view methods (`owner`, `paused`, `mpc_address`, `mpc_domain_id`, `mpc_key_version`, `version`, `get_public_keys`). Throttled via `fastauth_contract_state_last_run_at` checkpoint with `SNAPSHOT_MIN_INTERVAL_MS = 5 min` — config doesn't change often, the consensus-events feed surfaces the actual change moments. Append-only into `fastauth_contract_snapshots`; dashboard reads latest per `contract_id` via `DISTINCT ON`.

The three FastAuth health collectors share `health-classifier.ts` for receipt-walking + RPC plumbing. Each does two bounded passes per cycle: **discover** (≤50 new rows from the last `DISCOVERY_LOOKBACK_DAYS` (1) that aren't yet classified, calls NEAR `tx` RPC, persists newest-first) and **retry** (≤25 `rpc_pending` rows older than 5 min with `retry_count < 10`, re-classifies). The MPC consensus collector follows the same anti-join discovery pattern, with its own caps (`DISCOVER_LIMIT_RESPOND = 100`, `DISCOVER_LIMIT_SIGN_DIRECT = 50`, `DISCOVER_LIMIT_SIGN_FASTAUTH = 100`). All caps are sized so worst-case cycle time stays under ~150s even with full RPC timeout cascades; in steady state most calls succeed in ~200ms.

The Prisma schema still defines `Auth0Log`, `ServiceMetricSample`, and `AccountTvlDailySnapshot` models, but the corresponding collectors (`auth0.ts`, `service-metrics.ts`, `tvl.ts`, `dashboard-kpis.ts`) no longer exist in `src/lib/indexers/` — do not assume those tables are being populated by the current worker. If you're reviving any of them, add them back into `runAllIndexers` and wire a checkpoint key.

Every collector returns `IndexerRunResult` (`src/lib/indexers/types.ts`) with `status: "ok" | "skipped" | "error"`. Collectors must **never throw** out of `runAllIndexers` — wrap failures and return `status: "error"` so one broken source doesn't kill the whole run. `runIndexerWithLogs` wraps each collector with structured start/finish/heartbeat logs (15s heartbeat).

### NEAR RPC orchestration

`near-rpc-manager.ts` exposes `createNearRpcManager()` which returns a `NearRpcManager` configured against a **hardcoded pool** of public NEAR RPCs (see `NEAR_RPC_URLS` in that file). The pool uses **round-robin per request**: each `request()` call advances `currentIndex` atomically and uses the next healthy endpoint, so N concurrent callers spread ~N/endpoint-count per RPC. Endpoints that return 429, 5xx, connection errors, or JSON-RPC quota/usage-limit messages are blacklisted for 60s and excluded from rotation. On exhaustion, `request()` throws `NearRpcExhaustedError` carrying the set of endpoints that responded `UNKNOWN_BLOCK`; `near.ts` uses this to require **majority consensus** (≥`ceil(n/2)` distinct endpoints) before permanently skipping a height — this prevents a single pruning RPC from advancing the checkpoint past real blocks. Collectors must call through the manager, not raw `fetch`. Archival RPCs are intentionally not used.

### Crash recovery

All collectors are checkpoint-driven via the `indexer_checkpoints` key/value table. In particular:

- `near.ts` tracks `near_last_final_block_height`, `near_last_final_block_hash`, and `near_last_scanned_height`; on each run it backfills from the last scanned height up to latest final, respecting the hardcoded `NEAR_MAX_BLOCKS_PER_RUN`, and only advances checkpoints up to the highest contiguous successfully-persisted height.
- `public-key-accounts.ts` keeps two checkpoints. `fastauth_public_key_accounts_last_event_id` advances forward through new sign events (first-run lookback window controlled by `FASTAUTH_PUBLIC_KEY_LOOKBACK_DAYS`). `fastauth_orphan_retry_last_run_at` throttles a separate **orphan-retry sweep** that runs at most every 20 min (`ORPHAN_RETRY_MIN_INTERVAL_MS`): it picks up to `ORPHAN_RETRY_MAX_PUBKEYS` (500) sign events still missing `user_account_id` whose pubkey isn't in pka yet and re-queries **FastNEAR** for them (NearBlocks fallback was removed). Every cycle also runs an idempotent **back-stamp UPDATE** that fills `user_account_id` on any historical sign event whose pubkey is now known to pka — this is what makes the collector self-healing against transient FastNEAR failures (which are logged via `console.warn`, not swallowed). When editing this collector, preserve all three: forward checkpoint, throttled orphan retry, and end-of-cycle back-stamp.
- `fastauth-health.ts` is **not** checkpoint-driven — it's bounded-per-cycle instead. The discovery query (`LEFT JOIN ... IS NULL`, newest-first) finds work organically by anti-joining `near_transactions` against `fastauth_health_tx`, capped at `DISCOVER_LIMIT` (50) per cycle. The retry pass picks up to `RETRY_LIMIT` (25) `rpc_pending` rows whose `last_attempted_at` is older than `RETRY_BACKOFF_MS` (5 min) and `retry_count < MAX_RETRY_COUNT` (10). After a row exhausts retries it stays `rpc_pending` forever — we don't promote to `other_failure` because we never confirmed what happened. Discovery is restricted to the last `DISCOVERY_LOOKBACK_DAYS` (1) — the boundary of "recent enough to bother backfilling on a fresh deploy"; anything older is permanently skipped and its sign events keep whatever chunk-level executionStatus `near.ts` originally recorded. The 1-day window matches the live cards' 24h aggregation, so a fresh deploy reaches steady state in a single backlog drain. Per-cycle caps are sized so even worst-case (every `tx` call hits the manager's 15s timeout) keeps cycle duration under ~150s; in steady state most calls succeed in ~200ms and a cycle completes in seconds.

When editing collectors, preserve this checkpoint-first design — do not substitute in-memory state.

### MPC consensus correlation (Path B')

`mpc-consensus.ts` correlates `sign` ↔ `respond` calls to v1.signer to compute yield→resume latency, build the node roster, and surface stuck signs. Method: parse the Rust `Debug`-format logs the contract emits inside its v1.signer receipts. Both sides log a `request` field, but the structs differ:

```
sign:    request=SignRequestArgs { path: "...", payload_v2: Some(Ecdsa/Eddsa(BoundedVec { inner: [bytes] })) }
respond: request=SignatureRequest { tweak: Tweak([32 bytes]), payload: Ecdsa/Eddsa(BoundedVec { inner: [bytes] }) }
```

The contract canonicalizes `path → tweak` before enqueueing, so the two `request` strings are not directly comparable. **The matching key is the payload bytes**, present in both forms: `requestKey = "{scheme}:{hex(payload_inner)}"`. 1-to-N relationship (one sign → multiple responds, one per participating node). When a sign tx lacks a v1.signer receipt entirely (typically a FastAuth guard rejection that short-circuited before the cross-contract call), there is no `sign:` log to parse — the tx is tombstoned in `mpc_log_parse_skipped` so the LEFT JOIN anti-join in subsequent cycles skips it (otherwise the discovery query loops on the same dead-end txs and burns RPC quota). Three tombstone reasons: `no_v1signer_receipt`, `no_sign_log`, `no_respond_log`. Pinned to commit `1ee251d` of `near/mpc`; the parser regexes are stable as long as the contract's `Debug` formatter doesn't change. If `contract_source_metadata` reports a new commit, regenerate fixtures with `_validate-mpc-parser.ts` before trusting steady-state output.

Synthetic traffic: `tx-bench.near` is a benchmarking bot whose direct `sign` calls are tagged `trafficSource = 'synthetic'` at decode time. Not filtered (its respond latency is real signal about node health) but flagged so dashboard queries can separate organic vs synthetic load.

### Indexer tuning

Block concurrency, chunk concurrency, max-blocks-per-run, backfill seed, progress log cadence, RPC pool, request timeout, blacklist duration, and health-classifier per-cycle caps are **hardcoded in source** (`near.ts`, `fastauth-health.ts`, `near-rpc-manager.ts`). They were previously env-driven but flipped to constants because they are deployment-invariant — change them in code, not via env vars.

See `FASTNEAR_RPC_LIMITS_RUNBOOK.md` for rate-limiting rules (treat 429/5xx as backpressure; scale conservatively).

### Signed indexer trigger

`POST /api/indexers/run` is an HMAC-gated fallback for environments without a long-running worker. The signature format is `HMAC-SHA256(INDEXER_CRON_SECRET, "${ts}:${pathname}")`, with a 5-minute timestamp skew window and optional `INDEXER_ALLOWED_IPS` source allowlist. `pnpm indexers:trigger` is the canonical client for this endpoint — use it rather than hand-rolling curl when testing.

### Data tables

Prisma schema in `prisma/schema.prisma`. The models split into:

- **Raw ingest** — `near_transactions` (populated by Paths 1-3 in `near.ts`); `mpc_transactions` (Path 4 of the same scan, txs with `receiver_id = v1.signer`).
- **Derived from raw, by `near.ts`**:
  - `fastauth_sign_events` — decoded NEP-366 `FastAuth.sign()` calls; primary key `(tx_hash, action_index)`.
  - `fastauth_consumer_transactions` — relayer-submitted Delegate-wrapped meta-txs that consume a FastAuth signature on chain; mostly `AddKey` / `DeleteKey` from login/logout key churn. Links back to its sign event via `linked_sign_event_id`.
  - `fastauth_user_transactions` — any tx whose signer holds a FastAuth-derived MPC key (i.e. *real* user activity). Anchored on the account, not on session keys, so attribution survives session-key rotation. Carries per-token USD valuation populated at index-time.
- **Resolved, by `public-key-accounts.ts`** — `fastauth_public_key_accounts` (publicKey → accountId mapping with first/last-seen) and `accounts` (FastAuth user accounts; note: not NextAuth — there is no auth in this dashboard).
- **Marts** — `relayers`, `relayer_dapps` — rebuilt each NEAR run from sign events via `rebuildRelayerMarts` in `near.ts`. `mpc_nodes` — rebuilt by `mpc-consensus.ts` from `mpc_sign_responses` aggregates.
- **Health** — three per-tx classification tables, each populated by its own collector via the same receipt-walk pattern in `health-classifier.ts`:
  - `fastauth_health_tx` — FA-receiver tx (sourced from `near_transactions`). Outcome ∈ `success | guard_failure | mpc_failure | other_failure | rpc_pending`. Carries `reached_mpc bool?` for the MPC vs guard split. Feeds MPC Status / Fast Auth Status cards and the Transactions panel.
  - `fastauth_consumer_health_tx` — consumer tx (sourced from `fastauth_consumer_transactions`). Outcome ∈ `success | failure | rpc_pending` (no MPC split — consumer txs don't touch the FA → MPC pipeline). Feeds the Consumer Outcomes panel's Failed counts.
  - `fastauth_user_health_tx` — real user activity (sourced from `fastauth_user_transactions`). Same simplified outcome enum. Feeds the Real Activity panel's Failed counts.
  
  All three carry `failing_executor_id` + `failure_reason` (extracted from the failing receipt's status) so the dashboard can show *why* a tx failed, not just that it did.
- **MPC consensus** — populated by `mpc-consensus.ts` via log parsing (Path B') and inline JSON arg decoding:
  - `mpc_sign_requests` — one row per `sign:` log observed in a v1.signer receipt. `source ∈ {direct, fastauth}` distinguishes top-level `sign` calls (chain signatures, `tx-bench.near`, etc.) from FastAuth cross-contract calls. `trafficSource ∈ {organic, synthetic}` flags `tx-bench.near` as benchmark traffic.
  - `mpc_sign_responses` — one row per `respond:` log, with `signer_id` (the MPC node account) and `request_key` matching the corresponding sign.
  - `mpc_nodes` — mart aggregated from responses (account, first/last seen, total responses).
  - `mpc_log_parse_skipped` — tombstones for txs the collector tried but couldn't extract a usable log from. Three reasons: `no_v1signer_receipt`, `no_sign_log`, `no_respond_log`. Source-scoped (`respond`, `sign-direct`, `sign-fastauth`) so each pipeline has its own anti-join.
  - `mpc_consensus_events` — control-plane events (TEE attestations, code/launcher/OS hash votes, key event lifecycle, contract upgrade votes, foreign chain governance, node migrations). Args decoded inline from `mpc_transactions.payload_json` (base64 → JSON). `category` field buckets the 26 governance methods into 6 groups (`tee | version | key_events | updates | foreign_chains | migration | other`) so the home can render category counts and a code-hash-drift indicator without re-classifying on every render.
- **Legacy / unused** — `fastauth_chain_health_snapshots` — old window-sampled snapshots; the snapshot table is preserved for historical record but no longer written to. `auth0_logs`, `service_metrics_timeseries`, `account_tvl_daily_snapshots` likewise: declared in schema, no current collector.
- **FastAuth contract state** — `fastauth_contract_snapshots`. Append-only snapshots from `fastauth-contract-state.ts`, throttled to ~5 min/contract. Each row: `contractId`, `snapshotAt`, account fields (`balanceYocto`, `storageUsage`, `codeHash`, `fullAccessKeys` → `locked` derived), free-form `config` JSON (varies by contract), and `sourceMetadata` JSON (NEP-330). Dashboard reads latest per contract via `DISTINCT ON (contractId) ORDER BY contractId, snapshotAt DESC`.
- **Ops** — `indexer_checkpoints` (key/value); `missing_block_ranges` (gap tracking, see Gap management below).

The dashboard reads marts, derived, resolved, and health tables via `src/lib/dashboard-data.ts`; it never reads raw `near_transactions` for KPIs.

The UI deliberately separates two activity streams that are easy to confuse: **consumer transactions** (`fastauth_consumer_transactions`) are the on-chain *consequences* of `FastAuth.sign()` — high volume but skewed by login key churn — while **real activity** (`fastauth_user_transactions`) is what FastAuth users actually do on chain afterward, with their own session keys, attributed to the underlying account.

The status cards split the same `fastauth_health_tx` data two ways: **Fast Auth Status** is end-to-end (`success / total_classified` over all FastAuth-touching tx — answers "is the pipeline working for users?"), while **MPC Status** isolates the MPC network (`success / mpc_attempted` filtered to `reached_mpc = true` — answers "is MPC actually signing?", excluding guard-side rejections that never reached MPC). Pending tx are excluded from both denominators; their count is shown separately so RPC pressure surfaces as its own signal.

The home page also renders an **MPC Network** section (component `src/components/mpc-network-section.tsx`) bound to `data.mpcNetwork` from `dashboard-data.ts`. Eight sub-panels under one kicker, ordered after FastAuth Contracts and immediately before the page footer (the old `Indexer status` and `Developer` sections are gone — internal-only diagnostics, not appropriate for a public dashboard):

1. **Overview KPIs** — responses, sign requests (organic vs synthetic), FastAuth share with explicit `(N%)`, pending count. Window auto-aligns: when the underlying tables have < 24h of history, KPIs are computed over the actual available window and labelled "Last Xh" instead of lying with "Last 24h". Numerator and denominator share the same window so the FastAuth-share percentage is honest.
2. **Yield→resume latency by node** — table with p50/p95/p99 per signer.
3. **Liveness heatmap** — 24 hourly buckets per node. Each bucket has a CSS-styled hover tooltip (`data-tooltip` + `:hover::after`) that renders an instant on-brand legend (`30 Apr 14:00–15:00 • 47 responds`); the native `title` attribute is preserved as a touch / accessibility fallback. Tooltip is positioned **below** the cell so it stays inside the parent `.tableWrap` (which has `overflow-x: auto`).
4. **Network roster** — all observed MPC nodes with windowed counts.
5. **Pending sign requests** — signs without matching respond aged past `MPC_PENDING_MIN_AGE_SEC = 60` (sub-minute is normal MPC propagation, not a stuck request).
6. **Governance & key events** — overview KPIs (events 24h/7d, code-hash-consensus indicator) plus a count-per-category breakdown across 24h/7d/30d windows.
7. **Code-hash drift by node** — latest `vote_code_hash` per node from the last 30d. If multiple distinct hashes appear, the consensus tile flips to alert.
8. **Recent events timeline** — paginated client component `MpcRecentEventsTable` (`src/components/mpc-recent-events-table.tsx`) showing 10 events per page, up to 50 latest, with category, actor, and a one-line `payloadSummary` extracted by `summarizeGovernancePayload()` in `dashboard-data.ts`.

When the consensus tables are empty (fresh deploy, collector warming up), the section renders a single placeholder card instead of erroring. Every forward-only sub-panel renders a "Data available since X" / "Events tracked since X" hint in user-friendly language so viewers understand history depth.

A separate **FastAuth Contracts** section (component `src/components/fastauth-contracts-section.tsx`) sits between Top Accounts and MPC Network. Three cards (FastAuth, JWT Guard Router, Auth0 Guard) showing balance, storage, code_hash truncated with full-hash tooltip, locked-from-fullaccess-keys derivation, owner (clickable to NEARblocks if it's a NEAR account ID), MPC config, NEP-330 source link (clickable, external). For Auth0 Guard, a `<details>` widget collapses the active RSA public keys; each key renders as a one-liner `RSA-2048 · n=bc1295ba…  · e=65537` (parsed from the `{e:[bytes], n:[bytes]}` JSON via `formatRsaKey()`).

## Conventions

- Path alias `@/*` → `src/*` (`tsconfig.json`). Use it in all internal imports.
- `src/lib/prisma.ts` exports a **singleton** `prisma` — always import from there, never `new PrismaClient()`, to avoid exhausting connections in dev with HMR.
- Collectors accept `prisma` as a parameter (not a module-global import) to make them testable and swappable.
- The `docs/` directory is a **separate Docusaurus sub-project** with its own `package.json` and `node_modules` — excluded from the root `tsconfig.json`. Do not try to build it with the root scripts.
- Security headers (CSP, HSTS, frame-ancestors=none, etc.) are set in `next.config.ts`. If you add third-party origins for scripts/fonts/images, update `connectSrc`/`contentSecurityPolicy` there.
