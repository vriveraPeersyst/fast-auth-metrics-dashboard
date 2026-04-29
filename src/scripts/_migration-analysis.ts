import { prisma } from "@/lib/prisma";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_MAP = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i++) ALPHABET_MAP.set(ALPHABET[i], i);

function base58Decode(s: string): Uint8Array {
  const bytes: number[] = [0];
  for (const c of s) {
    const v = ALPHABET_MAP.get(c);
    if (v === undefined) throw new Error(`bad b58 char: ${c}`);
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < s.length && s[i] === "1"; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

function pubkeyToImplicit(pk: string): string | null {
  const m = pk.match(/^ed25519:(.+)$/);
  if (!m) return null;
  const bytes = base58Decode(m[1]);
  if (bytes.length !== 32) return null;
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function main() {
  // ── 1. Look for sweat-migration.near activity in our raw transactions ──
  console.log("─── Sweat-migration activity in near_transactions ───");
  const sweatMigCount = await prisma.nearTransaction.count({
    where: { signerAccountId: "sweat-migration.near" },
  });
  console.log(`  near_transactions where signer = sweat-migration.near: ${sweatMigCount.toLocaleString()}`);

  // ── 2. Look for AddKey-pattern consumer transactions where outer signer
  //       is sweat-migration.near (or contains "migration") ──
  const sweatMigConsumers = await prisma.fastAuthConsumerTransaction.count({
    where: { outerSignerId: { contains: "migration" } },
  });
  console.log(`  consumer txs with 'migration' outer signer: ${sweatMigConsumers.toLocaleString()}`);

  const consumerSamples = await prisma.fastAuthConsumerTransaction.findMany({
    where: { outerSignerId: { contains: "migration" } },
    take: 5,
    orderBy: { blockTimestamp: "desc" },
  });
  for (const c of consumerSamples) {
    const implicitOfInnerKey = pubkeyToImplicit(c.innerPublicKey);
    const matchesInner = implicitOfInnerKey === c.innerSignerId;
    console.log(
      `    tx=${c.txHash.slice(0, 12)}... outer=${c.outerSignerId} inner_signer=${c.innerSignerId.slice(0, 16)}... actions=[${c.innerActionTypes.join(",")}]`,
    );
    console.log(
      `      inner_pubkey hex = ${implicitOfInnerKey?.slice(0, 16)}...   inner_signer  = ${c.innerSignerId.slice(0, 16)}...   match=${matchesInner ? "✓" : "✗ (migration pattern)"}`,
    );
  }

  // ── 3. THE BIG QUESTION: of the 34k orphan sign events, how many would
  //       local derivation get RIGHT vs WRONG?
  //       For each orphan: pka has the FastNEAR answer (we proved 100% are in pka).
  //       Compare: does FastNEAR's answer == hex(pubkey)?
  console.log("\n─── For orphan sign events, would local derivation be right or wrong? ───");

  const breakdown = await prisma.$queryRaw<
    Array<{
      derived_matches: bigint;
      derived_mismatches: bigint;
      no_pka_at_all: bigint;
      multi_account: bigint;
      total: bigint;
    }>
  >`
    WITH orphans AS (
      SELECT id, user_derived_public_key
      FROM fastauth_sign_events
      WHERE user_account_id IS NULL
        AND user_derived_public_key LIKE 'ed25519:%'
    ),
    -- For each orphan pubkey, count how many distinct accounts pka knows for it,
    -- and pick the most-recent owner (the answer back-stamp would use).
    pka_for_orphans AS (
      SELECT
        o.id,
        o.user_derived_public_key,
        COUNT(DISTINCT p.account_id) AS account_count,
        (
          SELECT account_id FROM fastauth_public_key_accounts p2
          WHERE p2.public_key = o.user_derived_public_key
          ORDER BY last_seen_at DESC LIMIT 1
        ) AS chosen_account
      FROM orphans o
      LEFT JOIN fastauth_public_key_accounts p ON p.public_key = o.user_derived_public_key
      GROUP BY o.id, o.user_derived_public_key
    )
    SELECT
      COUNT(*) FILTER (WHERE chosen_account IS NULL) AS no_pka_at_all,
      COUNT(*) FILTER (WHERE account_count > 1) AS multi_account,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE chosen_account IS NOT NULL AND account_count = 1) AS derived_matches,
      COUNT(*) FILTER (WHERE chosen_account IS NOT NULL AND account_count = 1) AS derived_mismatches
    FROM pka_for_orphans
  `;
  // ^ derived_matches/mismatches need a separate query that actually compares;
  // SQL can't easily compute hex(decode_base58(...)). Do it in JS below.

  const rows = await prisma.$queryRaw<
    Array<{ user_derived_public_key: string; account_id: string }>
  >`
    SELECT DISTINCT o.user_derived_public_key, p.account_id
    FROM (
      SELECT DISTINCT user_derived_public_key
      FROM fastauth_sign_events
      WHERE user_account_id IS NULL AND user_derived_public_key LIKE 'ed25519:%'
    ) o
    JOIN fastauth_public_key_accounts p ON p.public_key = o.user_derived_public_key
  `;

  let matches = 0;
  let mismatches = 0;
  const distinctOrphanPubkeys = new Set<string>();
  for (const r of rows) {
    distinctOrphanPubkeys.add(r.user_derived_public_key);
    const implicit = pubkeyToImplicit(r.user_derived_public_key);
    if (implicit && implicit === r.account_id) matches++;
    else mismatches++;
  }
  console.log(`  Distinct orphan pubkeys with pka entry:           ${distinctOrphanPubkeys.size.toLocaleString()}`);
  console.log(`    pka account == hex(pubkey) (local-derive OK):   ${matches.toLocaleString()} (${((matches / rows.length) * 100).toFixed(1)}%)`);
  console.log(`    pka account ≠ hex(pubkey) (migrated/AddKey):    ${mismatches.toLocaleString()} (${((mismatches / rows.length) * 100).toFixed(1)}%)`);

  console.log(`\n  Multi-account pubkeys: ${breakdown[0].multi_account} (one pubkey known to be on multiple accounts)`);
  console.log(`  Orphan events with NO pka at all: ${breakdown[0].no_pka_at_all} (these would only be helpable by local derivation)`);
  console.log(`  Total orphan ed25519 events: ${breakdown[0].total}`);

  // ── 4. Per orphan EVENT (not pubkey), count by category ──
  const eventBreakdown = await prisma.$queryRaw<
    Array<{ category: string; cnt: bigint }>
  >`
    WITH owners AS (
      SELECT DISTINCT ON (public_key) public_key, account_id
      FROM fastauth_public_key_accounts
      ORDER BY public_key, last_seen_at DESC
    )
    SELECT
      CASE
        WHEN owners.account_id IS NULL THEN 'no_pka_entry'
        ELSE 'has_pka_entry'
      END AS category,
      COUNT(*) AS cnt
    FROM fastauth_sign_events fse
    LEFT JOIN owners ON owners.public_key = fse.user_derived_public_key
    WHERE fse.user_account_id IS NULL AND fse.user_derived_public_key LIKE 'ed25519:%'
    GROUP BY 1
  `;
  console.log("\n  Per orphan sign event:");
  for (const r of eventBreakdown) {
    console.log(`    ${r.category}: ${r.cnt}`);
  }

  // ── 5. What % of all FastAuth users went through the Sweat migration? ──
  console.log("\n─── Sweat migration footprint on overall account population ───");
  const accountStats = await prisma.$queryRaw<
    Array<{ category: string; cnt: bigint }>
  >`
    SELECT
      CASE
        WHEN account_type = 'implicit_self' THEN 'implicit_self (likely fresh FA)'
        WHEN account_type = 'implicit_other' THEN 'implicit_other (likely migrated)'
        ELSE COALESCE(account_type, '(null)')
      END AS category,
      COUNT(*) AS cnt
    FROM accounts
    GROUP BY account_type
    ORDER BY cnt DESC
  `;
  for (const r of accountStats) {
    console.log(`  ${r.category}: ${r.cnt}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
