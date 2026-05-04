import { NextResponse } from "next/server";

import { MIGRATED_ACCOUNTS_TOTAL } from "@/lib/migrated-accounts";
import { prisma } from "@/lib/prisma";

// Public, unauthenticated landing-page KPIs. Aggregate-only — no PII, no
// per-account or per-tx detail. Intended for the FastAuth marketing landing
// to render its "Live network" panel from the same Postgres the dashboard
// reads, without giving the landing direct DB credentials.
//
// Cached for 60s — the route handler runs once per window, then the JSON
// response is served from Next's data cache. Don't add `dynamic =
// "force-dynamic"` here: it overrides `revalidate` and silently disables the
// cache, which was tripping Postgres 53100 (shmem exhaustion) under landing
// load.
export const revalidate = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
} as const;

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
};

const HEALTH_FAILURE_OUTCOMES = ["guard_failure", "mpc_failure", "other_failure"];

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function GET() {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  try {
    const [
      indexedAccounts,
      newAccounts24h,
      activeAccounts24h,
      activeAccounts7d,
      activeAccounts30d,
      signEvents7d,
      signEvents30d,
      relayerCount,
      healthSuccess24h,
      healthFailure24h,
    ] = await Promise.all([
      prisma.account.count(),
      prisma.account.count({ where: { firstSeenAt: { gte: last24h } } }),
      prisma.account.count({ where: { lastSeenAt: { gte: last24h } } }),
      prisma.account.count({ where: { lastSeenAt: { gte: last7d } } }),
      prisma.account.count({ where: { lastSeenAt: { gte: last30d } } }),
      prisma.fastAuthSignEvent.count({ where: { blockTimestamp: { gte: last7d } } }),
      prisma.fastAuthSignEvent.count({ where: { blockTimestamp: { gte: last30d } } }),
      prisma.relayer.count(),
      prisma.fastAuthHealthTx.count({
        where: { outcome: "success", blockTimestamp: { gte: last24h } },
      }),
      prisma.fastAuthHealthTx.count({
        where: { outcome: { in: HEALTH_FAILURE_OUTCOMES }, blockTimestamp: { gte: last24h } },
      }),
    ]);

    const classified24h = healthSuccess24h + healthFailure24h;
    const uptimePct =
      classified24h > 0 ? Math.round((healthSuccess24h / classified24h) * 1000) / 10 : null;

    // total = indexed (accounts table) + migrated (legacy FastAuth pre-indexer
    // snapshot). The two cohorts are disjoint; new24h / active{24h,7d,30d}
    // only reflect the indexed cohort because migrated accounts have no
    // per-account timestamps.
    return NextResponse.json(
      {
        fetchedAt: now.toISOString(),
        accounts: {
          total: indexedAccounts + MIGRATED_ACCOUNTS_TOTAL,
          indexed: indexedAccounts,
          migrated: MIGRATED_ACCOUNTS_TOTAL,
          new24h: newAccounts24h,
          active24h: activeAccounts24h,
          active7d: activeAccounts7d,
          active30d: activeAccounts30d,
        },
        signEvents: {
          last7d: signEvents7d,
          last30d: signEvents30d,
        },
        relayers: {
          total: relayerCount,
        },
        health24h: {
          uptimePct,
          classified: classified24h,
          successful: healthSuccess24h,
          failed: healthFailure24h,
        },
      },
      { headers: { ...CORS_HEADERS, ...CACHE_HEADERS } },
    );
  } catch (error) {
    console.error("[public/metrics] failed", error);
    return NextResponse.json(
      { error: "metrics_unavailable" },
      { status: 503, headers: CORS_HEADERS },
    );
  }
}
