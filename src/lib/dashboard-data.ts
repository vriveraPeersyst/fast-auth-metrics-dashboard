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
  all: number;
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
  userAccountId: string | null;
  signActionType: string | null;
  consumerStatus: "succeeded" | "failed" | "pending";
  consumerFailureReason: string | null;
  consumerTxHash: string | null;
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
  guardFailedTransactions: number;
  successRatePct: number | null;
  distinctRelayers: number;
  lastSuccessTimestamp: Date | null;
  lastSuccessTxHash: string | null;
  minutesSinceLastSuccess: number | null;
};

type MpcChainHealth = {
  computedAt: Date;
  attemptedTransactions: number;
  failedTransactions: number;
  successfulTransactions: number;
  successRatePct: number | null;
};

type ChainHealthHistoryPoint = {
  computedAt: Date;
  totalTransactions: number;
  fastAuthSuccessRatePct: number | null;
  mpcAttempted: number;
  mpcFailed: number;
  mpcSuccessRatePct: number | null;
};

type GuardWindowStats = {
  signed: number;
  failed: number;
  total: number;
  distinctUsers: number;
  successRatePct: number | null;
};

type GuardBreakdownItem = {
  guardName: string;
  last24h: GuardWindowStats;
  last7d: GuardWindowStats;
  last30d: GuardWindowStats;
};

type ProviderBreakdownItem = {
  providerType: string;
  last24h: GuardWindowStats;
  last7d: GuardWindowStats;
  last30d: GuardWindowStats;
};

type ActionTypeBreakdownItem = {
  actionType: string;
  last24h: number;
  last7d: number;
  last30d: number;
  all: number;
};

type ConsumerOutcomeWindow = {
  total: number;
  succeeded: number;
  failed: number;
  successRatePct: number | null;
};

type ConsumerFailureReasonRow = {
  reason: string;
  last24h: number;
  last7d: number;
  last30d: number;
  all: number;
};

type ConsumerOutcomes = {
  byWindow: {
    last24h: ConsumerOutcomeWindow;
    last7d: ConsumerOutcomeWindow;
    last30d: ConsumerOutcomeWindow;
    all: ConsumerOutcomeWindow;
  };
  topFailureReasons: ConsumerFailureReasonRow[];
};

type TopAccountRow = {
  accountId: string;
  signEventsAll: number;
  signEvents30d: number;
  signEvents7d: number;
  signEvents24h: number;
  firstEventAt: Date | null;
  lastEventAt: Date | null;
};

type DashboardData = {
  accountsOverview: AggregateAccountsMetrics;
  transactionOverview: TransactionMetrics;
  providerBreakdown: ProviderBreakdownItem[];
  guardBreakdown: GuardBreakdownItem[];
  actionTypeBreakdown: ActionTypeBreakdownItem[];
  consumerOutcomes: ConsumerOutcomes;
  topAccounts: TopAccountRow[];
  latestNearFinalBlock: string | null;
  indexerLag: IndexerLag;
  fastAuthChainHealth: FastAuthChainHealth | null;
  mpcChainHealth: MpcChainHealth | null;
  chainHealthHistory: ChainHealthHistoryPoint[];
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
const MAX_TOP_ACCOUNTS = 50;

async function loadGuardBreakdown(
  last24h: Date,
  last7d: Date,
  last30d: Date,
  failureWhere: object,
): Promise<GuardBreakdownItem[]> {
  const windows: Array<{ key: "last24h" | "last7d" | "last30d"; gte: Date }> = [
    { key: "last24h", gte: last24h },
    { key: "last7d", gte: last7d },
    { key: "last30d", gte: last30d },
  ];

  const queries = windows.flatMap((w) => [
    prisma.fastAuthSignEvent.groupBy({
      by: ["guardName"],
      where: { blockTimestamp: { gte: w.gte } },
      _count: { id: true },
    }),
    prisma.fastAuthSignEvent.groupBy({
      by: ["guardName"],
      where: { blockTimestamp: { gte: w.gte }, ...failureWhere },
      _count: { id: true },
    }),
    prisma.fastAuthSignEvent.findMany({
      where: {
        blockTimestamp: { gte: w.gte },
        userDerivedPublicKey: { not: null },
      },
      distinct: ["guardName", "userDerivedPublicKey"],
      select: { guardName: true },
    }),
  ]);

  const results = await Promise.all(queries);

  // Sentinel for null guardName so the Map can still key it.
  const NULL_KEY = "__null__";
  const toKey = (guardName: string | null): string => guardName ?? NULL_KEY;
  const fromKey = (key: string): string => (key === NULL_KEY ? "(unnamed)" : key);

  const allKeys = new Set<string>();
  const perWindow = new Map<
    "last24h" | "last7d" | "last30d",
    Map<string, GuardWindowStats>
  >();

  windows.forEach((w, i) => {
    const totalRows = results[i * 3] as Array<{
      guardName: string | null;
      _count: { id: number };
    }>;
    const failedRows = results[i * 3 + 1] as Array<{
      guardName: string | null;
      _count: { id: number };
    }>;
    const distinctRows = results[i * 3 + 2] as Array<{ guardName: string | null }>;

    const map = new Map<string, GuardWindowStats>();

    for (const row of totalRows) {
      const key = toKey(row.guardName);
      allKeys.add(key);
      map.set(key, {
        signed: row._count.id,
        failed: 0,
        total: row._count.id,
        distinctUsers: 0,
        successRatePct: null,
      });
    }

    for (const row of failedRows) {
      const key = toKey(row.guardName);
      const stats = map.get(key);
      if (stats) {
        stats.failed = row._count.id;
        stats.signed = Math.max(0, stats.total - row._count.id);
      } else {
        allKeys.add(key);
        map.set(key, {
          signed: 0,
          failed: row._count.id,
          total: row._count.id,
          distinctUsers: 0,
          successRatePct: null,
        });
      }
    }

    const distinctCounts = new Map<string, number>();
    for (const row of distinctRows) {
      const key = toKey(row.guardName);
      distinctCounts.set(key, (distinctCounts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of distinctCounts) {
      const stats = map.get(key);
      if (stats) {
        stats.distinctUsers = count;
      }
    }

    for (const stats of map.values()) {
      if (stats.total > 0) {
        stats.successRatePct = Math.round((stats.signed / stats.total) * 1000) / 10;
      }
    }

    perWindow.set(w.key, map);
  });

  const emptyStats: GuardWindowStats = {
    signed: 0,
    failed: 0,
    total: 0,
    distinctUsers: 0,
    successRatePct: null,
  };

  return [...allKeys]
    .map((key) => ({
      guardName: fromKey(key),
      last24h: perWindow.get("last24h")?.get(key) ?? { ...emptyStats },
      last7d: perWindow.get("last7d")?.get(key) ?? { ...emptyStats },
      last30d: perWindow.get("last30d")?.get(key) ?? { ...emptyStats },
    }))
    .sort((a, b) => b.last30d.total - a.last30d.total);
}

async function loadProviderBreakdown(
  last24h: Date,
  last7d: Date,
  last30d: Date,
  failureWhere: object,
): Promise<ProviderBreakdownItem[]> {
  const windows: Array<{ key: "last24h" | "last7d" | "last30d"; gte: Date }> = [
    { key: "last24h", gte: last24h },
    { key: "last7d", gte: last7d },
    { key: "last30d", gte: last30d },
  ];

  const queries = windows.flatMap((w) => [
    prisma.fastAuthSignEvent.groupBy({
      by: ["providerType"],
      where: { blockTimestamp: { gte: w.gte } },
      _count: { id: true },
    }),
    prisma.fastAuthSignEvent.groupBy({
      by: ["providerType"],
      where: { blockTimestamp: { gte: w.gte }, ...failureWhere },
      _count: { id: true },
    }),
    prisma.fastAuthSignEvent.findMany({
      where: {
        blockTimestamp: { gte: w.gte },
        userDerivedPublicKey: { not: null },
      },
      distinct: ["providerType", "userDerivedPublicKey"],
      select: { providerType: true },
    }),
  ]);

  const results = await Promise.all(queries);

  const allKeys = new Set<string>();
  const perWindow = new Map<
    "last24h" | "last7d" | "last30d",
    Map<string, GuardWindowStats>
  >();

  windows.forEach((w, i) => {
    const totalRows = results[i * 3] as Array<{
      providerType: string;
      _count: { id: number };
    }>;
    const failedRows = results[i * 3 + 1] as Array<{
      providerType: string;
      _count: { id: number };
    }>;
    const distinctRows = results[i * 3 + 2] as Array<{ providerType: string }>;

    const map = new Map<string, GuardWindowStats>();

    for (const row of totalRows) {
      allKeys.add(row.providerType);
      map.set(row.providerType, {
        signed: row._count.id,
        failed: 0,
        total: row._count.id,
        distinctUsers: 0,
        successRatePct: null,
      });
    }

    for (const row of failedRows) {
      const stats = map.get(row.providerType);
      if (stats) {
        stats.failed = row._count.id;
        stats.signed = Math.max(0, stats.total - row._count.id);
      } else {
        allKeys.add(row.providerType);
        map.set(row.providerType, {
          signed: 0,
          failed: row._count.id,
          total: row._count.id,
          distinctUsers: 0,
          successRatePct: null,
        });
      }
    }

    const distinctCounts = new Map<string, number>();
    for (const row of distinctRows) {
      distinctCounts.set(row.providerType, (distinctCounts.get(row.providerType) ?? 0) + 1);
    }
    for (const [providerType, count] of distinctCounts) {
      const stats = map.get(providerType);
      if (stats) {
        stats.distinctUsers = count;
      }
    }

    for (const stats of map.values()) {
      if (stats.total > 0) {
        stats.successRatePct = Math.round((stats.signed / stats.total) * 1000) / 10;
      }
    }

    perWindow.set(w.key, map);
  });

  const emptyStats: GuardWindowStats = {
    signed: 0,
    failed: 0,
    total: 0,
    distinctUsers: 0,
    successRatePct: null,
  };

  return [...allKeys]
    .map((providerType) => ({
      providerType,
      last24h: perWindow.get("last24h")?.get(providerType) ?? { ...emptyStats },
      last7d: perWindow.get("last7d")?.get(providerType) ?? { ...emptyStats },
      last30d: perWindow.get("last30d")?.get(providerType) ?? { ...emptyStats },
    }))
    .sort((a, b) => b.last30d.total - a.last30d.total);
}

async function loadActionTypeBreakdown(
  last24h: Date,
  last7d: Date,
  last30d: Date,
): Promise<ActionTypeBreakdownItem[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      action_type: string | null;
      total_all: bigint;
      total_30d: bigint;
      total_7d: bigint;
      total_24h: bigint;
    }>
  >`
    SELECT
      sign_action_type AS action_type,
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last24h}) AS total_24h
    FROM fastauth_sign_events
    GROUP BY sign_action_type
    ORDER BY total_all DESC
  `;

  return rows.map((row) => ({
    actionType: row.action_type ?? "(unclassified)",
    last24h: Number(row.total_24h),
    last7d: Number(row.total_7d),
    last30d: Number(row.total_30d),
    all: Number(row.total_all),
  }));
}

async function loadConsumerOutcomes(
  last24h: Date,
  last7d: Date,
  last30d: Date,
): Promise<ConsumerOutcomes> {
  const [windowsRow] = await prisma.$queryRaw<
    Array<{
      total_all: bigint;
      total_30d: bigint;
      total_7d: bigint;
      total_24h: bigint;
      failed_all: bigint;
      failed_30d: bigint;
      failed_7d: bigint;
      failed_24h: bigint;
    }>
  >`
    SELECT
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last24h}) AS total_24h,
      COUNT(*) FILTER (WHERE failure_reason IS NOT NULL) AS failed_all,
      COUNT(*) FILTER (WHERE failure_reason IS NOT NULL AND block_timestamp >= ${last30d}) AS failed_30d,
      COUNT(*) FILTER (WHERE failure_reason IS NOT NULL AND block_timestamp >= ${last7d}) AS failed_7d,
      COUNT(*) FILTER (WHERE failure_reason IS NOT NULL AND block_timestamp >= ${last24h}) AS failed_24h
    FROM fastauth_consumer_transactions
  `;

  const reasonRows = await prisma.$queryRaw<
    Array<{
      reason: string | null;
      total_all: bigint;
      total_30d: bigint;
      total_7d: bigint;
      total_24h: bigint;
    }>
  >`
    SELECT
      failure_reason AS reason,
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last24h}) AS total_24h
    FROM fastauth_consumer_transactions
    WHERE failure_reason IS NOT NULL
    GROUP BY failure_reason
    ORDER BY total_all DESC
    LIMIT 10
  `;

  const buildWindow = (total: bigint, failed: bigint): ConsumerOutcomeWindow => {
    const totalNum = Number(total);
    const failedNum = Number(failed);
    const succeeded = Math.max(0, totalNum - failedNum);
    return {
      total: totalNum,
      succeeded,
      failed: failedNum,
      successRatePct: totalNum > 0 ? Math.round((succeeded / totalNum) * 1000) / 10 : null,
    };
  };

  return {
    byWindow: {
      last24h: buildWindow(windowsRow?.total_24h ?? BigInt(0), windowsRow?.failed_24h ?? BigInt(0)),
      last7d: buildWindow(windowsRow?.total_7d ?? BigInt(0), windowsRow?.failed_7d ?? BigInt(0)),
      last30d: buildWindow(windowsRow?.total_30d ?? BigInt(0), windowsRow?.failed_30d ?? BigInt(0)),
      all: buildWindow(windowsRow?.total_all ?? BigInt(0), windowsRow?.failed_all ?? BigInt(0)),
    },
    topFailureReasons: reasonRows.map((r) => ({
      reason: r.reason ?? "(unknown)",
      last24h: Number(r.total_24h),
      last7d: Number(r.total_7d),
      last30d: Number(r.total_30d),
      all: Number(r.total_all),
    })),
  };
}

async function loadTopAccounts(
  last24h: Date,
  last7d: Date,
  last30d: Date,
  limit: number,
): Promise<TopAccountRow[]> {
  // One round-trip with conditional aggregations across all four windows.
  // Filtering on user_account_id ensures we only count events whose owner
  // has been resolved by the public-key-accounts collector.
  const rows = await prisma.$queryRaw<
    Array<{
      account_id: string;
      sign_events_all: bigint;
      sign_events_30d: bigint;
      sign_events_7d: bigint;
      sign_events_24h: bigint;
      first_event_at: Date | null;
      last_event_at: Date | null;
    }>
  >`
    SELECT
      user_account_id AS account_id,
      COUNT(*) AS sign_events_all,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last30d}) AS sign_events_30d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last7d}) AS sign_events_7d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last24h}) AS sign_events_24h,
      MIN(block_timestamp) AS first_event_at,
      MAX(block_timestamp) AS last_event_at
    FROM fastauth_sign_events
    WHERE user_account_id IS NOT NULL
    GROUP BY user_account_id
    ORDER BY sign_events_all DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    accountId: row.account_id,
    signEventsAll: Number(row.sign_events_all),
    signEvents30d: Number(row.sign_events_30d),
    signEvents7d: Number(row.sign_events_7d),
    signEvents24h: Number(row.sign_events_24h),
    firstEventAt: row.first_event_at,
    lastEventAt: row.last_event_at,
  }));
}

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

  const guardBreakdownPromise = loadGuardBreakdown(last24h, last7d, last30d, failureWhere);
  const providerBreakdownPromise = loadProviderBreakdown(last24h, last7d, last30d, failureWhere);
  const topAccountsPromise = loadTopAccounts(last24h, last7d, last30d, MAX_TOP_ACCOUNTS);
  const actionTypeBreakdownPromise = loadActionTypeBreakdown(last24h, last7d, last30d);
  const consumerOutcomesPromise = loadConsumerOutcomes(last24h, last7d, last30d);

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
    signFailedAll,
    nearHeightCheckpoint,
    nearScannedCheckpoint,
    nearChainHeadCheckpoint,
    nearBackfillOriginCheckpoint,
    latestFastAuthChainHealth,
    chainHealthHistoryRows,
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
    prisma.fastAuthSignEvent.count({ where: failureWhere }),
    prisma.indexerCheckpoint.findUnique({ where: { key: "near_last_final_block_height" } }),
    prisma.indexerCheckpoint.findUnique({ where: { key: "near_last_scanned_height" } }),
    prisma.indexerCheckpoint.findUnique({ where: { key: "near_chain_head_height" } }),
    prisma.indexerCheckpoint.findUnique({ where: { key: "near_backfill_start_origin" } }),
    prisma.fastAuthChainHealthSnapshot.findFirst({ orderBy: { computedAt: "desc" } }),
    prisma.fastAuthChainHealthSnapshot.findMany({
      where: { computedAt: { gte: last24h } },
      orderBy: { computedAt: "asc" },
      select: {
        computedAt: true,
        totalTransactions: true,
        successfulTransactions: true,
        failedTransactions: true,
        mpcAttemptedTransactions: true,
        mpcFailedTransactions: true,
      },
    }),
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
        userAccountId: true,
        signActionType: true,
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
    // "Created all" = lifetime accounts ever observed by the indexer.
    // "Active all" = same set, since every account has a lastSeenAt; both
    // collapse to accountsTotal in the all-time column.
    created: {
      last24h: accountsCreated24h,
      last7d: accountsCreated7d,
      last30d: accountsCreated30d,
      all: accountsTotal,
    },
    active: {
      last24h: accountsActive24h,
      last7d: accountsActive7d,
      last30d: accountsActive30d,
      all: accountsTotal,
    },
  };

  const signTotalAll = fastAuthSignEventsTotalCount;
  const transactionOverview: TransactionMetrics = {
    signed: {
      last24h: Math.max(0, signTotal24h - signFailed24h),
      last7d: Math.max(0, signTotal7d - signFailed7d),
      last30d: Math.max(0, signTotal30d - signFailed30d),
      all: Math.max(0, signTotalAll - signFailedAll),
    },
    failed: {
      last24h: signFailed24h,
      last7d: signFailed7d,
      last30d: signFailed30d,
      all: signFailedAll,
    },
    total: {
      last24h: signTotal24h,
      last7d: signTotal7d,
      last30d: signTotal30d,
      all: signTotalAll,
    },
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

  // Look up the consumer tx (if any) for each recent sign event so we can show
  // whether the relayer's downstream submission of the FastAuth signature
  // actually landed on chain — and what the failure reason was if it didn't.
  const recentEventIds = recentSignEventsRaw
    .map((event) => event.id)
    .filter((id): id is bigint => typeof id === "bigint");
  const consumerByEventId = new Map<
    string,
    { failureReason: string | null; txHash: string }
  >();
  if (recentEventIds.length > 0) {
    const consumerRows = await prisma.fastAuthConsumerTransaction.findMany({
      where: { linkedSignEventId: { in: recentEventIds } },
      select: { linkedSignEventId: true, failureReason: true, txHash: true },
    });
    for (const row of consumerRows) {
      if (row.linkedSignEventId) {
        consumerByEventId.set(row.linkedSignEventId.toString(), {
          failureReason: row.failureReason,
          txHash: row.txHash,
        });
      }
    }
  }

  const recentSignEvents: RecentSignEvent[] = recentSignEventsRaw.map((event) => {
    const consumer = consumerByEventId.get(event.id.toString()) ?? null;
    const consumerStatus: RecentSignEvent["consumerStatus"] = consumer
      ? consumer.failureReason
        ? "failed"
        : "succeeded"
      : "pending";
    return {
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
      userAccountId: event.userAccountId,
      signActionType: event.signActionType,
      consumerStatus,
      consumerFailureReason: consumer?.failureReason ?? null,
      consumerTxHash: consumer?.txHash ?? null,
      projectDappId: event.projectDappId,
      sponsoredAccountId: event.sponsoredAccountId,
      executionStatus: event.executionStatus,
      gasBurnt:
        typeof event.gasBurnt === "bigint" ? event.gasBurnt.toString() : event.gasBurnt ?? null,
    };
  });

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
        guardFailedTransactions: latestFastAuthChainHealth.guardFailedTransactions,
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

  const mpcChainHealth: MpcChainHealth | null = latestFastAuthChainHealth
    ? {
        computedAt: latestFastAuthChainHealth.computedAt,
        attemptedTransactions: latestFastAuthChainHealth.mpcAttemptedTransactions,
        failedTransactions: latestFastAuthChainHealth.mpcFailedTransactions,
        successfulTransactions: Math.max(
          0,
          latestFastAuthChainHealth.mpcAttemptedTransactions -
            latestFastAuthChainHealth.mpcFailedTransactions,
        ),
        successRatePct:
          latestFastAuthChainHealth.mpcAttemptedTransactions > 0
            ? Math.round(
                ((latestFastAuthChainHealth.mpcAttemptedTransactions -
                  latestFastAuthChainHealth.mpcFailedTransactions) /
                  latestFastAuthChainHealth.mpcAttemptedTransactions) *
                  1000,
              ) / 10
            : null,
      }
    : null;

  const chainHealthHistory: ChainHealthHistoryPoint[] = chainHealthHistoryRows.map((row) => ({
    computedAt: row.computedAt,
    totalTransactions: row.totalTransactions,
    fastAuthSuccessRatePct:
      row.totalTransactions > 0
        ? Math.round((row.successfulTransactions / row.totalTransactions) * 1000) / 10
        : null,
    mpcAttempted: row.mpcAttemptedTransactions,
    mpcFailed: row.mpcFailedTransactions,
    mpcSuccessRatePct:
      row.mpcAttemptedTransactions > 0
        ? Math.round(
            ((row.mpcAttemptedTransactions - row.mpcFailedTransactions) /
              row.mpcAttemptedTransactions) *
              1000,
          ) / 10
        : null,
  }));

  const indexerLag: IndexerLag = {
    chainHead: chainHeadValue,
    scannedHeight: scannedHeightValue,
    backfillStartHeight: nearBackfillOriginCheckpoint?.value ?? null,
    blocksBehind: blocksBehind !== null && Number.isFinite(blocksBehind) ? blocksBehind : null,
    latestIndexedBlockTimestamp,
    minutesBehind,
    lastScannedCheckpointAt: nearScannedCheckpoint?.updatedAt ?? null,
  };

  const guardBreakdown = await guardBreakdownPromise;
  const providerBreakdown = await providerBreakdownPromise;
  const topAccounts = await topAccountsPromise;
  const actionTypeBreakdown = await actionTypeBreakdownPromise;
  const consumerOutcomes = await consumerOutcomesPromise;

  return {
    accountsOverview,
    transactionOverview,
    providerBreakdown,
    guardBreakdown,
    actionTypeBreakdown,
    consumerOutcomes,
    topAccounts,
    latestNearFinalBlock: nearChainHeadCheckpoint?.value ?? nearHeightCheckpoint?.value ?? null,
    indexerLag,
    fastAuthChainHealth,
    mpcChainHealth,
    chainHealthHistory,
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
