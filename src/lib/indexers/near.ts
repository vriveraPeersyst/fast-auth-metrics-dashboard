import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import {
  createNearRpcManager,
  NearRpcExhaustedError,
  type NearRpcManager,
} from "@/lib/indexers/near-rpc-manager";
import type { IndexerRunResult } from "@/lib/indexers/types";

// Hardcoded indexer tuning. Historical defaults from env (.env knobs) have
// been collapsed into source constants — they are deployment-invariant and
// only churned here.
const NEAR_MAX_BLOCKS_PER_RUN = 500;
const NEAR_BLOCK_CONCURRENCY = 20;
const NEAR_CHUNK_CONCURRENCY = 6;
const NEAR_BACKFILL_START_HEIGHT = 194_800_000;
const NEAR_PROGRESS_LOG_EVERY_BLOCKS = 10;

export type NearBlockResponse = {
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

export type NearChunkResponse = {
  result?: {
    transactions?: NearChunkTransaction[];
  };
};

export type NearChunkTransaction = {
  hash?: string;
  signer_id?: string;
  public_key?: string;
  receiver_id?: string;
  actions?: unknown[];
  outcome?: {
    outcome?: {
      gas_burnt?: number | string;
      status?: unknown;
    };
  };
};

const CHECKPOINT_HEIGHT = "near_last_final_block_height";
const CHECKPOINT_HASH = "near_last_final_block_hash";
const CHECKPOINT_SCANNED_HEIGHT = "near_last_scanned_height";
const CHECKPOINT_CHAIN_HEAD_HEIGHT = "near_chain_head_height";
const CHECKPOINT_CHAIN_HEAD_HASH = "near_chain_head_hash";
const CHECKPOINT_BACKFILL_START_ORIGIN = "near_backfill_start_origin";

export type FastAuthSignEventSeed = Prisma.FastAuthSignEventCreateManyInput;

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const effectiveConcurrency = Math.min(Math.max(concurrency, 1), items.length);
  let cursor = 0;
  let failure: unknown = null;

  const runners = Array.from({ length: effectiveConcurrency }, async () => {
    while (failure === null) {
      const currentIndex = cursor;
      cursor += 1;

      if (currentIndex >= items.length) {
        return;
      }

      try {
        await worker(items[currentIndex], currentIndex);
      } catch (error) {
        if (failure === null) {
          failure = error;
        }
        return;
      }
    }
  });

  await Promise.all(runners);

  if (failure !== null) {
    throw failure;
  }
}

export function resolveFastAuthContractIds(): string[] {
  const raw = process.env.FASTAUTH_CONTRACT_IDS;

  if (!raw) {
    throw new Error(
      "FASTAUTH_CONTRACT_IDS is required. Set on Railway worker (comma-separated contract IDs).",
    );
  }

  const parsed = raw
    .split(",")
    .map((contractId) => contractId.trim().toLowerCase())
    .filter(Boolean);

  if (parsed.length === 0) {
    throw new Error("FASTAUTH_CONTRACT_IDS must contain at least one contract ID.");
  }

  return [...new Set(parsed)];
}

export function toDateFromNearNs(timestampNs: number | undefined): Date {
  if (!timestampNs) {
    return new Date();
  }

  return new Date(Math.floor(timestampNs / 1_000_000));
}

function isSkippableMissingHeightError(error: unknown): boolean {
  // Only trust the exhausted-retries error type. A single transient failure
  // shouldn't skip a height; we need confirmation from the full retry loop.
  if (!(error instanceof NearRpcExhaustedError)) {
    return false;
  }

  if (!error.message.includes("block-by-height")) {
    return false;
  }

  // Require majority of endpoints in the pool to confirm UNKNOWN_BLOCK before
  // permanently skipping. Prevents a single pruning RPC that lies about
  // heights it doesn't serve from advancing the checkpoint past real blocks.
  const quorum = Math.ceil(error.healthyEndpointCount / 2);
  return error.unknownBlockEndpoints.size >= quorum;
}

async function fetchFinalBlock(rpcManager: NearRpcManager): Promise<NearBlockResponse> {
  return rpcManager.request<NearBlockResponse>("block", { finality: "final" }, "final-block");
}

export async function fetchBlockByHeight(
  rpcManager: NearRpcManager,
  height: number,
): Promise<NearBlockResponse> {
  return rpcManager.request<NearBlockResponse>(
    "block",
    { block_id: height },
    `block-by-height ${height}`,
  );
}

export async function fetchChunkByHash(
  rpcManager: NearRpcManager,
  chunkHash: string,
): Promise<NearChunkResponse> {
  return rpcManager.request<NearChunkResponse>(
    "chunk",
    { chunk_id: chunkHash },
    `chunk-by-hash ${chunkHash}`,
  );
}

export function parseActionMetadata(actions: unknown[] | undefined): {
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeBase64ToUtf8(raw: string): string | null {
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function decodeBase64UrlToUtf8(raw: string): string | null {
  const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  return decodeBase64ToUtf8(padded);
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseJwtSub(verifyPayload: string | null): string | null {
  if (!verifyPayload) {
    return null;
  }

  const segments = verifyPayload.split(".");
  if (segments.length < 2) {
    return null;
  }

  const payloadJson = decodeBase64UrlToUtf8(segments[1]);
  const payload = parseJsonObject(payloadJson);
  const sub = payload?.sub;

  return typeof sub === "string" && sub.trim() ? sub.trim() : null;
}

function getNestedValue(input: unknown, path: string[]): unknown {
  let current = input;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function isLikelyNearAccountId(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return /^[a-z0-9._-]+$/.test(normalized) && (normalized.includes(".") || normalized.endsWith("near"));
}

export function normalizeNearPublicKey(value: string | undefined): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseSignPayload(
  signPayload: unknown,
): { payloadObject: Record<string, unknown> | null; payloadJson: Prisma.InputJsonValue | null } {
  if (Array.isArray(signPayload)) {
    if (signPayload.every((item) => typeof item === "number")) {
      const decoded = Buffer.from(signPayload).toString("utf8");
      const parsedObject = parseJsonObject(decoded);

      return {
        payloadObject: parsedObject,
        payloadJson: parsedObject as Prisma.InputJsonValue,
      };
    }

    return {
      payloadObject: null,
      payloadJson: signPayload as Prisma.InputJsonValue,
    };
  }

  if (typeof signPayload === "string") {
    const directObject = parseJsonObject(signPayload);
    if (directObject) {
      return {
        payloadObject: directObject,
        payloadJson: directObject as Prisma.InputJsonValue,
      };
    }

    const decoded = decodeBase64ToUtf8(signPayload);
    const decodedObject = parseJsonObject(decoded);

    return {
      payloadObject: decodedObject,
      payloadJson: decodedObject as Prisma.InputJsonValue,
    };
  }

  if (signPayload && typeof signPayload === "object") {
    return {
      payloadObject: signPayload as Record<string, unknown>,
      payloadJson: signPayload as Prisma.InputJsonValue,
    };
  }

  return {
    payloadObject: null,
    payloadJson: null,
  };
}

function extractProjectDappId(signPayload: Record<string, unknown> | null): string | null {
  if (!signPayload) {
    return null;
  }

  const candidatePaths = [
    ["transaction", "receiver_id"],
    ["transaction", "receiverId"],
    ["delegate_action", "receiver_id"],
    ["delegateAction", "receiverId"],
    ["receiver_id"],
    ["receiverId"],
    ["receiver"],
  ];

  for (const path of candidatePaths) {
    const value = getNestedValue(signPayload, path);

    if (typeof value === "string" && value.trim()) {
      return value.trim().toLowerCase();
    }
  }

  return null;
}

function extractSponsoredAccount(signPayload: Record<string, unknown> | null): string | null {
  if (!signPayload) {
    return null;
  }

  const candidatePaths = [
    ["transaction", "signer_id"],
    ["transaction", "signerId"],
    ["delegate_action", "sender_id"],
    ["delegateAction", "senderId"],
    ["account_id"],
    ["accountId"],
    ["signer_id"],
    ["signerId"],
    ["sender_id"],
    ["senderId"],
    ["user_id"],
    ["userId"],
  ];

  for (const path of candidatePaths) {
    const value = getNestedValue(signPayload, path);

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function resolveProviderType(guardId: string | null): { providerType: string; guardName: string | null } {
  if (!guardId || !guardId.trim()) {
    return {
      providerType: "unknown",
      guardName: null,
    };
  }

  const normalizedGuardId = guardId.trim().toLowerCase();
  const parts = normalizedGuardId.split("#");
  const guardName = parts.length > 1 ? parts[1] : parts[0];

  if (guardName.includes("auth0")) {
    return {
      providerType: "auth0",
      guardName,
    };
  }

  if (guardName.includes("firebase")) {
    return {
      providerType: "firebase",
      guardName,
    };
  }

  if (guardName.includes("custom") || guardName.includes("issuer")) {
    return {
      providerType: "custom_issuer",
      guardName,
    };
  }

  return {
    providerType: "unknown",
    guardName,
  };
}

function toMpcDomainId(algorithm: string | null): number | null {
  if (!algorithm || !algorithm.trim()) {
    return null;
  }

  const normalized = algorithm.trim().toLowerCase();

  if (normalized === "eddsa") {
    return 1;
  }

  if (normalized === "secp256k1" || normalized === "ecdsa") {
    return 0;
  }

  return null;
}

function isFunctionCallAction(action: unknown): action is { FunctionCall: Record<string, unknown> } {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    return false;
  }

  const functionCall = (action as Record<string, unknown>).FunctionCall;

  return Boolean(functionCall && typeof functionCall === "object" && !Array.isArray(functionCall));
}

export function deriveFastAuthSignEventsFromTransaction(params: {
  tx: NearChunkTransaction;
  blockHeight: number;
  blockTimestamp: number | undefined;
  executionStatus: string | null;
  failureReason: string | null;
  gasBurnt: bigint | null;
  relayerPublicKey: string | null;
  fastAuthContractSet: Set<string>;
}): FastAuthSignEventSeed[] {
  const actions = Array.isArray(params.tx.actions) ? params.tx.actions : [];
  const receiverId = params.tx.receiver_id?.trim().toLowerCase() ?? null;
  const relayerAccountId = params.tx.signer_id?.trim().toLowerCase() ?? null;
  const txHash = params.tx.hash;

  if (!receiverId || !relayerAccountId || !txHash || !params.fastAuthContractSet.has(receiverId)) {
    return [];
  }

  const derivedEvents: FastAuthSignEventSeed[] = [];

  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];

    if (!isFunctionCallAction(action)) {
      continue;
    }

    const functionCall = action.FunctionCall;
    const methodName = functionCall.method_name;

    if (typeof methodName !== "string" || methodName !== "sign") {
      continue;
    }

    const rawArgs = functionCall.args;
    const argsPayload =
      typeof rawArgs === "string" ? parseJsonObject(decodeBase64ToUtf8(rawArgs)) : null;
    const guardId =
      typeof argsPayload?.guard_id === "string"
        ? argsPayload.guard_id
        : typeof argsPayload?.guardId === "string"
          ? argsPayload.guardId
          : null;
    const verifyPayload =
      typeof argsPayload?.verify_payload === "string"
        ? argsPayload.verify_payload
        : typeof argsPayload?.verifyPayload === "string"
          ? argsPayload.verifyPayload
          : null;
    const algorithm =
      typeof argsPayload?.algorithm === "string" ? argsPayload.algorithm : null;
    const signPayloadCandidate =
      argsPayload?.sign_payload ?? argsPayload?.signPayload ?? null;
    const { payloadObject, payloadJson } = parseSignPayload(signPayloadCandidate);
    const userSub = parseJwtSub(verifyPayload);
    const userKeyPath =
      guardId && userSub
        ? `${guardId.trim()}#${userSub}`
        : null;
    const userDomainId = toMpcDomainId(algorithm);
    const projectDappId = extractProjectDappId(payloadObject);
    const sponsoredAccountCandidate =
      extractSponsoredAccount(payloadObject) ?? userSub;
    const sponsoredAccountId =
      sponsoredAccountCandidate && isLikelyNearAccountId(sponsoredAccountCandidate)
        ? sponsoredAccountCandidate.trim().toLowerCase()
        : null;
    const sponsoredAccountHash = sponsoredAccountCandidate
      ? sha256(sponsoredAccountCandidate)
      : null;
    const verifyPayloadHash = verifyPayload ? sha256(verifyPayload) : null;
    const { providerType, guardName } = resolveProviderType(guardId);
    const attachedDepositYocto =
      typeof functionCall.deposit === "string" ? functionCall.deposit : null;

    derivedEvents.push({
      txHash,
      actionIndex,
      blockHeight: BigInt(params.blockHeight),
      blockTimestamp: toDateFromNearNs(params.blockTimestamp),
      relayerAccountId,
      relayerPublicKey: params.relayerPublicKey,
      fastAuthContractId: receiverId,
      guardId,
      guardName,
      providerType,
      algorithm,
      userSub,
      userKeyPath,
      userDomainId,
      userDerivedPublicKey: null,
      projectDappId,
      sponsoredAccountId,
      sponsoredAccountHash,
      verifyPayloadHash,
      signPayloadJson: payloadJson ?? Prisma.JsonNull,
      executionStatus: params.executionStatus,
      failureReason: params.failureReason,
      gasBurnt: params.gasBurnt,
      attachedDepositYocto,
    });
  }

  return derivedEvents;
}

export async function rebuildRelayerMarts(prisma: PrismaClient): Promise<{ relayers: number }> {
  const now = new Date();
  const [
    relayerGroups,
    relayerProviderGroups,
    relayerSponsoredPairs,
  ] = await Promise.all([
    prisma.fastAuthSignEvent.groupBy({
      by: ["relayerAccountId"],
      _count: {
        id: true,
      },
      _min: {
        blockTimestamp: true,
      },
      _max: {
        blockTimestamp: true,
      },
      _sum: {
        gasBurnt: true,
      },
    }),
    prisma.fastAuthSignEvent.groupBy({
      by: ["relayerAccountId", "providerType"],
      _count: {
        id: true,
      },
    }),
    prisma.fastAuthSignEvent.findMany({
      where: {
        sponsoredAccountId: {
          not: null,
        },
      },
      select: {
        relayerAccountId: true,
        sponsoredAccountId: true,
      },
      distinct: ["relayerAccountId", "sponsoredAccountId"],
    }),
  ]);

  const sponsoredByRelayer = new Map<string, number>();
  for (const pair of relayerSponsoredPairs) {
    const key = pair.relayerAccountId.toLowerCase();
    sponsoredByRelayer.set(key, (sponsoredByRelayer.get(key) ?? 0) + 1);
  }

  const providerMixByRelayer = new Map<string, Record<string, number>>();
  for (const group of relayerProviderGroups) {
    const key = group.relayerAccountId.toLowerCase();
    const current = providerMixByRelayer.get(key) ?? {};

    current[group.providerType] = group._count.id;
    providerMixByRelayer.set(key, current);
  }

  const projectOwnerMap = new Map<string, string>();

  const relayerRows: Prisma.RelayerCreateManyInput[] = relayerGroups.map((group) => {
    const key = group.relayerAccountId.toLowerCase();

    return {
      accountId: key,
      firstSeenAt: group._min.blockTimestamp ?? now,
      lastSeenAt: group._max.blockTimestamp ?? now,
      totalSignTransactions: group._count.id,
      totalGasBurnt: group._sum.gasBurnt,
      totalSponsoredUniqueAccounts: sponsoredByRelayer.get(key) ?? 0,
      projectOwner: projectOwnerMap.get(key) ?? null,
      providerMixJson: providerMixByRelayer.get(key) ?? {},
      createdAt: now,
      updatedAt: now,
    };
  });

  await prisma.$transaction(async (tx) => {
    await tx.relayer.deleteMany({});
    if (relayerRows.length > 0) {
      await tx.relayer.createMany({
        data: relayerRows,
      });
    }
  });

  return {
    relayers: relayerRows.length,
  };
}

export function toNullableBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }

    return BigInt(Math.floor(value));
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  return null;
}

export function parseExecutionStatus(status: unknown): { executionStatus: string | null; failureReason: string | null } {
  if (!status) {
    return {
      executionStatus: "included",
      failureReason: null,
    };
  }

  if (typeof status === "string") {
    return {
      executionStatus: status,
      failureReason: null,
    };
  }

  if (typeof status === "object") {
    const entries = Object.entries(status as Record<string, unknown>);

    if (entries.length > 0) {
      const [variant, payload] = entries[0];

      return {
        executionStatus: variant,
        failureReason:
          variant.toLowerCase().includes("failure")
            ? typeof payload === "string"
              ? payload
              : JSON.stringify(payload)
            : null,
      };
    }
  }

  return {
    executionStatus: "included",
    failureReason: null,
  };
}

export function toTransactionPayload(tx: NearChunkTransaction): Prisma.InputJsonObject {
  return {
    hash: tx.hash ?? null,
    signer_id: tx.signer_id ?? null,
    public_key: tx.public_key ?? null,
    receiver_id: tx.receiver_id ?? null,
    actions: (Array.isArray(tx.actions) ? tx.actions : []) as Prisma.InputJsonArray,
  };
}

export async function persistNearBlock(
  prisma: PrismaClient,
  blockHeight: number,
  blockHash: string,
  blockTimestamp: number | undefined,
  transactions: Prisma.NearTransactionCreateManyInput[],
  signEvents: FastAuthSignEventSeed[],
): Promise<{ insertedTransactions: number; insertedSignEvents: number }> {
  // Fast path: most NEAR blocks contain no FastAuth-relevant transactions.
  // Avoid opening a Prisma transaction (or even a single round-trip) when
  // there is nothing to write.
  if (transactions.length === 0 && signEvents.length === 0) {
    return { insertedTransactions: 0, insertedSignEvents: 0 };
  }

  // The two createMany statements are independently row-atomic and
  // skipDuplicates makes re-runs idempotent, so we don't need an interactive
  // transaction wrapping them. Running them in parallel halves DB round-trips.
  const [txInsert, signInsert] = await Promise.all([
    transactions.length > 0
      ? prisma.nearTransaction.createMany({
          data: transactions,
          skipDuplicates: true,
        })
      : Promise.resolve({ count: 0 }),
    signEvents.length > 0
      ? prisma.fastAuthSignEvent.createMany({
          data: signEvents,
          skipDuplicates: true,
        })
      : Promise.resolve({ count: 0 }),
  ]);

  return {
    insertedTransactions: txInsert.count,
    insertedSignEvents: signInsert.count,
  };
}

async function persistRunCheckpoints(
  prisma: PrismaClient,
  params: { targetHeight: number; targetHash: string | null },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.indexerCheckpoint.upsert({
      where: { key: CHECKPOINT_HEIGHT },
      create: { key: CHECKPOINT_HEIGHT, value: String(params.targetHeight) },
      update: { value: String(params.targetHeight) },
    });

    await tx.indexerCheckpoint.upsert({
      where: { key: CHECKPOINT_SCANNED_HEIGHT },
      create: { key: CHECKPOINT_SCANNED_HEIGHT, value: String(params.targetHeight) },
      update: { value: String(params.targetHeight) },
    });

    if (params.targetHash) {
      await tx.indexerCheckpoint.upsert({
        where: { key: CHECKPOINT_HASH },
        create: { key: CHECKPOINT_HASH, value: params.targetHash },
        update: { value: params.targetHash },
      });
    }
  });
}

export async function collectNearState(prisma: PrismaClient): Promise<IndexerRunResult> {
  const rpcManager = createNearRpcManager();
  const fastAuthContractIds = resolveFastAuthContractIds();
  const fastAuthContractSet = new Set(fastAuthContractIds);
  const configuredBackfillStartHeight = NEAR_BACKFILL_START_HEIGHT;
  const progressLogEveryBlocks = NEAR_PROGRESS_LOG_EVERY_BLOCKS;

  try {
    const maxBlocksPerRun = NEAR_MAX_BLOCKS_PER_RUN;
    const payload = await fetchFinalBlock(rpcManager);
    const latestHeight = payload.result?.header?.height;
    const latestHash = payload.result?.header?.hash;

    if (!latestHeight || !latestHash) {
      throw new Error("NEAR response did not include final block height/hash.");
    }

    await prisma.$transaction([
      prisma.indexerCheckpoint.upsert({
        where: { key: CHECKPOINT_CHAIN_HEAD_HEIGHT },
        create: { key: CHECKPOINT_CHAIN_HEAD_HEIGHT, value: String(latestHeight) },
        update: { value: String(latestHeight) },
      }),
      prisma.indexerCheckpoint.upsert({
        where: { key: CHECKPOINT_CHAIN_HEAD_HASH },
        create: { key: CHECKPOINT_CHAIN_HEAD_HASH, value: latestHash },
        update: { value: latestHash },
      }),
    ]);

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

    // Persist the origin of the backfill on the first ever run. `create`-only
    // upsert behavior: the record sticks once written, so future runs never
    // overwrite the historical starting point.
    await prisma.indexerCheckpoint.upsert({
      where: { key: CHECKPOINT_BACKFILL_START_ORIGIN },
      create: { key: CHECKPOINT_BACKFILL_START_ORIGIN, value: String(startHeight) },
      update: {},
    });

    const targetHeight = Math.min(latestHeight, startHeight + maxBlocksPerRun - 1);
    const startedAt = Date.now();

    console.log(
      JSON.stringify({
        level: "info",
        message: "NEAR collector range selected",
        startHeight,
        targetHeight,
        latestHeight,
        maxBlocksPerRun,
        blockConcurrency: NEAR_BLOCK_CONCURRENCY,
        chunkConcurrency: NEAR_CHUNK_CONCURRENCY,
      }),
    );

    let processed = 0;
    let skippedHeights = 0;
    let indexedTransactions = 0;
    let indexedFastAuthSignEvents = 0;
    let latestPersistedHash: string | null = null;
    let latestPersistedHeight = -1;
    // Tracks heights that finished (successfully or safely-skipped) so we can
    // advance the checkpoint only to the highest contiguous height without
    // leaving gaps when parallel workers complete out of order.
    const completedHeights = new Set<number>();

    const blockConcurrency = NEAR_BLOCK_CONCURRENCY;
    const chunkConcurrency = NEAR_CHUNK_CONCURRENCY;
    const heights: number[] = [];
    for (let h = startHeight; h <= targetHeight; h += 1) {
      heights.push(h);
    }
    const totalPlanned = heights.length;

    const processBlockHeight = async (height: number): Promise<void> => {
      let blockPayload: NearBlockResponse;

      try {
        blockPayload =
          height === latestHeight
            ? payload
            : await fetchBlockByHeight(rpcManager, height);
      } catch (error) {
        if (isSkippableMissingHeightError(error)) {
          processed += 1;
          skippedHeights += 1;
          completedHeights.add(height);
          return;
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
      const uniqueSignEvents = new Map<string, FastAuthSignEventSeed>();

      const chunkPayloads: NearChunkResponse[] = new Array(chunkHashes.length);
      await runWithConcurrency(chunkHashes, chunkConcurrency, async (chunkHash, idx) => {
        chunkPayloads[idx] = await fetchChunkByHash(rpcManager, chunkHash);
      });

      for (const chunkPayload of chunkPayloads) {
        const chunkTransactions = chunkPayload?.result?.transactions ?? [];

        for (const tx of chunkTransactions) {
          const txHash = tx.hash;
          if (!txHash) {
            continue;
          }

          const normalizedReceiverId = tx.receiver_id?.trim().toLowerCase() ?? null;
          if (!normalizedReceiverId || !fastAuthContractSet.has(normalizedReceiverId)) {
            continue;
          }

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
            // Composite unique key is (txHash, actionIndex).
            uniqueSignEvents.set(`${signEvent.txHash}:${signEvent.actionIndex}`, signEvent);
          }
        }
      }

      const insertResult = await persistNearBlock(
        prisma,
        blockHeight,
        blockHash,
        blockTimestamp,
        [...uniqueTransactions.values()],
        [...uniqueSignEvents.values()],
      );

      processed += 1;
      indexedTransactions += insertResult.insertedTransactions;
      indexedFastAuthSignEvents += insertResult.insertedSignEvents;

      if (blockHeight > latestPersistedHeight) {
        latestPersistedHeight = blockHeight;
        latestPersistedHash = blockHash;
      }
      completedHeights.add(height);

      const shouldLogProgress =
        processed === 1 ||
        processed % progressLogEveryBlocks === 0 ||
        processed === totalPlanned;

      if (shouldLogProgress) {
        const elapsedMs = Date.now() - startedAt;

        console.log(
          JSON.stringify({
            level: "info",
            message: "NEAR collector progress",
            processed,
            totalPlanned,
            currentHeight: height,
            latestPersistedHeight,
            indexedTransactions,
            indexedFastAuthSignEvents,
            skippedHeights,
            elapsedMs,
          }),
        );
      }
    };

    let runError: unknown = null;
    try {
      await runWithConcurrency(heights, blockConcurrency, processBlockHeight);
    } catch (error) {
      runError = error;
    }

    // Advance checkpoints only to the highest contiguous height completed from
    // startHeight. Any hole (e.g. a 429 that killed the middle of the window)
    // stops the advance so we retry those missing heights next run.
    let highestContiguous = startHeight - 1;
    for (let h = startHeight; h <= targetHeight; h += 1) {
      if (!completedHeights.has(h)) {
        break;
      }
      highestContiguous = h;
    }

    if (highestContiguous >= startHeight) {
      await persistRunCheckpoints(prisma, {
        targetHeight: highestContiguous,
        targetHash: latestPersistedHeight === highestContiguous ? latestPersistedHash : null,
      });
    }

    // Rebuild marts only when we actually persisted new FastAuth sign events.
    // Empty blocks dominate the stream, and the mart rebuild scans the entire
    // sign-event table, so running it on no-op runs is the biggest cost in a
    // normal cycle.
    const martCounts =
      indexedFastAuthSignEvents > 0
        ? await rebuildRelayerMarts(prisma)
        : {
            relayers: 0,
          };

    if (runError !== null) {
      const message =
        runError instanceof Error ? runError.message : "Unknown NEAR collector error.";

      return {
        source: "near",
        status: "error",
        inserted: indexedTransactions,
        details: `${message} | Partial progress: persisted up to height ${highestContiguous} (latest persisted ${latestPersistedHeight}); indexed ${indexedTransactions} transactions and ${indexedFastAuthSignEvents} sign events; rebuilt marts (${martCounts.relayers} relayers); skipped ${skippedHeights} empty heights.`,
      };
    }

    return {
      source: "near",
      status: "ok",
      inserted: indexedTransactions,
      details:
        processed === 0
          ? `Checkpoint already at latest final block ${latestHeight}.`
          : `Processed block heights ${startHeight}..${targetHeight}${targetHeight < latestHeight ? ` (latest is ${latestHeight})` : ""}; indexed ${indexedTransactions} transactions and ${indexedFastAuthSignEvents} FastAuth sign events; rebuilt marts (${martCounts.relayers} relayers); skipped ${skippedHeights} empty heights.`,
    };
  } catch (error) {
    return {
      source: "near",
      status: "error",
      details: error instanceof Error ? error.message : "Unknown NEAR collector error.",
    };
  }
}
