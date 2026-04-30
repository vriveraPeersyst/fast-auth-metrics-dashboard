import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import {
  createNearRpcManager,
  NearRpcExhaustedError,
  type NearRpcManager,
} from "@/lib/indexers/near-rpc-manager";
import { computeActionsValue, type ComputedTxValue } from "@/lib/indexers/compute-tx-value";
import {
  decodeSignActionType,
  decodeSignDelegatePublicKey,
} from "@/lib/indexers/decode-sign-action";
import { refreshTokenRegistry, type TokenRegistry } from "@/lib/indexers/token-prices";
import type { IndexerRunResult } from "@/lib/indexers/types";

// Hardcoded indexer tuning. Historical defaults from env (.env knobs) have
// been collapsed into source constants — they are deployment-invariant and
// only churned here.
const NEAR_MAX_BLOCKS_PER_RUN = 500;
const NEAR_BLOCK_CONCURRENCY = 20;
const NEAR_CHUNK_CONCURRENCY = 6;
const NEAR_BACKFILL_START_HEIGHT = 194_800_000;
const NEAR_PROGRESS_LOG_EVERY_BLOCKS = 10;

// Mainnet only — testnet (`v1.signer-prod.testnet`) is not in our scan scope.
const MPC_CONTRACT_IDS: ReadonlySet<string> = new Set(["v1.signer"]);

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

/**
 * Project a ComputedTxValue (totalUsd + per-token entries) into the column
 * shape FastAuthUserTransactionCreateManyInput expects: a scalar value_usd
 * plus four parallel arrays (symbols, raw amounts, decimals, per-token
 * USD values). Empty arrays when no token movement was priced.
 */
function buildTokenColumns(computed: ComputedTxValue): {
  valueUsd: Prisma.Decimal | null;
  tokenSymbols: string[];
  tokenAmounts: string[];
  tokenDecimals: number[];
  tokenValuesUsd: Prisma.Decimal[];
} {
  if (computed.totalUsd === null) {
    return {
      valueUsd: null,
      tokenSymbols: [],
      tokenAmounts: [],
      tokenDecimals: [],
      tokenValuesUsd: [],
    };
  }
  return {
    valueUsd: new Prisma.Decimal(computed.totalUsd),
    tokenSymbols: computed.tokens.map((t) => t.symbol),
    tokenAmounts: computed.tokens.map((t) => t.rawAmount),
    tokenDecimals: computed.tokens.map((t) => t.decimals),
    tokenValuesUsd: computed.tokens.map((t) => new Prisma.Decimal(t.valueUsd)),
  };
}

type DelegateActionInfo = {
  innerSignerId: string;
  innerReceiverId: string;
  innerPublicKey: string;
  innerActionTypes: string[];
  // Inner method name from the FIRST FunctionCall inside the Delegate.
  // Most user activity is single-FunctionCall (ft_transfer / claim / etc),
  // so first-method is a good proxy for "what did this Delegate do".
  innerMethodName: string | null;
  // Raw parsed inner actions for downstream value extraction (deposits,
  // ft_transfer args). Stored as the chunk-RPC-shaped objects we already
  // received — caller can iterate them to pull deposits / args / etc.
  innerActions: unknown[];
};

// Pulls the inner DelegateAction out of a NEP-366 meta-transaction so we can
// link it to the FastAuth sign event that produced its signature, and track
// whether the relayer's submission of that signature actually landed on chain.
export function extractDelegateActionInfo(
  actions: unknown[] | undefined,
): DelegateActionInfo | null {
  if (!actions) return null;
  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    const delegate = (action as Record<string, unknown>).Delegate;
    if (!delegate || typeof delegate !== "object") continue;
    const da = (delegate as Record<string, unknown>).delegate_action;
    if (!da || typeof da !== "object") continue;
    const sender = (da as Record<string, unknown>).sender_id;
    const receiver = (da as Record<string, unknown>).receiver_id;
    const pk = (da as Record<string, unknown>).public_key;
    const innerActions = (da as Record<string, unknown>).actions;
    if (
      typeof sender !== "string" ||
      typeof receiver !== "string" ||
      typeof pk !== "string" ||
      !Array.isArray(innerActions)
    ) {
      continue;
    }
    const innerActionTypes: string[] = [];
    let innerMethodName: string | null = null;
    for (const inner of innerActions) {
      if (!inner || typeof inner !== "object") continue;
      const [name] = Object.keys(inner);
      if (name) innerActionTypes.push(name);
      if (innerMethodName === null && name === "FunctionCall") {
        const fc = (inner as Record<string, unknown>).FunctionCall;
        if (fc && typeof fc === "object") {
          const m = (fc as Record<string, unknown>).method_name;
          if (typeof m === "string") innerMethodName = m;
        }
      }
    }
    return {
      innerSignerId: sender.trim(),
      innerReceiverId: receiver.trim(),
      innerPublicKey: pk.trim(),
      innerActionTypes,
      innerMethodName,
      innerActions,
    };
  }
  return null;
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

export function resolveProviderType(
  guardId: string | null,
): { providerType: string; guardName: string | null } {
  if (!guardId || !guardId.trim()) {
    return { providerType: "unknown", guardName: null };
  }

  const normalizedGuardId = guardId.trim().toLowerCase();
  const parts = normalizedGuardId.split("#");
  const guardName = parts.length > 1 ? parts[1] : parts[0];

  // Literal-name conventions take precedence over URL parsing — a guard
  // explicitly registered as "auth0" / "firebase" / "custom-issuer" is
  // unambiguous regardless of any underlying issuer URL.
  if (guardName.includes("auth0")) {
    return { providerType: "auth0", guardName };
  }
  if (guardName.includes("firebase")) {
    return { providerType: "firebase", guardName };
  }
  if (guardName.includes("custom") || guardName.includes("issuer")) {
    return { providerType: "custom_issuer", guardName };
  }

  // URL-form guard names: try to detect known IdP hosts before defaulting
  // to custom_issuer. Reason: docs convention isn't mandatory — operators
  // can register a Firebase- or Auth0-backed guard under its issuer URL
  // (e.g. "jwt#https://securetoken.google.com/<project>"), and we want
  // those classified correctly.
  if (guardName.startsWith("http://") || guardName.startsWith("https://")) {
    let host: string | null = null;
    try {
      host = new URL(guardName).hostname.toLowerCase();
    } catch {
      // Malformed URL — fall through to generic URL handling.
    }

    if (host) {
      if (host === "auth0.com" || host.endsWith(".auth0.com")) {
        return { providerType: "auth0", guardName };
      }
      if (host === "securetoken.google.com") {
        return { providerType: "firebase", guardName };
      }
    }

    return { providerType: "custom_issuer", guardName };
  }

  return { providerType: "unknown", guardName };
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
}): { seeds: FastAuthSignEventSeed[]; inlinePublicKeys: string[] } {
  const actions = Array.isArray(params.tx.actions) ? params.tx.actions : [];
  const receiverId = params.tx.receiver_id?.trim().toLowerCase() ?? null;
  const relayerAccountId = params.tx.signer_id?.trim().toLowerCase() ?? null;
  const txHash = params.tx.hash;

  if (!receiverId || !relayerAccountId || !txHash || !params.fastAuthContractSet.has(receiverId)) {
    return { seeds: [], inlinePublicKeys: [] };
  }

  const derivedEvents: FastAuthSignEventSeed[] = [];
  const inlinePublicKeys: string[] = [];

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
    const signPayloadBytes = Array.isArray(signPayloadCandidate)
      ? (signPayloadCandidate as number[])
      : null;
    const signActionType = decodeSignActionType(signPayloadBytes);
    const inlinePublicKey = decodeSignDelegatePublicKey(signPayloadBytes);
    if (inlinePublicKey) {
      inlinePublicKeys.push(inlinePublicKey);
    }
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
      signActionType,
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

  return { seeds: derivedEvents, inlinePublicKeys };
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
  consumerTransactions: Prisma.FastAuthConsumerTransactionCreateManyInput[] = [],
  userTransactions: Prisma.FastAuthUserTransactionCreateManyInput[] = [],
  mpcTransactions: Prisma.MpcTransactionCreateManyInput[] = [],
): Promise<{
  insertedTransactions: number;
  insertedSignEvents: number;
  insertedConsumerTransactions: number;
  insertedUserTransactions: number;
  insertedMpcTransactions: number;
}> {
  if (
    transactions.length === 0 &&
    signEvents.length === 0 &&
    consumerTransactions.length === 0 &&
    userTransactions.length === 0 &&
    mpcTransactions.length === 0
  ) {
    return {
      insertedTransactions: 0,
      insertedSignEvents: 0,
      insertedConsumerTransactions: 0,
      insertedUserTransactions: 0,
      insertedMpcTransactions: 0,
    };
  }

  const [txInsert, signInsert, consumerInsert, userInsert, mpcInsert] = await Promise.all([
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
    consumerTransactions.length > 0
      ? prisma.fastAuthConsumerTransaction.createMany({
          data: consumerTransactions,
          skipDuplicates: true,
        })
      : Promise.resolve({ count: 0 }),
    userTransactions.length > 0
      ? prisma.fastAuthUserTransaction.createMany({
          data: userTransactions,
          skipDuplicates: true,
        })
      : Promise.resolve({ count: 0 }),
    mpcTransactions.length > 0
      ? prisma.mpcTransaction.createMany({
          data: mpcTransactions,
          skipDuplicates: true,
        })
      : Promise.resolve({ count: 0 }),
  ]);

  return {
    insertedTransactions: txInsert.count,
    insertedSignEvents: signInsert.count,
    insertedConsumerTransactions: consumerInsert.count,
    insertedUserTransactions: userInsert.count,
    insertedMpcTransactions: mpcInsert.count,
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

    // Load every FastAuth-derived public key seen so far. We use this set to
    // identify consumer transactions: relayer-submitted txs whose inner
    // DelegateAction was signed with a FastAuth-derived key. Membership
    // testing is O(1), and even a 100k-row distinct scan finishes in <1s on
    // an indexed column. Refreshed once per iteration.
    const fastAuthPubKeySet = new Set<string>();
    try {
      const rows = await prisma.fastAuthSignEvent.findMany({
        where: { userDerivedPublicKey: { not: null } },
        distinct: ["userDerivedPublicKey"],
        select: { userDerivedPublicKey: true },
      });
      for (const row of rows) {
        if (row.userDerivedPublicKey) {
          fastAuthPubKeySet.add(row.userDerivedPublicKey);
        }
      }
    } catch {
      // Best-effort: if the load fails, we just skip consumer-tx detection
      // for this iteration and keep going.
    }

    // Load every NEAR account that holds the FastAuth-derived MPC key
    // (K_FA). Activity from these accounts — regardless of which session
    // key signed any individual tx — is "real activity" by FastAuth users.
    // Anchoring on the account (not the key) means we correctly track a
    // user across logout/login cycles where Sweat installs new K_session
    // keys but the account stays the same.
    const fastAuthAccountSet = new Set<string>();
    try {
      const rows = await prisma.fastAuthPublicKeyAccount.findMany({
        distinct: ["accountId"],
        select: { accountId: true },
      });
      for (const row of rows) {
        if (row.accountId) {
          fastAuthAccountSet.add(row.accountId.trim().toLowerCase());
        }
      }
    } catch {
      // Best-effort: if the load fails we just skip user-activity
      // detection for this iteration.
    }

    // Refresh token prices once per iteration so we can stamp value_usd
    // on user txs as we index them. Failure here is non-fatal — falls
    // back to the previous cache (or null on first-run failure).
    let tokenRegistry: TokenRegistry | null = null;
    try {
      tokenRegistry = await refreshTokenRegistry();
    } catch {
      // already logged inside refreshTokenRegistry
    }

    let processed = 0;
    let skippedHeights = 0;
    let indexedTransactions = 0;
    let indexedFastAuthSignEvents = 0;
    let indexedConsumerTransactions = 0;
    let indexedUserTransactions = 0;
    let indexedMpcTransactions = 0;
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
      const uniqueUserTxs = new Map<string, Prisma.FastAuthUserTransactionCreateManyInput>();
      const uniqueConsumerTxs = new Map<
        string,
        Prisma.FastAuthConsumerTransactionCreateManyInput
      >();
      const uniqueMpcTxs = new Map<string, Prisma.MpcTransactionCreateManyInput>();

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

          const outcome = tx.outcome?.outcome;
          const gasBurnt = toNullableBigInt(outcome?.gas_burnt);
          const { executionStatus, failureReason } = parseExecutionStatus(outcome?.status);
          const relayerPublicKey = normalizeNearPublicKey(tx.public_key);
          const normalizedReceiverId = tx.receiver_id?.trim().toLowerCase() ?? null;
          const txSignerLower = tx.signer_id?.trim().toLowerCase() ?? null;

          // Path 1: txs to a FastAuth contract (sign() calls). Existing logic.
          if (normalizedReceiverId && fastAuthContractSet.has(normalizedReceiverId)) {
            const { methodName, attachedDepositYocto } = parseActionMetadata(tx.actions);
            const { seeds: derivedSignEvents, inlinePublicKeys } =
              deriveFastAuthSignEventsFromTransaction({
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

            // Grow the in-memory pubkey set inline so consumer txs landing
            // in this same iteration (typically 1-5 blocks after the sign
            // event) are matched immediately, without waiting for
            // public-key-accounts.ts to populate userDerivedPublicKey.
            for (const pk of inlinePublicKeys) {
              fastAuthPubKeySet.add(pk);
            }
          }

          // Path 2: consumer txs. Any tx whose actions contain a Delegate
          // signed by a FastAuth-derived key — the relayer's submission of
          // a previously FastAuth-signed action. This is independent of who
          // the receiver is and doesn't require the outer signer to be in
          // any allowlist; the inner public-key match is sufficient.
          if (fastAuthPubKeySet.size > 0) {
            const delegateInfo = extractDelegateActionInfo(tx.actions);
            if (delegateInfo && fastAuthPubKeySet.has(delegateInfo.innerPublicKey)) {
              const blockTs = toDateFromNearNs(blockTimestamp);
              if (blockTs) {
                uniqueConsumerTxs.set(txHash, {
                  txHash,
                  blockHeight: BigInt(blockHeight),
                  blockTimestamp: blockTs,
                  outerSignerId: tx.signer_id ?? "(unknown)",
                  outerSignerPublicKey: relayerPublicKey,
                  innerSignerId: delegateInfo.innerSignerId,
                  innerReceiverId: delegateInfo.innerReceiverId,
                  innerPublicKey: delegateInfo.innerPublicKey,
                  innerActionTypes: delegateInfo.innerActionTypes,
                  executionStatus,
                  failureReason,
                  linkedSignEventId: null,
                });
              }
            }
          }

          // Path 3: user activity. Two ways the same FastAuth user shows
          // up on chain:
          //
          //   (a) DIRECT: outer tx signed by the user's account. Rare in
          //       Sweat's setup but possible (e.g. wallet sign-and-send
          //       flows that don't go through the relayer).
          //
          //   (b) META-TX: outer tx signed by sweat-relayer.near with a
          //       Delegate whose sender_id is the user's account. This
          //       is how ~all Sweat product activity (ft_transfer, claim,
          //       contract calls) flows. We surface the INNER receiver/
          //       method here so the panel reads naturally.
          //
          // Skip txs already covered by Path 1 (sign() calls to FastAuth
          // itself) to avoid double-counting between user-tx + sign-event
          // tables.
          const blockTs = toDateFromNearNs(blockTimestamp);
          const skipBecausePath1 =
            normalizedReceiverId !== null && fastAuthContractSet.has(normalizedReceiverId);

          if (blockTs && !skipBecausePath1) {
            // (a) Direct
            if (txSignerLower && fastAuthAccountSet.has(txSignerLower)) {
              const receiver = normalizedReceiverId ?? tx.receiver_id?.trim() ?? null;
              if (receiver) {
                const { methodName: m } = parseActionMetadata(tx.actions);
                const actionTypes: string[] = [];
                if (Array.isArray(tx.actions)) {
                  for (const a of tx.actions) {
                    if (!a || typeof a !== "object") continue;
                    const [name] = Object.keys(a);
                    if (name) actionTypes.push(name);
                  }
                }
                const computed = computeActionsValue({
                  actions: Array.isArray(tx.actions) ? tx.actions : [],
                  receiverId: receiver,
                  registry: tokenRegistry,
                });
                uniqueUserTxs.set(txHash, {
                  txHash,
                  blockHeight: BigInt(blockHeight),
                  blockTimestamp: blockTs,
                  signerAccountId: txSignerLower,
                  signerPublicKey: relayerPublicKey,
                  receiverId: receiver,
                  methodName: m,
                  actionTypes,
                  metaWrapped: false,
                  ...buildTokenColumns(computed),
                  executionStatus,
                  failureReason,
                  gasBurnt,
                });
              }
            } else {
              // (b) Meta-tx. Look for a Delegate whose inner sender is a
              // FastAuth account. We reuse extractDelegateActionInfo so
              // we get inner action types + first method name + raw inner
              // actions for value computation.
              const delegateInfo = extractDelegateActionInfo(tx.actions);
              const innerSender = delegateInfo?.innerSignerId?.toLowerCase() ?? null;
              if (
                delegateInfo &&
                innerSender &&
                fastAuthAccountSet.has(innerSender) &&
                !uniqueUserTxs.has(txHash)
              ) {
                const innerReceiver = delegateInfo.innerReceiverId.toLowerCase();
                const computed = computeActionsValue({
                  actions: delegateInfo.innerActions,
                  receiverId: innerReceiver,
                  registry: tokenRegistry,
                });
                uniqueUserTxs.set(txHash, {
                  txHash,
                  blockHeight: BigInt(blockHeight),
                  blockTimestamp: blockTs,
                  signerAccountId: innerSender,
                  signerPublicKey: delegateInfo.innerPublicKey,
                  receiverId: innerReceiver,
                  methodName: delegateInfo.innerMethodName,
                  actionTypes: delegateInfo.innerActionTypes,
                  metaWrapped: true,
                  ...buildTokenColumns(computed),
                  executionStatus,
                  failureReason,
                  gasBurnt,
                });
              }
            }
          }

          // Path 4: MPC raw landing. Any tx whose receiver is the v1.signer
          // MPC contract — predominantly `respond` calls from MPC node
          // accounts, plus governance / TEE attestation traffic
          // (`vote_*`, `submit_participant_info`, etc.). Stored to its own
          // table so the consensus dashboard queries it independently of
          // the FastAuth flow. Disjoint from Paths 1-3: an MPC tx never
          // matches them (different signer set, different receiver).
          if (normalizedReceiverId && MPC_CONTRACT_IDS.has(normalizedReceiverId)) {
            const { methodName: mpcMethodName, attachedDepositYocto: mpcAttachedDeposit } =
              parseActionMetadata(tx.actions);
            uniqueMpcTxs.set(txHash, {
              txHash,
              blockHeight: BigInt(blockHeight),
              blockTimestamp: toDateFromNearNs(blockTimestamp),
              signerAccountId: tx.signer_id ?? null,
              signerPublicKey: relayerPublicKey,
              receiverId: normalizedReceiverId,
              methodName: mpcMethodName,
              executionStatus,
              failureReason,
              gasBurnt,
              attachedDepositYocto: mpcAttachedDeposit,
              payload: toTransactionPayload(tx),
            });
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
        [...uniqueConsumerTxs.values()],
        [...uniqueUserTxs.values()],
        [...uniqueMpcTxs.values()],
      );

      processed += 1;
      indexedTransactions += insertResult.insertedTransactions;
      indexedFastAuthSignEvents += insertResult.insertedSignEvents;
      indexedConsumerTransactions += insertResult.insertedConsumerTransactions;
      indexedUserTransactions += insertResult.insertedUserTransactions;
      indexedMpcTransactions += insertResult.insertedMpcTransactions;

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
            indexedMpcTransactions,
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

    // Link unlinked consumer txs to the FastAuth sign event that produced
    // their signature. Pick the most-recent sign event whose derived pubkey
    // matches the consumer's inner_public_key and whose block_timestamp is
    // within 60s before the consumer. Idempotent: only updates rows where
    // linked_sign_event_id IS NULL.
    let linkedConsumerCount = 0;
    if (indexedConsumerTransactions > 0) {
      try {
        linkedConsumerCount = Number(await prisma.$executeRaw`
          UPDATE fastauth_consumer_transactions ct
          SET linked_sign_event_id = (
            SELECT se.id
            FROM fastauth_sign_events se
            WHERE se.user_derived_public_key = ct.inner_public_key
              AND se.block_timestamp <= ct.block_timestamp
              AND se.block_timestamp >= ct.block_timestamp - INTERVAL '60 seconds'
            ORDER BY se.block_timestamp DESC
            LIMIT 1
          )
          WHERE ct.linked_sign_event_id IS NULL
        `);
      } catch {
        // Linking is best-effort; we can re-run it later via a periodic task.
      }
    }

    if (runError !== null) {
      const message =
        runError instanceof Error ? runError.message : "Unknown NEAR collector error.";

      return {
        source: "near",
        status: "error",
        inserted: indexedTransactions,
        details: `${message} | Partial progress: persisted up to height ${highestContiguous} (latest persisted ${latestPersistedHeight}); indexed ${indexedTransactions} transactions, ${indexedFastAuthSignEvents} sign events, ${indexedConsumerTransactions} consumer txs (${linkedConsumerCount} newly linked), ${indexedUserTransactions} user-activity txs, ${indexedMpcTransactions} mpc txs; rebuilt marts (${martCounts.relayers} relayers); skipped ${skippedHeights} empty heights.`,
      };
    }

    return {
      source: "near",
      status: "ok",
      inserted: indexedTransactions,
      details:
        processed === 0
          ? `Checkpoint already at latest final block ${latestHeight}.`
          : `Processed block heights ${startHeight}..${targetHeight}${targetHeight < latestHeight ? ` (latest is ${latestHeight})` : ""}; indexed ${indexedTransactions} transactions, ${indexedFastAuthSignEvents} sign events, ${indexedConsumerTransactions} consumer txs (${linkedConsumerCount} newly linked), ${indexedUserTransactions} user-activity txs, ${indexedMpcTransactions} mpc txs; rebuilt marts (${martCounts.relayers} relayers); skipped ${skippedHeights} empty heights.`,
    };
  } catch (error) {
    return {
      source: "near",
      status: "error",
      details: error instanceof Error ? error.message : "Unknown NEAR collector error.",
    };
  }
}
