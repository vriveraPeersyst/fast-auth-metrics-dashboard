# FastAuth Metrics API Examples

This companion document provides concrete API requests for all sources defined in the metrics plan.

Related plan: [docs/fast-auth-metrics-collection-plan.md](docs/fast-auth-metrics-collection-plan.md)

## 1. Required Environment Variables

Set these before running calls.

~~~bash
export AUTH0_DOMAIN="your-tenant.us.auth0.com"
export AUTH0_CLIENT_ID="your-m2m-client-id"
export AUTH0_CLIENT_SECRET="your-m2m-client-secret"
export AUTH0_AUDIENCE="https://${AUTH0_DOMAIN}/api/v2/"

export RELAYER_BASE_URL="https://your-relayer-host"
export CUSTOM_ISSUER_BASE_URL="https://your-custom-issuer-host"
export CUSTOM_ISSUER_GO_BASE_URL="https://your-custom-issuer-go-host"

export NEAR_RPC_URL="https://rpc.mainnet.near.org"
~~~

## 2. Auth0 Management API

## 2.0 Read-Only and PII-Safe Profile

Use this default posture for the metrics collector key:

- Read-only scopes only.
- Do not grant user-directory scopes unless there is an explicit support need.
- Do not persist raw email, IP, user agent, full JWT, or full Auth0 details payloads.
- Store a salted hash of user_id for aggregation.

## 2.1 Get Management API Token

Endpoint:
POST https://{AUTH0_DOMAIN}/oauth/token

~~~bash
AUTH0_TOKEN=$(curl -s -X POST "https://${AUTH0_DOMAIN}/oauth/token" \
  -H "Content-Type: application/json" \
  -d "{\"client_id\":\"${AUTH0_CLIENT_ID}\",\"client_secret\":\"${AUTH0_CLIENT_SECRET}\",\"audience\":\"${AUTH0_AUDIENCE}\",\"grant_type\":\"client_credentials\"}" \
  | jq -r '.access_token')

echo "Token length: ${#AUTH0_TOKEN}"
~~~

Expected key fields:

- access_token
- token_type
- expires_in

## 2.2 Fetch Auth0 Logs (Incremental)

Endpoint:
GET https://{AUTH0_DOMAIN}/api/v2/logs

~~~bash
curl -s "https://${AUTH0_DOMAIN}/api/v2/logs?per_page=100&page=0&sort=date:1" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  | jq '.[0]'
~~~

Useful query parameters:

- per_page
- page
- sort
- include_totals
- from and take (checkpoint pagination)
- q (search filter)

Key fields to persist:

- _id
- date
- type
- description
- client_id
- client_name
- user_id_hash
- connection

Recommended transformation before storage:

~~~bash
curl -s "https://${AUTH0_DOMAIN}/api/v2/logs?per_page=100&page=0&sort=date:1" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  | jq '[.[] | {
      log_id: ._id,
      date: .date,
      type: .type,
      description: .description,
      client_id: .client_id,
      client_name: .client_name,
      connection: .connection,
      user_id_hash: (if .user_id then (.user_id | @sha256) else null end)
    }]'
~~~

## 2.3 Fetch Specific Log by ID

Endpoint:
GET https://{AUTH0_DOMAIN}/api/v2/logs/{id}

~~~bash
LOG_ID="replace_with_log_id"

curl -s "https://${AUTH0_DOMAIN}/api/v2/logs/${LOG_ID}" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  | jq
~~~

## 2.4 Optional: Fetch Users (Support-Only, Not for Default Metrics Collector)

Endpoint:
GET https://{AUTH0_DOMAIN}/api/v2/users

~~~bash
curl -s "https://${AUTH0_DOMAIN}/api/v2/users?per_page=100&page=0&include_totals=true" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  | jq '{total: .total, first_user: .users[0]}'
~~~

Key fields to persist:

- user_id
- email
- created_at
- updated_at
- last_login
- logins_count
- blocked
- identities
- app_metadata
- user_metadata

Privacy guidance:

- Keep this endpoint disabled for the default analytics key.
- If enabled for support workflows, avoid storing email and user_metadata in analytics datasets.

## 2.5 Optional: Fetch User by ID (Support-Only)

Endpoint:
GET https://{AUTH0_DOMAIN}/api/v2/users/{id}

~~~bash
AUTH0_USER_ID="auth0|123456"
ENCODED_USER_ID=$(python3 - <<'PY'
import urllib.parse, os
print(urllib.parse.quote(os.environ['AUTH0_USER_ID'], safe=''))
PY
)

curl -s "https://${AUTH0_DOMAIN}/api/v2/users/${ENCODED_USER_ID}" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  | jq
~~~

## 2.6 Optional: Fetch User by Email (Support-Only)

Endpoint:
GET https://{AUTH0_DOMAIN}/api/v2/users-by-email

~~~bash
EMAIL="user@example.com"

curl -s "https://${AUTH0_DOMAIN}/api/v2/users-by-email?email=${EMAIL}" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  | jq '.[0]'
~~~

## 2.7 Fetch Daily Stats

Endpoint:
GET https://{AUTH0_DOMAIN}/api/v2/stats/daily

~~~bash
curl -s "https://${AUTH0_DOMAIN}/api/v2/stats/daily?from=2026-01-01&to=2026-01-31" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  | jq '.[0]'
~~~

Key fields include:

- date
- logins
- signups

## 2.8 Fetch Active Users

Endpoint:
GET https://{AUTH0_DOMAIN}/api/v2/stats/active-users

~~~bash
curl -s "https://${AUTH0_DOMAIN}/api/v2/stats/active-users" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  | jq
~~~

## 2.9 Fetch Clients (Applications)

Endpoint:
GET https://{AUTH0_DOMAIN}/api/v2/clients

~~~bash
curl -s "https://${AUTH0_DOMAIN}/api/v2/clients?fields=client_id,name,app_type,callbacks&include_fields=true" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  | jq '.[0]'
~~~

## 2.10 Fetch Connections (Identity Providers)

Endpoint:
GET https://{AUTH0_DOMAIN}/api/v2/connections

~~~bash
curl -s "https://${AUTH0_DOMAIN}/api/v2/connections?fields=id,name,strategy,enabled_clients&include_fields=true" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  | jq '.[0]'
~~~

## 2.11 Optional: Create Log Stream

Endpoint:
POST https://{AUTH0_DOMAIN}/api/v2/log-streams

~~~bash
curl -s -X POST "https://${AUTH0_DOMAIN}/api/v2/log-streams" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "metrics-log-stream",
    "type": "http",
    "sink": {
      "httpEndpoint": "https://your-log-endpoint.example.com/auth0",
      "httpContentFormat": "JSONLINES",
      "httpContentType": "application/json"
    }
  }' | jq
~~~

List configured streams:

~~~bash
curl -s "https://${AUTH0_DOMAIN}/api/v2/log-streams" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  | jq
~~~

## 2.12 Minimum Auth0 Scopes (Least-Privilege)

Default read-only scopes for metrics collection:

- read:logs
- read:stats
- read:clients
- read:connections

Optional read-only scope:

- read:log_streams (only if you need to audit existing log stream configuration)

Avoid for default metrics collector:

- read:users

Not read-only and should be handled by an admin-only key outside the collector:

- create:log_streams

## 3. FastAuth Service Metrics

## 3.1 Relayer Metrics

Endpoint:
GET {RELAYER_BASE_URL}/api/metrics

~~~bash
curl -s "${RELAYER_BASE_URL}/api/metrics" | head -n 60
~~~

Useful metric names in this repository:

- sign_total
- sign_failed

Example extraction:

~~~bash
curl -s "${RELAYER_BASE_URL}/api/metrics" \
  | grep -E '^(sign_total|sign_failed)'
~~~

## 3.2 Custom Issuer (Nest) Metrics

Endpoint:
GET {CUSTOM_ISSUER_BASE_URL}/metrics

~~~bash
curl -s "${CUSTOM_ISSUER_BASE_URL}/metrics" | grep -E 'custom_issuer_'
~~~

Useful metric names:

- custom_issuer_tokens_issued_total
- custom_issuer_tokens_failed_total
- custom_issuer_issue_duration_seconds

## 3.3 Custom Issuer (Go) Metrics

Endpoint:
GET {CUSTOM_ISSUER_GO_BASE_URL}/metrics

~~~bash
curl -s "${CUSTOM_ISSUER_GO_BASE_URL}/metrics" | grep -E 'custom_issuer_go_'
~~~

Useful metric names:

- custom_issuer_go_tokens_issued_total
- custom_issuer_go_tokens_failed_total
- custom_issuer_go_tokens_validation_failed_total
- custom_issuer_go_issue_duration_seconds

## 4. NEAR RPC Examples

## 4.1 Fetch Transaction Status

Method:
POST {NEAR_RPC_URL} with method tx

~~~bash
TX_HASH="replace_with_base58_tx_hash"
SENDER_ID="replace_with_sender_account"

curl -s -X POST "${NEAR_RPC_URL}" \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": \"dontcare\",
    \"method\": \"tx\",
    \"params\": [\"${TX_HASH}\", \"${SENDER_ID}\"]
  }" | jq
~~~

Key fields to persist:

- result.transaction.hash
- result.transaction.signer_id
- result.transaction.receiver_id
- result.transaction.actions
- result.status
- result.transaction_outcome.outcome.gas_burnt
- result.receipts_outcome

## 4.2 Fetch Latest Final Block

Method:
POST {NEAR_RPC_URL} with method block

~~~bash
curl -s -X POST "${NEAR_RPC_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "dontcare",
    "method": "block",
    "params": {"finality": "final"}
  }' | jq '.result.header | {height, hash, timestamp}'
~~~

## 4.3 Call View Method on FastAuth Contract

Method:
POST {NEAR_RPC_URL} with method query

Example: read paused state from fast-auth.near.

~~~bash
curl -s -X POST "${NEAR_RPC_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "dontcare",
    "method": "query",
    "params": {
      "request_type": "call_function",
      "finality": "final",
      "account_id": "fast-auth.near",
      "method_name": "paused",
      "args_base64": "e30="
    }
  }' | jq
~~~

For view calls that return bytes in result.result, decode with:

~~~bash
jq -r '.result.result | map(. ) | @csv'
~~~

## 5. Recommended Polling Cadence

- Auth0 logs: every 1 to 5 minutes.
- Auth0 clients and connections: every 24 hours.
- Auth0 stats: every 24 hours.
- Service metrics: scrape every 30 to 60 seconds.
- NEAR block and tx indexing: continuous or every 5 to 15 seconds with checkpointing.

## 6. Checkpoint and Idempotency

Use these checkpoint keys:

- Auth0 logs: last log id and log timestamp.
- Prometheus: scrape timestamp.
- NEAR: block height and processed receipt id.

Idempotency keys:

- Auth0 logs: _id
- NEAR: transaction hash and receipt id
- Metrics samples: metric_name plus labels plus timestamp

## 7. Quick Validation Queries

## 7.1 Validate Auth0 Log Ingestion

~~~bash
curl -s "https://${AUTH0_DOMAIN}/api/v2/logs?per_page=5&sort=date:-1" \
  -H "Authorization: Bearer ${AUTH0_TOKEN}" \
  | jq '.[] | {id: ._id, type: .type, date: .date, user: .user_id}'
~~~

## 7.2 Validate Relayer Health Signal

~~~bash
curl -s "${RELAYER_BASE_URL}/api/metrics" \
  | grep -E 'sign_total|sign_failed'
~~~

## 7.3 Validate On-chain FastAuth Calls

Use tx hashes from relayer responses and call tx status endpoint from section 4.1.

## 8. Common Failure Modes

- 401 or 403 from Auth0: missing scopes or expired token.
- 429 from Auth0: rate limit hit, apply backoff and retry.
- Empty service metric output: endpoint path mismatch or scrape blocked by network.
- NEAR tx not found: wrong sender id for tx lookup or not finalized yet.
