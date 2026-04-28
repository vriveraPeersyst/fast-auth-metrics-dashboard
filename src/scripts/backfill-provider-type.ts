/**
 * One-shot backfill: re-derive provider_type from guard_id for every row
 * in fastauth_sign_events using the current resolveProviderType logic.
 *
 * Run: pnpm tsx src/scripts/backfill-provider-type.ts
 *      pnpm tsx src/scripts/backfill-provider-type.ts --dry-run
 */
import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { resolveProviderType } from "@/lib/indexers/near";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const groups = await prisma.fastAuthSignEvent.groupBy({
    by: ["guardId", "providerType"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  console.log(
    `Found ${groups.length} distinct (guard_id, provider_type) groups across fastauth_sign_events.`,
  );

  let totalRowsConsidered = 0;
  let totalRowsToUpdate = 0;
  const plannedUpdates: Array<{
    guardId: string | null;
    fromProviderType: string;
    toProviderType: string;
    rows: number;
  }> = [];

  for (const group of groups) {
    totalRowsConsidered += group._count.id;
    const next = resolveProviderType(group.guardId);
    if (next.providerType !== group.providerType) {
      totalRowsToUpdate += group._count.id;
      plannedUpdates.push({
        guardId: group.guardId,
        fromProviderType: group.providerType,
        toProviderType: next.providerType,
        rows: group._count.id,
      });
    }
  }

  for (const u of plannedUpdates) {
    console.log(
      `  guard_id=${JSON.stringify(u.guardId)}: ${u.fromProviderType} → ${u.toProviderType} (${u.rows} rows)`,
    );
  }

  console.log(
    `\nTotal rows considered: ${totalRowsConsidered}; rows needing update: ${totalRowsToUpdate}.`,
  );

  if (dryRun) {
    console.log("Dry run — no writes.");
    await prisma.$disconnect();
    return;
  }

  if (plannedUpdates.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  for (const u of plannedUpdates) {
    const result = await prisma.fastAuthSignEvent.updateMany({
      where: {
        guardId: u.guardId,
        providerType: u.fromProviderType,
      },
      data: { providerType: u.toProviderType },
    });
    updated += result.count;
    console.log(`  updated ${result.count} rows for guard_id=${JSON.stringify(u.guardId)}`);
  }

  console.log(`\nTotal rows updated: ${updated}.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
