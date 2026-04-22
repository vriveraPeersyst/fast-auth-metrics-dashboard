import { PrismaClient } from "@prisma/client";

import {
  NearRpcManager,
  resolveNormalNearRpcManagerUrlsFromEnv,
} from "@/lib/indexers/near-rpc-manager";

type FastAuthActionArgs = {
  guard_id?: string;
  guardId?: string;
  verify_payload?: string;
  verifyPayload?: string;
  algorithm?: string;
};

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_LOOKUP_URL_TEMPLATE = "https://api.fastnear.com/v1/public_key/{publicKey}/all";

function resolveBatchSize(): number {
  const raw = process.env.BACKFILL_USER_KEYS_BATCH_SIZE;

  if (!raw) {
    return DEFAULT_BATCH_SIZE;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("BACKFILL_USER_KEYS_BATCH_SIZE must be a number >= 1.");
  }

  return Math.floor(parsed);
}

function resolveLookupUrlTemplate(): string {
  const raw = process.env.FASTAUTH_PUBLIC_KEY_ACCOUNTS_URL_TEMPLATE?.trim();

  if (!raw) {
    return DEFAULT_LOOKUP_URL_TEMPLATE;
  }

  const normalized = raw.toLowerCase();
  if (normalized.includes("your-") || normalized.includes("replace-with")) {
    return DEFAULT_LOOKUP_URL_TEMPLATE;
  }

  return raw;
}

function resolveMpcContractId(predecessorId: string): string {
  const configured = process.env.FASTAUTH_MPC_CONTRACT_ID?.trim();

  if (configured) {
    return configured;
  }

  return predecessorId.endsWith(".testnet") ? "v1.signer-prod.testnet" : "v1.signer";
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

function parseJwtSub(verifyPayload: string | null): string | null {
  if (!verifyPayload) {
    return null;
  }

  const segments = verifyPayload.split(".");
  if (segments.length < 2) {
    return null;
  }

  const payloadJson = decodeBase64UrlToUtf8(segments[1]);

  if (!payloadJson) {
    return null;
  }

  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const sub = payload.sub;

    return typeof sub === "string" && sub.trim() ? sub.trim() : null;
  } catch {
    return null;
  }
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

function parseActionArgs(payload: unknown, actionIndex: number): FastAuthActionArgs | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const actions = (payload as Record<string, unknown>).actions;
  if (!Array.isArray(actions)) {
    return null;
  }

  const action = actions[actionIndex];
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    return null;
  }

  const functionCall = (action as Record<string, unknown>).FunctionCall;
  if (!functionCall || typeof functionCall !== "object" || Array.isArray(functionCall)) {
    return null;
  }

  const argsBase64 = (functionCall as Record<string, unknown>).args;
  if (typeof argsBase64 !== "string" || !argsBase64) {
    return null;
  }

  const decoded = decodeBase64ToUtf8(argsBase64);
  if (!decoded) {
    return null;
  }

  try {
    const parsed = JSON.parse(decoded) as FastAuthActionArgs;

    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function toLookupUrl(template: string, publicKey: string): string {
  if (template.includes("{publicKey}")) {
    return template.replaceAll("{publicKey}", encodeURIComponent(publicKey));
  }

  const url = new URL(template);
  url.searchParams.set("publicKey", publicKey);

  return url.toString();
}

function extractAccountsFromPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.account_ids, record.accounts, record.data, record.result, record.items];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    const fromStrings = candidate.filter((item): item is string => typeof item === "string");
    if (fromStrings.length > 0) {
      return fromStrings;
    }

    const fromObjects = candidate
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return null;
        }

        const row = item as Record<string, unknown>;
        const accountId = row.account_id ?? row.accountId ?? row.id;

        return typeof accountId === "string" ? accountId : null;
      })
      .filter((item): item is string => Boolean(item));

    if (fromObjects.length > 0) {
      return fromObjects;
    }
  }

  return [];
}

function isLikelyNearAccountId(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return /^[a-z0-9._-]+$/.test(normalized) && (normalized.includes(".") || normalized.endsWith("near"));
}

async function fetchAccountsForPublicKey(
  lookupUrlTemplate: string,
  publicKey: string,
): Promise<string[]> {
  const response = await fetch(toLookupUrl(lookupUrlTemplate, publicKey));

  if (!response.ok) {
    throw new Error(`Account lookup failed (${response.status}) for ${publicKey}.`);
  }

  const payload = (await response.json()) as unknown;

  return extractAccountsFromPayload(payload)
    .map((accountId) => accountId.trim().toLowerCase())
    .filter((accountId) => isLikelyNearAccountId(accountId));
}

async function fetchDerivedPublicKey(params: {
  rpcManager: NearRpcManager;
  mpcContractId: string;
  path: string;
  predecessor: string;
  domainId: number;
}): Promise<string> {
  const args = Buffer.from(
    JSON.stringify({
      path: params.path,
      predecessor: params.predecessor,
      domain_id: params.domainId,
    }),
  ).toString("base64");

  const payload = await params.rpcManager.request<{
    error?: unknown;
    result?: {
      result?: number[];
    };
  }>(
    "query",
    {
      request_type: "call_function",
      finality: "final",
      account_id: params.mpcContractId,
      method_name: "derived_public_key",
      args_base64: args,
    },
    `derived_public_key for ${params.path}`,
  );

  if (payload.error) {
    throw new Error(`MPC returned error for path=${params.path}: ${JSON.stringify(payload.error)}`);
  }

  const bytes = payload.result?.result;
  if (!Array.isArray(bytes)) {
    throw new Error(`MPC response missing result bytes for path=${params.path}.`);
  }

  const utf8 = Buffer.from(bytes).toString("utf8").trim();

  if (!utf8) {
    throw new Error(`MPC response was empty for path=${params.path}.`);
  }

  try {
    const parsed = JSON.parse(utf8) as unknown;
    if (typeof parsed === "string" && parsed.trim()) {
      return parsed.trim();
    }
  } catch {
    // Keep raw utf8 below.
  }

  return utf8;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const rpcManager = new NearRpcManager(resolveNormalNearRpcManagerUrlsFromEnv());
  const lookupUrlTemplate = resolveLookupUrlTemplate();
  const batchSize = resolveBatchSize();

  let scanned = 0;
  let updatedEvents = 0;
  let derivedKeysResolved = 0;
  let accountLinksUpserted = 0;
  let unresolved = 0;

  try {
    const events = await prisma.fastAuthSignEvent.findMany({
      where: {
        OR: [
          { userSub: null },
          { userKeyPath: null },
          { userDomainId: null },
          { userDerivedPublicKey: null },
        ],
      },
      orderBy: {
        id: "asc",
      },
      take: batchSize,
      select: {
        id: true,
        txHash: true,
        actionIndex: true,
        blockTimestamp: true,
        fastAuthContractId: true,
        guardId: true,
        algorithm: true,
        userSub: true,
        userKeyPath: true,
        userDomainId: true,
        userDerivedPublicKey: true,
      },
    });

    scanned = events.length;

    if (events.length === 0) {
      console.log(
        JSON.stringify(
          {
            scanned,
            updatedEvents,
            derivedKeysResolved,
            accountLinksUpserted,
            unresolved,
          },
          null,
          2,
        ),
      );
      return;
    }

    const txHashes = [...new Set(events.map((event) => event.txHash))];
    const txRows = await prisma.nearTransaction.findMany({
      where: {
        txHash: {
          in: txHashes,
        },
      },
      select: {
        txHash: true,
        payload: true,
      },
    });

    const txPayloadByHash = new Map(txRows.map((row) => [row.txHash, row.payload]));

    for (const event of events) {
      const payload = txPayloadByHash.get(event.txHash) ?? null;
      const args = parseActionArgs(payload, event.actionIndex);

      const guardIdFromArgs = args?.guard_id ?? args?.guardId ?? null;
      const verifyPayload = args?.verify_payload ?? args?.verifyPayload ?? null;
      const algorithmFromArgs = args?.algorithm ?? null;

      const guardId = event.guardId ?? guardIdFromArgs;
      const algorithm = event.algorithm ?? algorithmFromArgs;
      const userSub = event.userSub ?? parseJwtSub(verifyPayload);
      const userKeyPath = event.userKeyPath ?? (guardId && userSub ? `${guardId}#${userSub}` : null);
      const userDomainId = event.userDomainId ?? toMpcDomainId(algorithm);

      let userDerivedPublicKey = event.userDerivedPublicKey;

      if (!userDerivedPublicKey && userKeyPath && userDomainId !== null) {
        try {
          userDerivedPublicKey = await fetchDerivedPublicKey({
            rpcManager,
            mpcContractId: resolveMpcContractId(event.fastAuthContractId),
            path: userKeyPath,
            predecessor: event.fastAuthContractId,
            domainId: userDomainId,
          });
          derivedKeysResolved += 1;
        } catch {
          unresolved += 1;
        }
      }

      const changed =
        userSub !== event.userSub ||
        userKeyPath !== event.userKeyPath ||
        userDomainId !== event.userDomainId ||
        userDerivedPublicKey !== event.userDerivedPublicKey;

      if (changed) {
        await prisma.fastAuthSignEvent.update({
          where: {
            id: event.id,
          },
          data: {
            userSub,
            userKeyPath,
            userDomainId,
            userDerivedPublicKey,
          },
        });

        updatedEvents += 1;
      }

      if (!userDerivedPublicKey) {
        continue;
      }

      try {
        const accounts = await fetchAccountsForPublicKey(lookupUrlTemplate, userDerivedPublicKey);

        for (const accountId of accounts) {
          await prisma.fastAuthPublicKeyAccount.upsert({
            where: {
              publicKey_accountId: {
                publicKey: userDerivedPublicKey,
                accountId,
              },
            },
            create: {
              publicKey: userDerivedPublicKey,
              accountId,
              keyPath: userKeyPath,
              predecessorId: event.fastAuthContractId,
              domainId: userDomainId,
              firstSeenAt: event.blockTimestamp,
              lastSeenAt: event.blockTimestamp,
              lastSourceEventId: event.id,
            },
            update: {
              keyPath: userKeyPath,
              predecessorId: event.fastAuthContractId,
              domainId: userDomainId,
              lastSeenAt: event.blockTimestamp,
              lastSourceEventId: event.id,
            },
          });

          accountLinksUpserted += 1;
        }
      } catch {
        unresolved += 1;
      }
    }

    console.log(
      JSON.stringify(
        {
          scanned,
          updatedEvents,
          derivedKeysResolved,
          accountLinksUpserted,
          unresolved,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
