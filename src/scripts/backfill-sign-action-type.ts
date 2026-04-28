/**
 * One-shot backfill: derive sign_action_type for every fastauth_sign_events
 * row from the corresponding near_transactions.payload_json.
 *
 * Run: pnpm tsx src/scripts/backfill-sign-action-type.ts
 *      pnpm tsx src/scripts/backfill-sign-action-type.ts --dry-run
 *      pnpm tsx src/scripts/backfill-sign-action-type.ts --batch=2000
 */
import "dotenv/config";

import { Buffer } from "node:buffer";

import type { Prisma } from "@prisma/client";

import { decodeSignActionType } from "@/lib/indexers/decode-sign-action";
import { prisma } from "@/lib/prisma";

const DEFAULT_BATCH = 1000;

function parseBatchArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--batch="));
  if (!arg) return DEFAULT_BATCH;
  const value = Number(arg.split("=")[1]);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_BATCH;
  return Math.floor(value);
}

function actionTypeFromTx(payload: unknown, actionIndex: number): string | null {
  if (!payload || typeof payload !== "object") return null;
  const actions = (payload as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return null;
  const action = actions[actionIndex];
  if (!action || typeof action !== "object") return null;
  const fc = (action as { FunctionCall?: unknown }).FunctionCall;
  if (!fc || typeof fc !== "object") return null;
  const argsField = (fc as { args?: unknown }).args;
  if (typeof argsField !== "string") return null;

  let argsJson: unknown;
  try {
    const decoded = Buffer.from(argsField, "base64").toString("utf8");
    argsJson = JSON.parse(decoded);
  } catch {
    return null;
  }

  const candidate =
    (argsJson as { sign_payload?: unknown; signPayload?: unknown })?.sign_payload ??
    (argsJson as { signPayload?: unknown })?.signPayload ??
    null;

  if (!Array.isArray(candidate)) return null;
  if (!candidate.every((v) => typeof v === "number")) return null;

  return decodeSignActionType(candidate as number[]);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const batchSize = parseBatchArg();

  const totalNeedingBackfill = await prisma.fastAuthSignEvent.count({
    where: { signActionType: null },
  });

  console.log(
    `Sign events missing sign_action_type: ${totalNeedingBackfill} (batch=${batchSize}, dry-run=${dryRun}).`,
  );

  if (totalNeedingBackfill === 0) {
    await prisma.$disconnect();
    return;
  }

  let cursor: bigint | null = null;
  let processed = 0;
  let updated = 0;
  const counts = new Map<string, number>();

  type EventRow = { id: bigint; txHash: string; actionIndex: number };

  while (true) {
    const events: EventRow[] = await prisma.fastAuthSignEvent.findMany({
      where: { signActionType: null, ...(cursor !== null ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: batchSize,
      select: { id: true, txHash: true, actionIndex: true },
    });

    if (events.length === 0) break;

    const txHashes: string[] = [...new Set(events.map((e: EventRow) => e.txHash))];
    const txRows = await prisma.nearTransaction.findMany({
      where: { txHash: { in: txHashes } },
      select: { txHash: true, payload: true },
    });
    const payloadByTx = new Map(txRows.map((r) => [r.txHash, r.payload as Prisma.JsonValue]));

    const updatesByType = new Map<string, bigint[]>();

    for (const event of events) {
      processed += 1;
      const payload = payloadByTx.get(event.txHash);
      const actionType = payload ? actionTypeFromTx(payload, event.actionIndex) : null;
      const value = actionType ?? "Unparseable";
      counts.set(value, (counts.get(value) ?? 0) + 1);

      const list = updatesByType.get(value) ?? [];
      list.push(event.id);
      updatesByType.set(value, list);
    }

    if (!dryRun) {
      for (const [actionType, ids] of updatesByType) {
        const result = await prisma.fastAuthSignEvent.updateMany({
          where: { id: { in: ids } },
          data: { signActionType: actionType },
        });
        updated += result.count;
      }
    }

    cursor = events[events.length - 1].id;
    process.stdout.write(`processed=${processed}/${totalNeedingBackfill} updated=${updated}\r`);
  }

  process.stdout.write("\n");
  console.log("Action type distribution from this run:");
  for (const [type, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
