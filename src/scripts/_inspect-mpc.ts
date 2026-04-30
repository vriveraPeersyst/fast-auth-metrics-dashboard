import { prisma } from "@/lib/prisma";

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

async function main() {
  console.log("─── mpc_transactions snapshot ───\n");

  const [total, byMethod, bySigner, byStatus, oldest, newest] = await Promise.all([
    prisma.mpcTransaction.count(),
    prisma.$queryRaw<Array<{ method_name: string | null; n: bigint }>>`
      SELECT method_name, COUNT(*) AS n
      FROM mpc_transactions
      GROUP BY method_name
      ORDER BY n DESC
    `,
    prisma.$queryRaw<Array<{ signer_account_id: string | null; n: bigint }>>`
      SELECT signer_account_id, COUNT(*) AS n
      FROM mpc_transactions
      GROUP BY signer_account_id
      ORDER BY n DESC
      LIMIT 20
    `,
    prisma.$queryRaw<Array<{ execution_status: string | null; n: bigint }>>`
      SELECT execution_status, COUNT(*) AS n
      FROM mpc_transactions
      GROUP BY execution_status
      ORDER BY n DESC
    `,
    prisma.mpcTransaction.findFirst({
      orderBy: { blockTimestamp: "asc" },
      select: { blockHeight: true, blockTimestamp: true, txHash: true },
    }),
    prisma.mpcTransaction.findFirst({
      orderBy: { blockTimestamp: "desc" },
      select: { blockHeight: true, blockTimestamp: true, txHash: true },
    }),
  ]);

  console.log(`Total rows: ${total.toLocaleString("en-US")}`);

  if (oldest && newest && oldest.blockTimestamp && newest.blockTimestamp) {
    const spanMs = newest.blockTimestamp.getTime() - oldest.blockTimestamp.getTime();
    const spanMin = spanMs / 60_000;
    const ratePerMin = spanMin > 0 ? total / spanMin : 0;
    console.log(`Block range: ${oldest.blockHeight} → ${newest.blockHeight}`);
    console.log(`Time range: ${oldest.blockTimestamp.toISOString()} → ${newest.blockTimestamp.toISOString()}`);
    console.log(`Span: ${spanMin.toFixed(1)} min (~${ratePerMin.toFixed(1)} txs/min, ~${(ratePerMin * 60).toFixed(0)}/h, ~${(ratePerMin * 60 * 24).toFixed(0)}/day)`);
  }

  console.log("\nBy method_name:");
  for (const row of byMethod) {
    console.log(`  ${pad(row.n.toString(), 8)}  ${row.method_name ?? "(null)"}`);
  }

  console.log("\nTop signer_account_id (MPC nodes):");
  for (const row of bySigner) {
    console.log(`  ${pad(row.n.toString(), 8)}  ${row.signer_account_id ?? "(null)"}`);
  }

  console.log("\nBy execution_status:");
  for (const row of byStatus) {
    console.log(`  ${pad(row.n.toString(), 8)}  ${row.execution_status ?? "(null)"}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
