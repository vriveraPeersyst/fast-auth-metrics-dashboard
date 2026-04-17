import "dotenv/config";

import { runAllIndexers } from "../lib/indexers/run-all";

const DEFAULT_INTERVAL_MS = 30_000;

function resolveIntervalMs(): number {
  const raw = process.env.INDEXER_POLL_INTERVAL_MS;
  if (!raw) {
    return DEFAULT_INTERVAL_MS;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 5_000) {
    throw new Error("INDEXER_POLL_INTERVAL_MS must be a number >= 5000.");
  }

  return Math.floor(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoop(intervalMs: number): Promise<void> {
  let runCount = 0;

  while (true) {
    runCount += 1;
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();

    try {
      const results = await runAllIndexers();
      console.log(
        JSON.stringify({
          level: "info",
          message: "Indexer iteration completed",
          runCount,
          timestamp,
          results,
        }),
      );
    } catch (error) {
      const details = error instanceof Error ? error.message : "Unknown indexer worker error.";
      console.error(
        JSON.stringify({
          level: "error",
          message: "Indexer iteration crashed",
          runCount,
          timestamp,
          details,
        }),
      );
    }

    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(0, intervalMs - elapsed);
    await sleep(waitMs);
  }
}

async function main(): Promise<void> {
  const intervalMs = resolveIntervalMs();

  console.log(
    JSON.stringify({
      level: "info",
      message: "Indexer worker started",
      intervalMs,
      startedAt: new Date().toISOString(),
    }),
  );

  await runLoop(intervalMs);
}

void main().catch((error: unknown) => {
  const details = error instanceof Error ? error.message : "Unknown startup error.";
  console.error(
    JSON.stringify({
      level: "error",
      message: "Indexer worker failed to start",
      details,
    }),
  );
  process.exit(1);
});
