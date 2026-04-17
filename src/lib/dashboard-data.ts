import { prisma } from "@/lib/prisma";

type DashboardData = {
  auth0EventsLast24h: number;
  latestRelayerSignTotal: number | null;
  latestRelayerSignFailed: number | null;
  latestNearFinalBlock: string | null;
  nearTrackedTxLast24h: number;
  recentAuth0Logs: Array<{
    logId: string;
    timestamp: Date;
    type: string;
    description: string | null;
    connection: string | null;
  }>;
  recentNearTransactions: Array<{
    txHash: string;
    blockHeight: string | null;
    blockTimestamp: Date | null;
    signerAccountId: string | null;
    receiverId: string | null;
    methodName: string | null;
    executionStatus: string | null;
  }>;
  lastIngestionAt: Date | null;
};

export async function getDashboardData(): Promise<DashboardData> {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    auth0EventsLast24h,
    latestRelayerSignTotal,
    latestRelayerSignFailed,
    nearHeightCheckpoint,
    nearTrackedTxLast24h,
    recentAuth0Logs,
    recentNearTransactions,
    lastAuth0Log,
    lastNearTransaction,
    lastServiceMetric,
  ] = await Promise.all([
    prisma.auth0Log.count({
      where: {
        timestamp: {
          gte: last24h,
        },
      },
    }),
    prisma.serviceMetricSample.findFirst({
      where: {
        serviceName: "relayer",
        metricName: "sign_total",
      },
      orderBy: {
        timestamp: "desc",
      },
    }),
    prisma.serviceMetricSample.findFirst({
      where: {
        serviceName: "relayer",
        metricName: "sign_failed",
      },
      orderBy: {
        timestamp: "desc",
      },
    }),
    prisma.indexerCheckpoint.findUnique({
      where: { key: "near_last_final_block_height" },
    }),
    prisma.nearTransaction.count({
      where: {
        blockTimestamp: {
          gte: last24h,
        },
      },
    }),
    prisma.auth0Log.findMany({
      orderBy: {
        timestamp: "desc",
      },
      take: 8,
      select: {
        logId: true,
        timestamp: true,
        type: true,
        description: true,
        connection: true,
      },
    }),
    prisma.nearTransaction.findMany({
      orderBy: [
        {
          blockHeight: "desc",
        },
        {
          createdAt: "desc",
        },
      ],
      take: 8,
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
    prisma.auth0Log.findFirst({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        createdAt: true,
      },
    }),
    prisma.nearTransaction.findFirst({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        createdAt: true,
      },
    }),
    prisma.serviceMetricSample.findFirst({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        createdAt: true,
      },
    }),
  ]);

  const lastIngestionAt =
    [lastAuth0Log?.createdAt, lastNearTransaction?.createdAt, lastServiceMetric?.createdAt]
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  return {
    auth0EventsLast24h,
    latestRelayerSignTotal: latestRelayerSignTotal?.value ?? null,
    latestRelayerSignFailed: latestRelayerSignFailed?.value ?? null,
    latestNearFinalBlock: nearHeightCheckpoint?.value ?? null,
    nearTrackedTxLast24h,
    recentAuth0Logs,
    recentNearTransactions: recentNearTransactions.map((tx) => ({
      txHash: tx.txHash,
      blockHeight: tx.blockHeight !== null ? tx.blockHeight.toString() : null,
      blockTimestamp: tx.blockTimestamp,
      signerAccountId: tx.signerAccountId,
      receiverId: tx.receiverId,
      methodName: tx.methodName,
      executionStatus: tx.executionStatus,
    })),
    lastIngestionAt,
  };
}
