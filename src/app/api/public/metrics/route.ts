import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// Public, unauthenticated landing-page KPIs. Aggregate-only — no PII, no
// per-account or per-tx detail. Intended for the FastAuth marketing landing
// to render its "Live network" panel from the same Postgres the dashboard
// reads, without giving the landing direct DB credentials.
//
// Cached for 60s on the edge / browser via Cache-Control. Re-computed at
// most once per minute even if many landings hit it.

export const revalidate = 60;
export const dynamic = "force-dynamic";

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

  try {
    const [
      totalAccounts,
      newAccounts24h,
      activeAccounts24h,
      activeAccounts7d,
      signEvents7d,
      relayerCount,
      healthSuccess24h,
      healthFailure24h,
    ] = await Promise.all([
      prisma.account.count(),
      prisma.account.count({ where: { firstSeenAt: { gte: last24h } } }),
      prisma.account.count({ where: { lastSeenAt: { gte: last24h } } }),
      prisma.account.count({ where: { lastSeenAt: { gte: last7d } } }),
      prisma.fastAuthSignEvent.count({ where: { blockTimestamp: { gte: last7d } } }),
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

    return NextResponse.json(
      {
        fetchedAt: now.toISOString(),
        accounts: {
          total: totalAccounts,
          new24h: newAccounts24h,
          active24h: activeAccounts24h,
          active7d: activeAccounts7d,
        },
        signEvents: {
          last7d: signEvents7d,
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
