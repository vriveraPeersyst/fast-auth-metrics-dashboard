import { prisma } from "@/lib/prisma";
import { getDashboardData } from "@/lib/dashboard-data";

function fmtPct(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function main() {
  console.log("=== Running getDashboardData() ===\n");
  const t0 = Date.now();
  const data = await getDashboardData();
  console.log(`(took ${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);

  // ── Action type breakdown (sign events) ──────────────────────────────────
  console.log("─── Action Type Breakdown (fastauth_sign_events.sign_action_type) ───");
  for (const row of data.actionTypeBreakdown) {
    const flag = row.actionType === "(unclassified)" ? " ◀ NULL" : "";
    console.log(`  ${pad(row.actionType, 32)} all=${row.all.toLocaleString()}  30d=${row.last30d}${flag}`);
  }

  // ── Real activity overall windows ────────────────────────────────────────
  console.log("\n─── Real Activity Windows ───");
  console.log(`  all:   ${data.realActivity.byWindow.all.total} txs, ${data.realActivity.byWindow.all.distinctUsers} users, $${data.realActivity.byWindow.all.volumeUsd.toFixed(2)}`);
  console.log(`  30d:   ${data.realActivity.byWindow.last30d.total} txs, ${data.realActivity.byWindow.last30d.distinctUsers} users, $${data.realActivity.byWindow.last30d.volumeUsd.toFixed(2)}`);
  console.log(`  7d:    ${data.realActivity.byWindow.last7d.total} txs, ${data.realActivity.byWindow.last7d.distinctUsers} users, $${data.realActivity.byWindow.last7d.volumeUsd.toFixed(2)}`);
  console.log(`  24h:   ${data.realActivity.byWindow.last24h.total} txs, ${data.realActivity.byWindow.last24h.distinctUsers} users, $${data.realActivity.byWindow.last24h.volumeUsd.toFixed(2)}`);

  // ── Real activity by receiver (top-level) ────────────────────────────────
  console.log("\n─── Real Activity by Receiver (top-level — fallback '(unknown)') ───");
  for (const row of data.realActivity.byReceiver.slice(0, 10)) {
    const flag = row.key === "(unknown)" ? " ◀ NULL receiver" : "";
    console.log(`  ${pad(row.key, 50)} all=${row.all}${flag}`);
  }

  console.log("\n─── Real Activity by Method (top-level — fallback '(no method)') ───");
  for (const row of data.realActivity.byMethod.slice(0, 10)) {
    const flag = row.key === "(no method)" ? " ◀ NULL method" : "";
    console.log(`  ${pad(row.key, 50)} all=${row.all}${flag}`);
  }

  // ── Real activity grouped by relayer/provider/guard ──────────────────────
  for (const groupName of ["byRelayer", "byProvider", "byGuard"] as const) {
    console.log(`\n─── Real Activity ${groupName}.overall (fallback '(unclassified)') ───`);
    const rows = data.realActivity[groupName].overall;
    const totalAll = rows.reduce((sum, r) => sum + r.all, 0);
    const unclassified = rows.find((r) => r.key === "(unclassified)");
    if (unclassified) {
      console.log(`  ⚠ (unclassified): ${unclassified.all} of ${totalAll} (${fmtPct(unclassified.all, totalAll)})`);
    } else {
      console.log(`  ✓ no (unclassified) entries`);
    }
    for (const row of rows.slice(0, 8)) {
      const flag = row.key === "(unclassified)" ? " ◀" : "";
      console.log(`  ${pad(row.key, 50)} all=${row.all}${flag}`);
    }
  }

  // ── Real activity cross-tabs (where '(none)' shows up) ───────────────────
  for (const groupName of ["byRelayer", "byProvider", "byGuard"] as const) {
    for (const innerKey of ["byReceiver", "byMethod"] as const) {
      const rows = data.realActivity[groupName][innerKey];
      const noneCount = rows.filter((r) => r.innerKey === "(none)").reduce((s, r) => s + r.all, 0);
      const unclassCount = rows.filter((r) => r.classKey === "(unclassified)").reduce((s, r) => s + r.all, 0);
      const totalAll = rows.reduce((s, r) => s + r.all, 0);
      console.log(`\n  ${groupName}.${innerKey}: ${rows.length} rows, ${totalAll} txs total — (none) inner: ${noneCount} (${fmtPct(noneCount, totalAll)}), (unclassified) class: ${unclassCount} (${fmtPct(unclassCount, totalAll)})`);
    }
  }

  // ── Consumer outcomes fallbacks ──────────────────────────────────────────
  // (Removed in the dashboard simplify pass — `data.consumerOutcomes` no
  // longer exists. The diagnostic remains useful but needs to be re-wired
  // against `data.realActivity.byRelayer/byGuard/byProvider` if revived.)
  console.log("\n─── Consumer Outcomes Fallbacks ───");
  console.log("  (skipped — consumerOutcomes was removed from getDashboardData)");

  // ── Diagnostic queries: WHERE are the NULLs coming from? ────────────────
  console.log("\n\n=== Root-cause diagnostics ===\n");

  const totalSignEvents = await prisma.fastAuthSignEvent.count();
  const nullActionType = await prisma.fastAuthSignEvent.count({ where: { signActionType: null } });
  const nullUserAccount = await prisma.fastAuthSignEvent.count({ where: { userAccountId: null } });
  const nullDerivedKey = await prisma.fastAuthSignEvent.count({ where: { userDerivedPublicKey: null } });
  const nullGuard = await prisma.fastAuthSignEvent.count({ where: { guardName: null } });

  console.log("fastauth_sign_events column nullness:");
  console.log(`  total rows:                   ${totalSignEvents.toLocaleString()}`);
  console.log(`  sign_action_type IS NULL:     ${nullActionType.toLocaleString()} (${fmtPct(nullActionType, totalSignEvents)})  → '(unclassified)' in actionTypeBreakdown`);
  console.log(`  user_derived_public_key NULL: ${nullDerivedKey.toLocaleString()} (${fmtPct(nullDerivedKey, totalSignEvents)})  → can't resolve account from these`);
  console.log(`  user_account_id IS NULL:      ${nullUserAccount.toLocaleString()} (${fmtPct(nullUserAccount, totalSignEvents)})  → unresolved by public-key-accounts.ts`);
  console.log(`  guard_name IS NULL:           ${nullGuard.toLocaleString()} (${fmtPct(nullGuard, totalSignEvents)})`);

  const totalUserTxs = await prisma.fastAuthUserTransaction.count();
  const userTxNullReceiver = await prisma.fastAuthUserTransaction.count({ where: { receiverId: "" } });
  const userTxNullMethod = await prisma.fastAuthUserTransaction.count({ where: { methodName: null } });

  console.log("\nfastauth_user_transactions column nullness:");
  console.log(`  total rows:                   ${totalUserTxs.toLocaleString()}`);
  console.log(`  receiver_id = '':             ${userTxNullReceiver.toLocaleString()} (should be 0)`);
  console.log(`  method_name IS NULL:          ${userTxNullMethod.toLocaleString()} (${fmtPct(userTxNullMethod, totalUserTxs)})  → '(none)' in cross-tabs (expected for Transfer-only txs)`);

  // Orphaned user txs: signer doesn't appear as user_account_id in any sign event
  const [orphanRow] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count
    FROM fastauth_user_transactions t
    WHERE NOT EXISTS (
      SELECT 1 FROM fastauth_sign_events s
      WHERE s.user_account_id = t.signer_account_id
    )
  `;
  const orphanCount = Number(orphanRow.count);
  console.log(`\nUser txs with NO matching sign_event.user_account_id (→ '(unclassified)' in real-activity grouping):`);
  console.log(`  ${orphanCount.toLocaleString()} of ${totalUserTxs.toLocaleString()} (${fmtPct(orphanCount, totalUserTxs)})`);

  // Top orphan signers
  const orphanSamples = await prisma.$queryRaw<Array<{ signer_account_id: string; cnt: bigint }>>`
    SELECT t.signer_account_id, COUNT(*) AS cnt
    FROM fastauth_user_transactions t
    WHERE NOT EXISTS (
      SELECT 1 FROM fastauth_sign_events s
      WHERE s.user_account_id = t.signer_account_id
    )
    GROUP BY t.signer_account_id
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `;
  if (orphanSamples.length > 0) {
    console.log(`\n  Top 10 orphan signer accounts (have user-tx activity but no sign_event with user_account_id resolved):`);
    for (const r of orphanSamples) {
      // Check if account exists at all in public_key_accounts
      const pkaCount = await prisma.fastAuthPublicKeyAccount.count({ where: { accountId: r.signer_account_id } });
      console.log(`    ${pad(r.signer_account_id, 56)} ${Number(r.cnt).toLocaleString().padStart(8)} txs   public_key_accounts rows: ${pkaCount}`);
    }
  }

  // Are these signers' keys in public_key_accounts but never back-linked to sign events?
  const [linkRow] = await prisma.$queryRaw<Array<{
    signers_in_user_txs: bigint;
    signers_in_pka: bigint;
    signers_in_sign_events: bigint;
  }>>`
    WITH s AS (SELECT DISTINCT signer_account_id AS aid FROM fastauth_user_transactions)
    SELECT
      (SELECT COUNT(*) FROM s) AS signers_in_user_txs,
      (SELECT COUNT(*) FROM s WHERE EXISTS (SELECT 1 FROM fastauth_public_key_accounts p WHERE p.account_id = s.aid)) AS signers_in_pka,
      (SELECT COUNT(*) FROM s WHERE EXISTS (SELECT 1 FROM fastauth_sign_events e WHERE e.user_account_id = s.aid)) AS signers_in_sign_events
  `;
  const totalSigners = Number(linkRow.signers_in_user_txs);
  console.log(`\nDistinct signer accounts in user_transactions: ${totalSigners.toLocaleString()}`);
  console.log(`  · also in fastauth_public_key_accounts:  ${Number(linkRow.signers_in_pka).toLocaleString()} (${fmtPct(Number(linkRow.signers_in_pka), totalSigners)})`);
  console.log(`  · also in sign_events.user_account_id:   ${Number(linkRow.signers_in_sign_events).toLocaleString()} (${fmtPct(Number(linkRow.signers_in_sign_events), totalSigners)})`);
  console.log(`  → gap = signers KNOWN to public-key-accounts but their sign event row never got user_account_id back-filled`);

  // Checkpoint state
  const checkpoint = await prisma.indexerCheckpoint.findUnique({ where: { key: "fastauth_public_key_accounts_last_event_id" } });
  const maxEventId = await prisma.fastAuthSignEvent.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
  console.log(`\nPublic-key-accounts checkpoint:`);
  console.log(`  last processed event id:  ${checkpoint?.value ?? "(unset)"}`);
  console.log(`  max sign_event id:        ${maxEventId?.id?.toString() ?? "(none)"}`);
  if (checkpoint && maxEventId) {
    const lag = Number(maxEventId.id) - Number(checkpoint.value);
    console.log(`  lag:                      ${lag.toLocaleString()} events`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
