import { prisma } from "@/lib/prisma";

type CollectorHealthStatus = "healthy" | "lagging" | "stale" | "no_data";

type CollectorHealth = {
  source: "near" | "fastauth_accounts";
  displayName: string;
  status: CollectorHealthStatus;
  ageMinutes: number | null;
  lastWriteAt: Date | null;
  checkpoint: string | null;
  details: string;
};

type TimeWindowMetrics = {
  last24h: number;
  last7d: number;
  last30d: number;
};

type AggregateAccountsMetrics = {
  totalAccounts: number;
  created: TimeWindowMetrics;
  active: TimeWindowMetrics;
};

type TransactionMetrics = {
  signed: TimeWindowMetrics;
  failed: TimeWindowMetrics;
  total: TimeWindowMetrics;
};

type RelayerBreakdownItem = {
  address: string;
  transactions: number;
  feesPaidGasBurnt: string | null;
  projectOwner: string | null;
  sponsoredUniqueAccounts: {
    last24h: number;
    last7d: number;
    last30d: number;
    total: number;
  };
  uniqueAccountsList: string[];
  tvl: string | null;
};

type RecentSignEvent = {
  id: string;
  txHash: string;
  actionIndex: number;
  blockHeight: string;
  blockTimestamp: Date;
  relayerAccountId: string;
  fastAuthContractId: string;
  guardName: string | null;
  providerType: string;
  algorithm: string | null;
  userDomainId: number | null;
  userDerivedPublicKey: string | null;
  projectDappId: string | null;
  sponsoredAccountId: string | null;
  executionStatus: string | null;
  gasBurnt: string | null;
};

type PublicKeyAccountRow = {
  publicKey: string;
  accountId: string;
  keyPath: string | null;
  predecessorId: string | null;
  domainId: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

type IndexerCheckpointRow = {
  key: string;
  value: string;
  updatedAt: Date;
};

type RecentNearTransaction = {
  txHash: string;
  blockHeight: string | null;
  blockTimestamp: Date | null;
  signerAccountId: string | null;
  receiverId: string | null;
  methodName: string | null;
  executionStatus: string | null;
};

type DbTableCounts = {
  nearTransactions: number;
  fastAuthSignEvents: number;
  accounts: number;
  publicKeyAccounts: number;
  relayers: number;
  indexerCheckpoints: number;
};

type IndexerLag = {
  chainHead: string | null;
  scannedHeight: string | null;
  backfillStartHeight: string | null;
  blocksBehind: number | null;
  latestIndexedBlockTimestamp: Date | null;
  minutesBehind: number | null;
  lastScannedCheckpointAt: Date | null;
};

type MissingBlockRange = {
  startHeight: number;
  endHeight: number;
  size: number;
  blocksProcessed: number;
  blocksPending: number;
  status: "open" | "closed";
  reason: string;
  recordedAt: string;
  completedUpTo: number | null;
  completedDownTo: number | null;
};

type FastAuthChainHealth = {
  computedAt: Date;
  chainHead: string;
  windowStartHeight: string;
  windowEndHeight: string;
  windowBlocks: number;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  successRatePct: number | null;
  distinctRelayers: number;
  lastSuccessTimestamp: Date | null;
  lastSuccessTxHash: string | null;
  minutesSinceLastSuccess: number | null;
};

type DashboardData = {
  accountsOverview: AggregateAccountsMetrics;
  transactionOverview: TransactionMetrics;
  latestNearFinalBlock: string | null;
  indexerLag: IndexerLag;
  fastAuthChainHealth: FastAuthChainHealth | null;
  missingBlockRanges: MissingBlockRange[];
  collectorHealth: CollectorHealth[];
  relayerBreakdown: RelayerBreakdownItem[];
  recentNearTransactions: RecentNearTransaction[];
  recentSignEvents: RecentSignEvent[];
  topPublicKeyAccounts: PublicKeyAccountRow[];
  indexerCheckpoints: IndexerCheckpointRow[];
  tableCounts: DbTableCounts;
};

const MAX_RELAYER_ROWS = 30;
const MAX_UNIQUE_SPONSORED_ACCOUNTS_TO_DISPLAY = 12;
const MAX_RECENT_NEAR_TRANSACTIONS = 8;
const MAX_RECENT_SIGN_EVENTS = 12;
const MAX_PUBLIC_KEY_ACCOUNTS = 12;

async function loadMissingBlockRanges(): Promise<MissingBlockRange[]> {
  let rows: Awaited<ReturnType<typeof prisma.missingBlockRange.findMany>>;
  try {
    rows = await prisma.missingBlockRange.findMany({ orderBy: { startHeight: "asc" } });
  } catch (error) {
    // Table may not yet exist (e.g. dashboard built before the migration is
    // applied) — render an empty list rather than crashing the entire page.
    if (error && typeof error === "object" && "code" in error && error.code === "P2021") {
      return [];
    }
    throw error;
  }
  return rows.map((r) => {
    const startHeight = Number(r.startHeight);
    const endHeight = Number(r.endHeight);
    const completedUpTo = r.completedUpTo != null ? Number(r.completedUpTo) : null;
    const completedDownTo = r.completedDownTo != null ? Number(r.completedDownTo) : null;
    const size = endHeight - startHeight + 1;
    const ascDone =
      completedUpTo != null && completedUpTo >= startHeight
        ? Math.min(completedUpTo, endHeight) - startHeight + 1
        : 0;
    const descDone =
      completedDownTo != null && completedDownTo <= endHeight
        ? endHeight - Math.max(completedDownTo, startHeight) + 1
        : 0;
    // Asc and desc grow toward each other; cap the sum at the range size to
    // avoid double-counting if the two cursors ever cross.
    const blocksProcessed = Math.min(size, ascDone + descDone);
    return {
      startHeight,
      endHeight,
      size,
      blocksProcessed,
      blocksPending: size - blocksProcessed,
      status: r.status === "closed" ? "closed" : "open",
      reason: r.reason,
      recordedAt: r.recordedAt.toISOString(),
      completedUpTo,
      completedDownTo,
    };
  });
}

function tryParseBigInt(value: string | null | undefined): bigint | null {
  if (!value) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function resolveIndexerPollIntervalMs(): number {
  const raw = process.env.INDEXER_POLL_INTERVAL_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 30_000;
  }
  return Math.floor(parsed);
}

function getCollectorHealthStatus(
  lastWriteAt: Date | null,
  pollIntervalMs: number,
  now: Date,
): { status: CollectorHealthStatus; ageMinutes: number | null } {
  if (!lastWriteAt) {
    return { status: "no_data", ageMinutes: null };
  }

  const ageMs = Math.max(0, now.getTime() - lastWriteAt.getTime());
  const ageMinutes = Math.floor(ageMs / 60_000);
  const healthyThresholdMs = Math.max(pollIntervalMs * 3, 5 * 60_000);
  const laggingThresholdMs = Math.max(pollIntervalMs * 10, 20 * 60_000);

  if (ageMs <= healthyThresholdMs) {
    return { status: "healthy", ageMinutes };
  }
  if (ageMs <= laggingThresholdMs) {
    return { status: "lagging", ageMinutes };
  }
  return { status: "stale", ageMinutes };
}

function toCollectorHealth(params: {
  source: CollectorHealth["source"];
  displayName: string;
  lastWriteAt: Date | null;
  checkpoint: string | null;
  details: string;
  pollIntervalMs: number;
  now: Date;
}): CollectorHealth {
  const freshness = getCollectorHealthStatus(params.lastWriteAt, params.pollIntervalMs, params.now);

  return {
    source: params.source,
    displayName: params.displayName,
    status: freshness.status,
    ageMinutes: freshness.ageMinutes,
    lastWriteAt: params.lastWriteAt,
    checkpoint: params.checkpoint,
    details: params.details,
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const pollIntervalMs = resolveIndexerPollIntervalMs();

  const failureWhere = {
    OR: [
      { failureReason: { not: null } },
      { executionStatus: { contains: "failure", mode: "insensitive" as const } },
    ],
  };

  const [
    accountsTotal,
    accountsCreated24h,
    accountsCreated7d,
    accountsCreated30d,
    accountsActive24h,
    accountsActive7d,
    accountsActive30d,
    signTotal24h,
    signTotal7d,
    signTotal30d,
    signFailed24h,
    signFailed7d,
    signFailed30d,
    nearHeightCheckpoint,
    nearScannedCheckpoint,
    nearChainHeadCheckpoint,
    nearBackfillOriginCheckpoint,
    latestFastAuthChainHealth,
    lastNearTransaction,
    relayerRows,
    relayerSponsoredPairsAllTime,
    relayerSponsoredPairs24h,
    relayerSponsoredPairs7d,
    relayerSponsoredPairs30d,
    recentNearTransactionsRaw,
    recentSignEventsRaw,
    topPublicKeyAccountsRaw,
    indexerCheckpointsRaw,
    nearTransactionsTotalCount,
    fastAuthSignEventsTotalCount,
    accountsTotalCount,
    publicKeyAccountsTotalCount,
    relayersTotalCount,
    indexerCheckpointsTotalCount,
  ] = await Promise.all([
    prisma.account.count(),
    prisma.account.count({ where: { firstSeenAt: { gte: last24h } } }),
    prisma.account.count({ where: { firstSeenAt: { gte: last7d } } }),
    prisma.account.count({ where: { firstSeenAt: { gte: last30d } } }),
    prisma.account.count({ where: { lastSeenAt: { gte: last24h } } }),
    prisma.account.count({ where: { lastSeenAt: { gte: last7d } } }),
    prisma.account.count({ where: { lastSeenAt: { gte: last30d } } }),
    prisma.fastAuthSignEvent.count({ where: { blockTimestamp: { gte: last24h } } }),
    prisma.fastAuthSignEvent.count({ where: { blockTimestamp: { gte: last7d } } }),
    prisma.fastAuthSignEvent.count({ where: { blockTimestamp: { gte: last30d } } }),
    prisma.fastAuthSignEvent.count({ where: { blockTimestamp: { gte: last24h }, ...failureWhere } }),
    prisma.fastAuthSignEvent.count({ where: { blockTimestamp: { gte: last7d }, ...failureWhere } }),
    prisma.fastAuthSignEvent.count({ where: { blockTimestamp: { gte: last30d }, ...failureWhere } }),
    prisma.indexerCheckpoint.findUnique({ where: { key: "near_last_final_block_height" } }),
    prisma.indexerCheckpoint.findUnique({ where: { key: "near_last_scanned_height" } }),
    prisma.indexerCheckpoint.findUnique({ where: { key: "near_chain_head_height" } }),
    prisma.indexerCheckpoint.findUnique({ where: { key: "near_backfill_start_origin" } }),
    prisma.fastAuthChainHealthSnapshot.findFirst({ orderBy: { computedAt: "desc" } }),
    prisma.nearTransaction.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.relayer.findMany({
      orderBy: { totalSignTransactions: "desc" },
      take: MAX_RELAYER_ROWS,
      select: {
        accountId: true,
        totalSignTransactions: true,
        totalGasBurnt: true,
        totalSponsoredUniqueAccounts: true,
        projectOwner: true,
      },
    }),
    prisma.fastAuthSignEvent.findMany({
      where: { sponsoredAccountId: { not: null } },
      select: { relayerAccountId: true, sponsoredAccountId: true },
      distinct: ["relayerAccountId", "sponsoredAccountId"],
    }),
    prisma.fastAuthSignEvent.findMany({
      where: { sponsoredAccountId: { not: null }, blockTimestamp: { gte: last24h } },
      select: { relayerAccountId: true, sponsoredAccountId: true },
      distinct: ["relayerAccountId", "sponsoredAccountId"],
    }),
    prisma.fastAuthSignEvent.findMany({
      where: { sponsoredAccountId: { not: null }, blockTimestamp: { gte: last7d } },
      select: { relayerAccountId: true, sponsoredAccountId: true },
      distinct: ["relayerAccountId", "sponsoredAccountId"],
    }),
    prisma.fastAuthSignEvent.findMany({
      where: { sponsoredAccountId: { not: null }, blockTimestamp: { gte: last30d } },
      select: { relayerAccountId: true, sponsoredAccountId: true },
      distinct: ["relayerAccountId", "sponsoredAccountId"],
    }),
    prisma.nearTransaction.findMany({
      orderBy: { blockTimestamp: "desc" },
      take: MAX_RECENT_NEAR_TRANSACTIONS,
      select: {
        txHash: true,
        blockHeight: true,
        blockTimestamp: true,
        signerAccountId: true,
        receiverId: true,
        methodName: true,
        executionStatus: true,
      },
    }),
    prisma.fastAuthSignEvent.findMany({
      orderBy: { blockTimestamp: "desc" },
      take: MAX_RECENT_SIGN_EVENTS,
      select: {
        id: true,
        txHash: true,
        actionIndex: true,
        blockHeight: true,
        blockTimestamp: true,
        relayerAccountId: true,
        fastAuthContractId: true,
        guardName: true,
        providerType: true,
        algorithm: true,
        userDomainId: true,
        userDerivedPublicKey: true,
        projectDappId: true,
        sponsoredAccountId: true,
        executionStatus: true,
        gasBurnt: true,
      },
    }),
    prisma.fastAuthPublicKeyAccount.findMany({
      orderBy: { lastSeenAt: "desc" },
      take: MAX_PUBLIC_KEY_ACCOUNTS,
      select: {
        publicKey: true,
        accountId: true,
        keyPath: true,
        predecessorId: true,
        domainId: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    }),
    prisma.indexerCheckpoint.findMany({
      orderBy: { key: "asc" },
      select: { key: true, value: true, updatedAt: true },
    }),
    prisma.nearTransaction.count(),
    prisma.fastAuthSignEvent.count(),
    prisma.account.count(),
    prisma.fastAuthPublicKeyAccount.count(),
    prisma.relayer.count(),
    prisma.indexerCheckpoint.count(),
  ]);

  const accountsOverview: AggregateAccountsMetrics = {
    totalAccounts: accountsTotal,
    created: { last24h: accountsCreated24h, last7d: accountsCreated7d, last30d: accountsCreated30d },
    active: { last24h: accountsActive24h, last7d: accountsActive7d, last30d: accountsActive30d },
  };

  const transactionOverview: TransactionMetrics = {
    signed: {
      last24h: Math.max(0, signTotal24h - signFailed24h),
      last7d: Math.max(0, signTotal7d - signFailed7d),
      last30d: Math.max(0, signTotal30d - signFailed30d),
    },
    failed: { last24h: signFailed24h, last7d: signFailed7d, last30d: signFailed30d },
    total: { last24h: signTotal24h, last7d: signTotal7d, last30d: signTotal30d },
  };

  function buildSponsoredMap(
    pairs: Array<{ relayerAccountId: string; sponsoredAccountId: string | null }>,
  ): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const pair of pairs) {
      if (!pair.sponsoredAccountId) continue;
      const key = pair.relayerAccountId.toLowerCase();
      let set = map.get(key);
      if (!set) {
        set = new Set<string>();
        map.set(key, set);
      }
      set.add(pair.sponsoredAccountId);
    }
    return map;
  }

  const sponsoredTotalMap = buildSponsoredMap(relayerSponsoredPairsAllTime);
  const sponsored24hMap = buildSponsoredMap(relayerSponsoredPairs24h);
  const sponsored7dMap = buildSponsoredMap(relayerSponsoredPairs7d);
  const sponsored30dMap = buildSponsoredMap(relayerSponsoredPairs30d);

  const relayerBreakdown: RelayerBreakdownItem[] = relayerRows.map((entry) => {
    const address = entry.accountId;
    const addressKey = address.toLowerCase();
    const totalSet = sponsoredTotalMap.get(addressKey) ?? new Set<string>();

    return {
      address,
      transactions: entry.totalSignTransactions,
      feesPaidGasBurnt:
        typeof entry.totalGasBurnt === "bigint" ? entry.totalGasBurnt.toString() : null,
      projectOwner: entry.projectOwner,
      sponsoredUniqueAccounts: {
        last24h: sponsored24hMap.get(addressKey)?.size ?? 0,
        last7d: sponsored7dMap.get(addressKey)?.size ?? 0,
        last30d: sponsored30dMap.get(addressKey)?.size ?? 0,
        total: totalSet.size,
      },
      uniqueAccountsList: [...totalSet]
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_UNIQUE_SPONSORED_ACCOUNTS_TO_DISPLAY),
      tvl: null,
    };
  });

  const fastAuthAccountsCheckpoint = indexerCheckpointsRaw.find(
    (row) => row.key === "fastauth_public_key_accounts_last_event_id",
  );

  const collectorHealth: CollectorHealth[] = [
    toCollectorHealth({
      source: "near",
      displayName: "NEAR",
      lastWriteAt: lastNearTransaction?.createdAt ?? null,
      checkpoint: nearScannedCheckpoint?.value ?? nearHeightCheckpoint?.value ?? null,
      details: "Final-block scan progress (including skipped empty heights).",
      pollIntervalMs,
      now,
    }),
    toCollectorHealth({
      source: "fastauth_accounts",
      displayName: "FastAuth Accounts",
      lastWriteAt: fastAuthAccountsCheckpoint?.updatedAt ?? null,
      checkpoint: fastAuthAccountsCheckpoint?.value ?? null,
      details: "Links derived public keys to NEAR accounts via FastNEAR.",
      pollIntervalMs,
      now,
    }),
  ];

  const recentNearTransactions: RecentNearTransaction[] = recentNearTransactionsRaw.map((tx) => ({
    txHash: tx.txHash,
    blockHeight: tx.blockHeight !== null && tx.blockHeight !== undefined ? tx.blockHeight.toString() : null,
    blockTimestamp: tx.blockTimestamp ?? null,
    signerAccountId: tx.signerAccountId,
    receiverId: tx.receiverId,
    methodName: tx.methodName,
    executionStatus: tx.executionStatus,
  }));

  const recentSignEvents: RecentSignEvent[] = recentSignEventsRaw.map((event) => ({
    id: event.id.toString(),
    txHash: event.txHash,
    actionIndex: event.actionIndex,
    blockHeight: event.blockHeight.toString(),
    blockTimestamp: event.blockTimestamp,
    relayerAccountId: event.relayerAccountId,
    fastAuthContractId: event.fastAuthContractId,
    guardName: event.guardName,
    providerType: event.providerType,
    algorithm: event.algorithm,
    userDomainId: event.userDomainId,
    userDerivedPublicKey: event.userDerivedPublicKey,
    projectDappId: event.projectDappId,
    sponsoredAccountId: event.sponsoredAccountId,
    executionStatus: event.executionStatus,
    gasBurnt:
      typeof event.gasBurnt === "bigint" ? event.gasBurnt.toString() : event.gasBurnt ?? null,
  }));

  const indexerCheckpoints: IndexerCheckpointRow[] = indexerCheckpointsRaw.map((row) => ({
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt,
  }));

  const chainHeadValue = nearChainHeadCheckpoint?.value ?? nearHeightCheckpoint?.value ?? null;
  const scannedHeightValue = nearScannedCheckpoint?.value ?? null;
  const chainHeadBigInt = tryParseBigInt(chainHeadValue);
  const scannedBigInt = tryParseBigInt(scannedHeightValue);
  const blocksBehind =
    chainHeadBigInt !== null && scannedBigInt !== null
      ? Number(chainHeadBigInt - scannedBigInt)
      : null;
  const latestIndexedBlockTimestamp = recentNearTransactionsRaw[0]?.blockTimestamp ?? null;
  const minutesBehind = latestIndexedBlockTimestamp
    ? Math.max(0, Math.floor((now.getTime() - latestIndexedBlockTimestamp.getTime()) / 60_000))
    : null;

  const fastAuthChainHealth: FastAuthChainHealth | null = latestFastAuthChainHealth
    ? {
        computedAt: latestFastAuthChainHealth.computedAt,
        chainHead: latestFastAuthChainHealth.chainHead.toString(),
        windowStartHeight: latestFastAuthChainHealth.windowStartHeight.toString(),
        windowEndHeight: latestFastAuthChainHealth.windowEndHeight.toString(),
        windowBlocks: latestFastAuthChainHealth.windowBlocks,
        totalTransactions: latestFastAuthChainHealth.totalTransactions,
        successfulTransactions: latestFastAuthChainHealth.successfulTransactions,
        failedTransactions: latestFastAuthChainHealth.failedTransactions,
        successRatePct:
          latestFastAuthChainHealth.totalTransactions > 0
            ? Math.round(
                (latestFastAuthChainHealth.successfulTransactions /
                  latestFastAuthChainHealth.totalTransactions) *
                  1000,
              ) / 10
            : null,
        distinctRelayers: latestFastAuthChainHealth.distinctRelayers,
        lastSuccessTimestamp: latestFastAuthChainHealth.lastSuccessTimestamp,
        lastSuccessTxHash: latestFastAuthChainHealth.lastSuccessTxHash,
        minutesSinceLastSuccess: latestFastAuthChainHealth.lastSuccessTimestamp
          ? Math.max(
              0,
              Math.floor(
                (now.getTime() - latestFastAuthChainHealth.lastSuccessTimestamp.getTime()) /
                  60_000,
              ),
            )
          : null,
      }
    : null;

  const indexerLag: IndexerLag = {
    chainHead: chainHeadValue,
    scannedHeight: scannedHeightValue,
    backfillStartHeight: nearBackfillOriginCheckpoint?.value ?? null,
    blocksBehind: blocksBehind !== null && Number.isFinite(blocksBehind) ? blocksBehind : null,
    latestIndexedBlockTimestamp,
    minutesBehind,
    lastScannedCheckpointAt: nearScannedCheckpoint?.updatedAt ?? null,
  };

  return {
    accountsOverview,
    transactionOverview,
    latestNearFinalBlock: nearChainHeadCheckpoint?.value ?? nearHeightCheckpoint?.value ?? null,
    indexerLag,
    fastAuthChainHealth,
    missingBlockRanges: await loadMissingBlockRanges(),
    collectorHealth,
    relayerBreakdown,
    recentNearTransactions,
    recentSignEvents,
    topPublicKeyAccounts: topPublicKeyAccountsRaw,
    indexerCheckpoints,
    tableCounts: {
      nearTransactions: nearTransactionsTotalCount,
      fastAuthSignEvents: fastAuthSignEventsTotalCount,
      accounts: accountsTotalCount,
      publicKeyAccounts: publicKeyAccountsTotalCount,
      relayers: relayersTotalCount,
      indexerCheckpoints: indexerCheckpointsTotalCount,
    },
  };
}
