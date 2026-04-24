import type { PrismaClient } from "@prisma/client";

import { createNearRpcManager } from "@/lib/indexers/near-rpc-manager";
import type { IndexerRunResult } from "@/lib/indexers/types";

const CHECKPOINT_LAST_RUN_AT = "fastauth_chain_health_last_run_at";

// Hardcoded chain-health prober tuning.
const CHAIN_HEALTH_WINDOW_BLOCKS = 300;
const CHAIN_HEALTH_MIN_INTERVAL_MS = 600_000;
const CHAIN_HEALTH_BLOCK_CONCURRENCY = 20;
const CHAIN_HEALTH_CHUNK_CONCURRENCY = 6;

type NearBlockResponse = {
  result?: {
    header?: {
      height?: number;
      hash?: string;
      timestamp?: number | string;
    };
    chunks?: Array<{ chunk_hash?: string }>;
  };
};

type NearChunkTransaction = {
  hash?: string;
  signer_id?: string;
  receiver_id?: string;
  outcome?: {
    outcome?: {
      status?: unknown;
    };
  };
};

type NearChunkResponse = {
  result?: {
    transactions?: NearChunkTransaction[];
  };
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

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const effectiveConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  const runners = Array.from({ length: effectiveConcurrency }, async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;

      if (currentIndex >= items.length) {
        return;
      }

      await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
}

function toDateFromNearNs(timestampNs: number | string | undefined): Date | null {
  if (timestampNs === undefined || timestampNs === null) {
    return null;
  }
  try {
    const asBigInt = typeof timestampNs === "bigint" ? timestampNs : BigInt(timestampNs);
    const ms = Number(asBigInt / BigInt(1_000_000));
    if (!Number.isFinite(ms)) {
      return null;
    }
    return new Date(ms);
  } catch {
    return null;
  }
}

function isFailureStatus(status: unknown): boolean {
  if (!status) {
    return false;
  }
  if (typeof status === "string") {
    return status.toLowerCase().includes("failure");
  }
  if (typeof status === "object") {
    const entries = Object.entries(status as Record<string, unknown>);
    if (entries.length === 0) {
      return false;
    }
    return entries[0][0].toLowerCase().includes("failure");
  }
  return false;
}

export async function collectFastAuthChainHealth(
  prisma: PrismaClient,
): Promise<IndexerRunResult> {
  const fastAuthContractIds = resolveFastAuthContractIds();
  const fastAuthContractSet = new Set(fastAuthContractIds);

  if (fastAuthContractSet.size === 0) {
    return {
      source: "fastauth_chain_health",
      status: "skipped",
      details: "FASTAUTH_CONTRACT_IDS not configured.",
    };
  }

  const minIntervalMs = CHAIN_HEALTH_MIN_INTERVAL_MS;
  const lastRunCheckpoint = await prisma.indexerCheckpoint.findUnique({
    where: { key: CHECKPOINT_LAST_RUN_AT },
  });
  if (lastRunCheckpoint?.value) {
    const lastRunMs = Number(lastRunCheckpoint.value);
    if (Number.isFinite(lastRunMs) && Date.now() - lastRunMs < minIntervalMs) {
      return {
        source: "fastauth_chain_health",
        status: "skipped",
        details: `Throttled; last run ${Math.round((Date.now() - lastRunMs) / 1000)}s ago.`,
      };
    }
  }

  const rpcManager = createNearRpcManager();

  try {
    const headPayload = await rpcManager.request<NearBlockResponse>(
      "block",
      { finality: "final" },
      "fastauth-head-status:final-block",
    );
    const chainHead = headPayload.result?.header?.height;
    if (!chainHead) {
      throw new Error("NEAR response did not include final block height.");
    }

    const windowBlocks = CHAIN_HEALTH_WINDOW_BLOCKS;
    const windowStartHeight = Math.max(1, chainHead - windowBlocks + 1);
    const windowEndHeight = chainHead;
    const heights: number[] = [];
    for (let h = windowStartHeight; h <= windowEndHeight; h += 1) {
      heights.push(h);
    }

    const blockConcurrency = CHAIN_HEALTH_BLOCK_CONCURRENCY;
    const chunkConcurrency = CHAIN_HEALTH_CHUNK_CONCURRENCY;

    let totalTransactions = 0;
    let successfulTransactions = 0;
    let failedTransactions = 0;
    let lastSuccessTimestamp: Date | null = null;
    let lastSuccessTxHash: string | null = null;
    let lastSuccessBlockHeight = -1;
    const distinctRelayers = new Set<string>();

    await runWithConcurrency(heights, blockConcurrency, async (height) => {
      let blockPayload: NearBlockResponse;
      try {
        blockPayload = await rpcManager.request<NearBlockResponse>(
          "block",
          { block_id: height },
          `fastauth-head-status:block ${height}`,
        );
      } catch {
        return;
      }

      const chunkHashes =
        blockPayload.result?.chunks
          ?.map((chunk) => chunk.chunk_hash)
          .filter((chunkHash): chunkHash is string => Boolean(chunkHash)) ?? [];
      if (chunkHashes.length === 0) {
        return;
      }

      const blockTimestamp = toDateFromNearNs(blockPayload.result?.header?.timestamp);

      const chunkPayloads: NearChunkResponse[] = new Array(chunkHashes.length);
      await runWithConcurrency(chunkHashes, chunkConcurrency, async (chunkHash, idx) => {
        try {
          chunkPayloads[idx] = await rpcManager.request<NearChunkResponse>(
            "chunk",
            { chunk_id: chunkHash },
            `fastauth-head-status:chunk ${chunkHash}`,
          );
        } catch {
          chunkPayloads[idx] = { result: { transactions: [] } };
        }
      });

      for (const chunkPayload of chunkPayloads) {
        const chunkTransactions = chunkPayload?.result?.transactions ?? [];
        for (const tx of chunkTransactions) {
          const receiver = tx.receiver_id?.trim().toLowerCase() ?? null;
          if (!receiver || !fastAuthContractSet.has(receiver)) {
            continue;
          }

          totalTransactions += 1;
          if (tx.signer_id) {
            distinctRelayers.add(tx.signer_id.trim().toLowerCase());
          }

          const failed = isFailureStatus(tx.outcome?.outcome?.status);
          if (failed) {
            failedTransactions += 1;
            continue;
          }

          successfulTransactions += 1;
          if (height > lastSuccessBlockHeight) {
            lastSuccessBlockHeight = height;
            lastSuccessTxHash = tx.hash ?? null;
            lastSuccessTimestamp = blockTimestamp;
          }
        }
      }
    });

    await prisma.$transaction([
      prisma.fastAuthChainHealthSnapshot.create({
        data: {
          chainHead: BigInt(chainHead),
          windowStartHeight: BigInt(windowStartHeight),
          windowEndHeight: BigInt(windowEndHeight),
          windowBlocks,
          totalTransactions,
          successfulTransactions,
          failedTransactions,
          distinctRelayers: distinctRelayers.size,
          lastSuccessTimestamp,
          lastSuccessTxHash,
        },
      }),
      prisma.indexerCheckpoint.upsert({
        where: { key: CHECKPOINT_LAST_RUN_AT },
        create: { key: CHECKPOINT_LAST_RUN_AT, value: String(Date.now()) },
        update: { value: String(Date.now()) },
      }),
    ]);

    const successRatePct =
      totalTransactions > 0
        ? Math.round((successfulTransactions / totalTransactions) * 1000) / 10
        : null;

    return {
      source: "fastauth_chain_health",
      status: "ok",
      inserted: 1,
      details:
        `Scanned blocks ${windowStartHeight}..${windowEndHeight} (${windowBlocks}); ` +
        `found ${totalTransactions} FastAuth tx ` +
        `(${successfulTransactions} ok, ${failedTransactions} failed` +
        `${successRatePct !== null ? `, ${successRatePct}%` : ""}); ` +
        `${distinctRelayers.size} distinct relayers.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      source: "fastauth_chain_health",
      status: "error",
      details: message,
    };
  }
}
