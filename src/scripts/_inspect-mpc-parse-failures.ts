import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { resolveFastAuthContractIds } from "@/lib/indexers/near";
import { createNearRpcManager } from "@/lib/indexers/near-rpc-manager";
import { parseSignLog } from "@/lib/indexers/parse-mpc-logs";

const V1_SIGNER = "v1.signer";

type Receipt = {
  outcome?: {
    executor_id?: string;
    logs?: string[];
    status?: unknown;
  };
};

type TxResponse = {
  result?: {
    transaction_outcome?: { outcome?: { status?: unknown } };
    receipts_outcome?: Receipt[];
  };
};

async function main() {
  const rpcManager = createNearRpcManager();
  const fastAuthContractIds = resolveFastAuthContractIds();

  console.log("─── Inspección de signs FastAuth que no parsean ───\n");

  // Same query as the collector — limited to find the bad apples currently stuck.
  const candidates = await prisma.$queryRaw<
    Array<{
      tx_hash: string;
      signer_account_id: string;
      block_timestamp: Date;
      execution_status: string | null;
    }>
  >`
    SELECT n.tx_hash, n.signer_account_id, n.block_timestamp, n.execution_status
    FROM near_transactions n
    LEFT JOIN mpc_sign_requests r ON r.tx_hash = n.tx_hash
    WHERE r.tx_hash IS NULL
      AND n.method_name = 'sign'
      AND n.receiver_id = ANY(${fastAuthContractIds}::text[])
      AND n.block_timestamp >= NOW() - INTERVAL '24 hours'
      AND n.signer_account_id IS NOT NULL
    ORDER BY n.block_timestamp DESC
    LIMIT 50
  `;

  let parseable = 0;
  let nonParseable = 0;

  for (const c of candidates) {
    let response: TxResponse;
    try {
      response = await rpcManager.request<TxResponse>(
        "tx",
        [c.tx_hash, c.signer_account_id],
        `inspect:${c.tx_hash}`,
      );
    } catch (e) {
      console.log(`[rpc-error] ${c.tx_hash}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const txOutcome = response.result?.transaction_outcome?.outcome?.status;
    const receipts = response.result?.receipts_outcome ?? [];
    const v1SignerReceipts = receipts.filter(
      (r) => (r.outcome?.executor_id ?? "").trim().toLowerCase() === V1_SIGNER,
    );
    const allLogs = v1SignerReceipts.flatMap((r) => r.outcome?.logs ?? []);
    const signLogs = allLogs.filter((l) => l.startsWith("sign:"));

    let parsed = false;
    for (const l of signLogs) {
      if (parseSignLog(l)) {
        parsed = true;
        break;
      }
    }

    if (parsed) {
      parseable++;
      continue;
    }

    nonParseable++;
    console.log(`\n═══ NO PARSEABLE ═══`);
    console.log(`tx          = ${c.tx_hash}`);
    console.log(`signer      = ${c.signer_account_id}`);
    console.log(`tx status   = ${typeof txOutcome === "string" ? txOutcome : JSON.stringify(txOutcome)?.slice(0, 100)}`);
    console.log(`exec status = ${c.execution_status}`);
    console.log(`receipts    = ${receipts.length} total, ${v1SignerReceipts.length} en v1.signer`);
    console.log(`v1.signer logs = ${allLogs.length} total, ${signLogs.length} con prefijo "sign:"`);
    if (signLogs.length > 0) {
      for (const log of signLogs) {
        console.log(`  log raw: ${log.length > 400 ? log.slice(0, 400) + "…" : log}`);
      }
    } else if (allLogs.length > 0) {
      console.log(`  otros logs en v1.signer:`);
      for (const log of allLogs.slice(0, 3)) {
        console.log(`    > ${log.length > 200 ? log.slice(0, 200) + "…" : log}`);
      }
    } else if (v1SignerReceipts.length > 0) {
      const status = v1SignerReceipts[0].outcome?.status;
      console.log(`  v1.signer receipt status: ${JSON.stringify(status)?.slice(0, 200)}`);
    } else {
      console.log(`  (no hay receipts en v1.signer — la tx no llegó al MPC)`);
    }
  }

  console.log(`\n─── Resumen ───`);
  console.log(`parseables: ${parseable} / ${candidates.length}`);
  console.log(`no parseables: ${nonParseable} / ${candidates.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
