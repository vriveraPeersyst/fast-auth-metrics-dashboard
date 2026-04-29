import type { PrismaClient } from "@prisma/client";

import {
  classifyTxGeneric,
  runWithConcurrency,
} from "@/lib/indexers/health-classifier";
import { createNearRpcManager } from "@/lib/indexers/near-rpc-manager";
import type { IndexerRunResult } from "@/lib/indexers/types";

const DISCOVER_LIMIT = 50;
const RETRY_LIMIT = 25;

const DISCOVERY_LOOKBACK_DAYS = 1;
const DISCOVERY_LOOKBACK_MS = DISCOVERY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

const MAX_RETRY_COUNT = 10;
const RETRY_BACKOFF_MS = 5 * 60 * 1000;
const TX_STATUS_CONCURRENCY = 8;

type DiscoveryRow = {
  tx_hash: string;
  signer_account_id: string;
  block_height: bigint;
  block_timestamp: Date;
};

export async function collectFastAuthUserHealth(
  prisma: PrismaClient,
): Promise<IndexerRunResult> {
  const rpcManager = createNearRpcManager();
  const lookbackCutoff = new Date(Date.now() - DISCOVERY_LOOKBACK_MS);

  // ── Pass 1: discovery ──────────────────────────────────────────────
  const candidates = await prisma.$queryRaw<DiscoveryRow[]>`
    SELECT u.tx_hash, u.signer_account_id, u.block_height, u.block_timestamp
    FROM fastauth_user_transactions u
    LEFT JOIN fastauth_user_health_tx h ON h.tx_hash = u.tx_hash
    WHERE h.tx_hash IS NULL
      AND u.block_timestamp >= ${lookbackCutoff}
    ORDER BY u.block_height DESC
    LIMIT ${DISCOVER_LIMIT}
  `;

  let discoveredOk = 0;
  let discoveredFailed = 0;
  let discoveredPending = 0;

  if (candidates.length > 0) {
    type ClassifiedRow = DiscoveryRow & Awaited<
      ReturnType<typeof classifyTxGeneric>
    >;
    const classified: ClassifiedRow[] = [];

    await runWithConcurrency(
      candidates,
      TX_STATUS_CONCURRENCY,
      async (candidate) => {
        const result = await classifyTxGeneric(
          rpcManager,
          candidate.tx_hash,
          candidate.signer_account_id,
          "fastauth-user-health",
        );
        classified.push({ ...candidate, ...result });
      },
    );

    const now = new Date();
    await prisma.fastAuthUserHealthTx.createMany({
      data: classified.map((row) => ({
        txHash: row.tx_hash,
        signerId: row.signer_account_id,
        blockHeight: row.block_height,
        blockTimestamp: row.block_timestamp,
        outcome: row.outcome,
        failingExecutorId: row.failingExecutorId,
        failureReason: row.failureReason,
        retryCount: row.outcome === "rpc_pending" ? 1 : 0,
        lastAttemptedAt: now,
        lastError: row.lastError,
        classifiedAt: row.outcome === "rpc_pending" ? null : now,
      })),
      skipDuplicates: true,
    });

    for (const row of classified) {
      if (row.outcome === "success") {
        discoveredOk += 1;
      } else if (row.outcome === "rpc_pending") {
        discoveredPending += 1;
      } else {
        discoveredFailed += 1;
      }
    }
  }

  // ── Pass 2: retry sweep ────────────────────────────────────────────
  const retryCutoff = new Date(Date.now() - RETRY_BACKOFF_MS);
  const pendingRows = await prisma.fastAuthUserHealthTx.findMany({
    where: {
      outcome: "rpc_pending",
      retryCount: { lt: MAX_RETRY_COUNT },
      OR: [
        { lastAttemptedAt: null },
        { lastAttemptedAt: { lt: retryCutoff } },
      ],
    },
    orderBy: { lastAttemptedAt: "asc" },
    take: RETRY_LIMIT,
    select: { txHash: true, signerId: true, retryCount: true },
  });

  let retriedResolved = 0;
  let retriedStillPending = 0;

  if (pendingRows.length > 0) {
    await runWithConcurrency(
      pendingRows,
      TX_STATUS_CONCURRENCY,
      async (row) => {
        const result = await classifyTxGeneric(
          rpcManager,
          row.txHash,
          row.signerId,
          "fastauth-user-health",
        );
        const now = new Date();

        await prisma.fastAuthUserHealthTx.update({
          where: { txHash: row.txHash },
          data: {
            outcome: result.outcome,
            failingExecutorId: result.failingExecutorId,
            failureReason: result.failureReason,
            retryCount: { increment: 1 },
            lastAttemptedAt: now,
            lastError: result.lastError,
            classifiedAt: result.outcome === "rpc_pending" ? null : now,
          },
        });

        if (result.outcome === "rpc_pending") {
          retriedStillPending += 1;
        } else {
          retriedResolved += 1;
        }
      },
    );
  }

  const totalDiscovered = discoveredOk + discoveredFailed + discoveredPending;
  const totalRetried = retriedResolved + retriedStillPending;

  return {
    source: "fastauth_user_health",
    status: "ok",
    inserted: totalDiscovered,
    details:
      `Discovered ${totalDiscovered} ` +
      `(${discoveredOk} ok, ${discoveredFailed} failed, ${discoveredPending} pending); ` +
      `retried ${totalRetried} ` +
      `(${retriedResolved} resolved, ${retriedStillPending} still pending).`,
  };
}
