import { prisma } from "@/lib/prisma";

async function main() {
  console.log("Wiping indexer data...");

  const results = await prisma.$transaction([
    prisma.fastAuthPublicKeyAccount.deleteMany({}),
    prisma.fastAuthSignEvent.deleteMany({}),
    prisma.nearTransaction.deleteMany({}),
    prisma.relayerDapp.deleteMany({}),
    prisma.relayer.deleteMany({}),
    prisma.indexerCheckpoint.deleteMany({}),
  ]);

  const labels = [
    "fastAuthPublicKeyAccount",
    "fastAuthSignEvent",
    "nearTransaction",
    "relayerDapp",
    "relayer",
    "indexerCheckpoint",
  ];

  const summary = Object.fromEntries(
    results.map((r, i) => [labels[i], r.count]),
  );

  console.log(JSON.stringify({ deleted: summary }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
