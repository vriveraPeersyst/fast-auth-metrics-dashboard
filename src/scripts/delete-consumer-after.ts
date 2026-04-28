/**
 * Delete fastauth_consumer_transactions rows inserted after a cutoff
 * timestamp (created_at > cutoff). Use when an incorrect filter caused
 * bad rows to be persisted and you want to start clean from a known-good
 * point.
 *
 * Run with --dry-run first to see how many rows would be affected.
 *
 *   pnpm tsx src/scripts/delete-consumer-after.ts --cutoff="2026-04-28T14:14:46.126478502Z" --dry-run
 *   pnpm tsx src/scripts/delete-consumer-after.ts --cutoff="2026-04-28T14:14:46.126478502Z" --confirm
 */
import "dotenv/config";

import { prisma } from "@/lib/prisma";

function getArg(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return null;
  return arg.slice(name.length + 3);
}

async function main() {
  const cutoffStr = getArg("cutoff");
  const dryRun = process.argv.includes("--dry-run");
  const confirm = process.argv.includes("--confirm");

  if (!cutoffStr) {
    console.error('Missing --cutoff="<ISO timestamp>"');
    process.exit(1);
  }

  const cutoff = new Date(cutoffStr);
  if (Number.isNaN(cutoff.getTime())) {
    console.error(`Invalid timestamp: ${cutoffStr}`);
    process.exit(1);
  }

  const total = await prisma.fastAuthConsumerTransaction.count();
  const targetCount = await prisma.fastAuthConsumerTransaction.count({
    where: { createdAt: { gt: cutoff } },
  });
  const wouldKeep = total - targetCount;

  console.log(`Cutoff:               ${cutoff.toISOString()}`);
  console.log(`Total rows:           ${total}`);
  console.log(`Rows after cutoff:    ${targetCount}  ← will be deleted`);
  console.log(`Rows on/before cutoff:${wouldKeep}  ← kept`);

  if (dryRun) {
    console.log("\nDry run — no writes.");
    await prisma.$disconnect();
    return;
  }

  if (!confirm) {
    console.error('\nRefusing to delete without --confirm. Re-run with --confirm to proceed.');
    await prisma.$disconnect();
    process.exit(1);
  }

  if (targetCount === 0) {
    console.log("\nNothing to delete.");
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.fastAuthConsumerTransaction.deleteMany({
    where: { createdAt: { gt: cutoff } },
  });

  console.log(`\nDeleted ${result.count} rows.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
