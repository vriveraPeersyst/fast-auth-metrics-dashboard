import { prisma } from "@/lib/prisma";
import { createNearRpcManager } from "@/lib/indexers/near-rpc-manager";
import { parseSignLog, parseRespondLog } from "@/lib/indexers/parse-mpc-logs";

const V1_SIGNER = "v1.signer";

type TxResponse = {
  result?: {
    receipts_outcome?: Array<{
      outcome?: { executor_id?: string; logs?: string[] };
    }>;
  };
};

async function fetchV1SignerLogs(
  rpcManager: ReturnType<typeof createNearRpcManager>,
  txHash: string,
  signerId: string,
): Promise<string[]> {
  const response = await rpcManager.request<TxResponse>("tx", [txHash, signerId], `parser-test:${txHash}`);
  const out: string[] = [];
  for (const r of response.result?.receipts_outcome ?? []) {
    if ((r.outcome?.executor_id ?? "").trim().toLowerCase() === V1_SIGNER) {
      for (const log of r.outcome?.logs ?? []) out.push(log);
    }
  }
  return out;
}

async function main() {
  const rpcManager = createNearRpcManager();
  console.log("─── Parser fixture test ───\n");

  const respondRows = await prisma.mpcTransaction.findMany({
    where: { methodName: "respond" },
    orderBy: { blockTimestamp: "desc" },
    take: 5,
  });
  const directSignRows = await prisma.mpcTransaction.findMany({
    where: { methodName: "sign" },
    orderBy: { blockTimestamp: "desc" },
    take: 3,
  });
  const fastAuthSignRows = await prisma.nearTransaction.findMany({
    where: { methodName: "sign" },
    orderBy: { blockTimestamp: "desc" },
    take: 3,
  });

  let respondOk = 0;
  let respondFail = 0;
  let signOk = 0;
  let signFail = 0;
  const requestKeys = new Map<string, { sign: number; respond: number }>();

  for (const row of respondRows) {
    const logs = await fetchV1SignerLogs(rpcManager, row.txHash, row.signerAccountId ?? "");
    for (const log of logs) {
      const parsed = parseRespondLog(log);
      if (!parsed) {
        if (log.startsWith("respond:")) respondFail++;
        continue;
      }
      respondOk++;
      const slot = requestKeys.get(parsed.requestKey) ?? { sign: 0, respond: 0 };
      slot.respond++;
      requestKeys.set(parsed.requestKey, slot);
      console.log(
        `[respond] tx=${row.txHash.slice(0, 10)} signer=${parsed.signerId} scheme=${parsed.scheme} key=${parsed.requestKey.slice(0, 28)}…`,
      );
    }
  }

  for (const row of [...directSignRows, ...fastAuthSignRows]) {
    const signerId = row.signerAccountId ?? "";
    const logs = await fetchV1SignerLogs(rpcManager, row.txHash, signerId);
    for (const log of logs) {
      const parsed = parseSignLog(log);
      if (!parsed) {
        if (log.startsWith("sign:")) signFail++;
        continue;
      }
      signOk++;
      const slot = requestKeys.get(parsed.requestKey) ?? { sign: 0, respond: 0 };
      slot.sign++;
      requestKeys.set(parsed.requestKey, slot);
      console.log(
        `[sign]    tx=${row.txHash.slice(0, 10)} pred=${parsed.predecessorId} path=${(parsed.path || "(empty)").slice(0, 40)} scheme=${parsed.scheme} key=${parsed.requestKey.slice(0, 28)}…`,
      );
    }
  }

  console.log("\n─── Summary ───");
  console.log(`respond logs parsed: ${respondOk} ok, ${respondFail} failed`);
  console.log(`sign    logs parsed: ${signOk} ok, ${signFail} failed`);
  console.log(`distinct request keys observed: ${requestKeys.size}`);
  const matched = [...requestKeys.values()].filter((s) => s.sign > 0 && s.respond > 0).length;
  console.log(`request keys matched (have BOTH sign and respond): ${matched}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
