# FastAuth Metrics Dashboard

Private dashboard for FastAuth analytics with:

- Next.js App Router + TypeScript
- pnpm workspace tooling
- Google SSO restricted to the peersyst.org domain
- Railway Postgres-backed storage for indexer output

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

This repo includes six collectors:

- Auth0 incremental logs collector
- Prometheus collector for relayer and issuers
- NEAR transaction collector with final block checkpoints + derived FastAuth sign events
- FastAuth public-key account linker (maps relayer public keys to discovered NEAR accounts)
- Sponsored-account TVL snapshot collector
- Dashboard KPI snapshot collector (writes transaction/account/relayer monitoring metrics)

Crash-recovery behavior:

- Auth0 ingestion is checkpointed transactionally with durable progress updates.
- NEAR indexing backfills missed final block heights from last checkpoint, writes `near_transactions` rows for FastAuth contract transactions, derives `fastauth_sign_events`, and rebuilds relayer marts.
- Public-key account linking is checkpointed incrementally on `fastauth_sign_events.id`.
- Service counter metrics also persist *_delta samples to preserve aggregate counter growth across worker downtime.

Primary mode: continuous backend worker (recommended):

```bash
pnpm indexers:worker
```

Worker config:

- INDEXER_POLL_INTERVAL_MS (default 30000)
- NEAR_RPC_URL (normal endpoint for latest-final polling)
- NEAR_RPC_FALLBACKS (optional comma-separated fallback endpoints for latest-final polling)
- NEAR_ARCHIVAL_RPC_URL (archival endpoint for historical backfill)
- NEAR_ARCHIVAL_RPC_FALLBACKS (optional comma-separated fallback endpoints for historical backfill)
- NEAR_BACKFILL_START_HEIGHT (optional first-run seed if no checkpoint exists)
- NEAR_MAX_BLOCKS_PER_RUN (default 100)
- FASTAUTH_CONTRACT_IDS (comma-separated FastAuth contract IDs used for sign-event derivation)
- FASTAUTH_PUBLIC_KEY_ACCOUNTS_URL_TEMPLATE (optional URL template for account lookup by public key; supports `{publicKey}` token)
- FASTAUTH_PUBLIC_KEY_ACCOUNTS_BATCH_SIZE (default 200)
- FASTAUTH_PUBLIC_KEY_LOOKBACK_DAYS (default 30; only used before first account-link checkpoint)
- TVL_RPC_URL (optional; defaults to NEAR_RPC_URL)
- TVL_LOOKBACK_DAYS (default 30)
- TVL_MAX_ACCOUNTS_PER_RUN (default 200)

Relayer dashboard sourcing:

- Relayer and relayer-dapp stats are sourced from backend-built marts (`relayers`, `relayer_dapps`) derived from indexed FastAuth sign events.
- FastAuth transaction totals/failures and relayer activity windows are sourced from `fastauth_sign_events`.
- Account totals/created/active windows are sourced from `fastauth_public_key_accounts`.
- Relayer TVL is computed from latest `account_tvl_daily_snapshots` for sponsored accounts.
- Relayer project owner labels are sourced from indexed relayer Prometheus samples when exposed.

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

Prisma models included:

- auth0_logs
- service_metrics_timeseries
- near_transactions
- fastauth_sign_events
- relayers
- relayer_dapps
- account_tvl_daily_snapshots
- indexer_checkpoints

These are designed to align with the collection plan and can be expanded during KPI mart development.
