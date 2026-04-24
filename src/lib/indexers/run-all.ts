import { prisma } from "@/lib/prisma";
import { collectFastAuthChainHealth } from "@/lib/indexers/fastauth-head-status";
import { collectNearState } from "@/lib/indexers/near";
import { collectFastAuthPublicKeyAccounts } from "@/lib/indexers/public-key-accounts";
import type { IndexerRunResult } from "@/lib/indexers/types";

const INDEXER_HEARTBEAT_MS = 15_000;

async function runIndexerWithLogs(params: {
  source: string;
  run: () => Promise<IndexerRunResult>;
}): Promise<IndexerRunResult> {
  const startedAt = Date.now();

  console.log(
    JSON.stringify({
      level: "info",
      message: "Indexer started",
      source: params.source,
      startedAt: new Date(startedAt).toISOString(),
    }),
  );

  const heartbeat = setInterval(() => {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Indexer still running",
        source: params.source,
        elapsedMs: Date.now() - startedAt,
      }),
    );
  }, INDEXER_HEARTBEAT_MS);

  try {
    const result = await params.run();
    const elapsedMs = Date.now() - startedAt;

    console.log(
      JSON.stringify({
        level: "info",
        message: "Indexer finished",
        source: params.source,
        status: result.status,
        inserted: result.inserted ?? 0,
        elapsedMs,
      }),
    );

    return result;
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runAllIndexers(): Promise<IndexerRunResult[]> {
  // The collectors hit disjoint upstreams (NEAR RPC for the main backfill and
  // chain-head probe, FastNEAR for public-key lookups) and write to disjoint
  // tables, so they can run concurrently. The chain-health collector throttles
  // itself internally so it doesn't actually fire on every tick.
  const [near, publicKeyAccounts, chainHealth] = await Promise.all([
    runIndexerWithLogs({
      source: "near",
      run: () => collectNearState(prisma),
    }),
    runIndexerWithLogs({
      source: "fastauth_public_keys",
      run: () => collectFastAuthPublicKeyAccounts(prisma),
    }),
    runIndexerWithLogs({
      source: "fastauth_chain_health",
      run: () => collectFastAuthChainHealth(prisma),
    }),
  ]);

  return [near, publicKeyAccounts, chainHealth];
}
