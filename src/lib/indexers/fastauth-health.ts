import type { PrismaClient } from "@prisma/client";

import {
  extractFailureReason,
  isFailureStatus,
  runWithConcurrency,
} from "@/lib/indexers/health-classifier";
import { createNearRpcManager } from "@/lib/indexers/near-rpc-manager";
import type { IndexerRunResult } from "@/lib/indexers/types";

// Per-cycle work caps. Sized so worst-case cycle time stays bounded even when
// every tx RPC call hits the pool's 15s timeout — at concurrency 8, a fully
// timing-out batch takes (cap/8 * 15s). With these caps, that's ~94s discovery
// + ~47s retry. In the steady state most calls succeed in ~200ms and a cycle
// completes in seconds.
const DISCOVER_LIMIT = 50;
const RETRY_LIMIT = 25;

// On fresh deploy this is the size of the one-time backlog the discovery pass
// will work through. Anything older is permanently skipped — those sign events
// keep whatever chunk-level executionStatus near.ts originally recorded.
// Aligned to the live cards' 24h window so the dashboard reaches steady state
// in a single backlog drain.
const DISCOVERY_LOOKBACK_DAYS = 1;
const DISCOVERY_LOOKBACK_MS = DISCOVERY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

// rpc_pending rows are retried at most this many times. After that they freeze
// as rpc_pending — we don't promote to other_failure because we never confirmed
// what actually happened to the tx.
const MAX_RETRY_COUNT = 10;
// Spacing between successive retries for the same row, so a transient RPC
// blip doesn't get hammered on every tick.
const RETRY_BACKOFF_MS = 5 * 60 * 1000;

// Concurrency for tx RPC lookups within a pass. Matches the old prober's
// CHAIN_HEALTH_TX_STATUS_CONCURRENCY, which the public RPC pool tolerates.
const TX_STATUS_CONCURRENCY = 8;

type Outcome =
  | "success"
  | "guard_failure"
  | "mpc_failure"
  | "other_failure"
  | "rpc_pending";

type NearReceiptOutcome = {
  outcome?: {
    executor_id?: string;
    status?: unknown;
  };
};

type NearTxStatusResponse = {
  result?: {
    transaction_outcome?: {
      outcome?: {
        executor_id?: string;
        status?: unknown;
      };
    };
    receipts_outcome?: NearReceiptOutcome[];
  };
};

type Classification = {
  outcome: Outcome;
  reachedMpc: boolean | null;
  failingExecutorId: string | null;
  // Receipt-level error message extracted from the failing receipt's status.
  // Set on any *_failure outcome; null on success/rpc_pending.
  failureReason: string | null;
  // RPC-level error message — only set when the tx RPC call itself failed
  // (network error, timeout, endpoint exhausted) and we couldn't classify.
  lastError: string | null;
};

function resolveFastAuthContractIds(): string[] {
  const raw = process.env.FASTAUTH_CONTRACT_IDS;
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

// Configurable via env; otherwise derives v1.signer (mainnet) or
// v1.signer-prod.testnet (testnet) from each FastAuth contract's suffix.
function resolveMpcContractIds(fastAuthContractIds: string[]): Set<string> {
  const ids = new Set<string>();
  const configured = process.env.FASTAUTH_MPC_CONTRACT_ID?.trim();
  if (configured) {
    ids.add(configured.toLowerCase());
  }

  for (const fa of fastAuthContractIds) {
    ids.add(fa.endsWith(".testnet") ? "v1.signer-prod.testnet" : "v1.signer");
  }
  return ids;
}

async function classifyTx(
  rpcManager: ReturnType<typeof createNearRpcManager>,
  txHash: string,
  signerId: string,
  mpcContractSet: Set<string>,
): Promise<Classification> {
  let txStatus: NearTxStatusResponse;
  try {
    txStatus = await rpcManager.request<NearTxStatusResponse>(
      "tx",
      [txHash, signerId],
      `fastauth-health:tx ${txHash}`,
    );
  } catch (error) {
    return {
      outcome: "rpc_pending",
      reachedMpc: null,
      failingExecutorId: null,
      failureReason: null,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }

  const receipts = txStatus.result?.receipts_outcome ?? [];
  let reachedMpc = false;
  let firstFailingExecutor: string | null = null;
  let firstFailingStatus: unknown = null;

  for (const receipt of receipts) {
    const executor =
      receipt.outcome?.executor_id?.trim().toLowerCase() ?? null;
    if (executor && mpcContractSet.has(executor)) {
      reachedMpc = true;
    }
    if (
      firstFailingExecutor === null &&
      isFailureStatus(receipt.outcome?.status)
    ) {
      firstFailingExecutor = executor;
      firstFailingStatus = receipt.outcome?.status;
    }
  }

  const txConversionStatus = txStatus.result?.transaction_outcome?.outcome?.status;
  const txConversionFailed = isFailureStatus(txConversionStatus);
  const anyFailure = firstFailingExecutor !== null || txConversionFailed;

  if (!anyFailure) {
    return {
      outcome: "success",
      reachedMpc,
      failingExecutorId: null,
      failureReason: null,
      lastError: null,
    };
  }

  // Pick the most informative failure source: the failing receipt's status
  // if any, otherwise the conversion-level failure.
  const failureReason =
    extractFailureReason(firstFailingStatus) ??
    extractFailureReason(txConversionStatus);

  // Failure attribution:
  //   - failing executor in MPC set        -> mpc_failure
  //   - reached MPC but failure elsewhere  -> other_failure
  //   - everything else (incl. !reachedMpc and FA / router / guard executors)
  //                                         -> guard_failure
  if (firstFailingExecutor && mpcContractSet.has(firstFailingExecutor)) {
    return {
      outcome: "mpc_failure",
      reachedMpc: true,
      failingExecutorId: firstFailingExecutor,
      failureReason,
      lastError: null,
    };
  }

  if (reachedMpc && firstFailingExecutor !== null) {
    return {
      outcome: "other_failure",
      reachedMpc: true,
      failingExecutorId: firstFailingExecutor,
      failureReason,
      lastError: null,
    };
  }

  // Conversion failure (firstFailingExecutor is null, txConversionFailed true)
  // is still a guard-side problem — the tx never produced a receipt and so
  // never made it past the FastAuth contract.
  return {
    outcome: "guard_failure",
    reachedMpc,
    failingExecutorId: firstFailingExecutor,
    failureReason,
    lastError: null,
  };
}

type DiscoveryRow = {
  tx_hash: string;
  signer_account_id: string;
  block_height: bigint;
  block_timestamp: Date;
};

type RetryRow = {
  txHash: string;
  signerId: string;
  retryCount: number;
};

export async function collectFastAuthHealth(
  prisma: PrismaClient,
): Promise<IndexerRunResult> {
  const fastAuthContractIds = resolveFastAuthContractIds();
  if (fastAuthContractIds.length === 0) {
    return {
      source: "fastauth_health",
      status: "skipped",
      details: "FASTAUTH_CONTRACT_IDS not configured.",
    };
  }

  const mpcContractSet = resolveMpcContractIds(fastAuthContractIds);
  const rpcManager = createNearRpcManager();
  const lookbackCutoff = new Date(Date.now() - DISCOVERY_LOOKBACK_MS);

  // ── Pass 1: discovery ──────────────────────────────────────────────
  // Pick near_transactions rows that don't yet have a fastauth_health_tx row.
  // LEFT JOIN ... IS NULL is the anti-join form Postgres optimizes efficiently
  // when both sides are indexed on tx_hash. Newest-first so recent tx (whose
  // receipts are still on public RPCs) classify quickly; older tx within the
  // lookback drain in subsequent cycles.
  const candidates = await prisma.$queryRaw<DiscoveryRow[]>`
    SELECT n.tx_hash, n.signer_account_id, n.block_height, n.block_timestamp
    FROM near_transactions n
    LEFT JOIN fastauth_health_tx h ON h.tx_hash = n.tx_hash
    WHERE h.tx_hash IS NULL
      AND n.receiver_id = ANY(${fastAuthContractIds}::text[])
      AND n.block_timestamp >= ${lookbackCutoff}
      AND n.signer_account_id IS NOT NULL
      AND n.block_timestamp IS NOT NULL
      AND n.block_height IS NOT NULL
    ORDER BY n.block_height DESC
    LIMIT ${DISCOVER_LIMIT}
  `;

  let discoveredOk = 0;
  let discoveredFailed = 0;
  let discoveredPending = 0;

  if (candidates.length > 0) {
    type ClassifiedRow = DiscoveryRow & Classification;
    const classified: ClassifiedRow[] = [];

    await runWithConcurrency(
      candidates,
      TX_STATUS_CONCURRENCY,
      async (candidate) => {
        const result = await classifyTx(
          rpcManager,
          candidate.tx_hash,
          candidate.signer_account_id,
          mpcContractSet,
        );
        classified.push({ ...candidate, ...result });
      },
    );

    const now = new Date();
    await prisma.fastAuthHealthTx.createMany({
      data: classified.map((row) => ({
        txHash: row.tx_hash,
        signerId: row.signer_account_id,
        blockHeight: row.block_height,
        blockTimestamp: row.block_timestamp,
        reachedMpc: row.reachedMpc,
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
  // Retry rpc_pending rows that haven't been touched recently and haven't
  // exhausted their retry budget. Oldest first.
  const retryCutoff = new Date(Date.now() - RETRY_BACKOFF_MS);
  const pendingRows = await prisma.fastAuthHealthTx.findMany({
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
      pendingRows as RetryRow[],
      TX_STATUS_CONCURRENCY,
      async (row) => {
        const result = await classifyTx(
          rpcManager,
          row.txHash,
          row.signerId,
          mpcContractSet,
        );
        const now = new Date();

        await prisma.fastAuthHealthTx.update({
          where: { txHash: row.txHash },
          data: {
            reachedMpc: result.reachedMpc,
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
    source: "fastauth_health",
    status: "ok",
    inserted: totalDiscovered,
    details:
      `Discovered ${totalDiscovered} ` +
      `(${discoveredOk} ok, ${discoveredFailed} failed, ${discoveredPending} pending); ` +
      `retried ${totalRetried} ` +
      `(${retriedResolved} resolved, ${retriedStillPending} still pending).`,
  };
}
