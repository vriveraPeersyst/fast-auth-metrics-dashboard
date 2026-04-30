import type { Prisma, PrismaClient } from "@prisma/client";

import { runWithConcurrency } from "@/lib/indexers/health-classifier";
import { resolveFastAuthContractIds } from "@/lib/indexers/near";
import { createNearRpcManager } from "@/lib/indexers/near-rpc-manager";
import {
  parseRespondLog,
  parseSignLog,
  type ParsedRespondLog,
  type ParsedSignLog,
} from "@/lib/indexers/parse-mpc-logs";
import type { IndexerRunResult } from "@/lib/indexers/types";

// Bounded per-cycle (anti-join discovery, no checkpoint). Same pattern as
// the health collectors. RPC `tx` per row is the dominant cost — sized so
// worst-case cycle stays under ~120s with full RPC timeouts.
const DISCOVER_LIMIT_RESPOND = 100;
const DISCOVER_LIMIT_SIGN_DIRECT = 50;
// Slightly higher than the others because of the ~10k row backlog
// accumulated from before this collector existed (`near_transactions`
// was indexing FastAuth signs long before mpc-consensus.ts was wired
// in). The lookback is bounded to 24h so this naturally decays once
// the backlog drains; in steady state the cap is rarely hit.
const DISCOVER_LIMIT_SIGN_FASTAUTH = 100;
const TX_STATUS_CONCURRENCY = 8;
const DISCOVERY_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const V1_SIGNER = "v1.signer";

// Synthetic-traffic accounts. Tagged but not filtered — their respond
// latency is still real signal about node health.
const SYNTHETIC_PREDECESSORS: ReadonlySet<string> = new Set(["tx-bench.near"]);

type RawTxResponse = {
  result?: {
    receipts_outcome?: Array<{
      outcome?: {
        executor_id?: string;
        logs?: string[];
      };
    }>;
  };
};

async function fetchV1SignerLogs(
  rpcManager: ReturnType<typeof createNearRpcManager>,
  txHash: string,
  signerId: string,
  source: string,
): Promise<{ logs: string[]; error: string | null }> {
  try {
    const response = await rpcManager.request<RawTxResponse>(
      "tx",
      [txHash, signerId],
      `${source}:${txHash}`,
    );
    const logs: string[] = [];
    for (const r of response.result?.receipts_outcome ?? []) {
      if ((r.outcome?.executor_id ?? "").trim().toLowerCase() === V1_SIGNER) {
        for (const log of r.outcome?.logs ?? []) logs.push(log);
      }
    }
    return { logs, error: null };
  } catch (error) {
    return {
      logs: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function classifyTrafficSource(predecessorId: string): "organic" | "synthetic" {
  return SYNTHETIC_PREDECESSORS.has(predecessorId.toLowerCase()) ? "synthetic" : "organic";
}

type DiscoveredRow = {
  txHash: string;
  signerAccountId: string;
  blockHeight: bigint;
  blockTimestamp: Date;
  executionStatus: string | null;
};

async function processRespondPass(
  prisma: PrismaClient,
  rpcManager: ReturnType<typeof createNearRpcManager>,
  lookbackCutoff: Date,
): Promise<{ discovered: number; inserted: number; skipped: number }> {
  const candidates = await prisma.$queryRaw<
    Array<{
      tx_hash: string;
      signer_account_id: string;
      block_height: bigint;
      block_timestamp: Date;
      execution_status: string | null;
    }>
  >`
    SELECT m.tx_hash, m.signer_account_id, m.block_height, m.block_timestamp, m.execution_status
    FROM mpc_transactions m
    LEFT JOIN mpc_sign_responses r ON r.tx_hash = m.tx_hash
    LEFT JOIN mpc_log_parse_skipped s
      ON s.tx_hash = m.tx_hash AND s.source = 'respond'
    WHERE r.tx_hash IS NULL
      AND s.tx_hash IS NULL
      AND m.method_name = 'respond'
      AND m.block_timestamp >= ${lookbackCutoff}
      AND m.signer_account_id IS NOT NULL
    ORDER BY m.block_timestamp DESC
    LIMIT ${DISCOVER_LIMIT_RESPOND}
  `;

  if (candidates.length === 0) return { discovered: 0, inserted: 0, skipped: 0 };

  const rows: Prisma.MpcSignResponseCreateManyInput[] = [];
  const skipped: Prisma.MpcLogParseSkippedCreateManyInput[] = [];

  await runWithConcurrency(candidates, TX_STATUS_CONCURRENCY, async (candidate) => {
    const { logs } = await fetchV1SignerLogs(
      rpcManager,
      candidate.tx_hash,
      candidate.signer_account_id,
      "mpc-consensus:respond",
    );

    let parsed: ParsedRespondLog | null = null;
    for (const log of logs) {
      parsed = parseRespondLog(log);
      if (parsed) break;
    }

    if (!parsed) {
      skipped.push({
        txHash: candidate.tx_hash,
        source: "respond",
        reason: logs.length === 0 ? "no_v1signer_receipt" : "no_respond_log",
      });
      return;
    }

    rows.push({
      txHash: candidate.tx_hash,
      blockHeight: candidate.block_height,
      blockTimestamp: candidate.block_timestamp,
      signerId: parsed.signerId,
      requestKey: parsed.requestKey,
      scheme: parsed.scheme,
      payloadHex: parsed.payloadHex,
      executionStatus: candidate.execution_status,
    });
  });

  let inserted = 0;
  if (rows.length > 0) {
    const result = await prisma.mpcSignResponse.createMany({
      data: rows,
      skipDuplicates: true,
    });
    inserted = result.count;
  }
  if (skipped.length > 0) {
    await prisma.mpcLogParseSkipped.createMany({
      data: skipped,
      skipDuplicates: true,
    });
  }
  return { discovered: candidates.length, inserted, skipped: skipped.length };
}

async function processSignPass(
  prisma: PrismaClient,
  rpcManager: ReturnType<typeof createNearRpcManager>,
  candidates: DiscoveredRow[],
  source: "direct" | "fastauth",
): Promise<{ inserted: number; skipped: number }> {
  if (candidates.length === 0) return { inserted: 0, skipped: 0 };

  const rows: Prisma.MpcSignRequestCreateManyInput[] = [];
  const skipped: Prisma.MpcLogParseSkippedCreateManyInput[] = [];
  const skipSource = `sign-${source}`;

  await runWithConcurrency(candidates, TX_STATUS_CONCURRENCY, async (candidate) => {
    const { logs } = await fetchV1SignerLogs(
      rpcManager,
      candidate.txHash,
      candidate.signerAccountId,
      `mpc-consensus:${skipSource}`,
    );

    let parsed: ParsedSignLog | null = null;
    for (const log of logs) {
      parsed = parseSignLog(log);
      if (parsed) break;
    }

    if (!parsed) {
      // Common case for FastAuth: the sign() call was rejected by the
      // guard before the cross-contract call to v1.signer fired, so the
      // tx top-level succeeds but no `sign:` log exists. Tombstone it
      // here so subsequent cycles skip it.
      skipped.push({
        txHash: candidate.txHash,
        source: skipSource,
        reason: logs.length === 0 ? "no_v1signer_receipt" : "no_sign_log",
      });
      return;
    }

    rows.push({
      txHash: candidate.txHash,
      blockHeight: candidate.blockHeight,
      blockTimestamp: candidate.blockTimestamp,
      predecessorId: parsed.predecessorId,
      requestKey: parsed.requestKey,
      path: parsed.path,
      scheme: parsed.scheme,
      payloadHex: parsed.payloadHex,
      domainId: parsed.domainId,
      keyVersion: parsed.keyVersion,
      source,
      trafficSource: classifyTrafficSource(parsed.predecessorId),
      executionStatus: candidate.executionStatus,
    });
  });

  let inserted = 0;
  if (rows.length > 0) {
    const result = await prisma.mpcSignRequest.createMany({
      data: rows,
      skipDuplicates: true,
    });
    inserted = result.count;
  }
  if (skipped.length > 0) {
    await prisma.mpcLogParseSkipped.createMany({
      data: skipped,
      skipDuplicates: true,
    });
  }
  return { inserted, skipped: skipped.length };
}

async function discoverDirectSignCandidates(
  prisma: PrismaClient,
  lookbackCutoff: Date,
): Promise<DiscoveredRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      tx_hash: string;
      signer_account_id: string;
      block_height: bigint;
      block_timestamp: Date;
      execution_status: string | null;
    }>
  >`
    SELECT m.tx_hash, m.signer_account_id, m.block_height, m.block_timestamp, m.execution_status
    FROM mpc_transactions m
    LEFT JOIN mpc_sign_requests r ON r.tx_hash = m.tx_hash
    LEFT JOIN mpc_log_parse_skipped s
      ON s.tx_hash = m.tx_hash AND s.source = 'sign-direct'
    WHERE r.tx_hash IS NULL
      AND s.tx_hash IS NULL
      AND m.method_name = 'sign'
      AND m.block_timestamp >= ${lookbackCutoff}
      AND m.signer_account_id IS NOT NULL
    ORDER BY m.block_timestamp DESC
    LIMIT ${DISCOVER_LIMIT_SIGN_DIRECT}
  `;
  return rows.map((r) => ({
    txHash: r.tx_hash,
    signerAccountId: r.signer_account_id,
    blockHeight: r.block_height,
    blockTimestamp: r.block_timestamp,
    executionStatus: r.execution_status,
  }));
}

async function discoverFastAuthSignCandidates(
  prisma: PrismaClient,
  lookbackCutoff: Date,
  fastAuthContractIds: string[],
): Promise<DiscoveredRow[]> {
  if (fastAuthContractIds.length === 0) return [];
  const rows = await prisma.$queryRaw<
    Array<{
      tx_hash: string;
      signer_account_id: string | null;
      block_height: bigint | null;
      block_timestamp: Date | null;
      execution_status: string | null;
    }>
  >`
    SELECT n.tx_hash, n.signer_account_id, n.block_height, n.block_timestamp, n.execution_status
    FROM near_transactions n
    LEFT JOIN mpc_sign_requests r ON r.tx_hash = n.tx_hash
    LEFT JOIN mpc_log_parse_skipped s
      ON s.tx_hash = n.tx_hash AND s.source = 'sign-fastauth'
    WHERE r.tx_hash IS NULL
      AND s.tx_hash IS NULL
      AND n.method_name = 'sign'
      AND n.receiver_id = ANY(${fastAuthContractIds}::text[])
      AND n.block_timestamp >= ${lookbackCutoff}
      AND n.signer_account_id IS NOT NULL
      AND n.block_height IS NOT NULL
      AND n.block_timestamp IS NOT NULL
    ORDER BY n.block_timestamp DESC
    LIMIT ${DISCOVER_LIMIT_SIGN_FASTAUTH}
  `;
  return rows
    .filter(
      (r) =>
        r.signer_account_id !== null && r.block_height !== null && r.block_timestamp !== null,
    )
    .map((r) => ({
      txHash: r.tx_hash,
      signerAccountId: r.signer_account_id as string,
      blockHeight: r.block_height as bigint,
      blockTimestamp: r.block_timestamp as Date,
      executionStatus: r.execution_status,
    }));
}

// Aggregate roster from mpc_sign_responses. Same delete-then-insert pattern
// as `rebuildRelayerMarts` in near.ts. Cheap: bounded by node count (~10).
async function rebuildMpcNodeMart(prisma: PrismaClient): Promise<number> {
  const aggregates = await prisma.mpcSignResponse.groupBy({
    by: ["signerId"],
    _count: { _all: true },
    _min: { blockTimestamp: true },
    _max: { blockTimestamp: true },
  });

  const now = new Date();
  const rows: Prisma.MpcNodeCreateManyInput[] = aggregates.map((a) => ({
    accountId: a.signerId,
    firstSeenAt: a._min.blockTimestamp ?? now,
    lastSeenAt: a._max.blockTimestamp ?? now,
    totalResponses: a._count._all,
    createdAt: now,
    updatedAt: now,
  }));

  await prisma.$transaction(async (tx) => {
    await tx.mpcNode.deleteMany({});
    if (rows.length > 0) {
      await tx.mpcNode.createMany({ data: rows });
    }
  });

  return rows.length;
}

export async function collectMpcConsensus(prisma: PrismaClient): Promise<IndexerRunResult> {
  const rpcManager = createNearRpcManager();
  const lookbackCutoff = new Date(Date.now() - DISCOVERY_LOOKBACK_MS);

  let fastAuthContractIds: string[] = [];
  try {
    fastAuthContractIds = resolveFastAuthContractIds();
  } catch {
    // Tolerate missing FASTAUTH_CONTRACT_IDS — direct signs and respond
    // still work. Only the FastAuth-side discovery pass is skipped.
    fastAuthContractIds = [];
  }

  const respondResult = await processRespondPass(prisma, rpcManager, lookbackCutoff);

  const [directCandidates, fastAuthCandidates] = await Promise.all([
    discoverDirectSignCandidates(prisma, lookbackCutoff),
    discoverFastAuthSignCandidates(prisma, lookbackCutoff, fastAuthContractIds),
  ]);

  const directSignResult = await processSignPass(prisma, rpcManager, directCandidates, "direct");
  const fastAuthSignResult = await processSignPass(
    prisma,
    rpcManager,
    fastAuthCandidates,
    "fastauth",
  );

  const totalInserted =
    respondResult.inserted + directSignResult.inserted + fastAuthSignResult.inserted;

  let nodeRows = 0;
  if (respondResult.inserted > 0) {
    nodeRows = await rebuildMpcNodeMart(prisma);
  }

  return {
    source: "mpc_consensus",
    status: "ok",
    inserted: totalInserted,
    details:
      `responses: ${respondResult.inserted}/${respondResult.discovered}` +
      ` (${respondResult.skipped} tombstoned);` +
      ` sign-direct: ${directSignResult.inserted}/${directCandidates.length}` +
      ` (${directSignResult.skipped} tombstoned);` +
      ` sign-fastauth: ${fastAuthSignResult.inserted}/${fastAuthCandidates.length}` +
      ` (${fastAuthSignResult.skipped} tombstoned);` +
      ` mpc_nodes mart: ${nodeRows} rows.`,
  };
}
