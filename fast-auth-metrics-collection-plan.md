# FastAuth Metrics Collection Plan

## 1. Goal and Scope

This plan defines how to collect, store, and visualize FastAuth usage and reliability metrics across three data planes:

1. Auth0 identity and authentication telemetry.
2. FastAuth service telemetry (relayer and issuer metrics).
3. NEAR on-chain transaction outcomes.

The plan is designed to answer product and engineering questions about:

- Usage growth from dapps, partners, and users.
- Auth and signing funnel conversion.
- Failure reasons and system reliability.
- Security posture and suspicious activity.

## 2. Sources and Required Endpoints

### 2.1 Auth0 APIs

Base: `https://{AUTH0_DOMAIN}`

- `POST /oauth/token`
- `GET /api/v2/logs`
- `GET /api/v2/logs/{id}`
- `GET /api/v2/users`
- `GET /api/v2/users/{id}`
- `GET /api/v2/users-by-email`
- `GET /api/v2/stats/daily`
- `GET /api/v2/stats/active-users`
- `GET /api/v2/clients`
- `GET /api/v2/connections`
- Optional streaming:
- `POST /api/v2/log-streams`
- `GET /api/v2/log-streams`

### 2.2 FastAuth Service Endpoints

- Relayer metrics: `GET {RELAYER_BASE_URL}/api/metrics`
- Custom issuer (Nest) metrics: `GET {CUSTOM_ISSUER_BASE_URL}/metrics`
- Custom issuer (Go) metrics: `GET {CUSTOM_ISSUER_GO_BASE_URL}/metrics`

### 2.3 NEAR RPC

Base mainnet: `https://rpc.mainnet.near.org`

JSON-RPC methods required:

- `tx` or `EXPERIMENTAL_tx_status`
- `block`
- `query` for `call_function` (for selected contract state reads)

Main contracts:

- `fast-auth.near`
- `jwt.fast-auth.near`
- `auth0.jwt.fast-auth.near`

## 3. KPI Definitions

## 3.1 Identity and Authentication KPIs (Auth0)

- Login success rate = successful login events / login attempts.
- MFA challenge rate and MFA failure rate.
- Active users (daily, monthly).
- Provider mix (Google, Apple, username/password, passkey).
- Suspicious login event rate.

## 3.2 Signing Funnel KPIs (Cross-source)

- Auth success to sign request rate.
- Sign request to on-chain success conversion.
- End-to-end median and p95 signing latency.
- Drop-off by stage:
- login started
- login success
- sign request created
- on-chain sign succeeded

## 3.3 On-chain KPIs (NEAR)

- `sign` call volume by day and by guard.
- On-chain sign success rate.
- Guard verification reject rate.
- MPC signing failure rate.
- Algorithm mix (`secp256k1`, `ecdsa`, `eddsa`).
- Unique signer account count.
- Deposit and gas efficiency (avg, p95).

## 3.4 Service Reliability KPIs (Prometheus)

- Relayer sign failure ratio.
- Issuer token issuance success ratio.
- Issuer validation failure reasons (Go issuer labels).
- Latency distributions for relayer and issuer services.

## 4. Data Architecture

## 4.1 Ingestion Pattern

Use a hybrid ingestion model:

1. Polling jobs for Auth0 Management API resources.
2. Optional Auth0 log streaming for near real-time events.
3. Prometheus scrape for service metrics.
4. NEAR indexer job for transaction and receipt outcomes.

## 4.2 Storage Layers

1. Raw landing tables (append-only JSON payloads).
2. Normalized bronze/silver tables by entity:
- auth0_logs
- auth0_users
- auth0_clients
- auth0_connections
- relayer_metrics_timeseries
- issuer_metrics_timeseries
- near_transactions
- near_receipts
- near_fastauth_sign_events
3. Gold KPI marts for dashboards and alerts.

## 4.3 Correlation Strategy

Use privacy-safe joins:

- Primary cross-system user key: hashed `sub` (salted, irreversible in analytics layer).
- Event-level correlation key: generated request ID propagated through frontend, backend, and transaction metadata when possible.
- Time window fallback join for unmatched events.

Never store raw JWTs in analytics storage.

## 5. Collection Design by Source

## 5.1 Auth0 Collector

### Access and token refresh

- Use `POST /oauth/token` with client credentials.
- Refresh tokens proactively before expiry.

### Logs collector

- Pull `GET /api/v2/logs` incrementally with checkpointing by log id and timestamp.
- Backfill historical logs in controlled batches.
- Persist full payload in raw table and parse key fields into normalized table.

### Users collector

- Daily full sync from `GET /api/v2/users` with pagination.
- Upsert by `user_id`.
- Optional ad hoc lookups with `users-by-email` for support workflows.

### Stats collector

- Daily pull from `stats/daily` and `stats/active-users`.
- Compare against log-derived counts for quality checks.

### Metadata collector

- Refresh clients and connections daily.

## 5.2 Prometheus Scrape Collector

- Scrape relayer and issuer endpoints every 30-60 seconds.
- Retain high-resolution data for 7-14 days.
- Downsample to 5m/1h rollups for long-term trend reporting.

## 5.3 NEAR Indexing Collector

- Subscribe or poll blocks continuously.
- Filter transactions/receipts for target contract accounts.
- Parse method names and arguments for `sign`, `verify`, `add_guard`, `set_mpc_*`, etc.
- Capture success/failure status, gas used, attached deposits, and logs.

## 6. Data Model (Minimum)

## 6.1 `auth0_logs`

Columns:

- `log_id` (PK)
- `timestamp`
- `type`
- `description`
- `client_id`
- `connection`
- `user_id`
- `ip`
- `user_agent`
- `raw_payload_json`

## 6.2 `auth0_users`

Columns:

- `user_id` (PK)
- `email_hash`
- `created_at`
- `last_login`
- `blocked`
- `identities_json`
- `updated_at`

## 6.3 `near_fastauth_sign_events`

Columns:

- `tx_hash` (PK)
- `block_height`
- `block_timestamp`
- `signer_account_id`
- `receiver_id`
- `method_name`
- `guard_id`
- `algorithm`
- `attached_deposit_yocto`
- `gas_burnt`
- `execution_status`
- `failure_reason`
- `logs_json`

## 6.4 `service_metrics_timeseries`

Columns:

- `timestamp`
- `service_name`
- `metric_name`
- `labels_json`
- `value`

## 7. Dashboard Design

Create four dashboard groups.

1. Growth dashboard:
- Active users
- New users
- Provider mix
- Signing volume trend

2. Funnel dashboard:
- Login success
- Token issued
- Sign requested
- On-chain success

3. Reliability dashboard:
- Relayer and issuer error rates
- Latency p50/p95
- On-chain verification and MPC failure rates

4. Security dashboard:
- Suspicious login trends
- MFA anomalies
- Issuer validation failures by reason

## 8. Alerting Plan

Critical alerts:

- Login success rate drops below threshold for 15 minutes.
- On-chain sign success rate drops below threshold.
- Relayer sign_failed counter spike.
- Issuer token failure spike.
- Suspicious login event spike.

Warn-level alerts:

- p95 latency degradation.
- provider-specific failure increases.

## 9. Privacy and Security Controls

- Do not store raw JWT tokens.
- Hash PII fields (`email`, `sub`) before analytics persistence.
- Use least-privilege scopes for Auth0 Management API.
- Rotate API credentials and secrets regularly.
- Encrypt data at rest and in transit.
- Retention policy by dataset type (shorter for sensitive raw payloads).

## 10. Rollout Plan

Phase 1 (Week 1)

- Stand up collectors for Auth0 logs, relayer metrics, issuer metrics.
- Build raw and normalized tables.
- Validate ingestion completeness and checkpointing.

Phase 2 (Week 2)

- Add NEAR indexing for FastAuth contracts.
- Build cross-source joins and funnel marts.
- Publish initial dashboards.

Phase 3 (Week 3)

- Add alerting and SLO thresholds.
- Add data quality checks and reconciliation reports.
- Finalize runbook and on-call ownership.

Phase 4 (Week 4)

- Optional Auth0 log stream migration for near real-time.
- Optimize costs with rollups and partitioning.
- Add partner/dapp segmentation enhancements.

## 11. Data Quality and Reconciliation

Daily checks:

- Auth0 daily stats vs aggregated Auth0 logs.
- Relayer sign totals vs NEAR on-chain sign counts (allowing expected deltas).
- Issuer issuance counts vs sign requests requiring issuer tokens.

Checks for duplicates and gaps:

- Duplicate `log_id` detection.
- Transaction hash uniqueness checks.
- Ingestion lag monitoring per source.

## 12. Ownership and Operating Model

- Data engineering owns ingestion reliability and warehouse schemas.
- Backend/platform owns relayer/issuer endpoint uptime and metric correctness.
- Blockchain team owns NEAR indexing logic and contract event interpretation.
- Product/analytics owns KPI definitions and dashboard acceptance.

## 13. Implementation Checklist

- Create Auth0 M2M application and required API scopes.
- Provision secret storage for Auth0 credentials.
- Deploy collectors and schedulers.
- Create warehouse schemas and partition strategy.
- Configure Prometheus scrapes.
- Implement NEAR indexer filters for FastAuth contracts.
- Build dashboards and alerts.
- Validate with backfill and smoke tests.
- Publish runbook and maintenance SOP.

## 14. Deliverables

- Source collectors in production.
- Raw + normalized + KPI data models documented.
- 4 dashboard groups and alert pack deployed.
- Reconciliation report and data quality monitor.
- Runbook with incident and troubleshooting steps.
