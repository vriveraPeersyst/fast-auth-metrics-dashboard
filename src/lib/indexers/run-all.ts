import { prisma } from "@/lib/prisma";
import { collectAuth0Logs } from "@/lib/indexers/auth0";
import { collectNearState } from "@/lib/indexers/near";
import { collectServiceMetrics } from "@/lib/indexers/service-metrics";
import type { IndexerRunResult } from "@/lib/indexers/types";

export async function runAllIndexers(): Promise<IndexerRunResult[]> {
  const [auth0, serviceMetrics, near] = await Promise.all([
    collectAuth0Logs(prisma),
    collectServiceMetrics(prisma),
    collectNearState(prisma),
  ]);

  return [auth0, serviceMetrics, near];
}
