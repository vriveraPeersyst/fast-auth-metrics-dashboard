/**
 * One-shot backfill: stamp fastauth_sign_events.user_account_id from
 * fastauth_public_key_accounts using the most-recently-seen owner per
 * public key.
 *
 * Run: pnpm tsx src/scripts/backfill-sign-event-accounts.ts
 *      pnpm tsx src/scripts/backfill-sign-event-accounts.ts --dry-run
 */
import "dotenv/config";

import { prisma } from "@/lib/prisma";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const [pendingRows, totalSignEvents] = await Promise.all([
    prisma.fastAuthSignEvent.count({
      where: { userAccountId: null, userDerivedPublicKey: { not: null } },
    }),
    prisma.fastAuthSignEvent.count({ where: { userDerivedPublicKey: { not: null } } }),
  ]);

  console.log(
    `Sign events with derived pubkey: ${totalSignEvents}; missing user_account_id: ${pendingRows}.`,
  );

  if (pendingRows === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  if (dryRun) {
    console.log("Dry run — no writes.");
    await prisma.$disconnect();
    return;
  }

  // PostgreSQL DISTINCT ON picks one (public_key, account_id) per pubkey,
  // ordered by last_seen_at DESC — i.e. the current owner. We then UPDATE
  // every sign event whose pubkey matches and which doesn't already have
  // a user_account_id. Idempotent and re-runnable.
  const result = await prisma.$executeRaw`
    UPDATE fastauth_sign_events fse
    SET user_account_id = owners.account_id
    FROM (
      SELECT DISTINCT ON (public_key) public_key, account_id
      FROM fastauth_public_key_accounts
      ORDER BY public_key, last_seen_at DESC
    ) owners
    WHERE fse.user_derived_public_key = owners.public_key
      AND fse.user_account_id IS NULL
  `;

  console.log(`Updated ${result} sign event rows.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
