# FastAuth Metrics Dashboard

Public dashboard for FastAuth analytics on NEAR mainnet, plus a parallel **MPC Network** section that observes consensus health on `v1.signer`. Stack:

- **Next.js 16.2.4 + React 19.2.4 + TypeScript** (App Router, server-component data fetching).
- **pnpm 10** for tooling.
- **Railway Postgres** as the single store. The dashboard reads pre-computed marts; an indexer worker writes them.
- No auth layer — treat all displayed data as public.

## 1. Local Setup

Install dependencies:

```bash
pnpm install
```

Create env file:

```bash
cp .env.example .env
```

Then edit `.env` and replace all placeholder values.
At minimum, set a real `DATABASE_URL` before running Prisma migrations.

Example:

```env
DATABASE_URL="postgresql://postgres:REAL_PASSWORD@REAL_HOST:5432/railway"
```

Generate Prisma client and run local migrations:

```bash
pnpm prisma:generate
pnpm prisma migrate dev --name init
```

If you see `P1001: Can't reach database server at host:5432`, your `DATABASE_URL`
is still pointing to the placeholder host or to an unreachable database.

Run the app:

```bash
pnpm dev
```

## 2. Railway Postgres

Create a Railway Postgres service and copy its connection string to:

- DATABASE_URL

Important:

- Use the real connection string from Railway, not the sample `.env.example` value.
- The placeholder `host:5432` in `.env.example` is intentionally invalid.

Run schema migration in Railway deploy step or via Railway shell:

```bash
pnpm prisma:generate
pnpm prisma migrate deploy
```

## 3. Indexers

`pnpm indexers:worker` runs a long-poll loop that calls `runAllIndexers()` every `INDEXER_POLL_INTERVAL_MS` (default 30s). The loop runs **seven collectors concurrently**:

1. **NEAR scanner** (`src/lib/indexers/near.ts`) — scans final blocks, persists `near_transactions` for FastAuth-touching txs, derives `fastauth_sign_events` (NEP-366 `DelegateAction` decoded), `fastauth_consumer_transactions` (relayer meta-txs that consume a signature), `fastauth_user_transactions` (real user activity, USD-priced at index time). Same scan runs **Path 4**: persists txs to `mpc_transactions` when `receiver_id = v1.signer`. Rebuilds `relayers` / `relayer_dapps` marts inline.
2. **Public-key linker** (`public-key-accounts.ts`) — resolves user-derived pubkeys to NEAR accounts via FastNEAR (no NearBlocks fallback). Populates `fastauth_public_key_accounts` and `accounts`. Throttled orphan-retry sweep (≤20 min) plus end-of-cycle back-stamp UPDATE for self-healing.
3. **FastAuth health classifier** (`fastauth-health.ts`) — receipt-walks FA-receiver txs into `fastauth_health_tx` with outcome ∈ `success | guard_failure | mpc_failure | other_failure | rpc_pending`. Bounded per-cycle (≤50 discover + ≤25 retry).
4. **Consumer health classifier** (`fastauth-consumer-health.ts`) — same shape, simpler outcomes (`success | failure | rpc_pending`).
5. **User-activity health classifier** (`fastauth-user-health.ts`) — same shape, sourced from `fastauth_user_transactions`.
6. **MPC consensus collector** (`mpc-consensus.ts`) — four passes per cycle: (a) parses `sign:`/`respond:` logs from v1.signer receipts (RPC-bound), populates `mpc_sign_requests` and `mpc_sign_responses` matched by payload bytes (`{scheme}:{hex(payload)}`), rebuilds the `mpc_nodes` mart. Tombstones unparseable txs in `mpc_log_parse_skipped`. (b) **Governance pass** (no RPC) — decodes args inline from `mpc_transactions.payload_json` for 26 governance methods (TEE attestations, code/launcher/OS hash votes, key events, contract upgrade votes, foreign-chain governance, node migration), categorized into 6 buckets, persisted to `mpc_consensus_events` with a 30d lookback.
7. **FastAuth contract state collector** (`fastauth-contract-state.ts`) — periodic snapshot (~5 min, throttled via checkpoint) of the three FastAuth contracts on mainnet (`fast-auth.near`, `jwt.fast-auth.near`, `auth0.jwt.fast-auth.near`). For each: `view_account` (balance, storage, code_hash) + `view_access_key_list` (locked detection) + `contract_source_metadata` (NEP-330) + per-contract view methods (`owner`, `paused`, `mpc_address`, `mpc_domain_id`, `mpc_key_version`, `version`, `get_public_keys`). Append-only into `fastauth_contract_snapshots`.

Crash-recovery: every collector is checkpoint-driven via `indexer_checkpoints` (k/v table) or anti-join discovery. The NEAR collector advances checkpoints only to the highest contiguous successfully-persisted height; holes get retried. RPC pool (`near-rpc-manager.ts`) round-robins six public NEAR endpoints with 60s blacklisting on 429/5xx, and requires majority consensus on `UNKNOWN_BLOCK` before skipping a height.

Primary mode: continuous worker (recommended). Railway service runs:

```bash
pnpm indexers:worker
```

### Required env vars (worker)

- **`DATABASE_URL`** — Railway Postgres connection string (private URL when running on Railway).
- **`FASTAUTH_CONTRACT_IDS`** — comma-separated list. Mainnet: `fast-auth.near`.

### Optional env vars (worker)

- `INDEXER_POLL_INTERVAL_MS` — loop interval, default 30000ms (Railway worker uses 10000ms in production).
- `FASTAUTH_PUBLIC_KEY_ACCOUNTS_URL_TEMPLATES` — override FastNEAR template (default: `https://api.fastnear.com/v1/public_key/{publicKey}/all`).
- `FASTAUTH_PUBLIC_KEY_ACCOUNTS_BATCH_SIZE` — default 200.
- `FASTAUTH_PUBLIC_KEY_LOOKBACK_DAYS` — first-run lookback for orphan resolution, default 30.
- `FASTAUTH_PUBLIC_KEY_LOOKUP_CONCURRENCY` — default 24.
- `FASTNEAR_API_KEY` — Bearer token. Required once you hit the anonymous rate limit.
- `FASTAUTH_MPC_CONTRACT_ID` — override the auto-detected MPC contract ID (default: `v1.signer`).

**Tuning knobs are hardcoded in source**, not env-driven: block / chunk concurrency, max blocks per run, RPC pool, request timeout, blacklist duration, health-classifier per-cycle caps, MPC consensus per-cycle caps. They're deployment-invariant; change them in `near.ts`, `fastauth-health.ts`, `mpc-consensus.ts`, `near-rpc-manager.ts` rather than via env vars. See `FASTNEAR_RPC_LIMITS_RUNBOOK.md` for guardrails.

### Dashboard sourcing

- Relayer and relayer-dapp stats: `relayers` / `relayer_dapps` marts (rebuilt by `near.ts`).
- FastAuth transaction totals / failures / pending: `fastauth_sign_events` + `fastauth_health_tx`.
- Accounts panel: `accounts` (the `First seen` column reflects the *first time we observed* the account in a sign event, not its on-chain creation).
- Consumer Outcomes / Real Activity: `fastauth_consumer_transactions` + `_health_tx` and `fastauth_user_transactions` + `_health_tx`.
- FastAuth Contracts section: `fastauth_contract_snapshots` (one card per contract — current balance, storage, code-hash, locked status, owner, MPC config, NEP-330 source metadata; for Auth0 Guard, the active RSA public keys collapsed under a `<details>`).
- MPC Network section: `mpc_sign_requests` / `mpc_sign_responses` / `mpc_nodes` for latency yield→resume by node, hourly liveness heatmap, network roster, pending sign requests > 1 min. `mpc_consensus_events` for the governance & key-events feed (TEE attestations, code-hash drift indicator, paginated timeline of latest 50 events).
- All forward-only sections render a "data available since X" note so users can see how far back history goes.
- Counts from forward-only tables (`mpc_sign_requests`, `mpc_sign_responses`) auto-align to the most-recent of (last 24h, earliest indexed timestamp), so the "Last 24h" KPI degrades gracefully into "Last Xh" when history is shorter than a day.

One-shot manual run:

```bash
pnpm indexers:run
```

Optional fallback: signed HTTP trigger (for controlled automation):

- POST /api/indexers/run
- Header: x-indexer-ts: unix epoch seconds
- Header: x-indexer-signature: HMAC SHA-256 of "${x-indexer-ts}:/api/indexers/run" using INDEXER_CRON_SECRET

Set this env var:

- INDEXER_CRON_SECRET
- Optional: INDEXER_ALLOWED_IPS for source allowlisting
- DASHBOARD_BASE_URL (used by helper trigger script)

Standardized helper commands:

```bash
# Preview signed headers without sending
pnpm indexers:trigger:dry

# Send signed POST to ${DASHBOARD_BASE_URL}/api/indexers/run
pnpm indexers:trigger

# Override endpoint manually
pnpm indexers:trigger --url https://your-dashboard-host/api/indexers/run
```

Example signed trigger:

```bash
TS=$(date +%s)
SIG=$(printf "%s:/api/indexers/run" "${TS}" | openssl dgst -sha256 -hmac "${INDEXER_CRON_SECRET}" -hex | sed 's/^.* //')

curl -X POST "${DASHBOARD_BASE_URL}/api/indexers/run" \
	-H "x-indexer-ts: ${TS}" \
	-H "x-indexer-signature: ${SIG}"
```

## 4. Railway Deployment Notes

Recommended Railway settings for web service:

- Build command: pnpm install --frozen-lockfile && pnpm prisma:generate && pnpm build
- Start command: pnpm start
- Health check path: /api/health

Recommended Railway settings for indexer worker service:

- Create a separate Railway service from the same repo.
- Start command: pnpm indexers:worker
- Set INDEXER_POLL_INTERVAL_MS to your desired cadence (for example 30000 or 60000).
- Use the same DATABASE_URL and source API credentials as the web service.

Optional scheduled job fallback (if you do not run a dedicated worker):

- Use Railway cron to call POST /api/indexers/run every 1-5 minutes.
- Pass x-indexer-ts and x-indexer-signature headers.

Railway cron command example:

```bash
TS=$(date +%s); SIG=$(printf "%s:/api/indexers/run" "$TS" | openssl dgst -sha256 -hmac "$INDEXER_CRON_SECRET" -hex | sed 's/^.* //'); curl -sS -X POST "$DASHBOARD_BASE_URL/api/indexers/run" -H "x-indexer-ts: $TS" -H "x-indexer-signature: $SIG"
```

## 5. Vercel Deployment (web frontend only)

Deployment topology:

- **Railway** hosts the Postgres database and the long-running indexer worker (`pnpm indexers:worker`). Do not change this.
- **Vercel** hosts only the Next.js web dashboard. It reads the same Railway Postgres over the public connection URL. The `/api/indexers/run` endpoint is still compiled but unused from Vercel — the Railway worker keeps indexing on its own cadence.

### Initial setup

1. Import the repo into Vercel. The Next.js preset is auto-detected; no `vercel.json` is required.
2. Set the following environment variables in the Vercel project (Production scope at minimum):
   - `DATABASE_URL` — Railway Postgres **public** URL, with pooling params (see below).

Vars you do **not** need on Vercel: `INDEXER_CRON_SECRET`, `INDEXER_ALLOWED_IPS`, `INDEXER_POLL_INTERVAL_MS`, any NEAR RPC / Auth0 / service-metrics / TVL variables — those belong to the Railway worker.

### Database URL on Vercel

Railway Postgres exposes two URLs:

- **Private** (`postgres.railway.internal:5432`) — accessible only from other Railway services. The indexer worker uses this. **Do not put this on Vercel** — Vercel cannot reach Railway's private network.
- **Public proxy** (`*.proxy.rlwy.net:<port>` or similar) — accessible from the internet. Vercel uses this.

Serverless functions open a new DB connection per cold start. Without pooling, Railway Postgres will exhaust `max_connections` under dashboard traffic. Mitigations:

- Append `?connection_limit=1&pool_timeout=20` to the Vercel `DATABASE_URL` (Prisma-side cap — each serverless instance will open at most one connection).
- If your Railway Postgres plan exposes a PgBouncer-compatible endpoint, use it and add `&pgbouncer=true`.
- Alternative: move the DB to a provider with built-in pooling (Neon, Supabase). Requires updating both Railway and Vercel `DATABASE_URL`s and running `pnpm prisma:migrate` against the new instance.

Migrations (`pnpm prisma:migrate`) should continue to run from Railway or your local shell against the **direct** URL, never from Vercel build.

### Build configuration

- Build command and output are auto-detected. No overrides needed.
- `output: "standalone"` in `next.config.ts` is Railway-oriented; Vercel ignores it.
- Security headers and `poweredByHeader: false` ship to Vercel unchanged.

## 6. Security Considerations

The dashboard is **publicly accessible** — there is no auth layer. Treat any data displayed (relayer activity, public-key mappings, sign-event metadata) as public information. Do not surface secrets or operator-only fields here.

Known accepted risks:

- **CSP allows `'unsafe-inline'` for `script-src`.** Required by Next.js App Router server-component inlining. Nonce-based CSP would require proxy rewrites.
- **IP allowlist (`INDEXER_ALLOWED_IPS`) trusts `x-forwarded-for`.** Safe behind Vercel or Railway's edge; unsafe behind untrusted proxy chains.

Run `pnpm audit --prod` before each release to catch new advisories.

## 7. Data Tables

Prisma schema in `prisma/schema.prisma`. Current set:

**Raw ingest**
- `near_transactions` — txs touching FastAuth (Paths 1-3 of `near.ts`).
- `mpc_transactions` — txs to `v1.signer` (Path 4 of `near.ts`, raw landing for MPC consensus).

**Derived from raw (by `near.ts`)**
- `fastauth_sign_events` — NEP-366 `FastAuth.sign()` decoded, PK `(tx_hash, action_index)`.
- `fastauth_consumer_transactions` — Delegate-wrapped meta-txs that consume a signature.
- `fastauth_user_transactions` — real user activity, USD-priced.

**Resolved (by `public-key-accounts.ts`)**
- `fastauth_public_key_accounts` — pubkey → accountId mapping.
- `accounts` — FastAuth user accounts (note: `firstSeenAt` = first observation in a sign event, not on-chain creation).

**Health classifications (per-tx receipt walks)**
- `fastauth_health_tx` — outcome ∈ `success | guard_failure | mpc_failure | other_failure | rpc_pending`. Carries `reached_mpc`.
- `fastauth_consumer_health_tx` — outcome ∈ `success | failure | rpc_pending`.
- `fastauth_user_health_tx` — same simplified outcome enum.

**MPC consensus (by `mpc-consensus.ts`)**
- `mpc_sign_requests` — parsed `sign:` logs. `source ∈ {direct, fastauth}`, `trafficSource ∈ {organic, synthetic}` (the latter flags `tx-bench.near` as benchmark traffic).
- `mpc_sign_responses` — parsed `respond:` logs, matched to requests via `request_key = {scheme}:{hex(payload)}`.
- `mpc_nodes` — roster mart, aggregated from responses.
- `mpc_log_parse_skipped` — tombstones for txs without parseable logs (typically guard-rejected FastAuth signs that never reached v1.signer).
- `mpc_consensus_events` — control-plane events (TEE attestations, code/launcher/OS hash votes, key-event lifecycle, contract upgrade votes, foreign-chain governance, node migrations). Args decoded inline from `mpc_transactions.payload_json`. Bucketed via `category ∈ {tee, version, key_events, updates, foreign_chains, migration, other}`.

**FastAuth contract state (by `fastauth-contract-state.ts`)**
- `fastauth_contract_snapshots` — append-only snapshots, one row per (contract, sample) at ~5 min cadence. Captures account state (balance, storage, code_hash, full_access_keys), free-form `config_json` (owner, paused, mpc_address, mpc_domain_id, mpc_key_version, version, get_public_keys for Auth0), and NEP-330 `source_metadata_json`. Dashboard reads latest per contract via `DISTINCT ON (contract_id)`.

**Marts**
- `relayers`, `relayer_dapps` — rebuilt each NEAR run.
- `mpc_nodes` — rebuilt each cycle that inserts new responses.

**Ops**
- `indexer_checkpoints` (key/value).
- `missing_block_ranges` (gap tracking — see "Gap management" in `CLAUDE.md`).

**Legacy / unused** — `auth0_logs`, `service_metrics_timeseries`, `account_tvl_daily_snapshots`, `fastauth_chain_health_snapshots` are declared in schema but no current collector populates them.

There is no test runner configured. Verification is via inspection scripts under `src/scripts/` (see `inspect-db.ts`, `_inspect-mpc.ts`, `_validate-mpc-parser.ts`, etc.).
