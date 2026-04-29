import { prisma } from "@/lib/prisma";

// Base58 decode (Bitcoin alphabet, used by NEAR for ed25519 pubkey encoding)
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_MAP = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i++) ALPHABET_MAP.set(ALPHABET[i], i);

function base58Decode(s: string): Uint8Array {
  let bytes: number[] = [0];
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
  // leading zeros
  for (let i = 0; i < s.length && s[i] === "1"; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

function pubkeyToImplicitAccount(pubkey: string): string | null {
  // Format: "ed25519:<base58 of 32 bytes>"
  const m = pubkey.match(/^ed25519:(.+)$/);
  if (!m) return null;
  const bytes = base58Decode(m[1]);
  if (bytes.length !== 32) return null;
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function main() {
  // Sample: take 20 sign events with NULL user_account_id but a derived ed25519 key.
  const samples = await prisma.$queryRaw<
    Array<{ id: bigint; pubkey: string; algorithm: string | null }>
  >`
    SELECT id, user_derived_public_key AS pubkey, algorithm
    FROM fastauth_sign_events
    WHERE user_account_id IS NULL
      AND user_derived_public_key IS NOT NULL
    LIMIT 20
  `;

  console.log("─── Sample of 20 NULL-user_account_id sign events ───\n");
  let ed25519Count = 0;
  let derivableCount = 0;
  for (const s of samples) {
    const implicit = pubkeyToImplicitAccount(s.pubkey);
    if (s.pubkey.startsWith("ed25519:")) ed25519Count++;
    if (implicit) {
      derivableCount++;
      // Check: does this implicit account actually exist in our public_key_accounts?
      const pkaHit = await prisma.fastAuthPublicKeyAccount.findFirst({
        where: { publicKey: s.pubkey, accountId: implicit },
      });
      // Or in user_transactions?
      const userTxHit = await prisma.fastAuthUserTransaction.count({
        where: { signerAccountId: implicit },
      });
      console.log(
        `  pubkey=${s.pubkey.slice(0, 20)}... → implicit=${implicit.slice(0, 20)}...  ` +
          `pka=${pkaHit ? "✓" : "✗"}  user_txs=${userTxHit}`,
      );
    } else {
      console.log(`  pubkey=${s.pubkey.slice(0, 20)}...  algo=${s.algorithm}  → NOT DERIVABLE`);
    }
  }

  console.log(
    `\nIn sample: ${ed25519Count}/20 ed25519, ${derivableCount}/20 derivable to a 64-hex implicit account.`,
  );

  // Now the population-level check: of the 34k NULL events, what % have an
  // ed25519 pubkey whose implicit-account derivation matches a real
  // public_key_accounts row?
  console.log("\n─── Population check ───\n");

  const [agg] = await prisma.$queryRaw<
    Array<{
      total_null: bigint;
      ed25519_null: bigint;
      secp256k1_null: bigint;
      other_null: bigint;
    }>
  >`
    SELECT
      COUNT(*) AS total_null,
      COUNT(*) FILTER (WHERE user_derived_public_key LIKE 'ed25519:%') AS ed25519_null,
      COUNT(*) FILTER (WHERE user_derived_public_key LIKE 'secp256k1:%') AS secp256k1_null,
      COUNT(*) FILTER (WHERE user_derived_public_key NOT LIKE 'ed25519:%' AND user_derived_public_key NOT LIKE 'secp256k1:%') AS other_null
    FROM fastauth_sign_events
    WHERE user_account_id IS NULL AND user_derived_public_key IS NOT NULL
  `;

  console.log(`Total NULL-user_account_id events with a derived pubkey:  ${agg.total_null.toString()}`);
  console.log(`  ed25519:    ${agg.ed25519_null.toString()}`);
  console.log(`  secp256k1:  ${agg.secp256k1_null.toString()}`);
  console.log(`  other:      ${agg.other_null.toString()}`);

  // Verification: how many of the existing pka rows have account_id == hex(pubkey)?
  // I.e., how often does FastNEAR's answer agree with local derivation?
  console.log("\n─── Cross-check: do existing public_key_accounts rows match local derivation? ───\n");

  const ed25519Pkas = await prisma.fastAuthPublicKeyAccount.findMany({
    where: { publicKey: { startsWith: "ed25519:" } },
    select: { publicKey: true, accountId: true },
    take: 5000,
  });

  let match = 0;
  let mismatch = 0;
  let invalid = 0;
  const mismatchSamples: Array<{ pk: string; expected: string; actual: string }> = [];
  for (const row of ed25519Pkas) {
    const derived = pubkeyToImplicitAccount(row.publicKey);
    if (!derived) {
      invalid++;
      continue;
    }
    if (derived === row.accountId) {
      match++;
    } else {
      mismatch++;
      if (mismatchSamples.length < 8) {
        mismatchSamples.push({ pk: row.publicKey, expected: derived, actual: row.accountId });
      }
    }
  }
  console.log(`Sampled ${ed25519Pkas.length} ed25519 public_key_accounts rows:`);
  console.log(`  derived account == FastNEAR account:  ${match} (${((match / ed25519Pkas.length) * 100).toFixed(1)}%)`);
  console.log(`  mismatch (named account / multi-key): ${mismatch} (${((mismatch / ed25519Pkas.length) * 100).toFixed(1)}%)`);
  console.log(`  failed to decode:                     ${invalid}`);

  if (mismatchSamples.length > 0) {
    console.log("\n  Mismatch samples (named accounts that hold the FA key):");
    for (const s of mismatchSamples) {
      console.log(`    pubkey=${s.pk.slice(0, 30)}...`);
      console.log(`      expected (implicit): ${s.expected}`);
      console.log(`      actual (FastNEAR):   ${s.actual}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
