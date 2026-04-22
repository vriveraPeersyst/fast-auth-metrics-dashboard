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

## 2. Google Closed Access (peersyst.org)

Required env vars:

- NEXTAUTH_URL
- NEXTAUTH_SECRET
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- ALLOWED_GOOGLE_DOMAIN (default peersyst.org)

Behavior:

- Only Google logins from ALLOWED_GOOGLE_DOMAIN are accepted.
- Google email must be provider-verified.
- Unauthenticated users are redirected to /sign-in.
- Non-domain users are denied during auth callback.

Google Cloud OAuth client checklist (required):

- Application type: Web application.
- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

If you get `Error 400: redirect_uri_mismatch`:

- Ensure the redirect URI above exists exactly (character-by-character) in the same OAuth client used by `GOOGLE_CLIENT_ID`.
- Ensure `NEXTAUTH_URL` is `http://localhost:3000` in local development.
- Restart `pnpm dev` after changing `.env`.
- Wait a few minutes for Google config propagation.

## 3. Railway Postgres

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

## 4. Indexers

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

## 5. Railway Deployment Notes

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

## 6. Data Tables

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
