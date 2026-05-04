import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

// The dashboard renders one server component that fans out 60+ concurrent
// queries per render (Promise.all in getDashboardData plus nested Promise.all
// in each loadX helper). Prisma's default pool of `num_cpus * 2 + 1` lands at
// 5 on a 1-vCPU host, slow `$queryRaw` aggregations hold those slots, and the
// rest trip P2024 ("Timed out fetching a new connection from the connection
// pool"). connection_limit=1 is even worse — every query serializes and the
// cumulative wall-clock blows past pool_timeout.
//
// 10 connections is enough to drain the fan-out in 6 batches; 30s acquire
// timeout absorbs occasional slow aggregations. With ISR caching on the page
// (revalidate=60), only one render per minute actually fans out, so even
// concurrent Lambda instances on Vercel won't pile up against Railway's
// max_connections. Operator-set params in DATABASE_URL always win.
//
// Gate on NEXT_RUNTIME (set by Next.js in dashboard processes — both Vercel
// and local dev) so the override applies to anything rendering the dashboard
// but NOT to the Railway indexer worker (a tsx CLI process that imports this
// module). The worker keeps Prisma's normal default, since its concurrency
// shape is unrelated to the dashboard fan-out.
const DASHBOARD_DEFAULT_CONNECTION_LIMIT = 10;
const DASHBOARD_DEFAULT_POOL_TIMEOUT_SEC = 30;

function buildDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  if (!process.env.NEXT_RUNTIME) return raw;

  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", String(DASHBOARD_DEFAULT_CONNECTION_LIMIT));
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", String(DASHBOARD_DEFAULT_POOL_TIMEOUT_SEC));
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasourceUrl: buildDatasourceUrl(),
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
