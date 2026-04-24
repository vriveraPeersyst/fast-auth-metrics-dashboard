import "dotenv/config";

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
//
// Only FastNEAR archival is used. Benchmark (2026-04-24): sustained 100% at
// c=40 with p50 194ms, ~62 RPS ceiling. `archival-rpc.mainnet.near.org` was
// excluded after measuring its documented 4 RPM / 10 per 10min limit in
// practice (0% success at c=5 after any sustained load). Adding near.org
// as a failover partner is worse than useless: when FastNEAR blips and the
// rotation lands on near.org, near.org 429s for 30+ minutes and blacklists,
// dragging the script to a halt.
const ARCHIVAL_NEAR_RPC_URLS = [
  "https://archival-rpc.mainnet.fastnear.com",
];

// Concurrency tuned for FastNEAR archival's measured capacity. 10 × 5 = 50
// peak concurrent calls; in practice averages ~40-50 RPS = ~7 blocks/sec,
// giving ~16h end-to-end for a 408k-block gap.
const DEFAULT_BLOCK_CONCURRENCY = 10;
const DEFAULT_CHUNK_CONCURRENCY = 5;
// Batch size controls only how often `completedUpTo` is persisted to the JSON
// file — blocks themselves are written to DB as they complete. On crash we
// re-RPC up to `batch-size` blocks before the no-op upserts kick in, so smaller
// is cheaper on recovery. 50 ≈ a few seconds of re-work max; file writes are
// trivial (<1ms each).
const DEFAULT_BATCH_SIZE = 50;

const MISSING_RANGES_FILE = resolve(process.cwd(), "data/missing-block-ranges.json");

type MissingRange = {
  startHeight: number;
  endHeight: number;
  reason: string;
  recordedAt: string;
  // Ascending checkpoint — highest height already processed when walking asc.
  completedUpTo: number | null;
  // Descending checkpoint — lowest height already processed when walking desc.
  // Tracked independently so asc/desc can be combined if needed.
  completedDownTo?: number | null;
  status: "open" | "closed";
};

type MissingRangesFile = {
  $schema?: string;
  ranges: MissingRange[];
};

type Cli = {
  mode: "range" | "file";
  direction: "asc" | "desc";
  rangeStart?: number;
  rangeEnd?: number;
  entryIndex?: number;
  batchSize: number;
  blockConcurrency: number;
  chunkConcurrency: number;
  dryRun: boolean;
};

function parseCli(): Cli {
  const args = process.argv.slice(2);
  const cli: Cli = {
    mode: "range",
    direction: "asc",
    batchSize: DEFAULT_BATCH_SIZE,
    blockConcurrency: DEFAULT_BLOCK_CONCURRENCY,
    chunkConcurrency: DEFAULT_CHUNK_CONCURRENCY,
    dryRun: false,
  };

  for (const arg of args) {
    if (arg === "--from-file") {
      cli.mode = "file";
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
      cli.rangeStart = s;
      cli.rangeEnd = e;
    } else if (arg.startsWith("--entry=")) {
      const idx = Number(arg.slice("--entry=".length));
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error(`--entry must be a non-negative integer (got ${arg}).`);
      }
      cli.entryIndex = idx;
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

  if (cli.mode === "range" && (cli.rangeStart === undefined || cli.rangeEnd === undefined)) {
    throw new Error("--range=START..END is required unless --from-file is provided.");
  }

  return cli;
}

function readRangesFile(): MissingRangesFile {
  const raw = readFileSync(MISSING_RANGES_FILE, "utf8");
  const parsed = JSON.parse(raw) as MissingRangesFile;
  if (!Array.isArray(parsed.ranges)) {
    throw new Error("data/missing-block-ranges.json: missing `ranges` array.");
  }
  return parsed;
}

function writeRangesFile(data: MissingRangesFile): void {
  writeFileSync(MISSING_RANGES_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
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
    // For archival backfill, any exhausted-retry UNKNOWN_BLOCK is treated as a
    // genuinely missed slot (archival wouldn't prune). We still log it.
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
  onBatchComplete: (completedHeight: number) => void,
): Promise<{ totalInserted: number; totalSignEvents: number; totalSkipped: number }> {
  const fastAuthContractSet = new Set(resolveFastAuthContractIds());
  let totalInserted = 0;
  let totalSignEvents = 0;
  let totalSkipped = 0;
  const startedAt = Date.now();

  let cursor = walkFrom;
  // Ascending: cursor moves walkFrom → walkTo, walkFrom <= walkTo.
  // Descending: cursor moves walkFrom → walkTo, walkFrom >= walkTo.
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
      const res = await processBlock(rpcManager, height, fastAuthContractSet, cli.chunkConcurrency);
      batchInserted += res.inserted;
      batchSignEvents += res.signEvents;
      if (res.skipped) batchSkipped += 1;
    });

    totalInserted += batchInserted;
    totalSignEvents += batchSignEvents;
    totalSkipped += batchSkipped;

    // Checkpoint boundary = the batch's outer edge. For asc that's the
    // highest height just processed; for desc, the lowest.
    onBatchComplete(batchEnd);

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
  const rpcManager = new NearRpcManager(ARCHIVAL_NEAR_RPC_URLS);

  let entryIndex: number | null = null;
  let rangeStart: number;
  let rangeEnd: number;
  // walkFrom / walkTo = the inclusive bounds in traversal order.
  // asc: walkFrom <= walkTo (low → high)
  // desc: walkFrom >= walkTo (high → low)
  let walkFrom: number;
  let walkTo: number;

  if (cli.mode === "file") {
    const file = readRangesFile();
    const idx = cli.entryIndex ?? file.ranges.findIndex((r) => r.status === "open");
    if (idx < 0 || idx >= file.ranges.length) {
      throw new Error(
        `No entry at index ${idx}. File has ${file.ranges.length} ranges.`,
      );
    }
    const entry = file.ranges[idx];
    if (entry.status === "closed") {
      console.log(`Entry ${idx} is already closed. Nothing to do.`);
      return;
    }
    entryIndex = idx;
    rangeStart = entry.startHeight;
    rangeEnd = entry.endHeight;

    if (cli.direction === "asc") {
      walkFrom = entry.completedUpTo !== null ? entry.completedUpTo + 1 : rangeStart;
      walkTo = rangeEnd;
    } else {
      walkFrom =
        entry.completedDownTo != null ? entry.completedDownTo - 1 : rangeEnd;
      walkTo = rangeStart;
    }

    console.log(
      `Using entry ${idx}: ${rangeStart}..${rangeEnd} (direction=${cli.direction}, walk ${walkFrom} → ${walkTo})`,
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
    if (entryIndex !== null) {
      const file = readRangesFile();
      const entry = file.ranges[entryIndex];
      const ascDone = entry.completedUpTo != null && entry.completedUpTo >= entry.endHeight;
      const descDone =
        entry.completedDownTo != null && entry.completedDownTo <= entry.startHeight;
      if (ascDone || descDone) {
        entry.status = "closed";
        writeRangesFile(file);
        console.log(`Entry ${entryIndex} marked status="closed".`);
      }
    }
    return;
  }

  console.log("=== backfill-range ===");
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
    (completedHeight) => {
      if (entryIndex !== null) {
        // Persist checkpoint for file-mode runs so we can resume.
        const file = readRangesFile();
        const entry = file.ranges[entryIndex];
        if (!entry) return;

        if (cli.direction === "asc") {
          entry.completedUpTo = completedHeight;
          if (completedHeight >= entry.endHeight) {
            entry.status = "closed";
          }
        } else {
          entry.completedDownTo = completedHeight;
          if (completedHeight <= entry.startHeight) {
            entry.status = "closed";
          }
        }
        writeRangesFile(file);
      }
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
  if (entryIndex !== null) {
    const field = cli.direction === "asc" ? "completedUpTo" : "completedDownTo";
    console.log(
      `range entry ${entryIndex} updated in ${MISSING_RANGES_FILE} (${field} advanced)`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
