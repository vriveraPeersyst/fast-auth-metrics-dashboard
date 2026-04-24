import "dotenv/config";

import { createNearRpcManager } from "@/lib/indexers/near-rpc-manager";
import { prisma } from "@/lib/prisma";

const CHECKPOINT_HEIGHT = "near_last_final_block_height";
const CHECKPOINT_HASH = "near_last_final_block_hash";
const CHECKPOINT_SCANNED_HEIGHT = "near_last_scanned_height";
const CHECKPOINT_CHAIN_HEAD_HEIGHT = "near_chain_head_height";
const CHECKPOINT_CHAIN_HEAD_HASH = "near_chain_head_hash";

type NearBlockResponse = {
  result?: {
    header?: {
      height?: number;
      hash?: string;
    };
  };
};

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");

  const rpcManager = createNearRpcManager();

  const [scannedCheckpoint, heightCheckpoint] = await Promise.all([
    prisma.indexerCheckpoint.findUnique({ where: { key: CHECKPOINT_SCANNED_HEIGHT } }),
    prisma.indexerCheckpoint.findUnique({ where: { key: CHECKPOINT_HEIGHT } }),
  ]);

  const currentScannedHeight = scannedCheckpoint?.value
    ? Number(scannedCheckpoint.value)
    : null;

  if (currentScannedHeight === null || !Number.isFinite(currentScannedHeight)) {
    throw new Error(
      `Missing ${CHECKPOINT_SCANNED_HEIGHT} checkpoint. Cannot skip forward without knowing where we are.`,
    );
  }

  const latestFinal = await rpcManager.request<NearBlockResponse>(
    "block",
    { finality: "final" },
    "skip-forward:final-block",
  );
  const latestHeight = latestFinal.result?.header?.height;
  const latestHash = latestFinal.result?.header?.hash;
  if (!latestHeight || !latestHash) {
    throw new Error("NEAR response did not include a final block height/hash.");
  }

  const gapStart = currentScannedHeight + 1;
  const gapEnd = latestHeight - 1;
  const gapSize = gapEnd - gapStart + 1;

  console.log("=== skip-forward summary ===");
  console.log(`current scanned checkpoint:   ${currentScannedHeight}`);
  console.log(`current height checkpoint:    ${heightCheckpoint?.value ?? "(unset)"}`);
  console.log(`latest final block (now):     ${latestHeight} (${latestHash})`);
  console.log(`gap to record:                ${gapStart} .. ${gapEnd}  (${gapSize} blocks)`);
  console.log(`new scanned checkpoint:       ${latestHeight}`);
  console.log(`next run will resume at:      ${latestHeight + 1}`);
  console.log("");

  if (gapSize <= 0) {
    console.log("No gap to record — scanned checkpoint is already at or past latest final.");
    console.log("Nothing to do. Exiting.");
    return;
  }

  if (!confirm) {
    console.log("(dry run) Re-run with --confirm to:");
    console.log("  - insert the new range into missing_block_ranges");
    console.log("  - advance the NEAR indexer checkpoints to chain tip");
    return;
  }

  // Insert the new gap into the missing_block_ranges table. Use upsert in case
  // a previous run already created the same range — this keeps the script
  // idempotent (re-running with --confirm won't fail or create duplicates).
  const startHeightBig = BigInt(gapStart);
  const endHeightBig = BigInt(gapEnd);
  const range = await prisma.missingBlockRange.upsert({
    where: { startHeight_endHeight: { startHeight: startHeightBig, endHeight: endHeightBig } },
    create: {
      startHeight: startHeightBig,
      endHeight: endHeightBig,
      reason:
        "skip-forward to chain tip: public RPC pool had pruned chunks for blocks in this range (UNKNOWN_CHUNK errors). Requires archival-backed backfill.",
      recordedAt: new Date(),
      status: "open",
    },
    update: {},
  });
  console.log(`Recorded gap as missing_block_ranges id=${range.id} (${range.status}).`);

  await prisma.$transaction([
    prisma.indexerCheckpoint.upsert({
      where: { key: CHECKPOINT_SCANNED_HEIGHT },
      create: { key: CHECKPOINT_SCANNED_HEIGHT, value: String(latestHeight) },
      update: { value: String(latestHeight) },
    }),
    prisma.indexerCheckpoint.upsert({
      where: { key: CHECKPOINT_HEIGHT },
      create: { key: CHECKPOINT_HEIGHT, value: String(latestHeight) },
      update: { value: String(latestHeight) },
    }),
    prisma.indexerCheckpoint.upsert({
      where: { key: CHECKPOINT_HASH },
      create: { key: CHECKPOINT_HASH, value: latestHash },
      update: { value: latestHash },
    }),
    prisma.indexerCheckpoint.upsert({
      where: { key: CHECKPOINT_CHAIN_HEAD_HEIGHT },
      create: { key: CHECKPOINT_CHAIN_HEAD_HEIGHT, value: String(latestHeight) },
      update: { value: String(latestHeight) },
    }),
    prisma.indexerCheckpoint.upsert({
      where: { key: CHECKPOINT_CHAIN_HEAD_HASH },
      create: { key: CHECKPOINT_CHAIN_HEAD_HASH, value: latestHash },
      update: { value: latestHash },
    }),
  ]);

  console.log("DB checkpoints advanced. Indexer will resume at tip on its next run.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
