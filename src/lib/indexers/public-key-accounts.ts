import type { PrismaClient } from "@prisma/client";

import { HttpEndpointPool, parseHttpPoolTemplates } from "@/lib/indexers/http-endpoint-pool";
import { createNearRpcManager, type NearRpcManager } from "@/lib/indexers/near-rpc-manager";
import type { IndexerRunResult } from "@/lib/indexers/types";

const CHECKPOINT_KEY = "fastauth_public_key_accounts_last_event_id";
const ORPHAN_RETRY_CHECKPOINT_KEY = "fastauth_orphan_retry_last_run_at";
const ORPHAN_RETRY_MIN_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
const ORPHAN_RETRY_MAX_PUBKEYS = 500;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_MPC_FETCH_CONCURRENCY = 12;
const DEFAULT_LOOKUP_CONCURRENCY = 24;
const DEFAULT_LOOKUP_URL_TEMPLATES = [
  "https://api.fastnear.com/v1/public_key/{publicKey}/all",
];

const DEFAULT_NEARBLOCKS_URL_TEMPLATES = [
  "https://api.nearblocks.io/v1/kitwallet/publicKey/{publicKey}/accounts",
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

function resolveNearBlocksUrlTemplates(): string[] {
  const plural = process.env.FASTAUTH_PUBLIC_KEY_ACCOUNTS_NEARBLOCKS_TEMPLATES;
  const configured = parseHttpPoolTemplates(hasConfiguredValue(plural) ? plural : null);
  const unique = [...new Set(configured)];
  return unique.length > 0 ? unique : DEFAULT_NEARBLOCKS_URL_TEMPLATES;
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

async function fetchAccountsFromPool(
  pool: HttpEndpointPool,
  publicKey: string,
  sourceLabel: string,
): Promise<string[]> {
  try {
    const payload = await pool.get<unknown>(
      publicKey,
      `${sourceLabel} account lookup for ${publicKey}`,
    );
    return extractAccountsFromPayload(payload)
      .map((accountId) => accountId.trim().toLowerCase())
      .filter((accountId) => isLikelyNearAccountId(accountId));
  } catch (error) {
    // The union with the other source still has a chance to return a result
    // for this pubkey, so we don't propagate. But we DO log — silent FastNEAR
    // failures are how the 34k orphan backlog accumulated unnoticed. The
    // orphan-retry sweep below also re-attempts pubkeys that end up unresolved.
    console.warn(
      JSON.stringify({
        level: "warn",
        source: "fastauth_public_keys",
        message: `${sourceLabel} account lookup failed`,
        publicKey,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return [];
  }
}

async function fetchAccountsForPublicKey(
  fastNearPool: HttpEndpointPool,
  nearBlocksPool: HttpEndpointPool,
  publicKey: string,
): Promise<string[]> {
  // Query both sources in parallel, mirror near-mobile's
  // aggregated-near.indexer.ts pattern: union + dedupe. Both indexers
  // typically agree, but each occasionally returns a different result
  // (FastNEAR may lag indexing; NearBlocks may have its own caching) so
  // taking the union catches edge-case multi-account keys and protects
  // against any single source's outage.
  const [fastNear, nearBlocks] = await Promise.all([
    fetchAccountsFromPool(fastNearPool, publicKey, "fastnear"),
    fetchAccountsFromPool(nearBlocksPool, publicKey, "nearblocks"),
  ]);

  return [...new Set([...fastNear, ...nearBlocks])];
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
  const fastNearPool = new HttpEndpointPool(lookupTemplates, {
    placeholder: "publicKey",
    bearerToken: process.env.FASTNEAR_API_KEY ?? null,
  });
  const nearBlocksTemplates = resolveNearBlocksUrlTemplates();
  const nearBlocksPool = new HttpEndpointPool(nearBlocksTemplates, {
    placeholder: "publicKey",
    bearerToken: process.env.NEARBLOCKS_API_KEY ?? null,
  });
  const rpcManager = createNearRpcManager();

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

    // Note: we deliberately do NOT early-return when events.length === 0.
    // The orphan-retry sweep below needs to run on schedule (once an hour)
    // regardless of whether new events arrived this cycle — its whole purpose
    // is to catch users who signed once, never came back, and FastNEAR
    // failed for them at the time. Empty-events runs are cheap: every
    // per-batch loop becomes a no-op.

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
        } catch (error) {
          // The previous comment claimed "event will be re-attempted on a
          // subsequent run" but that's false: the checkpoint advances past
          // this event regardless, so a swallowed MPC failure means the
          // event stays without a derived pubkey forever (and is therefore
          // also unreachable by the orphan-retry sweep, which requires a
          // pubkey to look up). Log so we can see when this happens.
          console.warn(
            JSON.stringify({
              level: "warn",
              source: "fastauth_public_keys",
              message: "MPC derived_public_key call failed",
              eventId: event.id.toString(),
              keyPath: event.userKeyPath,
              domainId: event.userDomainId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
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
        const accounts = await fetchAccountsForPublicKey(
          fastNearPool,
          nearBlocksPool,
          publicKey,
        );
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

      // Resolve each candidate pubkey to its current "owner" account
      // (most-recently-seen wins) so we can stamp user_account_id on the
      // sign events themselves. This makes downstream queries that need
      // "which user signed this tx" a single-table read.
      const ownerByPublicKey = new Map<string, { accountId: string; lastSeenAt: Date }>();
      for (const pair of candidatePairs) {
        const current = ownerByPublicKey.get(pair.publicKey);
        if (!current || pair.meta.blockTimestamp > current.lastSeenAt) {
          ownerByPublicKey.set(pair.publicKey, {
            accountId: pair.accountId,
            lastSeenAt: pair.meta.blockTimestamp,
          });
        }
      }

      // Group sign-event ids by resolved accountId so we can do one
      // updateMany per group rather than one update per event.
      const eventIdsByAccount = new Map<string, bigint[]>();
      for (const event of events) {
        if (!event.userDerivedPublicKey) continue;
        const owner = ownerByPublicKey.get(event.userDerivedPublicKey);
        if (!owner) continue;
        const list = eventIdsByAccount.get(owner.accountId) ?? [];
        list.push(event.id);
        eventIdsByAccount.set(owner.accountId, list);
      }

      await runWithConcurrency(
        [...eventIdsByAccount.entries()],
        resolvePositiveIntEnv("FASTAUTH_DB_CONCURRENCY", 8),
        async ([accountId, ids]) => {
          await prisma.fastAuthSignEvent.updateMany({
            where: { id: { in: ids } },
            data: { userAccountId: accountId },
          });
        },
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

    // ── Periodic orphan-retry sweep ────────────────────────────────────
    // Once an hour, re-query FastNEAR/NearBlocks for pubkeys whose sign
    // events are still unstamped (user_account_id IS NULL) AND that are
    // not yet in pka. Covers the "user signed once, FastNEAR was down at
    // that moment, user never came back" failure mode, which the back-stamp
    // sweep alone cannot recover from (pka stays empty, so the join below
    // has nothing to use).
    let orphanRetryAttempted = 0;
    let orphanRetryResolved = 0;

    const orphanRetryCheckpoint = await prisma.indexerCheckpoint.findUnique({
      where: { key: ORPHAN_RETRY_CHECKPOINT_KEY },
    });
    const lastRetryAtMs = orphanRetryCheckpoint
      ? Date.parse(orphanRetryCheckpoint.value)
      : 0;
    const nowMs = Date.now();

    if (nowMs - lastRetryAtMs >= ORPHAN_RETRY_MIN_INTERVAL_MS) {
      // Earliest sign event per orphan pubkey supplies the metadata for the
      // pka row we'll insert if FastNEAR resolves it. Bounded so a sudden
      // backlog doesn't blast FastNEAR; the next hourly tick continues.
      const orphanReps = await prisma.$queryRaw<
        Array<{
          public_key: string;
          event_id: bigint;
          block_timestamp: Date;
          key_path: string | null;
          predecessor_id: string | null;
          domain_id: number | null;
        }>
      >`
        SELECT DISTINCT ON (fse.user_derived_public_key)
          fse.user_derived_public_key AS public_key,
          fse.id AS event_id,
          fse.block_timestamp,
          fse.user_key_path AS key_path,
          fse.fastauth_contract_id AS predecessor_id,
          fse.user_domain_id AS domain_id
        FROM fastauth_sign_events fse
        LEFT JOIN fastauth_public_key_accounts pka
          ON pka.public_key = fse.user_derived_public_key
        WHERE fse.user_account_id IS NULL
          AND fse.user_derived_public_key IS NOT NULL
          AND pka.public_key IS NULL
        ORDER BY fse.user_derived_public_key, fse.block_timestamp ASC
        LIMIT ${ORPHAN_RETRY_MAX_PUBKEYS}
      `;

      orphanRetryAttempted = orphanReps.length;

      if (orphanReps.length > 0) {
        console.log(
          JSON.stringify({
            level: "info",
            source: "fastauth_public_keys",
            message: "Orphan-retry sweep starting",
            pubkeyCount: orphanReps.length,
          }),
        );

        type OrphanResolved = {
          publicKey: string;
          accountId: string;
          keyPath: string | null;
          predecessorId: string | null;
          domainId: number | null;
          blockTimestamp: Date;
          eventId: bigint;
        };
        const resolvedRows: OrphanResolved[] = [];

        await runWithConcurrency(
          orphanReps,
          resolvePositiveIntEnv("FASTAUTH_PUBLIC_KEY_LOOKUP_CONCURRENCY", DEFAULT_LOOKUP_CONCURRENCY),
          async (rep) => {
            const accounts = await fetchAccountsForPublicKey(
              fastNearPool,
              nearBlocksPool,
              rep.public_key,
            );
            for (const accountId of accounts) {
              resolvedRows.push({
                publicKey: rep.public_key,
                accountId,
                keyPath: rep.key_path,
                predecessorId: rep.predecessor_id,
                domainId: rep.domain_id,
                blockTimestamp: rep.block_timestamp,
                eventId: rep.event_id,
              });
            }
          },
        );

        if (resolvedRows.length > 0) {
          await prisma.fastAuthPublicKeyAccount.createMany({
            data: resolvedRows.map((r) => ({
              publicKey: r.publicKey,
              accountId: r.accountId,
              keyPath: r.keyPath,
              predecessorId: r.predecessorId,
              domainId: r.domainId,
              firstSeenAt: r.blockTimestamp,
              lastSeenAt: r.blockTimestamp,
              lastSourceEventId: r.eventId,
            })),
            skipDuplicates: true,
          });

          // Create accounts rows for any newly-discovered accountIds — the
          // back-stamp UPDATE below uses pka but downstream queries (Top
          // Accounts, account counts) read from `accounts`.
          const distinctAccountIds = [...new Set(resolvedRows.map((r) => r.accountId))];
          const existingAccounts = await prisma.account.findMany({
            where: { accountId: { in: distinctAccountIds } },
            select: { accountId: true },
          });
          const existingAccountSet = new Set(existingAccounts.map((r) => r.accountId));
          const accountsToCreate = distinctAccountIds
            .filter((id) => !existingAccountSet.has(id))
            .map((id) => {
              const sample = resolvedRows.find((r) => r.accountId === id)!;
              return {
                accountId: id,
                accountType: classifyAccountType(id),
                firstSeenAt: sample.blockTimestamp,
                lastSeenAt: sample.blockTimestamp,
                publicKeyCount: 1,
                firstSourceEventId: sample.eventId,
                lastSourceEventId: sample.eventId,
              };
            });
          if (accountsToCreate.length > 0) {
            await prisma.account.createMany({
              data: accountsToCreate,
              skipDuplicates: true,
            });
          }

          orphanRetryResolved = new Set(resolvedRows.map((r) => r.publicKey)).size;
        }

        console.log(
          JSON.stringify({
            level: "info",
            source: "fastauth_public_keys",
            message: "Orphan-retry sweep finished",
            pubkeyCount: orphanRetryAttempted,
            resolvedPubkeys: orphanRetryResolved,
            stillUnresolved: orphanRetryAttempted - orphanRetryResolved,
          }),
        );
      }

      await prisma.indexerCheckpoint.upsert({
        where: { key: ORPHAN_RETRY_CHECKPOINT_KEY },
        create: {
          key: ORPHAN_RETRY_CHECKPOINT_KEY,
          value: new Date(nowMs).toISOString(),
        },
        update: {
          value: new Date(nowMs).toISOString(),
        },
      });
    }

    // Back-stamp historical orphans: any sign event still missing
    // user_account_id whose pubkey we now know (because pka has it from this
    // run, the orphan-retry sweep above, or any prior run) gets stamped
    // here. The per-batch updateMany only covers events in the *current*
    // batch — events that were processed earlier when the FastNEAR lookup
    // returned [] or threw stay NULL forever otherwise, even after a later
    // run resolves the same pubkey via a different event. Indexed UPDATE,
    // idempotent.
    const backStamped = await prisma.$executeRaw`
      UPDATE fastauth_sign_events fse
      SET user_account_id = owners.account_id
      FROM (
        SELECT DISTINCT ON (public_key) public_key, account_id
        FROM fastauth_public_key_accounts
        ORDER BY public_key, last_seen_at DESC
      ) owners
      WHERE fse.user_derived_public_key = owners.public_key
        AND fse.user_account_id IS NULL
    `;

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
      details:
        `Processed ${events.length} sign events; upserted ${linkedRows} links (${newLinks} new); ` +
        `touched ${touchedAccounts.size} accounts (${accountsCreated} new)` +
        (backStamped > 0 ? `; back-stamped ${backStamped} historical orphans` : "") +
        (orphanRetryAttempted > 0
          ? `; orphan-retry attempted ${orphanRetryAttempted}, resolved ${orphanRetryResolved}`
          : "") +
        ".",
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
