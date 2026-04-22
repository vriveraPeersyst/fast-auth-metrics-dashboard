import type { PrismaClient } from "@prisma/client";

import { HttpEndpointPool, parseHttpPoolTemplates } from "@/lib/indexers/http-endpoint-pool";
import {
  NearRpcManager,
  resolveNormalNearRpcManagerUrlsFromEnv,
} from "@/lib/indexers/near-rpc-manager";
import type { IndexerRunResult } from "@/lib/indexers/types";

const CHECKPOINT_KEY = "fastauth_public_key_accounts_last_event_id";
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_MPC_FETCH_CONCURRENCY = 12;
const DEFAULT_LOOKUP_CONCURRENCY = 24;
const DEFAULT_LOOKUP_URL_TEMPLATES = [
  "https://api.fastnear.com/v1/public_key/{publicKey}/all",
];

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const effective = Math.min(Math.max(concurrency, 1), items.length);
  let cursor = 0;
  let failure: unknown = null;

  const runners = Array.from({ length: effective }, async () => {
    while (failure === null) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) {
        return;
      }
      try {
        await worker(items[idx], idx);
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

function resolvePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

function hasConfiguredValue(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return !(normalized.includes("replace-with") || normalized.includes("your-"));
}

function resolveLookupUrlTemplates(): string[] {
  const plural = process.env.FASTAUTH_PUBLIC_KEY_ACCOUNTS_URL_TEMPLATES;
  const singular = process.env.FASTAUTH_PUBLIC_KEY_ACCOUNTS_URL_TEMPLATE;

  const configured = [
    ...parseHttpPoolTemplates(hasConfiguredValue(plural) ? plural : null),
    ...(hasConfiguredValue(singular) ? [singular.trim()] : []),
  ];

  const unique = [...new Set(configured)];

  return unique.length > 0 ? unique : DEFAULT_LOOKUP_URL_TEMPLATES;
}

function resolveMpcContractId(predecessorId: string): string {
  const configured = process.env.FASTAUTH_MPC_CONTRACT_ID?.trim();

  if (configured) {
    return configured;
  }

  return predecessorId.endsWith(".testnet") ? "v1.signer-prod.testnet" : "v1.signer";
}

function resolveBatchSize(): number {
  const raw = process.env.FASTAUTH_PUBLIC_KEY_ACCOUNTS_BATCH_SIZE;

  if (!raw) {
    return DEFAULT_BATCH_SIZE;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("FASTAUTH_PUBLIC_KEY_ACCOUNTS_BATCH_SIZE must be a number >= 1.");
  }

  return Math.floor(parsed);
}

function resolveLookbackDays(): number {
  const raw = process.env.FASTAUTH_PUBLIC_KEY_LOOKBACK_DAYS;

  if (!raw) {
    return DEFAULT_LOOKBACK_DAYS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("FASTAUTH_PUBLIC_KEY_LOOKBACK_DAYS must be a number >= 1.");
  }

  return Math.floor(parsed);
}

function isLikelyNearAccountId(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (!/^[a-z0-9._-]+$/.test(normalized)) {
    return false;
  }

  // Named accounts (contain a dot) or top-level `.near`/`.testnet`.
  if (normalized.includes(".") || normalized.endsWith("near")) {
    return true;
  }

  // 64-char lowercase hex implicit accounts (e.g. d1dbbd92...2c33).
  return /^[0-9a-f]{64}$/.test(normalized);
}

export function classifyAccountType(accountId: string): "implicit" | "named" {
  return /^[0-9a-f]{64}$/.test(accountId) ? "implicit" : "named";
}

function extractAccountsFromPayload(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is string => typeof item === "string");
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  // `account_ids` is the FastNEAR v1 public_key lookup shape.
  const candidates = [
    record.account_ids,
    record.accountIds,
    record.accounts,
    record.data,
    record.result,
    record.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const fromStrings = candidate.filter((item): item is string => typeof item === "string");
      if (fromStrings.length > 0) {
        return fromStrings;
      }

      const fromObjects = candidate
        .map((item) => {
          if (!item || typeof item !== "object") {
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
  }

  return [];
}

async function fetchAccountsForPublicKey(
  pool: HttpEndpointPool,
  publicKey: string,
): Promise<string[]> {
  const payload = await pool.get<unknown>(
    publicKey,
    `public-key account lookup for ${publicKey}`,
  );

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
    throw new Error(`MPC returned error for path ${params.path}: ${JSON.stringify(payload.error)}`);
  }

  const bytes = payload.result?.result;
  if (!Array.isArray(bytes)) {
    throw new Error(`MPC response missing bytes for path ${params.path}.`);
  }

  const utf8 = Buffer.from(bytes).toString("utf8").trim();
  if (!utf8) {
    throw new Error(`MPC returned empty derived key for path ${params.path}.`);
  }

  try {
    const parsed = JSON.parse(utf8) as unknown;
    if (typeof parsed === "string" && parsed.trim()) {
      return parsed.trim();
    }
  } catch {
    // Fall through and return utf8 as-is.
  }

  return utf8;
}

export async function collectFastAuthPublicKeyAccounts(
  prisma: PrismaClient,
): Promise<IndexerRunResult> {
  const lookupTemplates = resolveLookupUrlTemplates();
  const lookupPool = new HttpEndpointPool(lookupTemplates, {
    placeholder: "publicKey",
    bearerToken: process.env.FASTNEAR_API_KEY ?? null,
  });
  const rpcManager = new NearRpcManager(resolveNormalNearRpcManagerUrlsFromEnv());

  try {
    const batchSize = resolveBatchSize();
    const lookbackDays = resolveLookbackDays();
    const checkpoint = await prisma.indexerCheckpoint.findUnique({
      where: { key: CHECKPOINT_KEY },
    });

    const parsedCheckpoint = checkpoint?.value ? BigInt(checkpoint.value) : null;
    const hasCheckpoint = parsedCheckpoint !== null;
    const fallbackStart = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const events = await prisma.fastAuthSignEvent.findMany({
      where: {
        OR: [
          {
            userDerivedPublicKey: {
              not: null,
            },
          },
          {
            userKeyPath: {
              not: null,
            },
          },
          {
            userDomainId: {
              not: null,
            },
          },
        ],
        ...(hasCheckpoint
          ? {
              id: {
                gt: parsedCheckpoint,
              },
            }
          : {
              blockTimestamp: {
                gte: fallbackStart,
              },
            }),
      },
      orderBy: {
        id: "asc",
      },
      take: batchSize,
      select: {
        id: true,
        userDerivedPublicKey: true,
        userKeyPath: true,
        userDomainId: true,
        fastAuthContractId: true,
        blockTimestamp: true,
      },
    });

    if (events.length === 0) {
      return {
        source: "fastauth_public_keys",
        status: "ok",
        inserted: 0,
        details: "No new sign events with user-derived-key metadata.",
      };
    }

    const latestEventByKey = new Map<
      string,
      {
        eventId: bigint;
        blockTimestamp: Date;
        keyPath: string | null;
        predecessorId: string | null;
        domainId: number | null;
      }
    >();

    // Phase 1: resolve any missing derived public keys via MPC in parallel.
    const eventsNeedingMpc = events.filter(
      (event) =>
        !event.userDerivedPublicKey?.trim() &&
        event.userKeyPath !== null &&
        event.userDomainId !== null,
    );

    const mpcResults = new Map<bigint, string>();
    await runWithConcurrency(
      eventsNeedingMpc,
      resolvePositiveIntEnv("FASTAUTH_MPC_FETCH_CONCURRENCY", DEFAULT_MPC_FETCH_CONCURRENCY),
      async (event) => {
        try {
          const key = await fetchDerivedPublicKey({
            rpcManager,
            mpcContractId: resolveMpcContractId(event.fastAuthContractId),
            path: event.userKeyPath as string,
            predecessor: event.fastAuthContractId,
            domainId: event.userDomainId as number,
          });
          mpcResults.set(event.id, key);
        } catch {
          // Skip — event will be re-attempted on a subsequent run.
        }
      },
    );

    // Persist newly-resolved derived keys back to source events in parallel.
    await runWithConcurrency(
      [...mpcResults.entries()],
      resolvePositiveIntEnv("FASTAUTH_DB_CONCURRENCY", 8),
      async ([id, key]) => {
        await prisma.fastAuthSignEvent.update({
          where: { id },
          data: { userDerivedPublicKey: key },
        });
      },
    );

    for (const event of events) {
      const key = event.userDerivedPublicKey?.trim() || mpcResults.get(event.id) || null;

      if (!key) {
        continue;
      }

      latestEventByKey.set(key, {
        eventId: event.id,
        blockTimestamp: event.blockTimestamp,
        keyPath: event.userKeyPath ?? null,
        predecessorId: event.fastAuthContractId ?? null,
        domainId: event.userDomainId ?? null,
      });
    }

    // Phase 2: fetch FastNEAR account-id lists for every public key in parallel.
    type LookupRow = {
      publicKey: string;
      meta: { eventId: bigint; blockTimestamp: Date; keyPath: string | null; predecessorId: string | null; domainId: number | null };
      accounts: string[];
    };

    const lookupRows: LookupRow[] = [];
    const publicKeys = [...latestEventByKey.entries()];

    await runWithConcurrency(
      publicKeys,
      resolvePositiveIntEnv("FASTAUTH_PUBLIC_KEY_LOOKUP_CONCURRENCY", DEFAULT_LOOKUP_CONCURRENCY),
      async ([publicKey, meta]) => {
        const accounts = await fetchAccountsForPublicKey(lookupPool, publicKey);
        lookupRows.push({ publicKey, meta, accounts });
      },
    );

    // Phase 3: bulk-resolve which (publicKey, accountId) pairs and which
    // accountIds are already known, in two queries (one per table).
    const candidateAccountIds = new Set<string>();
    const candidatePairs: Array<{ publicKey: string; accountId: string; meta: LookupRow["meta"] }> = [];

    for (const row of lookupRows) {
      for (const accountId of row.accounts) {
        candidatePairs.push({ publicKey: row.publicKey, accountId, meta: row.meta });
        candidateAccountIds.add(accountId);
      }
    }

    let linkedRows = 0;
    let newLinks = 0;
    let accountsCreated = 0;

    if (candidatePairs.length > 0) {
      const candidatePublicKeys = [...new Set(candidatePairs.map((pair) => pair.publicKey))];

      const [existingLinks, existingAccounts] = await Promise.all([
        prisma.fastAuthPublicKeyAccount.findMany({
          where: {
            publicKey: { in: candidatePublicKeys },
            accountId: { in: [...candidateAccountIds] },
          },
          select: { publicKey: true, accountId: true },
        }),
        prisma.account.findMany({
          where: { accountId: { in: [...candidateAccountIds] } },
          select: { accountId: true },
        }),
      ]);

      const existingLinkSet = new Set(
        existingLinks.map((row) => `${row.publicKey}::${row.accountId}`),
      );
      const existingAccountSet = new Set(existingAccounts.map((row) => row.accountId));

      // Aggregate per-account stats so we can do one upsert per account instead
      // of one per (publicKey, accountId) pair.
      const accountAggregates = new Map<
        string,
        { lastSeenAt: Date; lastSourceEventId: bigint; newLinkCount: number; firstSeenAt: Date }
      >();

      for (const pair of candidatePairs) {
        const linkKey = `${pair.publicKey}::${pair.accountId}`;
        const isNewLink = !existingLinkSet.has(linkKey);

        if (isNewLink) {
          newLinks += 1;
        }
        linkedRows += 1;

        const agg = accountAggregates.get(pair.accountId);
        if (!agg) {
          accountAggregates.set(pair.accountId, {
            firstSeenAt: pair.meta.blockTimestamp,
            lastSeenAt: pair.meta.blockTimestamp,
            lastSourceEventId: pair.meta.eventId,
            newLinkCount: isNewLink ? 1 : 0,
          });
        } else {
          if (pair.meta.blockTimestamp > agg.lastSeenAt) {
            agg.lastSeenAt = pair.meta.blockTimestamp;
          }
          if (pair.meta.blockTimestamp < agg.firstSeenAt) {
            agg.firstSeenAt = pair.meta.blockTimestamp;
          }
          if (pair.meta.eventId > agg.lastSourceEventId) {
            agg.lastSourceEventId = pair.meta.eventId;
          }
          if (isNewLink) {
            agg.newLinkCount += 1;
          }
        }
      }

      // Bulk-insert new junction rows in one round-trip.
      const newLinkRows = candidatePairs
        .filter((pair) => !existingLinkSet.has(`${pair.publicKey}::${pair.accountId}`))
        .map((pair) => ({
          publicKey: pair.publicKey,
          accountId: pair.accountId,
          keyPath: pair.meta.keyPath,
          predecessorId: pair.meta.predecessorId,
          domainId: pair.meta.domainId,
          firstSeenAt: pair.meta.blockTimestamp,
          lastSeenAt: pair.meta.blockTimestamp,
          lastSourceEventId: pair.meta.eventId,
        }));

      if (newLinkRows.length > 0) {
        await prisma.fastAuthPublicKeyAccount.createMany({
          data: newLinkRows,
          skipDuplicates: true,
        });
      }

      // Refresh lastSeenAt/lastSourceEventId for every touched (publicKey, accountId)
      // in parallel so existing junction rows reflect the latest source event.
      await runWithConcurrency(
        candidatePairs,
        resolvePositiveIntEnv("FASTAUTH_DB_CONCURRENCY", 8),
        async (pair) => {
          await prisma.fastAuthPublicKeyAccount.update({
            where: {
              publicKey_accountId: {
                publicKey: pair.publicKey,
                accountId: pair.accountId,
              },
            },
            data: {
              lastSeenAt: pair.meta.blockTimestamp,
              lastSourceEventId: pair.meta.eventId,
            },
          });
        },
      );

      // Bulk-insert new accounts in one round-trip.
      const newAccountRows = [...accountAggregates.entries()]
        .filter(([accountId]) => !existingAccountSet.has(accountId))
        .map(([accountId, agg]) => ({
          accountId,
          accountType: classifyAccountType(accountId),
          firstSeenAt: agg.firstSeenAt,
          lastSeenAt: agg.lastSeenAt,
          publicKeyCount: agg.newLinkCount,
          firstSourceEventId: agg.lastSourceEventId,
          lastSourceEventId: agg.lastSourceEventId,
        }));

      if (newAccountRows.length > 0) {
        await prisma.account.createMany({
          data: newAccountRows,
          skipDuplicates: true,
        });
        accountsCreated = newAccountRows.length;
      }

      // Update existing accounts in parallel.
      const existingAccountUpdates = [...accountAggregates.entries()].filter(([accountId]) =>
        existingAccountSet.has(accountId),
      );

      await runWithConcurrency(
        existingAccountUpdates,
        resolvePositiveIntEnv("FASTAUTH_DB_CONCURRENCY", 8),
        async ([accountId, agg]) => {
          await prisma.account.update({
            where: { accountId },
            data: {
              lastSeenAt: agg.lastSeenAt,
              lastSourceEventId: agg.lastSourceEventId,
              ...(agg.newLinkCount > 0
                ? { publicKeyCount: { increment: agg.newLinkCount } }
                : {}),
            },
          });
        },
      );
    }

    const touchedAccounts = candidateAccountIds;

    const maxEventId = events[events.length - 1]?.id;

    if (maxEventId !== undefined) {
      await prisma.indexerCheckpoint.upsert({
        where: { key: CHECKPOINT_KEY },
        create: {
          key: CHECKPOINT_KEY,
          value: maxEventId.toString(),
        },
        update: {
          value: maxEventId.toString(),
        },
      });
    }

    return {
      source: "fastauth_public_keys",
      status: "ok",
      inserted: linkedRows,
      details: `Processed ${events.length} sign events; upserted ${linkedRows} links (${newLinks} new); touched ${touchedAccounts.size} accounts (${accountsCreated} new).`,
    };
  } catch (error) {
    return {
      source: "fastauth_public_keys",
      status: "error",
      details:
        error instanceof Error ? error.message : "Unknown FastAuth public-key account indexer error.",
    };
  }
}
