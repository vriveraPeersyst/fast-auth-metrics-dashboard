# FastAuth Metrics Dashboard: Software Engineering Study Guide

This guide explains the software engineering knowledge used in this repository, in a deep but practical way.

Goal: if you study this document carefully, you should understand not just what the code does, but why these engineering decisions are useful in real systems.

## How to Use This Guide

- Read each section in order once.
- After each section, open the linked file and connect the concept to real code.
- Run commands and routes locally while reading.
- Revisit the final "Study Roadmap" for repetition and mastery.

---

## 1. Product Thinking and Scope Definition

Software engineering starts before code: with a clear scope.

This repository defines a focused product:

- A private operational dashboard.
- Access restricted to a single Google Workspace domain.
- Metrics ingestion from Auth0, service Prometheus endpoints, and NEAR RPC.
- Storage in Railway Postgres.

Where this appears:

- [README.md](README.md)

Why this matters:

- Scope controls complexity.
- A tight scope enables secure defaults.
- Architectural decisions become easier when requirements are concrete.

---

## 2. System Architecture as Separable Modules

The system is split into layers instead of one large file:

- Presentation layer: pages and UI components.
- Auth layer: login and access policies.
- API layer: route handlers.
- Data layer: Prisma and schema.
- Ingestion layer: indexers.
- Ops layer: scripts and deployment configuration.

Where this appears:

- [src/app/page.tsx](src/app/page.tsx)
- [src/lib/auth.ts](src/lib/auth.ts)
- [src/app/api/indexers/run/route.ts](src/app/api/indexers/run/route.ts)
- [src/lib/prisma.ts](src/lib/prisma.ts)
- [src/lib/indexers/run-all.ts](src/lib/indexers/run-all.ts)
- [src/scripts/trigger-indexers.ts](src/scripts/trigger-indexers.ts)

Why this matters:

- Separation of concerns improves maintainability.
- You can test and evolve each area independently.
- Teams can work in parallel without stepping on each other.

---

## 3. TypeScript as a Design Tool

TypeScript here is not just syntax; it documents contracts.

Examples:

- The indexer result contract: source, status, inserted, details.
- Explicit data return shape from dashboard queries.
- Strong typing around parsed metric entries.

Where this appears:

- [src/lib/indexers/types.ts](src/lib/indexers/types.ts)
- [src/lib/dashboard-data.ts](src/lib/dashboard-data.ts)
- [src/lib/indexers/service-metrics.ts](src/lib/indexers/service-metrics.ts)

Why this matters:

- Fewer runtime surprises.
- Better IDE support and refactoring confidence.
- New contributors understand expectations quickly.

Key idea:

- Types encode architecture decisions. They are living documentation.

---

## 4. Next.js App Router and Server-First Rendering

The dashboard page is a server component that fetches data on the server and sends rendered HTML.

Where this appears:

- [src/app/page.tsx](src/app/page.tsx)

Why this matters:

- Better security: secrets stay server-side.
- Better performance: less client-side data fetching logic.
- Simpler mental model for admin-style dashboards.

Related pattern:

- Client components are used only where browser interactivity is needed.

Where this appears:

- [src/components/google-sign-in-button.tsx](src/components/google-sign-in-button.tsx)
- [src/components/logout-button.tsx](src/components/logout-button.tsx)

---

## 5. Authentication vs Authorization (Critical Distinction)

Authentication answers: "Who are you?"
Authorization answers: "Are you allowed here?"

This repo uses both:

- Authentication via NextAuth + Google provider.
- Authorization via domain policy, verified-email checks, route gating.

Where this appears:

- [src/lib/auth.ts](src/lib/auth.ts)
- [src/proxy.ts](src/proxy.ts)
- [src/app/sign-in/page.tsx](src/app/sign-in/page.tsx)
- [src/app/page.tsx](src/app/page.tsx)

Important engineering pattern:

- Defense in depth: checks are repeated in multiple layers.

Example in this repo:

1. NextAuth callback validates domain and verified email.
2. Proxy validates token email domain for protected routes.
3. Sensitive operations are isolated to backend workers and protected API endpoints.

Why this matters:

- If one control is bypassed, another can still block unauthorized access.

---

## 6. Security Engineering in HTTP APIs

The indexer trigger endpoint is hardened beyond a basic shared secret.

Controls used:

- HMAC SHA-256 request signature.
- Timestamp-based replay-window check.
- Constant-time signature comparison.
- Optional source IP allowlist.

Where this appears:

- [src/app/api/indexers/run/route.ts](src/app/api/indexers/run/route.ts)

Why this matters:

- Prevents trivial replay and signature timing attacks.
- Makes cron/webhook invocation safer in production.

Supporting ops tooling:

- A helper script signs requests consistently.

Where this appears:

- [src/scripts/trigger-indexers.ts](src/scripts/trigger-indexers.ts)

---

## 7. Platform Security Headers and Browser Hardening

Security is also enforced at the HTTP response header level.

Implemented headers include:

- Content Security Policy.
- X-Frame-Options.
- Strict-Transport-Security.
- X-Content-Type-Options.
- Referrer-Policy.
- Permissions-Policy.

Where this appears:

- [next.config.ts](next.config.ts)

Why this matters:

- Reduces browser attack surface.
- Protects against common classes of web attacks.
- Applies globally with one centralized configuration.

---

## 8. Secrets and Environment-Based Configuration

Runtime secrets and deployment-specific values are injected through environment variables.

Where this appears:

- [.env.example](.env.example)
- [README.md](README.md)

Engineering principles used:

- 12-factor configuration.
- No hardcoded credentials.
- Operational flexibility across local, staging, and prod.

Why this matters:

- Safe secret rotation.
- Easier deployment automation.
- Different environments can share code but vary behavior.

---

## 9. Data Modeling and Persistence Design

The Prisma schema defines normalized entities and indexes to support query patterns.

Entities include:

- auth0_logs
- service_metrics_timeseries
- near_transactions
- indexer_checkpoints

Where this appears:

- [prisma/schema.prisma](prisma/schema.prisma)

Engineering concepts used:

- Primary keys for uniqueness and idempotency.
- Indexes aligned with query access patterns.
- JSON columns for flexible labels/payload fragments.
- Timestamp metadata for operational visibility.

Why this matters:

- Correct schema design is foundational to performance and data quality.

---

## 10. Privacy-Aware Analytics Design

This code explicitly avoids storing full sensitive payloads for Auth0 events.

Where this appears:

- [src/lib/indexers/auth0.ts](src/lib/indexers/auth0.ts)

Privacy controls used:

- Salted hash for user identifiers.
- Safe payload allowlist instead of full raw event persistence.
- Separation between operational metrics and identity details.

Why this matters:

- Limits blast radius during incidents.
- Supports privacy-by-design analytics.
- Reduces compliance burden.

---

## 11. Indexer Engineering: Ingestion Pipelines

The indexing system follows a modular collector pattern.

Collectors:

- Auth0 collector.
- Service metrics collector.
- NEAR state collector.

Orchestration:

- Run collectors in parallel.
- Return structured run results.

Where this appears:

- [src/lib/indexers/auth0.ts](src/lib/indexers/auth0.ts)
- [src/lib/indexers/service-metrics.ts](src/lib/indexers/service-metrics.ts)
- [src/lib/indexers/near.ts](src/lib/indexers/near.ts)
- [src/lib/indexers/run-all.ts](src/lib/indexers/run-all.ts)

Engineering concepts used:

- Source-specific parsing and normalization.
- Unified result interface.
- Operationally useful status reporting.

---

## 12. Checkpointing and Idempotency

The system stores progress checkpoints to support incremental ingestion.

Where this appears:

- [src/lib/indexers/auth0.ts](src/lib/indexers/auth0.ts)
- [src/lib/indexers/near.ts](src/lib/indexers/near.ts)
- [prisma/schema.prisma](prisma/schema.prisma)

Techniques used:

- Checkpoint keys in database.
- Upsert for atomic create-or-update behavior.
- Skip duplicates on bulk insert.

Why this matters:

- You can rerun jobs safely.
- System can resume after failures.
- Prevents data inflation from duplicate ingestion.

---

## 13. Concurrency and Latency Optimization

Independent tasks are executed concurrently with Promise.all.

Where this appears:

- [src/lib/indexers/run-all.ts](src/lib/indexers/run-all.ts)
- [src/lib/dashboard-data.ts](src/lib/dashboard-data.ts)

Why this matters:

- Reduces total response time for dashboards and jobs.
- Improves throughput without extra infrastructure.

Tradeoff to understand:

- Concurrency improves speed but can increase external API pressure.

---

## 14. Parsing and Data Transformation

Prometheus text exposition is parsed into typed metric samples.

Where this appears:

- [src/lib/indexers/service-metrics.ts](src/lib/indexers/service-metrics.ts)

Concepts used:

- Regex-based protocol parsing.
- Label extraction and normalization.
- Metric filtering by service-specific allowlist.

Why this matters:

- Integrations often require careful translation from external formats to internal models.

---

## 15. Error Handling Strategy

Collectors use a controlled error-to-result pattern instead of throwing unhandled exceptions outward.

Where this appears:

- [src/lib/indexers/auth0.ts](src/lib/indexers/auth0.ts)
- [src/lib/indexers/service-metrics.ts](src/lib/indexers/service-metrics.ts)
- [src/lib/indexers/near.ts](src/lib/indexers/near.ts)

Pattern:

- Return status = ok, skipped, or error.
- Include details field for operations/debugging.

Why this matters:

- Job orchestrators can report partial success clearly.
- Failures in one source do not necessarily crash all pipelines.

---

## 16. Continuous Backend Worker Pattern

Indexer ingestion runs continuously in a backend worker process, not from the frontend.

Where this appears:

- [src/scripts/indexer-worker.ts](src/scripts/indexer-worker.ts)
- [src/lib/indexers/run-all.ts](src/lib/indexers/run-all.ts)
- [README.md](README.md)

Engineering ideas:

- Polling loop with configurable interval.
- Sequential iterations to avoid overlapping runs.
- Structured logging per iteration.
- One-shot script retained for manual operational runs.

Why this matters:

- Frontend remains read-only and cannot accidentally trigger ingestion jobs.
- Background work has clearer operational ownership.
- Worker lifecycle can be managed independently from web request traffic.

---

## 17. Query Design for Dashboard UX

Dashboard data retrieval balances freshness, simplicity, and readability.

Where this appears:

- [src/lib/dashboard-data.ts](src/lib/dashboard-data.ts)

Patterns used:

- Time-windowed aggregations.
- Latest-value lookups for counters.
- Limited recent logs list.
- Derived values like failure rate in UI layer.

Why this matters:

- Good dashboards are not only data-rich; they are query-efficient and focused.

---

## 18. Runtime Resource Management

Prisma client is implemented as a singleton in development to avoid repeated connection creation under hot-reload.

Where this appears:

- [src/lib/prisma.ts](src/lib/prisma.ts)

Why this matters:

- Prevents connection exhaustion.
- Stabilizes local development experience.

---

## 19. CLI Tooling and Operational Automation

Scripts are first-class engineering assets in this repo.

Where this appears:

- [package.json](package.json)
- [src/scripts/run-indexers.ts](src/scripts/run-indexers.ts)
- [src/scripts/trigger-indexers.ts](src/scripts/trigger-indexers.ts)

Capabilities:

- Local/manual indexer runs.
- Signed HTTP trigger generation.
- Dry-run mode for safer operations.
- Timeout and argument parsing for robustness.

Why this matters:

- Operational consistency reduces human error.
- Reproducible commands are easier to automate.

---

## 20. DevOps and Deployment Engineering

The project includes production-oriented deployment guidance.

Where this appears:

- [README.md](README.md)
- [next.config.ts](next.config.ts)

Engineering choices:

- Standalone Next build output for container runtimes.
- Health endpoint for liveness checks.
- Migration commands in deployment flow.
- Cron integration pattern for background jobs.

Where this appears:

- [src/app/api/health/route.ts](src/app/api/health/route.ts)

Why this matters:

- Deployability is part of engineering quality.

---

## 21. Dependency and Supply-Chain Hygiene

The repo locks package manager and uses dependency audit process plus transitive override strategy.

Where this appears:

- [package.json](package.json)

Concepts used:

- Reproducible package manager version.
- Security audits.
- Targeted override for vulnerable transitive dependency.

Why this matters:

- Supply-chain risk is one of the most common production risks.

---

## 22. Frontend Engineering Beyond Layout

The CSS and typography setup show system-level design thinking.

Where this appears:

- [src/app/globals.css](src/app/globals.css)
- [src/app/layout.tsx](src/app/layout.tsx)

Concepts used:

- Design tokens via CSS variables.
- Responsive behavior with media queries.
- Reusable component classes for action and ghost buttons.
- Brand typography integration through optimized font loading.

Why this matters:

- Maintainable styling is software architecture for UI.

---

## 23. Documentation as an Engineering Deliverable

The README acts like an operational runbook.

Where this appears:

- [README.md](README.md)

What it includes:

- Environment requirements.
- Local setup.
- Migration flow.
- Trigger and cron instructions.
- Production deployment notes.

Why this matters:

- Documentation reduces onboarding and operational mistakes.

---

## 24. What Is Missing (and Why You Should Learn It Next)

This repo is a strong foundation, but production maturity usually also needs:

- Automated tests (unit, integration, e2e).
- Structured logging and centralized observability.
- Alerting and SLO dashboards.
- Rate limiting middleware for sensitive APIs.
- Migration rollback playbooks.

This is not a weakness; it is a normal next step in iterative engineering.

---

## 25. Mental Models to Keep

1. Security is layered, not binary.
2. Data pipelines need idempotency from day one.
3. Types are architecture.
4. Operational scripts are product code.
5. Documentation is part of reliability.

---

## 26. Study Roadmap (Suggested)

### Pass 1: Architecture Map (60-90 minutes)

- Read [README.md](README.md).
- Trace request flow through [src/app/page.tsx](src/app/page.tsx), [src/lib/dashboard-data.ts](src/lib/dashboard-data.ts), and [src/lib/prisma.ts](src/lib/prisma.ts).

### Pass 2: Security Deep Dive (90-120 minutes)

- Study [src/lib/auth.ts](src/lib/auth.ts), [src/proxy.ts](src/proxy.ts), and [src/app/api/indexers/run/route.ts](src/app/api/indexers/run/route.ts).
- Reproduce signed trigger flow with [src/scripts/trigger-indexers.ts](src/scripts/trigger-indexers.ts).

### Pass 3: Data and Ingestion (120 minutes)

- Read [prisma/schema.prisma](prisma/schema.prisma).
- Follow each indexer:
  - [src/lib/indexers/auth0.ts](src/lib/indexers/auth0.ts)
  - [src/lib/indexers/service-metrics.ts](src/lib/indexers/service-metrics.ts)
  - [src/lib/indexers/near.ts](src/lib/indexers/near.ts)
- Understand orchestrator in [src/lib/indexers/run-all.ts](src/lib/indexers/run-all.ts).

### Pass 4: Frontend and UX Engineering (60 minutes)

- Study [src/app/globals.css](src/app/globals.css) and [src/app/layout.tsx](src/app/layout.tsx).
- Connect token system to component usage in [src/app/page.tsx](src/app/page.tsx).

### Pass 5: Hands-on Reinforcement

- Run local app.
- Trigger indexers manually.
- Add one new metric card and one new indexer source.
- Update documentation as if handing off to another engineer.

---

## 27. Self-Check Questions

- Can you explain why both auth callback checks and proxy checks exist?
- Can you describe how replay protection works in the indexer endpoint?
- Can you point to where idempotency is implemented?
- Can you explain how dashboard reads are optimized with concurrent queries?
- Can you explain why safe payload allowlisting is better than raw event storage?

If you can answer these from memory, your understanding is already strong.

---

## Final Note

This repository is a very good real-world learning artifact because it combines:

- Product concerns.
- Security concerns.
- Data engineering concerns.
- UI concerns.
- Deployment concerns.

That cross-domain integration is the core of modern software engineering.
