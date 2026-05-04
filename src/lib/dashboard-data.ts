import { Prisma } from "@prisma/client";

import { MIGRATED_ACCOUNTS_TOTAL } from "@/lib/migrated-accounts";
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
  indexedAccounts: number;
  migratedAccounts: number;
  firstSeen: TimeWindowMetrics;
  active: TimeWindowMetrics;
};

type TransactionMetrics = {
  signed: TimeWindowMetrics;
  failed: TimeWindowMetrics;
  // Sign events whose tx is in fastauth_health_tx with outcome = rpc_pending —
  // i.e. we haven't yet been able to walk receipts to know the real outcome.
  // Shown as its own row in the Transactions panel; not counted as success or
  // failure. Self-resolves as the health collector retries.
  pending: TimeWindowMetrics;
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

type ChainHealthFailureRow = {
  txHash: string;
  blockTimestamp: Date;
  outcome: string;
  failingExecutorId: string | null;
  failureReason: string | null;
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
  // Tx awaiting receipt-level classification (rpc_pending). Excluded from the
  // success-rate denominator — pending isn't success or failure.
  rpcPendingTransactions: number;
  successRatePct: number | null;
  distinctRelayers: number;
  lastSuccessTimestamp: Date | null;
  lastSuccessTxHash: string | null;
  minutesSinceLastSuccess: number | null;
  // Most recent failures across guard / mpc / other, for at-a-glance triage.
  recentFailures: ChainHealthFailureRow[];
};

type MpcChainHealth = {
  computedAt: Date;
  attemptedTransactions: number;
  failedTransactions: number;
  successfulTransactions: number;
  rpcPendingTransactions: number;
  successRatePct: number | null;
  // Most recent mpc_failure rows (a subset of FastAuthChainHealth.recentFailures).
  recentFailures: ChainHealthFailureRow[];
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

type RelayerActivityItem = {
  relayerAccountId: string;
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

type ConsumerOutcomesByWindow = {
  last24h: ConsumerOutcomeWindow;
  last7d: ConsumerOutcomeWindow;
  last30d: ConsumerOutcomeWindow;
  all: ConsumerOutcomeWindow;
};

type ConsumerOutcomesGroup = {
  key: string;
  byWindow: ConsumerOutcomesByWindow;
};

type ConsumerOutcomes = {
  byWindow: ConsumerOutcomesByWindow;
  byRelayer: ConsumerOutcomesGroup[];
  byGuard: ConsumerOutcomesGroup[];
  byProvider: ConsumerOutcomesGroup[];
  byActionType: ConsumerOutcomesGroup[];
  topFailureReasons: ConsumerFailureReasonRow[];
  trackingStartedAt: {
    blockHeight: string;
    blockTimestamp: Date;
  } | null;
};

type RealActivityWindow = {
  total: number;
  succeeded: number;
  failed: number;
  successRatePct: number | null;
  distinctUsers: number;
  volumeUsd: number;
};

type RealActivityGroupRow = {
  key: string;
  last24h: number;
  last7d: number;
  last30d: number;
  all: number;
  volumeUsdAll: number;
};

// (classification × secondary key) row, e.g. (relayer, receiver) or (provider, method).
type RealActivityCrossRow = {
  classKey: string;
  innerKey: string;
  last24h: number;
  last7d: number;
  last30d: number;
  all: number;
  volumeUsdAll: number;
};

type RealActivityNested = {
  // Top-level: one row per classification value (e.g. one row per relayer).
  overall: RealActivityGroupRow[];
  // Cross-classified: one row per (classification value, secondary key).
  byReceiver: RealActivityCrossRow[];
  byMethod: RealActivityCrossRow[];
};

type RealActivity = {
  byWindow: {
    last24h: RealActivityWindow;
    last7d: RealActivityWindow;
    last30d: RealActivityWindow;
    all: RealActivityWindow;
  };
  byReceiver: RealActivityGroupRow[];
  byMethod: RealActivityGroupRow[];
  // Account-attributed classifications: each account's user txs are
  // bucketed by its most-recent sign event's relayer / provider / guard.
  // Each classification has its own Overall / by-receiver / by-method
  // breakdown so we can answer "for this provider, which dApps are
  // dominant?" or "for this relayer, what method names dominate?".
  byRelayer: RealActivityNested;
  byProvider: RealActivityNested;
  byGuard: RealActivityNested;
  // Most common failure reason kinds (grouped by the prefix before the first
  // colon, so payload variants collapse into the underlying error class).
  // Sourced from fastauth_user_health_tx.
  topFailureReasons: ConsumerFailureReasonRow[];
  trackingStartedAt: {
    blockHeight: string;
    blockTimestamp: Date;
  } | null;
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

type MpcLatencyRow = {
  signerId: string;
  responses: number;
  avgLatencySec: number;
  p50LatencySec: number;
  p95LatencySec: number;
  p99LatencySec: number;
};

type MpcRosterRow = {
  accountId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  responses24h: number;
  responses7d: number;
  responsesAll: number;
};

type MpcLivenessSeries = {
  accountId: string;
  buckets: number[];
  total: number;
};

type MpcPendingRequest = {
  txHash: string;
  predecessorId: string;
  scheme: string;
  path: string | null;
  source: string;
  trafficSource: string;
  blockTimestamp: Date;
  pendingSec: number;
};

type MpcGovernanceCategoryCount = {
  category: string;
  count24h: number;
  count7d: number;
  count30d: number;
};

type MpcGovernanceEvent = {
  txHash: string;
  blockTimestamp: Date;
  eventType: string;
  category: string;
  actorId: string;
  payloadSummary: string | null;
};

type MpcVersionDriftRow = {
  actorId: string;
  votedHashShort: string;
  votedHashFull: string;
  votedAt: Date;
};

type MpcGovernanceOverview = {
  total24h: number;
  total7d: number;
  byCategory: MpcGovernanceCategoryCount[];
  recent: MpcGovernanceEvent[];
  // Latest vote_code_hash per node — drift indicator. If all entries
  // have the same `votedHashShort`, the network is in consensus.
  codeHashDrift: MpcVersionDriftRow[];
};

type MpcDataRange = {
  earliestSignResponseAt: Date | null;
  earliestSignRequestAt: Date | null;
  earliestGovernanceEventAt: Date | null;
};

type MpcNetworkOverview = {
  // Counts whose underlying source (mpc_transactions / mpc_sign_responses /
  // mpc_sign_requests source='direct') is forward-only from when Path 4
  // started indexing. When that's < 24h, we report what we can and label
  // accordingly. windowHours stamps the actual aligned window the dashboard
  // is reporting on (1 ≤ windowHours ≤ 24).
  windowHours: number;
  responses: number;
  signsTotal: number;
  signsOrganic: number;
  signsSynthetic: number;
  signsByFastAuth: number;
  pendingCount: number;
  bucketHours: number;
  // ISO ms timestamp anchoring the leftmost liveness bucket (≈ 24h ago).
  // The component reconstructs each bucket's [start, end) from this anchor
  // so tooltips can render absolute times.
  livenessAnchorMs: number;
  latencyByNode: MpcLatencyRow[];
  liveness: MpcLivenessSeries[];
  roster: MpcRosterRow[];
  pending: MpcPendingRequest[];
  governance: MpcGovernanceOverview;
  dataRange: MpcDataRange;
};

type FastAuthContractState = {
  contractId: string;
  label: string;
  description: string;
  snapshotAt: Date;
  balanceYocto: string | null;
  storageUsage: bigint | null;
  codeHash: string | null;
  fullAccessKeys: number | null;
  locked: boolean | null;
  config: Record<string, unknown>;
  sourceMetadata: Record<string, unknown> | null;
};

type FastAuthContractsOverview = {
  contracts: FastAuthContractState[];
  // Earliest snapshot across all tracked contracts — communicates how
  // far back the per-contract history goes on the dashboard.
  earliestSnapshotAt: Date | null;
};

type DashboardData = {
  accountsOverview: AggregateAccountsMetrics;
  transactionOverview: TransactionMetrics;
  providerBreakdown: ProviderBreakdownItem[];
  relayerBreakdownByActivity: RelayerActivityItem[];
  guardBreakdown: GuardBreakdownItem[];
  actionTypeBreakdown: ActionTypeBreakdownItem[];
  consumerOutcomes: ConsumerOutcomes;
  realActivity: RealActivity;
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
  mpcNetwork: MpcNetworkOverview;
  fastAuthContracts: FastAuthContractsOverview;
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
    loadSignFailedByDimension("guard_name", w.gte),
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
    const failedMap = results[i * 3 + 1] as Map<string | null, number>;
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

    for (const [rawKey, count] of failedMap) {
      const key = toKey(rawKey);
      const stats = map.get(key);
      if (stats) {
        stats.failed = count;
        stats.signed = Math.max(0, stats.total - count);
      } else {
        allKeys.add(key);
        map.set(key, {
          signed: 0,
          failed: count,
          total: count,
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
    loadSignFailedByDimension("provider_type", w.gte),
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
    const failedMap = results[i * 3 + 1] as Map<string | null, number>;
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

    for (const [rawKey, count] of failedMap) {
      // provider_type is non-nullable in fastauth_sign_events; the join will
      // never yield null for this dimension, but the helper's signature is
      // generic so coerce defensively.
      if (rawKey === null) continue;
      const stats = map.get(rawKey);
      if (stats) {
        stats.failed = count;
        stats.signed = Math.max(0, stats.total - count);
      } else {
        allKeys.add(rawKey);
        map.set(rawKey, {
          signed: 0,
          failed: count,
          total: count,
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

async function loadRelayerBreakdownByActivity(
  last24h: Date,
  last7d: Date,
  last30d: Date,
): Promise<RelayerActivityItem[]> {
  // Same shape as loadProviderBreakdown but grouped by the relayer account
  // that called fast-auth.near.sign() (sign event signer). Today there's
  // typically one relayer (sweat-relayer.near); the query is future-proof.
  const windows: Array<{ key: "last24h" | "last7d" | "last30d"; gte: Date }> = [
    { key: "last24h", gte: last24h },
    { key: "last7d", gte: last7d },
    { key: "last30d", gte: last30d },
  ];

  const queries = windows.flatMap((w) => [
    prisma.fastAuthSignEvent.groupBy({
      by: ["relayerAccountId"],
      where: { blockTimestamp: { gte: w.gte } },
      _count: { id: true },
    }),
    loadSignFailedByDimension("relayer_account_id", w.gte),
    prisma.fastAuthSignEvent.findMany({
      where: {
        blockTimestamp: { gte: w.gte },
        userDerivedPublicKey: { not: null },
      },
      distinct: ["relayerAccountId", "userDerivedPublicKey"],
      select: { relayerAccountId: true },
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
      relayerAccountId: string;
      _count: { id: number };
    }>;
    const failedMap = results[i * 3 + 1] as Map<string | null, number>;
    const distinctRows = results[i * 3 + 2] as Array<{ relayerAccountId: string }>;

    const map = new Map<string, GuardWindowStats>();

    for (const row of totalRows) {
      allKeys.add(row.relayerAccountId);
      map.set(row.relayerAccountId, {
        signed: row._count.id,
        failed: 0,
        total: row._count.id,
        distinctUsers: 0,
        successRatePct: null,
      });
    }

    for (const [rawKey, count] of failedMap) {
      // relayer_account_id is non-nullable in fastauth_sign_events.
      if (rawKey === null) continue;
      const stats = map.get(rawKey);
      if (stats) {
        stats.failed = count;
        stats.signed = Math.max(0, stats.total - count);
      } else {
        allKeys.add(rawKey);
        map.set(rawKey, {
          signed: 0,
          failed: count,
          total: count,
          distinctUsers: 0,
          successRatePct: null,
        });
      }
    }

    const distinctCounts = new Map<string, number>();
    for (const row of distinctRows) {
      distinctCounts.set(
        row.relayerAccountId,
        (distinctCounts.get(row.relayerAccountId) ?? 0) + 1,
      );
    }
    for (const [accountId, count] of distinctCounts) {
      const stats = map.get(accountId);
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
    .map((relayerAccountId) => ({
      relayerAccountId,
      last24h: perWindow.get("last24h")?.get(relayerAccountId) ?? { ...emptyStats },
      last7d: perWindow.get("last7d")?.get(relayerAccountId) ?? { ...emptyStats },
      last30d: perWindow.get("last30d")?.get(relayerAccountId) ?? { ...emptyStats },
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
  // Failures sourced from fastauth_consumer_health_tx (per-tx receipt-walk
  // classification), not from the chunk-level failure_reason on
  // fastauth_consumer_transactions. The chunk-level field only catches
  // conversion failures; downstream receipt panics need the health table.
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
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last24h}) AS total_24h,
      COUNT(*) FILTER (WHERE h.outcome = 'failure') AS failed_all,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last30d}) AS failed_30d,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last7d}) AS failed_7d,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last24h}) AS failed_24h
    FROM fastauth_consumer_transactions ct
    LEFT JOIN fastauth_consumer_health_tx h ON h.tx_hash = ct.tx_hash
  `;

  // Group by reason "kind" — the prefix before the first colon — so payload
  // variants (account_id, amounts, nonces) collapse into the underlying error
  // class. e.g. "LackBalanceForState: {...}" + "LackBalanceForState: {other}"
  // both bucket as "LackBalanceForState". Ungrouped raw reasons would scatter
  // every distinct payload into its own row.
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
      SPLIT_PART(failure_reason, ':', 1) AS reason,
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last24h}) AS total_24h
    FROM fastauth_consumer_health_tx
    WHERE outcome = 'failure' AND failure_reason IS NOT NULL
    GROUP BY SPLIT_PART(failure_reason, ':', 1)
    ORDER BY total_all DESC
    LIMIT 50
  `;

  // Per-relayer is a direct group by; per-guard / per-provider need to JOIN
  // through linked_sign_event_id (so unlinked consumer txs are excluded
  // from those slices). Each query produces totals + failures per window
  // in a single round-trip.
  const relayerRows = await prisma.$queryRaw<
    Array<{
      key: string | null;
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
      ct.outer_signer_id AS key,
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last24h}) AS total_24h,
      COUNT(*) FILTER (WHERE h.outcome = 'failure') AS failed_all,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last30d}) AS failed_30d,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last7d}) AS failed_7d,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last24h}) AS failed_24h
    FROM fastauth_consumer_transactions ct
    LEFT JOIN fastauth_consumer_health_tx h ON h.tx_hash = ct.tx_hash
    GROUP BY ct.outer_signer_id
    ORDER BY total_all DESC
  `;

  const guardRows = await prisma.$queryRaw<
    Array<{
      key: string | null;
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
      se.guard_name AS key,
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last24h}) AS total_24h,
      COUNT(*) FILTER (WHERE h.outcome = 'failure') AS failed_all,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last30d}) AS failed_30d,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last7d}) AS failed_7d,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last24h}) AS failed_24h
    FROM fastauth_consumer_transactions ct
    LEFT JOIN fastauth_sign_events se ON se.id = ct.linked_sign_event_id
    LEFT JOIN fastauth_consumer_health_tx h ON h.tx_hash = ct.tx_hash
    GROUP BY se.guard_name
    ORDER BY total_all DESC
  `;

  const actionTypeRows = await prisma.$queryRaw<
    Array<{
      key: string | null;
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
      array_to_string(ct.inner_action_types, '+') AS key,
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last24h}) AS total_24h,
      COUNT(*) FILTER (WHERE h.outcome = 'failure') AS failed_all,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last30d}) AS failed_30d,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last7d}) AS failed_7d,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last24h}) AS failed_24h
    FROM fastauth_consumer_transactions ct
    LEFT JOIN fastauth_consumer_health_tx h ON h.tx_hash = ct.tx_hash
    GROUP BY array_to_string(ct.inner_action_types, '+')
    ORDER BY total_all DESC
  `;

  const providerRows = await prisma.$queryRaw<
    Array<{
      key: string | null;
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
      se.provider_type AS key,
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE ct.block_timestamp >= ${last24h}) AS total_24h,
      COUNT(*) FILTER (WHERE h.outcome = 'failure') AS failed_all,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last30d}) AS failed_30d,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last7d}) AS failed_7d,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND ct.block_timestamp >= ${last24h}) AS failed_24h
    FROM fastauth_consumer_transactions ct
    LEFT JOIN fastauth_sign_events se ON se.id = ct.linked_sign_event_id
    LEFT JOIN fastauth_consumer_health_tx h ON h.tx_hash = ct.tx_hash
    GROUP BY se.provider_type
    ORDER BY total_all DESC
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

  type GroupRow = {
    key: string | null;
    total_all: bigint;
    total_30d: bigint;
    total_7d: bigint;
    total_24h: bigint;
    failed_all: bigint;
    failed_30d: bigint;
    failed_7d: bigint;
    failed_24h: bigint;
  };

  const buildGroup = (rows: GroupRow[], unlinkedLabel: string): ConsumerOutcomesGroup[] =>
    rows.map((row) => ({
      key: row.key ?? unlinkedLabel,
      byWindow: {
        last24h: buildWindow(row.total_24h, row.failed_24h),
        last7d: buildWindow(row.total_7d, row.failed_7d),
        last30d: buildWindow(row.total_30d, row.failed_30d),
        all: buildWindow(row.total_all, row.failed_all),
      },
    }));

  const firstConsumer = await prisma.fastAuthConsumerTransaction.findFirst({
    orderBy: { blockTimestamp: "asc" },
    select: { blockHeight: true, blockTimestamp: true },
  });

  return {
    byWindow: {
      last24h: buildWindow(windowsRow?.total_24h ?? BigInt(0), windowsRow?.failed_24h ?? BigInt(0)),
      last7d: buildWindow(windowsRow?.total_7d ?? BigInt(0), windowsRow?.failed_7d ?? BigInt(0)),
      last30d: buildWindow(windowsRow?.total_30d ?? BigInt(0), windowsRow?.failed_30d ?? BigInt(0)),
      all: buildWindow(windowsRow?.total_all ?? BigInt(0), windowsRow?.failed_all ?? BigInt(0)),
    },
    byRelayer: buildGroup(relayerRows, "(unknown)"),
    byGuard: buildGroup(guardRows, "(unlinked)"),
    byProvider: buildGroup(providerRows, "(unlinked)"),
    byActionType: buildGroup(actionTypeRows, "(empty)"),
    topFailureReasons: reasonRows.map((r) => ({
      reason: r.reason ?? "(unknown)",
      last24h: Number(r.total_24h),
      last7d: Number(r.total_7d),
      last30d: Number(r.total_30d),
      all: Number(r.total_all),
    })),
    trackingStartedAt: firstConsumer
      ? {
          blockHeight: firstConsumer.blockHeight.toString(),
          blockTimestamp: firstConsumer.blockTimestamp,
        }
      : null,
  };
}

async function loadRealActivity(
  last24h: Date,
  last7d: Date,
  last30d: Date,
): Promise<RealActivity> {
  // Per-window totals + success/fail + distinct users (signer accounts).
  // Failures sourced from fastauth_user_health_tx (per-tx receipt-walk),
  // not the chunk-level failure_reason on fastauth_user_transactions.
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
      users_all: bigint;
      users_30d: bigint;
      users_7d: bigint;
      users_24h: bigint;
      vol_all: string | null;
      vol_30d: string | null;
      vol_7d: string | null;
      vol_24h: string | null;
    }>
  >`
    SELECT
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE u.block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE u.block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE u.block_timestamp >= ${last24h}) AS total_24h,
      COUNT(*) FILTER (WHERE h.outcome = 'failure') AS failed_all,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND u.block_timestamp >= ${last30d}) AS failed_30d,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND u.block_timestamp >= ${last7d}) AS failed_7d,
      COUNT(*) FILTER (WHERE h.outcome = 'failure' AND u.block_timestamp >= ${last24h}) AS failed_24h,
      COUNT(DISTINCT u.signer_account_id) AS users_all,
      COUNT(DISTINCT u.signer_account_id) FILTER (WHERE u.block_timestamp >= ${last30d}) AS users_30d,
      COUNT(DISTINCT u.signer_account_id) FILTER (WHERE u.block_timestamp >= ${last7d}) AS users_7d,
      COUNT(DISTINCT u.signer_account_id) FILTER (WHERE u.block_timestamp >= ${last24h}) AS users_24h,
      COALESCE(SUM(u.value_usd), 0)::text AS vol_all,
      COALESCE(SUM(u.value_usd) FILTER (WHERE u.block_timestamp >= ${last30d}), 0)::text AS vol_30d,
      COALESCE(SUM(u.value_usd) FILTER (WHERE u.block_timestamp >= ${last7d}), 0)::text AS vol_7d,
      COALESCE(SUM(u.value_usd) FILTER (WHERE u.block_timestamp >= ${last24h}), 0)::text AS vol_24h
    FROM fastauth_user_transactions u
    LEFT JOIN fastauth_user_health_tx h ON h.tx_hash = u.tx_hash
  `;

  const receiverRows = await prisma.$queryRaw<
    Array<{
      receiver: string | null;
      total_all: bigint;
      total_30d: bigint;
      total_7d: bigint;
      total_24h: bigint;
      vol_all: string | null;
    }>
  >`
    SELECT
      receiver_id AS receiver,
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last24h}) AS total_24h,
      COALESCE(SUM(value_usd), 0)::text AS vol_all
    FROM fastauth_user_transactions
    GROUP BY receiver_id
    ORDER BY total_all DESC
    LIMIT 20
  `;

  const methodRows = await prisma.$queryRaw<
    Array<{
      method: string | null;
      total_all: bigint;
      total_30d: bigint;
      total_7d: bigint;
      total_24h: bigint;
      vol_all: string | null;
    }>
  >`
    -- For non-FunctionCall txs (AddKey, DeleteKey, Transfer) method_name is
    -- NULL; fall back to the joined action_types so the panel surfaces what
    -- the tx actually did instead of a "(no method)" bucket. Formatter on
    -- the client collapses repeats (e.g. "DeleteKey+DeleteKey" → "Batch(DeleteKey×2)").
    SELECT
      COALESCE(method_name, NULLIF(array_to_string(action_types, '+'), '')) AS method,
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last24h}) AS total_24h,
      COALESCE(SUM(value_usd), 0)::text AS vol_all
    FROM fastauth_user_transactions
    GROUP BY COALESCE(method_name, NULLIF(array_to_string(action_types, '+'), ''))
    ORDER BY total_all DESC
    LIMIT 20
  `;

  // Account → classification, picking the account's most-recent sign event.
  // Reused below for all three account-attributed groupings (relayer /
  // provider / guard) so each user_tx row maps to one classification.
  const accountClassificationCte = Prisma.sql`
    WITH account_class AS (
      SELECT DISTINCT ON (user_account_id)
        user_account_id,
        relayer_account_id,
        provider_type,
        guard_name
      FROM fastauth_sign_events
      WHERE user_account_id IS NOT NULL
      ORDER BY user_account_id, block_timestamp DESC
    )
  `;

  const buildClassGroupQuery = (
    classCol: "relayer_account_id" | "provider_type" | "guard_name",
  ) => Prisma.sql`
    ${accountClassificationCte}
    SELECT
      COALESCE(ac.${Prisma.raw(classCol)}, '(unclassified)') AS key,
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE t.block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE t.block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE t.block_timestamp >= ${last24h}) AS total_24h,
      COALESCE(SUM(t.value_usd), 0)::text AS vol_all
    FROM fastauth_user_transactions t
    LEFT JOIN account_class ac ON ac.user_account_id = t.signer_account_id
    GROUP BY COALESCE(ac.${Prisma.raw(classCol)}, '(unclassified)')
    ORDER BY total_all DESC
  `;

  type ClassGroupRow = {
    key: string | null;
    total_all: bigint;
    total_30d: bigint;
    total_7d: bigint;
    total_24h: bigint;
    vol_all: string | null;
  };

  // Cross-classification query: groups user txs by (classification, inner)
  // pair, where classification is the account's relayer/provider/guard
  // and inner is the user tx's receiver_id or method_name. For the method
  // dimension specifically, we fall back to the joined action_types when
  // method_name is NULL (AddKey/DeleteKey/Transfer txs have no method
  // call) so the panel surfaces a meaningful action label rather than
  // "(none)". Client formatter collapses repeats.
  const buildCrossQuery = (
    classCol: "relayer_account_id" | "provider_type" | "guard_name",
    innerCol: "receiver_id" | "method_name",
  ) => {
    const innerExpr =
      innerCol === "method_name"
        ? Prisma.sql`COALESCE(t.method_name, NULLIF(array_to_string(t.action_types, '+'), ''), '(none)')`
        : Prisma.sql`COALESCE(t.${Prisma.raw(innerCol)}, '(none)')`;

    return Prisma.sql`
      ${accountClassificationCte}
      SELECT
        COALESCE(ac.${Prisma.raw(classCol)}, '(unclassified)') AS class_key,
        ${innerExpr} AS inner_key,
        COUNT(*) AS total_all,
        COUNT(*) FILTER (WHERE t.block_timestamp >= ${last30d}) AS total_30d,
        COUNT(*) FILTER (WHERE t.block_timestamp >= ${last7d}) AS total_7d,
        COUNT(*) FILTER (WHERE t.block_timestamp >= ${last24h}) AS total_24h,
        COALESCE(SUM(t.value_usd), 0)::text AS vol_all
      FROM fastauth_user_transactions t
      LEFT JOIN account_class ac ON ac.user_account_id = t.signer_account_id
      GROUP BY
        COALESCE(ac.${Prisma.raw(classCol)}, '(unclassified)'),
        ${innerExpr}
      ORDER BY total_all DESC
      LIMIT 200
    `;
  };

  type CrossRow = {
    class_key: string;
    inner_key: string;
    total_all: bigint;
    total_30d: bigint;
    total_7d: bigint;
    total_24h: bigint;
    vol_all: string | null;
  };

  const [
    relayerClassRows,
    providerClassRows,
    guardClassRows,
    relayerReceiverRows,
    relayerMethodRows,
    providerReceiverRows,
    providerMethodRows,
    guardReceiverRows,
    guardMethodRows,
  ] = await Promise.all([
    prisma.$queryRaw<ClassGroupRow[]>(buildClassGroupQuery("relayer_account_id")),
    prisma.$queryRaw<ClassGroupRow[]>(buildClassGroupQuery("provider_type")),
    prisma.$queryRaw<ClassGroupRow[]>(buildClassGroupQuery("guard_name")),
    prisma.$queryRaw<CrossRow[]>(buildCrossQuery("relayer_account_id", "receiver_id")),
    prisma.$queryRaw<CrossRow[]>(buildCrossQuery("relayer_account_id", "method_name")),
    prisma.$queryRaw<CrossRow[]>(buildCrossQuery("provider_type", "receiver_id")),
    prisma.$queryRaw<CrossRow[]>(buildCrossQuery("provider_type", "method_name")),
    prisma.$queryRaw<CrossRow[]>(buildCrossQuery("guard_name", "receiver_id")),
    prisma.$queryRaw<CrossRow[]>(buildCrossQuery("guard_name", "method_name")),
  ]);

  const classGroupToRows = (rows: ClassGroupRow[]): RealActivityGroupRow[] =>
    rows.map((r) => ({
      key: r.key ?? "(unclassified)",
      last24h: Number(r.total_24h),
      last7d: Number(r.total_7d),
      last30d: Number(r.total_30d),
      all: Number(r.total_all),
      volumeUsdAll: r.vol_all ? Number(r.vol_all) : 0,
    }));

  const crossToRows = (rows: CrossRow[]): RealActivityCrossRow[] =>
    rows.map((r) => ({
      classKey: r.class_key,
      innerKey: r.inner_key,
      last24h: Number(r.total_24h),
      last7d: Number(r.total_7d),
      last30d: Number(r.total_30d),
      all: Number(r.total_all),
      volumeUsdAll: r.vol_all ? Number(r.vol_all) : 0,
    }));

  const firstUserTx = await prisma.fastAuthUserTransaction.findFirst({
    orderBy: { blockTimestamp: "asc" },
    select: { blockHeight: true, blockTimestamp: true },
  });

  // Top failure reason kinds, grouped by the prefix before the first colon
  // (so payload variants collapse into the underlying error class).
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
      SPLIT_PART(failure_reason, ':', 1) AS reason,
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last30d}) AS total_30d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last7d}) AS total_7d,
      COUNT(*) FILTER (WHERE block_timestamp >= ${last24h}) AS total_24h
    FROM fastauth_user_health_tx
    WHERE outcome = 'failure' AND failure_reason IS NOT NULL
    GROUP BY SPLIT_PART(failure_reason, ':', 1)
    ORDER BY total_all DESC
    LIMIT 50
  `;

  const buildWindow = (
    total: bigint,
    failed: bigint,
    distinctUsers: bigint,
    volumeUsd: string | null,
  ): RealActivityWindow => {
    const totalNum = Number(total);
    const failedNum = Number(failed);
    const succeeded = Math.max(0, totalNum - failedNum);
    return {
      total: totalNum,
      succeeded,
      failed: failedNum,
      successRatePct: totalNum > 0 ? Math.round((succeeded / totalNum) * 1000) / 10 : null,
      distinctUsers: Number(distinctUsers),
      volumeUsd: volumeUsd ? Number(volumeUsd) : 0,
    };
  };

  return {
    byWindow: {
      last24h: buildWindow(
        windowsRow?.total_24h ?? BigInt(0),
        windowsRow?.failed_24h ?? BigInt(0),
        windowsRow?.users_24h ?? BigInt(0),
        windowsRow?.vol_24h ?? null,
      ),
      last7d: buildWindow(
        windowsRow?.total_7d ?? BigInt(0),
        windowsRow?.failed_7d ?? BigInt(0),
        windowsRow?.users_7d ?? BigInt(0),
        windowsRow?.vol_7d ?? null,
      ),
      last30d: buildWindow(
        windowsRow?.total_30d ?? BigInt(0),
        windowsRow?.failed_30d ?? BigInt(0),
        windowsRow?.users_30d ?? BigInt(0),
        windowsRow?.vol_30d ?? null,
      ),
      all: buildWindow(
        windowsRow?.total_all ?? BigInt(0),
        windowsRow?.failed_all ?? BigInt(0),
        windowsRow?.users_all ?? BigInt(0),
        windowsRow?.vol_all ?? null,
      ),
    },
    byReceiver: receiverRows.map((r) => ({
      key: r.receiver ?? "(unknown)",
      last24h: Number(r.total_24h),
      last7d: Number(r.total_7d),
      last30d: Number(r.total_30d),
      all: Number(r.total_all),
      volumeUsdAll: r.vol_all ? Number(r.vol_all) : 0,
    })),
    byMethod: methodRows.map((r) => ({
      key: r.method ?? "(no method)",
      last24h: Number(r.total_24h),
      last7d: Number(r.total_7d),
      last30d: Number(r.total_30d),
      all: Number(r.total_all),
      volumeUsdAll: r.vol_all ? Number(r.vol_all) : 0,
    })),
    byRelayer: {
      overall: classGroupToRows(relayerClassRows),
      byReceiver: crossToRows(relayerReceiverRows),
      byMethod: crossToRows(relayerMethodRows),
    },
    byProvider: {
      overall: classGroupToRows(providerClassRows),
      byReceiver: crossToRows(providerReceiverRows),
      byMethod: crossToRows(providerMethodRows),
    },
    byGuard: {
      overall: classGroupToRows(guardClassRows),
      byReceiver: crossToRows(guardReceiverRows),
      byMethod: crossToRows(guardMethodRows),
    },
    topFailureReasons: reasonRows.map((r) => ({
      reason: r.reason ?? "(unknown)",
      last24h: Number(r.total_24h),
      last7d: Number(r.total_7d),
      last30d: Number(r.total_30d),
      all: Number(r.total_all),
    })),
    trackingStartedAt: firstUserTx
      ? {
          blockHeight: firstUserTx.blockHeight.toString(),
          blockTimestamp: firstUserTx.blockTimestamp,
        }
      : null,
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

type SignOutcomeCounts = {
  failed24h: number;
  failed7d: number;
  failed30d: number;
  failedAll: number;
  pending24h: number;
  pending7d: number;
  pending30d: number;
  pendingAll: number;
};

// Per-window counts of sign events whose underlying tx is classified as a
// failure or as still rpc_pending in fastauth_health_tx. Inner-joins drop
// sign events without a health row — those count as "signed" by exclusion,
// which is correct: until classified, we don't know if they failed.
async function loadSignOutcomeCounts(
  last24h: Date,
  last7d: Date,
  last30d: Date,
): Promise<SignOutcomeCounts> {
  const [row] = await prisma.$queryRaw<
    Array<{
      failed_24h: bigint;
      failed_7d: bigint;
      failed_30d: bigint;
      failed_all: bigint;
      pending_24h: bigint;
      pending_7d: bigint;
      pending_30d: bigint;
      pending_all: bigint;
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE se.block_timestamp >= ${last24h} AND h.outcome IN ('guard_failure','mpc_failure','other_failure')) AS failed_24h,
      COUNT(*) FILTER (WHERE se.block_timestamp >= ${last7d}  AND h.outcome IN ('guard_failure','mpc_failure','other_failure')) AS failed_7d,
      COUNT(*) FILTER (WHERE se.block_timestamp >= ${last30d} AND h.outcome IN ('guard_failure','mpc_failure','other_failure')) AS failed_30d,
      COUNT(*) FILTER (WHERE h.outcome IN ('guard_failure','mpc_failure','other_failure')) AS failed_all,
      COUNT(*) FILTER (WHERE se.block_timestamp >= ${last24h} AND h.outcome = 'rpc_pending') AS pending_24h,
      COUNT(*) FILTER (WHERE se.block_timestamp >= ${last7d}  AND h.outcome = 'rpc_pending') AS pending_7d,
      COUNT(*) FILTER (WHERE se.block_timestamp >= ${last30d} AND h.outcome = 'rpc_pending') AS pending_30d,
      COUNT(*) FILTER (WHERE h.outcome = 'rpc_pending') AS pending_all
    FROM fastauth_sign_events se
    INNER JOIN fastauth_health_tx h ON h.tx_hash = se.tx_hash
  `;
  return {
    failed24h: Number(row?.failed_24h ?? BigInt(0)),
    failed7d: Number(row?.failed_7d ?? BigInt(0)),
    failed30d: Number(row?.failed_30d ?? BigInt(0)),
    failedAll: Number(row?.failed_all ?? BigInt(0)),
    pending24h: Number(row?.pending_24h ?? BigInt(0)),
    pending7d: Number(row?.pending_7d ?? BigInt(0)),
    pending30d: Number(row?.pending_30d ?? BigInt(0)),
    pendingAll: Number(row?.pending_all ?? BigInt(0)),
  };
}

// Per-dimension failed sign-event counts via JOIN to fastauth_health_tx.
// Used by the guard / provider / relayer breakdowns to surface accurate
// "failed" columns sourced from the per-tx classifier rather than the
// chunk-level executionStatus.
async function loadSignFailedByDimension(
  dimensionColumn: "guard_name" | "provider_type" | "relayer_account_id",
  since: Date,
): Promise<Map<string | null, number>> {
  const rows = await prisma.$queryRaw<
    Array<{ key: string | null; cnt: bigint }>
  >`
    SELECT se.${Prisma.raw(dimensionColumn)} AS key, COUNT(*) AS cnt
    FROM fastauth_sign_events se
    INNER JOIN fastauth_health_tx h ON h.tx_hash = se.tx_hash
    WHERE se.block_timestamp >= ${since}
      AND h.outcome IN ('guard_failure','mpc_failure','other_failure')
    GROUP BY se.${Prisma.raw(dimensionColumn)}
  `;
  const result = new Map<string | null, number>();
  for (const row of rows) {
    result.set(row.key, Number(row.cnt));
  }
  return result;
}

async function loadChainHealth(
  now: Date,
  last24h: Date,
): Promise<{
  fastAuthChainHealth: FastAuthChainHealth | null;
  mpcChainHealth: MpcChainHealth | null;
  chainHealthHistory: ChainHealthHistoryPoint[];
}> {
  const [aggRow] = await prisma.$queryRaw<
    Array<{
      total: bigint;
      succeeded: bigint;
      failed: bigint;
      guard_failed: bigint;
      mpc_failed: bigint;
      pending: bigint;
      mpc_attempted: bigint;
      min_block_height: bigint | null;
      max_block_height: bigint | null;
      distinct_relayers: bigint;
    }>
  >`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE outcome = 'success') AS succeeded,
      COUNT(*) FILTER (WHERE outcome IN ('guard_failure','mpc_failure','other_failure')) AS failed,
      COUNT(*) FILTER (WHERE outcome = 'guard_failure') AS guard_failed,
      COUNT(*) FILTER (WHERE outcome = 'mpc_failure') AS mpc_failed,
      COUNT(*) FILTER (WHERE outcome = 'rpc_pending') AS pending,
      COUNT(*) FILTER (WHERE reached_mpc = true) AS mpc_attempted,
      MIN(block_height) AS min_block_height,
      MAX(block_height) AS max_block_height,
      COUNT(DISTINCT signer_id) AS distinct_relayers
    FROM fastauth_health_tx
    WHERE block_timestamp >= ${last24h}
  `;

  // Last successful tx, all-time. Lets the Fast Auth status card surface
  // "minutes since last success" even if the 24h window is dry.
  const [lastSuccess] = await prisma.$queryRaw<
    Array<{ block_timestamp: Date; tx_hash: string }>
  >`
    SELECT block_timestamp, tx_hash
    FROM fastauth_health_tx
    WHERE outcome = 'success'
    ORDER BY block_timestamp DESC
    LIMIT 1
  `;

  // Last 5 failures across all classes (guard / mpc / other) for triage.
  // Not bounded by the 24h window — if it's been quiet, we still want to
  // show the most recent failures regardless of age.
  const recentFastAuthFailures = await prisma.fastAuthHealthTx.findMany({
    where: { outcome: { in: ["guard_failure", "mpc_failure", "other_failure"] } },
    orderBy: { blockTimestamp: "desc" },
    take: 5,
    select: {
      txHash: true,
      blockTimestamp: true,
      outcome: true,
      failingExecutorId: true,
      failureReason: true,
    },
  });
  const recentMpcFailures = await prisma.fastAuthHealthTx.findMany({
    where: { outcome: "mpc_failure" },
    orderBy: { blockTimestamp: "desc" },
    take: 5,
    select: {
      txHash: true,
      blockTimestamp: true,
      outcome: true,
      failingExecutorId: true,
      failureReason: true,
    },
  });

  // 15-minute bins padded with generate_series so the sparkline always has
  // exactly 96 segments per 24h. Empty bins (no FA traffic) come back with
  // total = 0 and render as "idle" in the bar — distinct from healthy/failed.
  // date_bin (Postgres 14+) snaps to the reference epoch for stable boundaries
  // independent of when "now" is.
  const historyRows = await prisma.$queryRaw<
    Array<{
      bucket: Date;
      total: bigint;
      classified: bigint;
      succeeded: bigint;
      failed: bigint;
      mpc_attempted: bigint;
      mpc_failed: bigint;
    }>
  >`
    WITH bins AS (
      SELECT generate_series(
        date_bin('15 minutes', ${last24h}::timestamp, TIMESTAMP '2000-01-01'),
        date_bin('15 minutes', NOW()::timestamp, TIMESTAMP '2000-01-01'),
        interval '15 minutes'
      ) AS bucket
    )
    SELECT
      b.bucket,
      COUNT(h.tx_hash) AS total,
      COUNT(h.tx_hash) FILTER (WHERE h.outcome != 'rpc_pending') AS classified,
      COUNT(h.tx_hash) FILTER (WHERE h.outcome = 'success') AS succeeded,
      COUNT(h.tx_hash) FILTER (WHERE h.outcome IN ('guard_failure','mpc_failure','other_failure')) AS failed,
      COUNT(h.tx_hash) FILTER (WHERE h.reached_mpc = true) AS mpc_attempted,
      COUNT(h.tx_hash) FILTER (WHERE h.outcome = 'mpc_failure') AS mpc_failed
    FROM bins b
    LEFT JOIN fastauth_health_tx h
      ON date_bin('15 minutes', h.block_timestamp, TIMESTAMP '2000-01-01') = b.bucket
    GROUP BY b.bucket
    ORDER BY b.bucket ASC
  `;

  const total = Number(aggRow?.total ?? BigInt(0));
  const succeeded = Number(aggRow?.succeeded ?? BigInt(0));
  const failed = Number(aggRow?.failed ?? BigInt(0));
  const guardFailed = Number(aggRow?.guard_failed ?? BigInt(0));
  const mpcFailed = Number(aggRow?.mpc_failed ?? BigInt(0));
  const pending = Number(aggRow?.pending ?? BigInt(0));
  const mpcAttempted = Number(aggRow?.mpc_attempted ?? BigInt(0));
  const minBlock = aggRow?.min_block_height ?? null;
  const maxBlock = aggRow?.max_block_height ?? null;
  const distinctRelayers = Number(aggRow?.distinct_relayers ?? BigInt(0));

  // Denominator for success rates excludes pending — pending is its own
  // bucket reported separately, not a hidden penalty against MPC/FA.
  const classified = total - pending;

  const fastAuthChainHealth: FastAuthChainHealth | null =
    total === 0 && !lastSuccess
      ? null
      : {
          computedAt: now,
          chainHead: maxBlock !== null ? maxBlock.toString() : "0",
          windowStartHeight: minBlock !== null ? minBlock.toString() : "0",
          windowEndHeight: maxBlock !== null ? maxBlock.toString() : "0",
          windowBlocks:
            minBlock !== null && maxBlock !== null
              ? Number(maxBlock - minBlock + BigInt(1))
              : 0,
          totalTransactions: total,
          successfulTransactions: succeeded,
          failedTransactions: failed,
          guardFailedTransactions: guardFailed,
          rpcPendingTransactions: pending,
          successRatePct:
            classified > 0
              ? Math.round((succeeded / classified) * 1000) / 10
              : null,
          distinctRelayers,
          lastSuccessTimestamp: lastSuccess?.block_timestamp ?? null,
          lastSuccessTxHash: lastSuccess?.tx_hash ?? null,
          minutesSinceLastSuccess: lastSuccess
            ? Math.max(
                0,
                Math.floor(
                  (now.getTime() - lastSuccess.block_timestamp.getTime()) /
                    60_000,
                ),
              )
            : null,
          recentFailures: recentFastAuthFailures,
        };

  const mpcSucceeded = Math.max(0, mpcAttempted - mpcFailed);
  const mpcChainHealth: MpcChainHealth | null =
    total === 0
      ? null
      : {
          computedAt: now,
          attemptedTransactions: mpcAttempted,
          failedTransactions: mpcFailed,
          successfulTransactions: mpcSucceeded,
          rpcPendingTransactions: pending,
          successRatePct:
            mpcAttempted > 0
              ? Math.round((mpcSucceeded / mpcAttempted) * 1000) / 10
              : null,
          recentFailures: recentMpcFailures,
        };

  const chainHealthHistory: ChainHealthHistoryPoint[] = historyRows.map(
    (row) => {
      const t = Number(row.total);
      const c = Number(row.classified);
      const s = Number(row.succeeded);
      const ma = Number(row.mpc_attempted);
      const mf = Number(row.mpc_failed);
      // Denominator is classified-only (excludes rpc_pending), matching the
      // live cards. A bin where every tx is still pending will yield null
      // and render as no_data, not "stale".
      return {
        computedAt: row.bucket,
        totalTransactions: t,
        fastAuthSuccessRatePct: c > 0 ? Math.round((s / c) * 1000) / 10 : null,
        mpcAttempted: ma,
        mpcFailed: mf,
        mpcSuccessRatePct:
          ma > 0 ? Math.round(((ma - mf) / ma) * 1000) / 10 : null,
      };
    },
  );

  return { fastAuthChainHealth, mpcChainHealth, chainHealthHistory };
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

const MPC_LIVENESS_BUCKET_HOURS = 1;
const MPC_LIVENESS_LOOKBACK_HOURS = 24;
const MPC_PENDING_LOOKBACK_MIN = 60;
// Sub-minute pending is normal MPC propagation (yield→quorum→resume),
// not a stuck request. Only surface entries that have aged past this.
const MPC_PENDING_MIN_AGE_SEC = 60;
const MPC_PENDING_LIMIT = 20;
const MPC_GOVERNANCE_RECENT_LIMIT = 50;

const FASTAUTH_CONTRACT_LABELS: Record<string, { label: string; description: string }> = {
  "fast-auth.near": {
    label: "FastAuth",
    description: "Main entry point. Verifies JWTs (via guards) and forwards signing to v1.signer.",
  },
  "jwt.fast-auth.near": {
    label: "JWT Guard Router",
    description: "Routes JWT verification to the appropriate guard contract.",
  },
  "auth0.jwt.fast-auth.near": {
    label: "Auth0 Guard",
    description: "Verifies Auth0-issued JWTs against owner-managed RSA public keys.",
  },
};

async function loadFastAuthContracts(): Promise<FastAuthContractsOverview> {
  const [rows, earliest] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        contract_id: string;
        snapshot_at: Date;
        balance_yocto: string | null;
        storage_usage: bigint | null;
        code_hash: string | null;
        full_access_keys: number | null;
        config_json: unknown;
        source_metadata_json: unknown;
      }>
    >`
      SELECT DISTINCT ON (contract_id)
        contract_id,
        snapshot_at,
        balance_yocto,
        storage_usage,
        code_hash,
        full_access_keys,
        config_json,
        source_metadata_json
      FROM fastauth_contract_snapshots
      ORDER BY contract_id, snapshot_at DESC
    `,
    prisma.fastAuthContractSnapshot.findFirst({
      orderBy: { snapshotAt: "asc" },
      select: { snapshotAt: true },
    }),
  ]);

  const contracts = rows.map((r) => {
    const meta = FASTAUTH_CONTRACT_LABELS[r.contract_id] ?? {
      label: r.contract_id,
      description: "",
    };
    const config =
      r.config_json && typeof r.config_json === "object" && !Array.isArray(r.config_json)
        ? (r.config_json as Record<string, unknown>)
        : {};
    const sourceMetadata =
      r.source_metadata_json &&
      typeof r.source_metadata_json === "object" &&
      !Array.isArray(r.source_metadata_json)
        ? (r.source_metadata_json as Record<string, unknown>)
        : null;
    return {
      contractId: r.contract_id,
      label: meta.label,
      description: meta.description,
      snapshotAt: r.snapshot_at,
      balanceYocto: r.balance_yocto,
      storageUsage: r.storage_usage,
      codeHash: r.code_hash,
      fullAccessKeys: r.full_access_keys,
      // "Locked" in NEARBlocks parlance = no full-access keys remaining.
      locked: r.full_access_keys === null ? null : r.full_access_keys === 0,
      config,
      sourceMetadata,
    };
  });

  return {
    contracts,
    earliestSnapshotAt: earliest?.snapshotAt ?? null,
  };
}

async function loadMpcNetworkOverview(now: Date, last24h: Date): Promise<MpcNetworkOverview> {
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const livenessLookback = new Date(now.getTime() - MPC_LIVENESS_LOOKBACK_HOURS * 60 * 60 * 1000);
  const pendingLookback = new Date(now.getTime() - MPC_PENDING_LOOKBACK_MIN * 60 * 1000);

  // The "Last 24h" KPIs depend on three forward-only tables. Until those
  // have 24h of history, picking last24h as the lower bound creates an
  // asymmetric window across sources (FastAuth-side from near_transactions
  // has 24h+, direct-side from mpc_transactions has only as much as we've
  // indexed). We anchor the comparison to the most-recent of (last24h,
  // earliest mpc_transaction) so numerator and denominator share a window.
  const earliestMpcTx = await prisma.mpcTransaction.findFirst({
    where: { blockTimestamp: { not: null } },
    orderBy: { blockTimestamp: "asc" },
    select: { blockTimestamp: true },
  });
  const earliestMpcTxMs = earliestMpcTx?.blockTimestamp?.getTime() ?? null;
  const windowStartMs = Math.max(
    last24h.getTime(),
    earliestMpcTxMs ?? last24h.getTime(),
  );
  const windowStart = new Date(windowStartMs);
  const windowHours = Math.max(
    1,
    Math.min(24, Math.ceil((now.getTime() - windowStartMs) / (60 * 60 * 1000))),
  );

  const [
    latencyRowsRaw,
    rosterRowsRaw,
    livenessRowsRaw,
    pendingRowsRaw,
    responsesWindowCountRow,
    signCountsRow,
    pendingCountRow,
    governanceRecentRowsRaw,
    governanceCategoryRowsRaw,
    governanceCodeHashDriftRowsRaw,
    earliestSignResponseRow,
    earliestSignRequestRow,
    earliestGovernanceEventRow,
  ] = await Promise.all([
    // Latency yield→resume per node, last 24h. JOIN on requestKey.
    prisma.$queryRaw<
      Array<{
        signer_id: string;
        responses: bigint;
        avg_latency_sec: number | null;
        p50_latency_sec: number | null;
        p95_latency_sec: number | null;
        p99_latency_sec: number | null;
      }>
    >`
      SELECT
        resp.signer_id,
        COUNT(*)::bigint AS responses,
        AVG(EXTRACT(EPOCH FROM (resp.block_timestamp - req.block_timestamp))) AS avg_latency_sec,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (resp.block_timestamp - req.block_timestamp))
        ) AS p50_latency_sec,
        PERCENTILE_CONT(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (resp.block_timestamp - req.block_timestamp))
        ) AS p95_latency_sec,
        PERCENTILE_CONT(0.99) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (resp.block_timestamp - req.block_timestamp))
        ) AS p99_latency_sec
      FROM mpc_sign_responses resp
      JOIN mpc_sign_requests req ON req.request_key = resp.request_key
      WHERE resp.block_timestamp >= ${last24h}
      GROUP BY resp.signer_id
      ORDER BY p50_latency_sec ASC NULLS LAST
    `,
    // Roster — windowed counts per node from mpc_sign_responses.
    prisma.$queryRaw<
      Array<{
        signer_id: string;
        first_seen: Date;
        last_seen: Date;
        responses_24h: bigint;
        responses_7d: bigint;
        responses_all: bigint;
      }>
    >`
      SELECT
        signer_id,
        MIN(block_timestamp) AS first_seen,
        MAX(block_timestamp) AS last_seen,
        COUNT(*) FILTER (WHERE block_timestamp >= ${last24h})::bigint AS responses_24h,
        COUNT(*) FILTER (WHERE block_timestamp >= ${last7d})::bigint AS responses_7d,
        COUNT(*)::bigint AS responses_all
      FROM mpc_sign_responses
      GROUP BY signer_id
      ORDER BY responses_24h DESC, last_seen DESC
    `,
    // Liveness buckets — count per (node, hour) over the last 24h.
    prisma.$queryRaw<
      Array<{ signer_id: string; bucket: Date; n: bigint }>
    >`
      SELECT
        signer_id,
        date_trunc('hour', block_timestamp) AS bucket,
        COUNT(*)::bigint AS n
      FROM mpc_sign_responses
      WHERE block_timestamp >= ${livenessLookback}
      GROUP BY signer_id, bucket
      ORDER BY signer_id, bucket
    `,
    // Pending sign requests — sign without matching respond, aged past
    // MPC_PENDING_MIN_AGE_SEC, within the last hour.
    prisma.$queryRaw<
      Array<{
        tx_hash: string;
        predecessor_id: string;
        scheme: string;
        path: string | null;
        source: string;
        traffic_source: string;
        block_timestamp: Date;
        pending_sec: number;
      }>
    >`
      SELECT
        req.tx_hash,
        req.predecessor_id,
        req.scheme,
        req.path,
        req.source,
        req.traffic_source,
        req.block_timestamp,
        EXTRACT(EPOCH FROM (NOW() - req.block_timestamp))::float8 AS pending_sec
      FROM mpc_sign_requests req
      LEFT JOIN mpc_sign_responses resp ON resp.request_key = req.request_key
      WHERE resp.tx_hash IS NULL
        AND req.block_timestamp >= ${pendingLookback}
        AND req.block_timestamp <= NOW() - (${MPC_PENDING_MIN_AGE_SEC} * INTERVAL '1 second')
      ORDER BY req.block_timestamp DESC
      LIMIT ${MPC_PENDING_LIMIT}
    `,
    prisma.mpcSignResponse.count({ where: { blockTimestamp: { gte: windowStart } } }),
    prisma.mpcSignRequest.groupBy({
      by: ["source", "trafficSource"],
      where: { blockTimestamp: { gte: windowStart } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n
      FROM mpc_sign_requests req
      LEFT JOIN mpc_sign_responses resp ON resp.request_key = req.request_key
      WHERE resp.tx_hash IS NULL
        AND req.block_timestamp >= ${pendingLookback}
        AND req.block_timestamp <= NOW() - (${MPC_PENDING_MIN_AGE_SEC} * INTERVAL '1 second')
    `,
    // Governance: recent events for the timeline.
    prisma.mpcConsensusEvent.findMany({
      orderBy: { blockTimestamp: "desc" },
      take: MPC_GOVERNANCE_RECENT_LIMIT,
      select: {
        txHash: true,
        blockTimestamp: true,
        eventType: true,
        category: true,
        actorId: true,
        payload: true,
      },
    }),
    // Governance: counts per category × time window.
    prisma.$queryRaw<
      Array<{ category: string; count_24h: bigint; count_7d: bigint; count_30d: bigint }>
    >`
      SELECT
        category,
        COUNT(*) FILTER (WHERE block_timestamp >= ${last24h})::bigint AS count_24h,
        COUNT(*) FILTER (WHERE block_timestamp >= ${last7d})::bigint AS count_7d,
        COUNT(*) FILTER (WHERE block_timestamp >= ${last30d})::bigint AS count_30d
      FROM mpc_consensus_events
      WHERE block_timestamp >= ${last30d}
      GROUP BY category
      ORDER BY count_30d DESC
    `,
    // Governance: latest vote_code_hash per actor — version-drift indicator.
    // If actors disagree on the latest hash, the network is mid-upgrade or
    // (more concerning) split.
    prisma.$queryRaw<
      Array<{ actor_id: string; payload: unknown; voted_at: Date }>
    >`
      SELECT DISTINCT ON (actor_id)
        actor_id,
        payload_json AS payload,
        block_timestamp AS voted_at
      FROM mpc_consensus_events
      WHERE event_type = 'vote_code_hash'
        AND block_timestamp >= ${last30d}
      ORDER BY actor_id, block_timestamp DESC
    `,
    // Earliest tracked timestamps — surfaced on the dashboard so users
    // know "data available since X". All three derived tables are
    // forward-only (the collector started after near.ts had already been
    // running).
    prisma.mpcSignResponse.findFirst({
      orderBy: { blockTimestamp: "asc" },
      select: { blockTimestamp: true },
    }),
    prisma.mpcSignRequest.findFirst({
      orderBy: { blockTimestamp: "asc" },
      select: { blockTimestamp: true },
    }),
    prisma.mpcConsensusEvent.findFirst({
      orderBy: { blockTimestamp: "asc" },
      select: { blockTimestamp: true },
    }),
  ]);

  const latencyByNode: MpcLatencyRow[] = latencyRowsRaw.map((r) => ({
    signerId: r.signer_id,
    responses: Number(r.responses),
    avgLatencySec: r.avg_latency_sec ?? 0,
    p50LatencySec: r.p50_latency_sec ?? 0,
    p95LatencySec: r.p95_latency_sec ?? 0,
    p99LatencySec: r.p99_latency_sec ?? 0,
  }));

  const roster: MpcRosterRow[] = rosterRowsRaw.map((r) => ({
    accountId: r.signer_id,
    firstSeenAt: r.first_seen,
    lastSeenAt: r.last_seen,
    responses24h: Number(r.responses_24h),
    responses7d: Number(r.responses_7d),
    responsesAll: Number(r.responses_all),
  }));

  // Project liveness rows into a fixed-width per-node series. We align
  // every node to the same bucket grid so the heatmap rows are comparable.
  const bucketCount = MPC_LIVENESS_LOOKBACK_HOURS;
  const livenessAnchorMs = livenessLookback.getTime();
  const bucketByAccount = new Map<string, number[]>();
  for (const row of livenessRowsRaw) {
    const key = row.signer_id;
    let series = bucketByAccount.get(key);
    if (!series) {
      series = new Array(bucketCount).fill(0);
      bucketByAccount.set(key, series);
    }
    const offsetHours = Math.floor(
      (row.bucket.getTime() - livenessAnchorMs) / (60 * 60 * 1000),
    );
    if (offsetHours >= 0 && offsetHours < bucketCount) {
      series[offsetHours] = Number(row.n);
    }
  }
  const liveness: MpcLivenessSeries[] = [...bucketByAccount.entries()]
    .map(([accountId, buckets]) => ({
      accountId,
      buckets,
      total: buckets.reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.total - a.total);

  const pending: MpcPendingRequest[] = pendingRowsRaw.map((r) => ({
    txHash: r.tx_hash,
    predecessorId: r.predecessor_id,
    scheme: r.scheme,
    path: r.path,
    source: r.source,
    trafficSource: r.traffic_source,
    blockTimestamp: r.block_timestamp,
    pendingSec: Number(r.pending_sec),
  }));

  let signsOrganic = 0;
  let signsSynthetic = 0;
  let signsByFastAuth = 0;
  let signsTotal = 0;
  for (const row of signCountsRow) {
    const n = row._count._all;
    signsTotal += n;
    if (row.trafficSource === "synthetic") signsSynthetic += n;
    else signsOrganic += n;
    if (row.source === "fastauth") signsByFastAuth += n;
  }

  // Build the governance overview. Try to extract a one-line summary from
  // the decoded JSON payload — picks up common cases (hashes, account
  // IDs, key versions). Falls back to "—" when nothing useful surfaces.
  const governanceRecent: MpcGovernanceEvent[] = governanceRecentRowsRaw.map((r) => ({
    txHash: r.txHash,
    blockTimestamp: r.blockTimestamp,
    eventType: r.eventType,
    category: r.category,
    actorId: r.actorId,
    payloadSummary: summarizeGovernancePayload(r.eventType, r.payload),
  }));

  let governanceTotal24h = 0;
  let governanceTotal7d = 0;
  const governanceByCategory: MpcGovernanceCategoryCount[] = governanceCategoryRowsRaw.map((r) => {
    const c24 = Number(r.count_24h);
    const c7 = Number(r.count_7d);
    governanceTotal24h += c24;
    governanceTotal7d += c7;
    return {
      category: r.category,
      count24h: c24,
      count7d: c7,
      count30d: Number(r.count_30d),
    };
  });

  const codeHashDrift: MpcVersionDriftRow[] = governanceCodeHashDriftRowsRaw
    .map((r) => {
      const fullHash = extractStringFromPayload(r.payload, ["code_hash", "hash"]) ?? "";
      return {
        actorId: r.actor_id,
        votedHashFull: fullHash,
        votedHashShort: fullHash ? `${fullHash.slice(0, 10)}…${fullHash.slice(-6)}` : "(unknown)",
        votedAt: r.voted_at,
      };
    })
    .sort((a, b) => a.actorId.localeCompare(b.actorId));

  return {
    windowHours,
    responses: responsesWindowCountRow,
    signsTotal,
    signsOrganic,
    signsSynthetic,
    signsByFastAuth,
    pendingCount: Number(pendingCountRow[0]?.n ?? 0),
    bucketHours: MPC_LIVENESS_BUCKET_HOURS,
    livenessAnchorMs: livenessLookback.getTime(),
    latencyByNode,
    liveness,
    roster,
    pending,
    governance: {
      total24h: governanceTotal24h,
      total7d: governanceTotal7d,
      byCategory: governanceByCategory,
      recent: governanceRecent,
      codeHashDrift,
    },
    dataRange: {
      earliestSignResponseAt: earliestSignResponseRow?.blockTimestamp ?? null,
      earliestSignRequestAt: earliestSignRequestRow?.blockTimestamp ?? null,
      earliestGovernanceEventAt: earliestGovernanceEventRow?.blockTimestamp ?? null,
    },
  };
}

// Tries to extract a string field by name from a decoded JSON payload.
// Returns the first match. Used by the version-drift query.
function extractStringFromPayload(
  payload: unknown,
  fieldNames: readonly string[],
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  for (const name of fieldNames) {
    const value = obj[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

// Best-effort one-line summary for a governance event payload, surfaced
// in the dashboard timeline next to the event type. Recognizes a handful
// of common shapes; falls back to a compact JSON snippet for the rest.
function summarizeGovernancePayload(eventType: string, payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;

  if (typeof obj._decode_error === "string") {
    return `(decode: ${obj._decode_error})`;
  }

  switch (eventType) {
    case "vote_code_hash":
    case "vote_add_launcher_hash":
    case "vote_remove_launcher_hash":
    case "vote_add_os_measurement":
    case "vote_remove_os_measurement": {
      const hash =
        extractStringFromPayload(obj, ["code_hash", "launcher_hash", "os_measurement", "hash"]) ??
        "";
      if (hash) return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
      break;
    }
    case "submit_participant_info": {
      const tls = extractStringFromPayload(obj, ["tls_public_key"]) ?? "";
      if (tls) return `tls=${tls.slice(0, 22)}…`;
      break;
    }
    case "vote_pk":
    case "vote_reshared": {
      const epoch = obj.key_event_id ?? obj.epoch_id ?? obj.attempt_id;
      if (epoch !== undefined) return `key_event=${JSON.stringify(epoch).slice(0, 40)}`;
      break;
    }
    case "propose_update":
    case "vote_update": {
      const id = obj.id ?? obj.update_id;
      if (id !== undefined) return `update=${JSON.stringify(id).slice(0, 40)}`;
      break;
    }
  }

  // Fallback: compact one-liner of the first few keys.
  const keys = Object.keys(obj).filter((k) => !k.startsWith("_"));
  if (keys.length === 0) return null;
  const preview = keys
    .slice(0, 3)
    .map((k) => `${k}=${JSON.stringify(obj[k]).slice(0, 40)}`)
    .join(", ");
  return preview;
}

export async function getDashboardData(): Promise<DashboardData> {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const pollIntervalMs = resolveIndexerPollIntervalMs();

  const guardBreakdownPromise = loadGuardBreakdown(last24h, last7d, last30d);
  const providerBreakdownPromise = loadProviderBreakdown(last24h, last7d, last30d);
  const relayerBreakdownByActivityPromise = loadRelayerBreakdownByActivity(
    last24h,
    last7d,
    last30d,
  );
  const topAccountsPromise = loadTopAccounts(last24h, last7d, last30d, MAX_TOP_ACCOUNTS);
  const actionTypeBreakdownPromise = loadActionTypeBreakdown(last24h, last7d, last30d);
  const consumerOutcomesPromise = loadConsumerOutcomes(last24h, last7d, last30d);
  const realActivityPromise = loadRealActivity(last24h, last7d, last30d);
  const mpcNetworkPromise = loadMpcNetworkOverview(now, last24h);
  const fastAuthContractsPromise = loadFastAuthContracts();

  const [
    accountsTotal,
    accountsFirstSeen24h,
    accountsFirstSeen7d,
    accountsFirstSeen30d,
    accountsActive24h,
    accountsActive7d,
    accountsActive30d,
    signTotal24h,
    signTotal7d,
    signTotal30d,
    signOutcomeCounts,
    nearHeightCheckpoint,
    nearScannedCheckpoint,
    nearChainHeadCheckpoint,
    nearBackfillOriginCheckpoint,
    chainHealthData,
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
    loadSignOutcomeCounts(last24h, last7d, last30d),
    prisma.indexerCheckpoint.findUnique({ where: { key: "near_last_final_block_height" } }),
    prisma.indexerCheckpoint.findUnique({ where: { key: "near_last_scanned_height" } }),
    prisma.indexerCheckpoint.findUnique({ where: { key: "near_chain_head_height" } }),
    prisma.indexerCheckpoint.findUnique({ where: { key: "near_backfill_start_origin" } }),
    loadChainHealth(now, last24h),
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
    totalAccounts: accountsTotal + MIGRATED_ACCOUNTS_TOTAL,
    indexedAccounts: accountsTotal,
    migratedAccounts: MIGRATED_ACCOUNTS_TOTAL,
    // firstSeen = first time we observed the account in a FastAuth sign event,
    // not its on-chain creation. The all-time column collapses to indexed only
    // because we have no per-account first-seen timestamp for the migrated
    // cohort.
    firstSeen: {
      last24h: accountsFirstSeen24h,
      last7d: accountsFirstSeen7d,
      last30d: accountsFirstSeen30d,
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
  const {
    failed24h: signFailed24h,
    failed7d: signFailed7d,
    failed30d: signFailed30d,
    failedAll: signFailedAll,
    pending24h: signPending24h,
    pending7d: signPending7d,
    pending30d: signPending30d,
    pendingAll: signPendingAll,
  } = signOutcomeCounts;
  const transactionOverview: TransactionMetrics = {
    signed: {
      last24h: Math.max(0, signTotal24h - signFailed24h - signPending24h),
      last7d: Math.max(0, signTotal7d - signFailed7d - signPending7d),
      last30d: Math.max(0, signTotal30d - signFailed30d - signPending30d),
      all: Math.max(0, signTotalAll - signFailedAll - signPendingAll),
    },
    failed: {
      last24h: signFailed24h,
      last7d: signFailed7d,
      last30d: signFailed30d,
      all: signFailedAll,
    },
    pending: {
      last24h: signPending24h,
      last7d: signPending7d,
      last30d: signPending30d,
      all: signPendingAll,
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

  const { fastAuthChainHealth, mpcChainHealth, chainHealthHistory } = chainHealthData;

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
  const relayerBreakdownByActivity = await relayerBreakdownByActivityPromise;
  const topAccounts = await topAccountsPromise;
  const actionTypeBreakdown = await actionTypeBreakdownPromise;
  const consumerOutcomes = await consumerOutcomesPromise;
  const realActivity = await realActivityPromise;
  const mpcNetwork = await mpcNetworkPromise;
  const fastAuthContracts = await fastAuthContractsPromise;

  return {
    accountsOverview,
    transactionOverview,
    providerBreakdown,
    relayerBreakdownByActivity,
    guardBreakdown,
    actionTypeBreakdown,
    consumerOutcomes,
    realActivity,
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
    mpcNetwork,
    fastAuthContracts,
  };
}
