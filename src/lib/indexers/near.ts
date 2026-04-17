import type { Prisma, PrismaClient } from "@prisma/client";

import type { IndexerRunResult } from "@/lib/indexers/types";

type NearBlockResponse = {
  result?: {
    header?: {
      height?: number;
      hash?: string;
      timestamp?: number;
    };
    chunks?: Array<{
      chunk_hash?: string;
    }>;
  };
};

type NearChunkResponse = {
  result?: {
    transactions?: NearChunkTransaction[];
  };
};

type NearChunkTransaction = {
  hash?: string;
  signer_id?: string;
  receiver_id?: string;
  actions?: unknown[];
};

const CHECKPOINT_HEIGHT = "near_last_final_block_height";
const CHECKPOINT_HASH = "near_last_final_block_hash";
const CHECKPOINT_SCANNED_HEIGHT = "near_last_scanned_height";
const DEFAULT_MAX_BLOCKS_PER_RUN = 100;
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;
const DEFAULT_TRACKED_NEAR_ACCOUNTS = ["fast-auth.near"];

type RpcRequestParams =
  | {
      finality: "final";
    }
  | {
      block_id: number;
    }
  | {
      chunk_id: string;
    };

type RpcMethod = "block" | "chunk";

function resolveMaxBlocksPerRun(): number {
  const raw = process.env.NEAR_MAX_BLOCKS_PER_RUN;

  if (!raw) {
    return DEFAULT_MAX_BLOCKS_PER_RUN;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("NEAR_MAX_BLOCKS_PER_RUN must be a number >= 1.");
  }

  return Math.floor(parsed);
}

function resolveTrackedNearAccounts(): string[] {
  const raw = process.env.NEAR_TRACKED_ACCOUNT_IDS;
  const parsed = raw
    ?.split(",")
    .map((accountId) => accountId.trim().toLowerCase())
    .filter(Boolean);

  return parsed && parsed.length > 0 ? parsed : DEFAULT_TRACKED_NEAR_ACCOUNTS;
}

function resolveBackfillStartHeight(): number | null {
  const raw = process.env.NEAR_BACKFILL_START_HEIGHT;

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("NEAR_BACKFILL_START_HEIGHT must be an integer >= 0.");
  }

  return parsed;
}

function uniqueUrls(urls: string[]): string[] {
  return [...new Set(urls.filter(Boolean))];
}

function resolveNormalRpcUrl(): string {
  return process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.fastnear.com";
}

function resolveArchivalRpcUrl(): string {
  return process.env.NEAR_ARCHIVAL_RPC_URL ?? "https://archival-rpc.mainnet.fastnear.com";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestNearRpc<TResponse>(
  rpcUrls: string[],
  method: RpcMethod,
  params: RpcRequestParams,
  contextLabel: string,
): Promise<TResponse> {
  let lastError: Error | null = null;

  for (const rpcUrl of rpcUrls) {
    for (let attempt = 1; attempt <= DEFAULT_RETRY_COUNT; attempt += 1) {
      try {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "fast-auth-metrics-dashboard",
            method,
            params,
          }),
        });

        if (response.ok) {
          return (await response.json()) as TResponse;
        }

        const responseText = await response.text();
        const responseSnippet = responseText.slice(0, 220).replace(/\s+/g, " ").trim();

        lastError = new Error(
          `NEAR ${contextLabel} request failed (${response.status}) via ${rpcUrl}${responseSnippet ? `: ${responseSnippet}` : "."}`,
        );

        // Back off and retry on transient rate-limit/server errors.
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < DEFAULT_RETRY_COUNT
        ) {
          await sleep(DEFAULT_RETRY_BASE_DELAY_MS * attempt);
          continue;
        }

        break;
      } catch (error) {
        lastError =
          error instanceof Error
            ? error
            : new Error(`Unknown NEAR ${contextLabel} request failure via ${rpcUrl}.`);

        if (attempt < DEFAULT_RETRY_COUNT) {
          await sleep(DEFAULT_RETRY_BASE_DELAY_MS * attempt);
          continue;
        }
      }
    }
  }

  throw lastError ?? new Error(`NEAR ${contextLabel} request failed.`);
}

function toDateFromNearNs(timestampNs: number | undefined): Date {
  if (!timestampNs) {
    return new Date();
  }

  return new Date(Math.floor(timestampNs / 1_000_000));
}

function isSkippableMissingHeightError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message;

  return (
    message.includes("block-by-height") &&
    message.includes("(422)") &&
    (message.includes("UNKNOWN_BLOCK") ||
      message.includes("Unknown") ||
      message.includes("DB Not Found"))
  );
}

async function fetchFinalBlock(rpcUrls: string[]): Promise<NearBlockResponse> {
  return requestNearRpc<NearBlockResponse>(rpcUrls, "block", { finality: "final" }, "final-block");
}

async function fetchBlockByHeight(
  rpcUrls: string[],
  height: number,
): Promise<NearBlockResponse> {
  return requestNearRpc<NearBlockResponse>(
    rpcUrls,
    "block",
    { block_id: height },
    `block-by-height ${height}`,
  );
}

async function fetchChunkByHash(
  rpcUrls: string[],
  chunkHash: string,
): Promise<NearChunkResponse> {
  return requestNearRpc<NearChunkResponse>(
    rpcUrls,
    "chunk",
    { chunk_id: chunkHash },
    `chunk-by-hash ${chunkHash}`,
  );
}

function parseActionMetadata(actions: unknown[] | undefined): {
  methodName: string | null;
  attachedDepositYocto: string | null;
} {
  if (!actions || actions.length === 0) {
    return {
      methodName: null,
      attachedDepositYocto: null,
    };
  }

  let fallbackActionName: string | null = null;

  for (const action of actions) {
    if (!action || typeof action !== "object") {
      continue;
    }

    const [actionName] = Object.keys(action);
    if (!actionName) {
      continue;
    }

    fallbackActionName ??= actionName;

    if (actionName !== "FunctionCall") {
      continue;
    }

    const functionCall = (action as Record<string, unknown>).FunctionCall;
    if (!functionCall || typeof functionCall !== "object") {
      continue;
    }

    const methodName =
      typeof (functionCall as Record<string, unknown>).method_name === "string"
        ? ((functionCall as Record<string, unknown>).method_name as string)
        : "FunctionCall";

    const attachedDepositYocto =
      typeof (functionCall as Record<string, unknown>).deposit === "string"
        ? ((functionCall as Record<string, unknown>).deposit as string)
        : null;

    return {
      methodName,
      attachedDepositYocto,
    };
  }

  return {
    methodName: fallbackActionName,
    attachedDepositYocto: null,
  };
}

function toTransactionPayload(
  tx: NearChunkTransaction,
  trackedAccountMatches: string[],
): Prisma.InputJsonObject {
  return {
    hash: tx.hash ?? null,
    signer_id: tx.signer_id ?? null,
    receiver_id: tx.receiver_id ?? null,
    tracked_accounts: trackedAccountMatches,
    actions: (Array.isArray(tx.actions) ? tx.actions : []) as Prisma.InputJsonArray,
  };
}

async function persistNearBlock(
  prisma: PrismaClient,
  blockHeight: number,
  blockHash: string,
  blockTimestamp: number | undefined,
  transactions: Prisma.NearTransactionCreateManyInput[],
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    let insertedTransactions = 0;

    if (transactions.length > 0) {
      const insertResult = await tx.nearTransaction.createMany({
        data: transactions,
        skipDuplicates: true,
      });

      insertedTransactions = insertResult.count;
    }

    await tx.serviceMetricSample.create({
      data: {
        timestamp: toDateFromNearNs(blockTimestamp),
        serviceName: "near",
        metricName: "near_final_block_height",
        labels: {
          hash: blockHash,
        },
        value: blockHeight,
      },
    });

    await tx.indexerCheckpoint.upsert({
      where: { key: CHECKPOINT_HEIGHT },
      create: { key: CHECKPOINT_HEIGHT, value: String(blockHeight) },
      update: { value: String(blockHeight) },
    });

    await tx.indexerCheckpoint.upsert({
      where: { key: CHECKPOINT_SCANNED_HEIGHT },
      create: { key: CHECKPOINT_SCANNED_HEIGHT, value: String(blockHeight) },
      update: { value: String(blockHeight) },
    });

    await tx.indexerCheckpoint.upsert({
      where: { key: CHECKPOINT_HASH },
      create: { key: CHECKPOINT_HASH, value: blockHash },
      update: { value: blockHash },
    });

    return insertedTransactions;
  });
}

async function persistSkippedHeightCheckpoint(
  prisma: PrismaClient,
  height: number,
): Promise<void> {
  await prisma.indexerCheckpoint.upsert({
    where: { key: CHECKPOINT_SCANNED_HEIGHT },
    create: { key: CHECKPOINT_SCANNED_HEIGHT, value: String(height) },
    update: { value: String(height) },
  });
}

export async function collectNearState(prisma: PrismaClient): Promise<IndexerRunResult> {
  const normalRpcUrl = resolveNormalRpcUrl();
  const archivalRpcUrl = resolveArchivalRpcUrl();
  const latestBlockRpcUrls = uniqueUrls([normalRpcUrl, archivalRpcUrl]);
  const historicalRpcUrls = uniqueUrls([archivalRpcUrl, normalRpcUrl]);
  const trackedAccounts = resolveTrackedNearAccounts();
  const trackedAccountSet = new Set(trackedAccounts);
  const configuredBackfillStartHeight = resolveBackfillStartHeight();

  try {
    const maxBlocksPerRun = resolveMaxBlocksPerRun();
    const payload = await fetchFinalBlock(latestBlockRpcUrls);
    const latestHeight = payload.result?.header?.height;
    const latestHash = payload.result?.header?.hash;

    if (!latestHeight || !latestHash) {
      throw new Error("NEAR response did not include final block height/hash.");
    }

    const [heightCheckpoint, scannedHeightCheckpoint] = await Promise.all([
      prisma.indexerCheckpoint.findUnique({
        where: { key: CHECKPOINT_HEIGHT },
      }),
      prisma.indexerCheckpoint.findUnique({
        where: { key: CHECKPOINT_SCANNED_HEIGHT },
      }),
    ]);

    const parsedHeightCheckpoint = Number(heightCheckpoint?.value ?? "");
    const parsedScannedCheckpoint = Number(scannedHeightCheckpoint?.value ?? "");
    const hasHeightCheckpoint = Number.isFinite(parsedHeightCheckpoint);
    const hasScannedCheckpoint = Number.isFinite(parsedScannedCheckpoint);
    const computedStartHeight = hasScannedCheckpoint
      ? parsedScannedCheckpoint + 1
      : hasHeightCheckpoint
        ? parsedHeightCheckpoint + 1
        : configuredBackfillStartHeight !== null
          ? Math.min(configuredBackfillStartHeight, latestHeight)
          : latestHeight;
    const startHeight =
      configuredBackfillStartHeight !== null
        ? Math.max(computedStartHeight, configuredBackfillStartHeight)
        : computedStartHeight;
    const targetHeight = Math.min(latestHeight, startHeight + maxBlocksPerRun - 1);

    let processed = 0;
    let skippedHeights = 0;
    let indexedTransactions = 0;

    for (let height = startHeight; height <= targetHeight; height += 1) {
      let blockPayload: NearBlockResponse;

      try {
        blockPayload =
          height === latestHeight
            ? payload
            : await fetchBlockByHeight(historicalRpcUrls, height);
      } catch (error) {
        if (isSkippableMissingHeightError(error)) {
          await persistSkippedHeightCheckpoint(prisma, height);
          processed += 1;
          skippedHeights += 1;
          continue;
        }

        throw error;
      }

      const blockHeight = blockPayload.result?.header?.height;
      const blockHash = blockPayload.result?.header?.hash;
      const blockTimestamp = blockPayload.result?.header?.timestamp;

      if (!blockHeight || !blockHash) {
        throw new Error(`NEAR response missing block details for height ${height}.`);
      }

      const chunkHashes =
        blockPayload.result?.chunks
          ?.map((chunk) => chunk.chunk_hash)
          .filter((chunkHash): chunkHash is string => Boolean(chunkHash)) ?? [];

      const uniqueTransactions = new Map<string, Prisma.NearTransactionCreateManyInput>();

      for (const chunkHash of chunkHashes) {
        const chunkPayload = await fetchChunkByHash(historicalRpcUrls, chunkHash);
        const chunkTransactions = chunkPayload.result?.transactions ?? [];

        for (const tx of chunkTransactions) {
          const txHash = tx.hash;
          if (!txHash) {
            continue;
          }

          const signer = tx.signer_id?.toLowerCase();
          const receiver = tx.receiver_id?.toLowerCase();
          const matchesSigner = signer ? trackedAccountSet.has(signer) : false;
          const matchesReceiver = receiver ? trackedAccountSet.has(receiver) : false;

          if (!matchesSigner && !matchesReceiver) {
            continue;
          }

          const relatedAccounts = [...new Set([signer, receiver].filter((accountId): accountId is string => Boolean(accountId && trackedAccountSet.has(accountId))))];
          const { methodName, attachedDepositYocto } = parseActionMetadata(tx.actions);

          uniqueTransactions.set(txHash, {
            txHash,
            blockHeight: BigInt(blockHeight),
            blockTimestamp: toDateFromNearNs(blockTimestamp),
            signerAccountId: tx.signer_id ?? null,
            receiverId: tx.receiver_id ?? null,
            methodName,
            executionStatus: "included",
            failureReason: null,
            gasBurnt: null,
            attachedDepositYocto,
            payload: toTransactionPayload(tx, relatedAccounts),
          });
        }
      }

      const insertedTransactions = await persistNearBlock(
        prisma,
        blockHeight,
        blockHash,
        blockTimestamp,
        [...uniqueTransactions.values()],
      );

      processed += 1;
      indexedTransactions += insertedTransactions;
    }

    return {
      source: "near",
      status: "ok",
      inserted: indexedTransactions,
      details:
        processed === 0
          ? `Checkpoint already at latest final block ${latestHeight}.`
          : `Processed block heights ${startHeight}..${targetHeight}${targetHeight < latestHeight ? ` (latest is ${latestHeight})` : ""}; indexed ${indexedTransactions} tracked transactions for ${trackedAccounts.join(", ")}; skipped ${skippedHeights} empty heights.`,
    };
  } catch (error) {
    return {
      source: "near",
      status: "error",
      details: error instanceof Error ? error.message : "Unknown NEAR collector error.",
    };
  }
}
