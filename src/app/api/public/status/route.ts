import { NextResponse } from "next/server";

import { getDashboardData } from "@/lib/dashboard-data";

// Public, unauthenticated status payload for the FastAuth landing's /status
// page. This is a read-only projection of getDashboardData() — same data the
// dashboard's home page renders, reshaped into a stable JSON contract.
//
// The payload is large (top accounts, real-activity breakdowns, contracts,
// missing ranges). Cached for 60s on the edge so a hot cache absorbs landing
// fan-out without re-running the heavy dashboard query.

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

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function GET() {
  try {
    const data = await getDashboardData();

    const fa = data.fastAuthChainHealth;
    const mpc = data.mpcChainHealth;

    const fastAuth24h = fa?.successRatePct ?? null;
    const mpc24h = mpc?.successRatePct ?? null;

    const overall: "operational" | "degraded" =
      (fastAuth24h ?? 100) >= 99 && (mpc24h ?? 100) >= 99 ? "operational" : "degraded";

    // 24 hourly buckets for the uptime sparkline. Use chainHealthHistory if
    // populated, otherwise fall back to flat 24-bucket arrays of the current
    // window rate so the bar still renders.
    const uptime24h = build24hBuckets(data.chainHealthHistory, fastAuth24h, mpc24h);

    const recentFailures = (fa?.recentFailures ?? []).slice(0, 25).map((row) => ({
      at: row.blockTimestamp.toISOString(),
      kind: classifyFailureKind(row.outcome),
      executor: row.failingExecutorId ?? "—",
      reason: row.failureReason ?? row.outcome,
      txHash: row.txHash,
    }));

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        revalidateSeconds: 60,

        summary: {
          overall,
          fastAuthSuccess24h: fastAuth24h,
          mpcSuccess24h: mpc24h,
          txLast24h: fa?.totalTransactions ?? 0,
          accountsTotal: data.accountsOverview.totalAccounts,
          activeUsers24h: data.accountsOverview.active.last24h,
          chainHead: fa?.chainHead ?? data.latestNearFinalBlock ?? null,
        },

        fastAuthHealth: fa
          ? {
              successRatePct: fa.successRatePct,
              successful: fa.successfulTransactions,
              failed: fa.failedTransactions,
              guardFailed: fa.guardFailedTransactions,
              rpcPending: fa.rpcPendingTransactions,
              total: fa.totalTransactions,
              windowBlocks: fa.windowBlocks,
              windowStartHeight: fa.windowStartHeight,
              windowEndHeight: fa.windowEndHeight,
              lastSuccessAt: fa.lastSuccessTimestamp?.toISOString() ?? null,
              minutesSinceLastSuccess: fa.minutesSinceLastSuccess,
              computedAt: fa.computedAt.toISOString(),
            }
          : null,

        mpcHealth: mpc
          ? {
              successRatePct: mpc.successRatePct,
              attempted: mpc.attemptedTransactions,
              successful: mpc.successfulTransactions,
              failed: mpc.failedTransactions,
              rpcPending: mpc.rpcPendingTransactions,
              computedAt: mpc.computedAt.toISOString(),
            }
          : null,

        uptime24h,

        accounts: {
          total: data.accountsOverview.totalAccounts,
          indexed: data.accountsOverview.indexedAccounts,
          migrated: data.accountsOverview.migratedAccounts,
          firstSeen: data.accountsOverview.firstSeen,
          active: data.accountsOverview.active,
        },

        transactions: data.transactionOverview,

        realActivity: {
          trackingStartedAt: data.realActivity.trackingStartedAt
            ? {
                blockHeight: data.realActivity.trackingStartedAt.blockHeight,
                blockTimestamp:
                  data.realActivity.trackingStartedAt.blockTimestamp.toISOString(),
              }
            : null,
          rows: [
            {
              metric: "Total txs",
              last24h: data.realActivity.byWindow.last24h.total,
              last7d: data.realActivity.byWindow.last7d.total,
              last30d: data.realActivity.byWindow.last30d.total,
              all: data.realActivity.byWindow.all.total,
            },
            {
              metric: "Succeeded",
              last24h: data.realActivity.byWindow.last24h.succeeded,
              last7d: data.realActivity.byWindow.last7d.succeeded,
              last30d: data.realActivity.byWindow.last30d.succeeded,
              all: data.realActivity.byWindow.all.succeeded,
            },
            {
              metric: "Failed",
              last24h: data.realActivity.byWindow.last24h.failed,
              last7d: data.realActivity.byWindow.last7d.failed,
              last30d: data.realActivity.byWindow.last30d.failed,
              all: data.realActivity.byWindow.all.failed,
            },
            {
              metric: "Active users",
              last24h: data.realActivity.byWindow.last24h.distinctUsers,
              last7d: data.realActivity.byWindow.last7d.distinctUsers,
              last30d: data.realActivity.byWindow.last30d.distinctUsers,
              all: data.realActivity.byWindow.all.distinctUsers,
            },
          ],
          successRate: {
            last24h: data.realActivity.byWindow.last24h.successRatePct,
            last7d: data.realActivity.byWindow.last7d.successRatePct,
            last30d: data.realActivity.byWindow.last30d.successRatePct,
            all: data.realActivity.byWindow.all.successRatePct,
          },
          breakdowns: {
            // Receivers / methods: counts only (no per-row outcome split
            // available in dashboard schema today).
            receivers: data.realActivity.byReceiver
              .slice(0, 12)
              .map((r) => ({ label: r.key, txns: r.last24h, all: r.all })),
            methods: data.realActivity.byMethod
              .slice(0, 12)
              .map((r) => ({ label: r.key, txns: r.last24h, all: r.all })),
            // Relayers / providers / guards: GuardWindowStats has the full split.
            relayers: data.relayerBreakdownByActivity.slice(0, 12).map((r) => ({
              label: r.relayerAccountId,
              txns: r.last24h.total,
              succeeded: r.last24h.signed,
              failed: r.last24h.failed,
              successPct: r.last24h.successRatePct,
            })),
            providers: data.providerBreakdown.slice(0, 12).map((p) => ({
              label: p.providerType,
              txns: p.last24h.total,
              succeeded: p.last24h.signed,
              failed: p.last24h.failed,
              successPct: p.last24h.successRatePct,
            })),
            guards: data.guardBreakdown.slice(0, 12).map((g) => ({
              label: g.guardName,
              txns: g.last24h.total,
              succeeded: g.last24h.signed,
              failed: g.last24h.failed,
              successPct: g.last24h.successRatePct,
            })),
          },
        },

        actionTypes: data.actionTypeBreakdown.slice(0, 8).map((row) => {
          const total =
            data.actionTypeBreakdown.reduce((acc, r) => acc + r.last24h, 0) || 1;
          return {
            name: row.actionType,
            txns24h: row.last24h,
            pct: (row.last24h / total) * 100,
          };
        }),

        topAccounts: data.topAccounts.map((a) => ({
          accountId: a.accountId,
          calls24h: a.signEvents24h,
          callsAll: a.signEventsAll,
        })),
        topAccountsTotal: data.topAccounts.length,

        recentFailures,
        recentFailuresWindow: fa
          ? `Last 24h · ${fa.failedTransactions} failures`
          : "Last 24h",

        contracts: data.fastAuthContracts.contracts.map((c) => ({
          id: c.contractId,
          kind: c.label,
          balanceYocto: c.balanceYocto,
          storageBytes: c.storageUsage ? c.storageUsage.toString() : null,
          codeHash: c.codeHash,
          owner: extractStringConfig(c.config, "owner"),
          version: extractStringConfig(c.config, "version"),
          locked: c.locked,
          fullAccessKeys: c.fullAccessKeys,
          source: extractSourceLink(c.sourceMetadata),
          snapshotAt: c.snapshotAt.toISOString(),
        })),
        contractsTrackedSince: data.fastAuthContracts.earliestSnapshotAt?.toISOString() ?? null,

        indexer: {
          chainHead: data.indexerLag.chainHead,
          scannedHeight: data.indexerLag.scannedHeight,
          backfillStartHeight: data.indexerLag.backfillStartHeight,
          blocksBehind: data.indexerLag.blocksBehind,
          minutesBehind: data.indexerLag.minutesBehind,
          latestIndexedAt:
            data.indexerLag.latestIndexedBlockTimestamp?.toISOString() ?? null,
        },

        missingRanges: data.missingBlockRanges.map((r) => ({
          startHeight: r.startHeight,
          endHeight: r.endHeight,
          size: r.size,
          processed: r.blocksProcessed,
          pending: r.blocksPending,
          pctProcessed:
            r.size > 0 ? Math.round((r.blocksProcessed / r.size) * 1000) / 10 : 0,
          ascCursor: r.completedUpTo,
          descCursor: r.completedDownTo,
          status: r.status,
          reason: r.reason,
          recordedAt: r.recordedAt,
        })),
      },
      { headers: { ...CORS_HEADERS, ...CACHE_HEADERS } },
    );
  } catch (error) {
    console.error("[public/status] failed", error);
    return NextResponse.json(
      { error: "status_unavailable" },
      { status: 503, headers: CORS_HEADERS },
    );
  }
}

function classifyFailureKind(outcome: string): "guard_failure" | "mpc_failure" | "other" {
  if (outcome === "guard_failure") return "guard_failure";
  if (outcome === "mpc_failure") return "mpc_failure";
  return "other";
}

function extractStringConfig(config: Record<string, unknown>, key: string): string | null {
  const v = config?.[key];
  return typeof v === "string" ? v : null;
}

function extractSourceLink(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  const link = (meta as { link?: unknown }).link;
  return typeof link === "string" ? link : null;
}

type UptimeBucket = { hour: number; fastAuth: number; mpc: number };

function build24hBuckets(
  history: { computedAt: Date; fastAuthSuccessRatePct: number | null; mpcSuccessRatePct: number | null }[],
  faFallback: number | null,
  mpcFallback: number | null,
): UptimeBucket[] {
  const now = Date.now();
  const buckets: UptimeBucket[] = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    fastAuth: faFallback ?? 100,
    mpc: mpcFallback ?? 100,
  }));

  // Bucket history points by hour offset from now (0 = now, 23 = 23h ago).
  for (const point of history) {
    const ageMs = now - point.computedAt.getTime();
    const ageH = Math.floor(ageMs / (60 * 60 * 1000));
    if (ageH < 0 || ageH >= 24) continue;
    const idx = 23 - ageH;
    if (point.fastAuthSuccessRatePct !== null) {
      buckets[idx].fastAuth = point.fastAuthSuccessRatePct;
    }
    if (point.mpcSuccessRatePct !== null) {
      buckets[idx].mpc = point.mpcSuccessRatePct;
    }
  }

  return buckets;
}
