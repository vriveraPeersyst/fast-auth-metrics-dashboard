import { prisma } from "@/lib/prisma";

async function main() {
  const [
    nearTxCount,
    signEventCount,
    relayerCount,
    publicKeyAccountCount,
    checkpoints,
    latestTxs,
    latestSignEvents,
  ] = await Promise.all([
    prisma.nearTransaction.count(),
    prisma.fastAuthSignEvent.count(),
    prisma.relayer.count(),
    prisma.fastAuthPublicKeyAccount.count(),
    prisma.indexerCheckpoint.findMany({ orderBy: { key: "asc" } }),
    prisma.nearTransaction.findMany({
      orderBy: { blockHeight: "desc" },
      take: 5,
      select: {
        txHash: true,
        blockHeight: true,
        blockTimestamp: true,
        receiverId: true,
        methodName: true,
        executionStatus: true,
      },
    }),
    prisma.fastAuthSignEvent.findMany({
      orderBy: { blockHeight: "desc" },
      take: 5,
      select: {
        txHash: true,
        actionIndex: true,
        blockHeight: true,
        blockTimestamp: true,
        providerType: true,
        guardId: true,
        relayerAccountId: true,
        sponsoredAccountId: true,
      },
    }),
  ]);

  console.log(
    JSON.stringify(
      {
        counts: {
          nearTransactions: nearTxCount,
          fastAuthSignEvents: signEventCount,
          relayers: relayerCount,
          fastAuthPublicKeyAccounts: publicKeyAccountCount,
        },
        checkpoints: checkpoints.map((c) => ({ key: c.key, value: c.value })),
        latestTxs,
        latestSignEvents,
      },
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
