/**
 * Validate decodeSignDelegatePublicKey against ground truth.
 *
 * Compares the decoded public key (extracted inline from sign_payload bytes
 * via Borsh + base58) against userDerivedPublicKey (resolved independently
 * via FastNEAR by public-key-accounts.ts). If both code paths agree on a
 * sample of N events, the decoder is correct.
 */
import "dotenv/config";

import { Buffer } from "node:buffer";

import { decodeSignDelegatePublicKey } from "@/lib/indexers/decode-sign-action";
import { prisma } from "@/lib/prisma";

function extractSignPayload(payload: unknown, actionIndex: number): number[] | null {
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
  return candidate as number[];
}

async function main() {
  const sampleSize = 200;
  const events = await prisma.fastAuthSignEvent.findMany({
    where: { userDerivedPublicKey: { not: null } },
    orderBy: { id: "desc" },
    take: sampleSize,
    select: { id: true, txHash: true, actionIndex: true, userDerivedPublicKey: true },
  });

  if (events.length === 0) {
    console.log("No sign events with resolved userDerivedPublicKey to validate against.");
    await prisma.$disconnect();
    return;
  }

  const txHashes = [...new Set(events.map((e) => e.txHash))];
  const txRows = await prisma.nearTransaction.findMany({
    where: { txHash: { in: txHashes } },
    select: { txHash: true, payload: true },
  });
  const payloadByTx = new Map(txRows.map((r) => [r.txHash, r.payload]));

  let matches = 0;
  let mismatches = 0;
  let unparseable = 0;
  const mismatchSamples: Array<{ id: string; expected: string; got: string | null }> = [];

  for (const event of events) {
    const payload = payloadByTx.get(event.txHash);
    const bytes = payload ? extractSignPayload(payload, event.actionIndex) : null;
    if (!bytes) {
      unparseable += 1;
      continue;
    }
    const decoded = decodeSignDelegatePublicKey(bytes);
    if (decoded === event.userDerivedPublicKey) {
      matches += 1;
    } else {
      mismatches += 1;
      if (mismatchSamples.length < 5) {
        mismatchSamples.push({
          id: event.id.toString(),
          expected: event.userDerivedPublicKey ?? "(null)",
          got: decoded,
        });
      }
    }
  }

  console.log(`Sample size: ${events.length}`);
  console.log(`Matches:      ${matches}`);
  console.log(`Mismatches:   ${mismatches}`);
  console.log(`Unparseable:  ${unparseable}`);

  if (mismatches > 0) {
    console.log("\nFirst few mismatches:");
    for (const s of mismatchSamples) {
      console.log(`  id=${s.id}`);
      console.log(`    expected: ${s.expected}`);
      console.log(`    got:      ${s.got ?? "(null)"}`);
    }
  }

  await prisma.$disconnect();
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
