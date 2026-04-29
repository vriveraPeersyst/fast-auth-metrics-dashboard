import { prisma } from "@/lib/prisma";
import { collectFastAuthConsumerHealth } from "@/lib/indexers/fastauth-consumer-health";
import { collectFastAuthHealth } from "@/lib/indexers/fastauth-health";
import { collectFastAuthUserHealth } from "@/lib/indexers/fastauth-user-health";
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
  // The collectors hit disjoint upstreams (NEAR RPC for backfill + health
  // classifiers, FastNEAR for public-key lookups) and write to disjoint
  // tables, so they can run concurrently. The three health collectors each do
  // bounded work per tick (DISCOVER_LIMIT new + RETRY_LIMIT retries) so they
  // share the public RPC pool predictably.
  const [near, publicKeyAccounts, health, consumerHealth, userHealth] =
    await Promise.all([
      runIndexerWithLogs({
        source: "near",
        run: () => collectNearState(prisma),
      }),
      runIndexerWithLogs({
        source: "fastauth_public_keys",
        run: () => collectFastAuthPublicKeyAccounts(prisma),
      }),
      runIndexerWithLogs({
        source: "fastauth_health",
        run: () => collectFastAuthHealth(prisma),
      }),
      runIndexerWithLogs({
        source: "fastauth_consumer_health",
        run: () => collectFastAuthConsumerHealth(prisma),
      }),
      runIndexerWithLogs({
        source: "fastauth_user_health",
        run: () => collectFastAuthUserHealth(prisma),
      }),
    ]);

  return [near, publicKeyAccounts, health, consumerHealth, userHealth];
}
