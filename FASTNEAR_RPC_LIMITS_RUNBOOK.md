# FastNEAR RPC + API Limits Runbook

## Scope
This runbook captures the FastNEAR docs we need for this project and turns them into concrete operating rules for our indexer worker.

## Official Docs To Keep Open
- Docs home: https://docs.fastnear.com/
- RPC reference: https://docs.fastnear.com/rpc
- Auth and access: https://docs.fastnear.com/auth
- Auth for agents/workers: https://docs.fastnear.com/agents/auth
- Dashboard (keys + billing): https://dashboard.fastnear.com/
- Platform status: https://status.fastnear.com/

## Endpoint Roles (Mainnet)
From the RPC docs:
- Normal RPC: https://rpc.mainnet.fastnear.com
- Archival RPC: https://archival-rpc.mainnet.fastnear.com

How we use them:
- Normal RPC is the default for latest/finality polling.
- Archival RPC is required for historical backfills (older block heights/state).

## What The Docs Say About Limits
The public docs describe limits as policy-based (public access vs higher-limit or paid access) and do not publish fixed numeric quota tables (for example, X requests/second).

Documented behavior:
- Public endpoints can work without a key.
- Higher-limit or paid access is handled through FastNEAR Auth & Access and dashboard keys.
- A single FastNEAR API key works across RPC and supported REST surfaces.

Implication for operations:
- Treat 429 and transient 5xx as normal backpressure signals.
- Scale request volume conservatively and tune worker throughput.
- Move to authenticated higher-limit usage when needed.

## Auth Guidance For Production
Preferred:
- Authorization header: Authorization: Bearer <FASTNEAR_API_KEY>

Alternate (less preferred):
- Query parameter: ?apiKey=<FASTNEAR_API_KEY>

Why header-first:
- Lower risk of credential leakage through URL logs, analytics, copied links, and shell history.

## Current Project Env Settings
In this repository, NEAR indexing uses:
- NEAR_RPC_URL=https://rpc.mainnet.fastnear.com
- NEAR_ARCHIVAL_RPC_URL=https://archival-rpc.mainnet.fastnear.com
- NEAR_MAX_BLOCKS_PER_RUN=100

Related worker control:
- INDEXER_POLL_INTERVAL_MS controls cadence between iterations.

## Indexer Behavior Implemented Here
The NEAR collector is configured to:
1. Poll latest final block via normal RPC first (with fallback).
2. Backfill historical heights via archival RPC first (with fallback).
3. Retry transient failures (including 429) with backoff.
4. Limit per-run backfill by NEAR_MAX_BLOCKS_PER_RUN.

This keeps ingestion progressing without hammering one endpoint.

## Practical Tuning Rules
If you see frequent 429s:
1. Lower NEAR_MAX_BLOCKS_PER_RUN (for example 100 -> 50 -> 25).
2. Increase INDEXER_POLL_INTERVAL_MS (for example 30000 -> 60000).
3. Add API key auth for higher-limit behavior.
4. Confirm no duplicate workers are running concurrently.

If historical backfill is slow:
1. Keep archival endpoint as primary for historical reads.
2. Run worker continuously instead of large ad-hoc bursts.
3. Monitor progress by checkpoint height growth.

## Minimal Health Checks
Useful checks while operating:
- RPC status method against normal endpoint.
- Historical block read against archival endpoint.
- Dashboard query of near_last_final_block_height checkpoint.

## Notes
- FastNEAR docs are updated frequently; this runbook should be reviewed when docs update.
- If FastNEAR publishes explicit numeric limit tables in the future, add them here with source links.
