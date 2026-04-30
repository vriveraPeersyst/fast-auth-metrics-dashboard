import { prisma } from "@/lib/prisma";
import { createNearRpcManager } from "@/lib/indexers/near-rpc-manager";

const V1_SIGNER = "v1.signer";
const SAMPLE_SIZE = 5;

type ReceiptOutcome = {
  outcome?: {
    executor_id?: string;
    logs?: string[];
    status?: unknown;
  };
};

type TxResponse = {
  result?: {
    transaction_outcome?: ReceiptOutcome;
    receipts_outcome?: ReceiptOutcome[];
  };
};

type Sample = {
  source: "mpc_transactions" | "near_transactions";
  txHash: string;
  signerId: string;
  methodName: string;
  blockTimestamp: Date;
};

async function fetchSignerLogs(
  rpcManager: ReturnType<typeof createNearRpcManager>,
  txHash: string,
  signerId: string,
): Promise<{ logs: string[]; receiptCount: number; v1SignerReceiptCount: number; lastError: string | null }> {
  let response: TxResponse;
  try {
    response = await rpcManager.request<TxResponse>("tx", [txHash, signerId], `_validate-mpc-logs:${txHash}`);
  } catch (error) {
    return {
      logs: [],
      receiptCount: 0,
      v1SignerReceiptCount: 0,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }

  const receipts = response.result?.receipts_outcome ?? [];
  const v1SignerReceipts = receipts.filter(
    (r) => (r.outcome?.executor_id ?? "").trim().toLowerCase() === V1_SIGNER,
  );
  const logs: string[] = [];
  for (const r of v1SignerReceipts) {
    for (const line of r.outcome?.logs ?? []) {
      logs.push(line);
    }
  }
  return {
    logs,
    receiptCount: receipts.length,
    v1SignerReceiptCount: v1SignerReceipts.length,
    lastError: null,
  };
}

function pickRequestField(log: string): string | null {
  const idx = log.indexOf("request=");
  if (idx < 0) return null;
  return log.slice(idx + "request=".length);
}

async function main() {
  const rpcManager = createNearRpcManager();

  console.log("─── Fase 1: validación del formato de logs ───\n");
  console.log("Tomamos hasta 5 muestras de cada categoría y volcamos los logs de receipts");
  console.log("cuyo executor sea v1.signer. Buscamos: presencia + formato de `request=` en");
  console.log("los logs `sign:` y `respond:`, y si son comparables entre sí.\n");

  // 1) respond — desde mpc_transactions
  const respondRows = await prisma.mpcTransaction.findMany({
    where: { methodName: "respond" },
    orderBy: { blockTimestamp: "desc" },
    take: SAMPLE_SIZE,
    select: { txHash: true, signerAccountId: true, methodName: true, blockTimestamp: true },
  });
  // 2) sign top-level — desde mpc_transactions (los 45 directos)
  const directSignRows = await prisma.mpcTransaction.findMany({
    where: { methodName: "sign" },
    orderBy: { blockTimestamp: "desc" },
    take: SAMPLE_SIZE,
    select: { txHash: true, signerAccountId: true, methodName: true, blockTimestamp: true },
  });
  // 3) sign vía FastAuth — desde near_transactions (Path 1 existente)
  const fastAuthSignRows = await prisma.nearTransaction.findMany({
    where: { methodName: "sign" },
    orderBy: { blockTimestamp: "desc" },
    take: SAMPLE_SIZE,
    select: { txHash: true, signerAccountId: true, methodName: true, blockTimestamp: true },
  });

  const samples: Sample[] = [
    ...respondRows.map((r): Sample => ({
      source: "mpc_transactions",
      txHash: r.txHash,
      signerId: r.signerAccountId ?? "",
      methodName: r.methodName ?? "",
      blockTimestamp: r.blockTimestamp ?? new Date(0),
    })),
    ...directSignRows.map((r): Sample => ({
      source: "mpc_transactions",
      txHash: r.txHash,
      signerId: r.signerAccountId ?? "",
      methodName: r.methodName ?? "",
      blockTimestamp: r.blockTimestamp ?? new Date(0),
    })),
    ...fastAuthSignRows.map((r): Sample => ({
      source: "near_transactions",
      txHash: r.txHash,
      signerId: r.signerAccountId ?? "",
      methodName: r.methodName ?? "",
      blockTimestamp: r.blockTimestamp ?? new Date(0),
    })),
  ];

  const requestFields: Array<{ method: string; source: string; txHash: string; request: string }> = [];

  for (const sample of samples) {
    console.log(
      `═══ ${sample.source} | method=${sample.methodName} | signer=${sample.signerId}`,
    );
    console.log(`    tx=${sample.txHash}`);
    console.log(`    blockTimestamp=${sample.blockTimestamp.toISOString()}`);

    const result = await fetchSignerLogs(rpcManager, sample.txHash, sample.signerId);
    if (result.lastError) {
      console.log(`    [rpc-error] ${result.lastError}\n`);
      continue;
    }

    console.log(
      `    receipts=${result.receiptCount} (v1.signer=${result.v1SignerReceiptCount}); logs=${result.logs.length}`,
    );
    if (result.logs.length === 0) {
      console.log("    (sin logs en receipts de v1.signer)\n");
      continue;
    }

    for (const log of result.logs) {
      const truncated = log.length > 240 ? `${log.slice(0, 240)}…` : log;
      console.log(`    > ${truncated}`);
      const req = pickRequestField(log);
      if (req) {
        const reqHead = req.length > 200 ? `${req.slice(0, 200)}…` : req;
        requestFields.push({
          method: sample.methodName,
          source: sample.source,
          txHash: sample.txHash,
          request: reqHead,
        });
      }
    }
    console.log("");
  }

  console.log("─── Resumen `request=` por categoría ───\n");
  const grouped = new Map<string, typeof requestFields>();
  for (const r of requestFields) {
    const key = `${r.source}/${r.method}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }
  for (const [key, rows] of grouped) {
    console.log(`[${key}] (${rows.length} ocurrencias):`);
    for (const r of rows.slice(0, 3)) {
      console.log(`  request=${r.request}`);
    }
    console.log("");
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
