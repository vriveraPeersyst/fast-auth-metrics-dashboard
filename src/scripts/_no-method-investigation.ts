import { prisma } from "@/lib/prisma";

async function main() {
  console.log("─── User txs with NULL method_name: what are they? ───\n");

  // 1. Distinct action_type arrays (so we know if these are pure transfers, AddKey, etc.)
  const byActionTypes = await prisma.$queryRaw<
    Array<{ action_types: string[]; cnt: bigint }>
  >`
    SELECT action_types, COUNT(*) AS cnt
    FROM fastauth_user_transactions
    WHERE method_name IS NULL
    GROUP BY action_types
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `;
  console.log("Top action_types arrays for NULL-method txs:");
  for (const r of byActionTypes) {
    console.log(`  ${r.cnt.toString().padStart(8)}  [${r.action_types.join(", ")}]`);
  }

  // 2. Distinct receivers
  console.log("\nTop receivers for NULL-method txs:");
  const byReceiver = await prisma.$queryRaw<
    Array<{ receiver_id: string; cnt: bigint }>
  >`
    SELECT receiver_id, COUNT(*) AS cnt
    FROM fastauth_user_transactions
    WHERE method_name IS NULL
    GROUP BY receiver_id
    ORDER BY COUNT(*) DESC
    LIMIT 15
  `;
  for (const r of byReceiver) {
    console.log(`  ${r.cnt.toString().padStart(8)}  ${r.receiver_id}`);
  }

  // 3. Action_types × receiver
  console.log("\nAction_types × receiver (NULL-method txs):");
  const cross = await prisma.$queryRaw<
    Array<{ action_types: string[]; receiver_id: string; cnt: bigint }>
  >`
    SELECT action_types, receiver_id, COUNT(*) AS cnt
    FROM fastauth_user_transactions
    WHERE method_name IS NULL
    GROUP BY action_types, receiver_id
    ORDER BY COUNT(*) DESC
    LIMIT 15
  `;
  for (const r of cross) {
    console.log(`  ${r.cnt.toString().padStart(8)}  [${r.action_types.join(", ")}]  →  ${r.receiver_id}`);
  }

  // 4. Sample a few raw rows
  console.log("\nSample 5 raw NULL-method rows:");
  const samples = await prisma.fastAuthUserTransaction.findMany({
    where: { methodName: null },
    take: 5,
    orderBy: { blockTimestamp: "desc" },
    select: {
      txHash: true,
      signerAccountId: true,
      receiverId: true,
      actionTypes: true,
      methodName: true,
      valueUsd: true,
      tokenSymbols: true,
      tokenAmounts: true,
    },
  });
  for (const s of samples) {
    console.log(`  tx=${s.txHash}`);
    console.log(`    signer=${s.signerAccountId}  receiver=${s.receiverId}`);
    console.log(`    actionTypes=[${s.actionTypes.join(", ")}]  method=${s.methodName}`);
    console.log(`    valueUsd=${s.valueUsd}  tokens=[${s.tokenSymbols.join(",")}]  amounts=[${s.tokenAmounts.join(",")}]`);
  }

  // 5. Total volume vs count for NULL-method
  console.log("\nNULL-method totals:");
  const [totals] = await prisma.$queryRaw<
    Array<{ cnt: bigint; with_value: bigint; total_usd: string | null }>
  >`
    SELECT
      COUNT(*) AS cnt,
      COUNT(*) FILTER (WHERE value_usd IS NOT NULL AND value_usd > 0) AS with_value,
      COALESCE(SUM(value_usd), 0)::text AS total_usd
    FROM fastauth_user_transactions
    WHERE method_name IS NULL
  `;
  console.log(`  total NULL-method rows: ${totals.cnt}`);
  console.log(`  with non-zero USD value: ${totals.with_value}`);
  console.log(`  total USD: $${totals.total_usd}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
