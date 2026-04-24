import "dotenv/config";

import type { Prisma } from "@prisma/client";

import {
  deriveFastAuthSignEventsFromTransaction,
  fetchBlockByHeight,
  fetchChunkByHash,
  parseActionMetadata,
  parseExecutionStatus,
  persistNearBlock,
  rebuildRelayerMarts,
  resolveFastAuthContractIds,
  runWithConcurrency,
  toDateFromNearNs,
  toNullableBigInt,
  toTransactionPayload,
  normalizeNearPublicKey,
  type FastAuthSignEventSeed,
  type NearBlockResponse,
  type NearChunkResponse,
} from "@/lib/indexers/near";
import { NearRpcManager } from "@/lib/indexers/near-rpc-manager";
import { prisma } from "@/lib/prisma";

// Archival-only pool used by this script. Intentionally separate from the
// live indexer's `NEAR_RPC_URLS` — archival endpoints have stricter rate
// limits and would destabilise the tip-follower if mixed into that pool.
const ARCHIVAL_NEAR_RPC_URLS = [
  "https://archival-rpc.mainnet.fastnear.com",
];

// Concurrency tuned for FastNEAR archival's measured capacity. With a
// FASTNEAR_API_KEY the rate limit is higher; without one, drop to
// `--block-concurrency=1 --chunk-concurrency=5` to stay within the free tier.
const DEFAULT_BLOCK_CONCURRENCY = 10;
const DEFAULT_CHUNK_CONCURRENCY = 5;
// Batch size controls only how often the row's `completedUpTo` /
// `completedDownTo` cursor is persisted to `missing_block_ranges`. Blocks
// themselves are written to `near_transactions` / `fastauth_sign_events` as
// they complete. On crash we re-RPC up to `batch-size` blocks before the
// no-op upserts kick in, so smaller is cheaper on recovery.
const DEFAULT_BATCH_SIZE = 50;

// Rate-limit retry: when FastNEAR throws -429, sleep then retry. Lets the
// script ride out sustained rate-limit windows instead of crashing.
const RATE_LIMIT_RETRY_SLEEP_MS = 30_000;
const RATE_LIMIT_MAX_RETRIES = 20;

type Cli = {
  source: "range" | "row";
  direction: "asc" | "desc";
  rangeStart?: number;
  rangeEnd?: number;
  rowId?: number;
  batchSize: number;
  blockConcurrency: number;
  chunkConcurrency: number;
  dryRun: boolean;
};

function parseCli(): Cli {
  const args = process.argv.slice(2);
  const cli: Cli = {
    // Default: pick the first open row from missing_block_ranges.
    source: "row",
    direction: "asc",
    batchSize: DEFAULT_BATCH_SIZE,
    blockConcurrency: DEFAULT_BLOCK_CONCURRENCY,
    chunkConcurrency: DEFAULT_CHUNK_CONCURRENCY,
    dryRun: false,
  };

  for (const arg of args) {
    // pnpm v10 may forward a bare `--` through to the script when invoked
    // via `pnpm backfill:range -- ...`. Ignore it.
    if (arg === "--") {
      continue;
    }
    if (arg === "--from-file" || arg === "--from-db") {
      // Both kept for backwards compatibility with existing Railway start
      // commands. `--from-file` is a misnomer post-DB-migration but harmless.
      cli.source = "row";
    } else if (arg === "--dry-run") {
      cli.dryRun = true;
    } else if (arg === "--direction=asc") {
      cli.direction = "asc";
    } else if (arg === "--direction=desc") {
      cli.direction = "desc";
    } else if (arg.startsWith("--range=")) {
      const [start, end] = arg.slice("--range=".length).split("..");
      const s = Number(start);
      const e = Number(end);
      if (!Number.isInteger(s) || !Number.isInteger(e) || s > e) {
        throw new Error(`--range must be START..END with START <= END (got ${arg}).`);
      }
      cli.source = "range";
      cli.rangeStart = s;
      cli.rangeEnd = e;
    } else if (arg.startsWith("--id=") || arg.startsWith("--entry=")) {
      // `--entry=N` (legacy, was JSON array index) is accepted as an alias
      // for `--id=N` so old Railway start commands keep working — note that
      // the semantics changed: it is now the missing_block_ranges row id,
      // not an array index.
      const flag = arg.startsWith("--id=") ? "--id=" : "--entry=";
      const id = Number(arg.slice(flag.length));
      if (!Number.isInteger(id) || id < 0) {
        throw new Error(`${flag} must be a non-negative integer (got ${arg}).`);
      }
      cli.source = "row";
      cli.rowId = id;
    } else if (arg.startsWith("--batch-size=")) {
      const v = Number(arg.slice("--batch-size=".length));
      if (!Number.isInteger(v) || v < 1) throw new Error(`--batch-size must be >= 1.`);
      cli.batchSize = v;
    } else if (arg.startsWith("--block-concurrency=")) {
      const v = Number(arg.slice("--block-concurrency=".length));
      if (!Number.isInteger(v) || v < 1) throw new Error(`--block-concurrency must be >= 1.`);
      cli.blockConcurrency = v;
    } else if (arg.startsWith("--chunk-concurrency=")) {
      const v = Number(arg.slice("--chunk-concurrency=".length));
      if (!Number.isInteger(v) || v < 1) throw new Error(`--chunk-concurrency must be >= 1.`);
      cli.chunkConcurrency = v;
    } else {
      throw new Error(`Unknown arg: ${arg}`);
    }
  }

  return cli;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("rate limits exceeded") ||
    msg.includes("too many requests") ||
    msg.includes("(429)") ||
    msg.includes('"code":-429') ||
    msg.includes('"code": -429')
  );
}

async function withRateLimitRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err)) throw err;
      lastError = err;
      if (attempt === RATE_LIMIT_MAX_RETRIES) break;
      console.log(
        `  [rate-limited] ${context}: sleeping ${RATE_LIMIT_RETRY_SLEEP_MS / 1000}s (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES})`,
      );
      await sleep(RATE_LIMIT_RETRY_SLEEP_MS);
    }
  }
  throw lastError ?? new Error(`Rate-limit retries exhausted for ${context}`);
}

async function processBlock(
  rpcManager: NearRpcManager,
  height: number,
  fastAuthContractSet: Set<string>,
  chunkConcurrency: number,
): Promise<{ inserted: number; signEvents: number; skipped: boolean }> {
  let blockPayload: NearBlockResponse;
  try {
    blockPayload = await fetchBlockByHeight(rpcManager, height);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      (message.includes("UNKNOWN_BLOCK") || message.includes("Unknown block") || message.includes("DB Not Found")) &&
      message.includes("block-by-height")
    ) {
      console.log(`  [skip] height ${height}: UNKNOWN_BLOCK (missed slot).`);
      return { inserted: 0, signEvents: 0, skipped: true };
    }
    throw error;
  }

  const blockHeight = blockPayload.result?.header?.height;
  const blockHash = blockPayload.result?.header?.hash;
  const blockTimestamp = blockPayload.result?.header?.timestamp;
  if (!blockHeight || !blockHash) {
    throw new Error(`Block response for height ${height} missing header fields.`);
  }

  const chunkHashes =
    blockPayload.result?.chunks
      ?.map((c) => c.chunk_hash)
      .filter((h): h is string => Boolean(h)) ?? [];

  const chunkPayloads: NearChunkResponse[] = new Array(chunkHashes.length);
  await runWithConcurrency(chunkHashes, chunkConcurrency, async (chunkHash, idx) => {
    chunkPayloads[idx] = await fetchChunkByHash(rpcManager, chunkHash);
  });

  const uniqueTransactions = new Map<string, Prisma.NearTransactionCreateManyInput>();
  const uniqueSignEvents = new Map<string, FastAuthSignEventSeed>();

  for (const chunkPayload of chunkPayloads) {
    const chunkTransactions = chunkPayload?.result?.transactions ?? [];
    for (const tx of chunkTransactions) {
      const txHash = tx.hash;
      if (!txHash) continue;

      const normalizedReceiverId = tx.receiver_id?.trim().toLowerCase() ?? null;
      if (!normalizedReceiverId || !fastAuthContractSet.has(normalizedReceiverId)) continue;

      const { methodName, attachedDepositYocto } = parseActionMetadata(tx.actions);
      const outcome = tx.outcome?.outcome;
      const gasBurnt = toNullableBigInt(outcome?.gas_burnt);
      const { executionStatus, failureReason } = parseExecutionStatus(outcome?.status);
      const relayerPublicKey = normalizeNearPublicKey(tx.public_key);
      const derivedSignEvents = deriveFastAuthSignEventsFromTransaction({
        tx,
        blockHeight,
        blockTimestamp,
        executionStatus,
        failureReason,
        gasBurnt,
        relayerPublicKey,
        fastAuthContractSet,
      });

      uniqueTransactions.set(txHash, {
        txHash,
        blockHeight: BigInt(blockHeight),
        blockTimestamp: toDateFromNearNs(blockTimestamp),
        signerAccountId: tx.signer_id ?? null,
        signerPublicKey: relayerPublicKey,
        receiverId: normalizedReceiverId,
        methodName,
        executionStatus,
        failureReason,
        gasBurnt,
        attachedDepositYocto,
        payload: toTransactionPayload(tx),
      });

      for (const signEvent of derivedSignEvents) {
        uniqueSignEvents.set(`${signEvent.txHash}:${signEvent.actionIndex}`, signEvent);
      }
    }
  }

  const { insertedTransactions, insertedSignEvents } = await persistNearBlock(
    prisma,
    blockHeight,
    blockHash,
    blockTimestamp,
    [...uniqueTransactions.values()],
    [...uniqueSignEvents.values()],
  );

  return {
    inserted: insertedTransactions,
    signEvents: insertedSignEvents,
    skipped: false,
  };
}

async function backfillRange(
  cli: Cli,
  rpcManager: NearRpcManager,
  walkFrom: number,
  walkTo: number,
  totalBlocks: number,
  onBatchComplete: (completedHeight: number) => Promise<void>,
): Promise<{ totalInserted: number; totalSignEvents: number; totalSkipped: number }> {
  const fastAuthContractSet = new Set(resolveFastAuthContractIds());
  let totalInserted = 0;
  let totalSignEvents = 0;
  let totalSkipped = 0;
  const startedAt = Date.now();

  let cursor = walkFrom;
  const done = () =>
    cli.direction === "asc" ? cursor > walkTo : cursor < walkTo;

  while (!done()) {
    const batchEnd =
      cli.direction === "asc"
        ? Math.min(cursor + cli.batchSize - 1, walkTo)
        : Math.max(cursor - cli.batchSize + 1, walkTo);

    const heights: number[] = [];
    if (cli.direction === "asc") {
      for (let h = cursor; h <= batchEnd; h += 1) heights.push(h);
    } else {
      for (let h = cursor; h >= batchEnd; h -= 1) heights.push(h);
    }

    let batchInserted = 0;
    let batchSignEvents = 0;
    let batchSkipped = 0;

    await runWithConcurrency(heights, cli.blockConcurrency, async (height) => {
      const res = await withRateLimitRetry(
        () => processBlock(rpcManager, height, fastAuthContractSet, cli.chunkConcurrency),
        `block ${height}`,
      );
      batchInserted += res.inserted;
      batchSignEvents += res.signEvents;
      if (res.skipped) batchSkipped += 1;
    });

    totalInserted += batchInserted;
    totalSignEvents += batchSignEvents;
    totalSkipped += batchSkipped;

    await onBatchComplete(batchEnd);

    const elapsedS = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const processedBlocks =
      cli.direction === "asc"
        ? batchEnd - walkFrom + 1
        : walkFrom - batchEnd + 1;
    const rate = (processedBlocks / elapsedS).toFixed(2);
    const pct = ((processedBlocks / totalBlocks) * 100).toFixed(1);
    const batchLabel =
      cli.direction === "asc" ? `${cursor}..${batchEnd}` : `${batchEnd}..${cursor}`;
    console.log(
      `  batch ${batchLabel} (${cli.direction}): +${batchInserted} tx, +${batchSignEvents} sign events, ${batchSkipped} missed-slot skips | ${processedBlocks}/${totalBlocks} (${pct}%) in ${elapsedS}s (${rate} bps)`,
    );

    cursor = cli.direction === "asc" ? batchEnd + 1 : batchEnd - 1;
  }

  return { totalInserted, totalSignEvents, totalSkipped };
}

async function main(): Promise<void> {
  const cli = parseCli();
  const fastnearApiKey = process.env.FASTNEAR_API_KEY?.trim() || null;
  const rpcManager = new NearRpcManager(ARCHIVAL_NEAR_RPC_URLS, {
    bearerToken: fastnearApiKey,
  });
  if (fastnearApiKey) {
    console.log("Using FASTNEAR_API_KEY (Authorization: Bearer ***)");
  } else {
    console.log("No FASTNEAR_API_KEY set — using free-tier limits (very low credit budget)");
  }

  // Resolve which range to walk. Two modes:
  //   - row    : pick a `missing_block_ranges` row by id, or first open one
  //   - range  : ad-hoc start..end, no DB row association (no checkpointing)
  let rowId: bigint | null = null;
  let rangeStart: number;
  let rangeEnd: number;
  let walkFrom: number;
  let walkTo: number;

  if (cli.source === "row") {
    const dbRow =
      cli.rowId != null
        ? await prisma.missingBlockRange.findUnique({ where: { id: BigInt(cli.rowId) } })
        : await prisma.missingBlockRange.findFirst({
            where: { status: "open" },
            orderBy: { id: "asc" },
          });

    if (!dbRow) {
      if (cli.rowId != null) {
        console.error(`No missing_block_ranges row found with id=${cli.rowId}.`);
      } else {
        console.log('No open rows in missing_block_ranges. Nothing to do.');
      }
      return;
    }

    if (dbRow.status === "closed") {
      console.log(`Row id=${dbRow.id} is already closed. Nothing to do.`);
      return;
    }

    rowId = dbRow.id;
    rangeStart = Number(dbRow.startHeight);
    rangeEnd = Number(dbRow.endHeight);

    if (cli.direction === "asc") {
      walkFrom = dbRow.completedUpTo != null ? Number(dbRow.completedUpTo) + 1 : rangeStart;
      walkTo = rangeEnd;
    } else {
      walkFrom =
        dbRow.completedDownTo != null ? Number(dbRow.completedDownTo) - 1 : rangeEnd;
      walkTo = rangeStart;
    }

    console.log(
      `Using missing_block_ranges row id=${dbRow.id}: ${rangeStart}..${rangeEnd} (direction=${cli.direction}, walk ${walkFrom} → ${walkTo})`,
    );
  } else {
    rangeStart = cli.rangeStart!;
    rangeEnd = cli.rangeEnd!;
    walkFrom = cli.direction === "asc" ? rangeStart : rangeEnd;
    walkTo = cli.direction === "asc" ? rangeEnd : rangeStart;
  }

  const totalBlocks =
    cli.direction === "asc" ? walkTo - walkFrom + 1 : walkFrom - walkTo + 1;

  if (totalBlocks <= 0) {
    console.log("Nothing to do — range already complete in this direction.");
    if (rowId !== null) {
      const row = await prisma.missingBlockRange.findUnique({ where: { id: rowId } });
      if (row) {
        const ascDone = row.completedUpTo != null && row.completedUpTo >= row.endHeight;
        const descDone =
          row.completedDownTo != null && row.completedDownTo <= row.startHeight;
        if (ascDone || descDone) {
          await prisma.missingBlockRange.update({
            where: { id: rowId },
            data: { status: "closed" },
          });
          console.log(`Row id=${rowId} marked status="closed".`);
        }
      }
    }
    return;
  }

  console.log("=== backfill-range ===");
  console.log(`row:                ${rowId ?? "(ad-hoc, no checkpointing)"}`);
  console.log(`range:              ${rangeStart}..${rangeEnd}`);
  console.log(`direction:          ${cli.direction}`);
  console.log(`walk:               ${walkFrom} → ${walkTo}  (${totalBlocks} blocks)`);
  console.log(`batch size:         ${cli.batchSize}`);
  console.log(`block concurrency:  ${cli.blockConcurrency}`);
  console.log(`chunk concurrency:  ${cli.chunkConcurrency}`);
  console.log(`archival pool:      ${ARCHIVAL_NEAR_RPC_URLS.join(", ")}`);
  console.log(`dry run:            ${cli.dryRun}`);
  console.log("");

  if (cli.dryRun) {
    console.log("(dry run) No RPC calls or DB writes. Exiting.");
    return;
  }

  const startedAt = Date.now();
  const { totalInserted, totalSignEvents, totalSkipped } = await backfillRange(
    cli,
    rpcManager,
    walkFrom,
    walkTo,
    totalBlocks,
    async (completedHeight) => {
      if (rowId === null) return;
      // Persist checkpoint to the missing_block_ranges row so resume is durable
      // across container restarts (was JSON file before — now DB-backed).
      const updateData: Prisma.MissingBlockRangeUpdateInput = {};
      if (cli.direction === "asc") {
        updateData.completedUpTo = BigInt(completedHeight);
        if (completedHeight >= rangeEnd) {
          updateData.status = "closed";
        }
      } else {
        updateData.completedDownTo = BigInt(completedHeight);
        if (completedHeight <= rangeStart) {
          updateData.status = "closed";
        }
      }
      await prisma.missingBlockRange.update({ where: { id: rowId }, data: updateData });
    },
  );

  // Mart rebuild once at the end — rebuildRelayerMarts scans the full sign
  // event table, so calling it per-batch would dominate runtime.
  if (totalSignEvents > 0) {
    console.log("\nRebuilding relayer marts...");
    const martResult = await rebuildRelayerMarts(prisma);
    console.log(`  rebuilt ${martResult.relayers} relayers.`);
  }

  const elapsedS = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  console.log("\n=== summary ===");
  console.log(`processed ${totalBlocks} blocks in ${elapsedS}s (${(totalBlocks / elapsedS).toFixed(2)} bps)`);
  console.log(`inserted:      ${totalInserted} transactions, ${totalSignEvents} sign events`);
  console.log(`missed slots:  ${totalSkipped}`);
  if (rowId !== null) {
    const field = cli.direction === "asc" ? "completedUpTo" : "completedDownTo";
    console.log(`row id=${rowId} updated in missing_block_ranges (${field} advanced)`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
