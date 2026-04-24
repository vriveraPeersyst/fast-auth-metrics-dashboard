type RpcEndpoint = {
  url: string;
  failures: number;
  lastFailure?: number;
  isBlacklisted: boolean;
};

const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;
// Short enough that a transient burst-limited RPC recovers within a few indexer
// ticks, rather than being locked out for the full 5 min a stricter blacklist
// would impose.
const DEFAULT_BLACKLIST_DURATION_MS = 60 * 1000;
const DEFAULT_MAX_RPC_FAILURES = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_ID = "fast-auth-metrics-dashboard";

// Hardcoded NEAR RPC pool. All queries (latest-final, block-by-height,
// chunk-by-hash) rotate across this list with failover on 429/5xx.
// Archival endpoints are intentionally excluded — we do not need deep
// historical backfill; checkpoint-driven polling against public endpoints is
// sufficient for the FastAuth metrics window.
//
// Ordered by **sustained capacity** at c=40 ramp benchmark (2026-04-24),
// not raw single-call latency. The manager is sticky-current: position 0
// handles all traffic until it 429s, then rotates. An endpoint that is
// fast at c=5 but rate-limits at c=40 (e.g. `rpc.shitzuapes.xyz`) is the
// wrong choice for position 0 under our 120-concurrent indexer load.
//
// Per-endpoint capacity (100% success rate + achieved RPS at c=40):
//   blockpi       100%, 113 RPS, p50 151ms — workhorse
//   lava          100%,  95 RPS, p50 188ms — tied for fastest single-call
//   fastnear      100%,  73 RPS, p50 251ms — reliable mid-tier
//   drpc          100%,  40 RPS, p50 436ms — reliable, degrades under load
//   1rpc.io       100%,  28 RPS, p50 693ms — slow but never errored
//   shitzuapes     37%,  38 RPS, p50 235ms — rate-limits hard, failover only
//
// Dropped: api.zan.top (HTTP 400 on all calls), rpc.intea.rs (0% @ c=10).
export const NEAR_RPC_URLS = [
  "https://near.blockpi.network/v1/rpc/public",
  "https://near.lava.build",
  "https://free.rpc.fastnear.com",
  "https://near.drpc.org",
  "https://1rpc.io/near",
  "https://rpc.shitzuapes.xyz",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueUrls(urls: string[]): string[] {
  const normalized = urls.map((url) => url.trim()).filter(Boolean);
  return [...new Set(normalized)];
}

export function createNearRpcManager(): NearRpcManager {
  return new NearRpcManager(NEAR_RPC_URLS);
}

// Error thrown when `request()` exhausts all retries. Carries per-endpoint
// outcome metadata so callers can reason about *why* the request failed —
// specifically, how many distinct endpoints confirmed UNKNOWN_BLOCK. Callers
// that permanently skip missing heights (e.g., `near.ts`) use this to require
// majority consensus before marking a height as genuinely absent on-chain.
export class NearRpcExhaustedError extends Error {
  readonly unknownBlockEndpoints: ReadonlySet<string>;
  readonly healthyEndpointCount: number;
  readonly totalAttempts: number;

  constructor(
    message: string,
    unknownBlockEndpoints: ReadonlySet<string>,
    healthyEndpointCount: number,
    totalAttempts: number,
  ) {
    super(message);
    this.name = "NearRpcExhaustedError";
    this.unknownBlockEndpoints = unknownBlockEndpoints;
    this.healthyEndpointCount = healthyEndpointCount;
    this.totalAttempts = totalAttempts;
  }
}

function isUnknownBlockMessage(message: string): boolean {
  return (
    message.includes("UNKNOWN_BLOCK") ||
    message.includes("Unknown block") ||
    message.includes("DB Not Found")
  );
}

export class NearRpcManager {
  private readonly endpoints: RpcEndpoint[];
  private currentIndex = 0;
  private readonly maxFailures: number;
  private readonly blacklistDurationMs: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly requestId: string;

  constructor(
    urls: string[],
    options?: {
      maxFailures?: number;
      blacklistDurationMs?: number;
      maxAttempts?: number;
      baseDelayMs?: number;
      requestTimeoutMs?: number;
      requestId?: string;
    },
  ) {
    this.endpoints = uniqueUrls(urls).map((url) => ({
      url,
      failures: 0,
      isBlacklisted: false,
    }));

    this.maxFailures = options?.maxFailures ?? DEFAULT_MAX_RPC_FAILURES;
    this.blacklistDurationMs = options?.blacklistDurationMs ?? DEFAULT_BLACKLIST_DURATION_MS;
    this.baseDelayMs = options?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.maxAttempts = options?.maxAttempts ?? Math.max(this.endpoints.length * 2, DEFAULT_RETRY_COUNT);
    this.requestTimeoutMs = options?.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.requestId = options?.requestId ?? DEFAULT_REQUEST_ID;

    if (this.endpoints.length === 0) {
      throw new Error("NearRpcManager requires at least one RPC endpoint.");
    }
  }

  private clearExpiredBlacklists(): void {
    const now = Date.now();

    for (const endpoint of this.endpoints) {
      if (!endpoint.isBlacklisted || !endpoint.lastFailure) {
        continue;
      }

      if (now - endpoint.lastFailure > this.blacklistDurationMs) {
        endpoint.isBlacklisted = false;
        endpoint.failures = 0;
        endpoint.lastFailure = undefined;
      }
    }
  }

  private resetAllEndpoints(): void {
    for (const endpoint of this.endpoints) {
      endpoint.failures = 0;
      endpoint.isBlacklisted = false;
      endpoint.lastFailure = undefined;
    }

    this.currentIndex = 0;
  }

  private getAvailableEndpoints(): RpcEndpoint[] {
    this.clearExpiredBlacklists();

    const available = this.endpoints.filter((endpoint) => !endpoint.isBlacklisted);
    if (available.length > 0) {
      return available;
    }

    this.resetAllEndpoints();
    return this.endpoints;
  }

  // Round-robin: advance `currentIndex` atomically on every call and return
  // the endpoint that was at the previous index. JS is single-threaded, so
  // concurrent callers entering this method sequentially get distinct
  // endpoints (120 concurrent calls spread ~20 per endpoint across 6 URLs).
  private pickNextEndpoint(): RpcEndpoint {
    const available = this.getAvailableEndpoints();
    const idx = this.currentIndex % available.length;
    this.currentIndex = (this.currentIndex + 1) % available.length;
    return available[idx];
  }

  private isRateLimit(status: number, message: string): boolean {
    if (status === 429) return true;
    return (
      message.includes("rate") ||
      message.includes("throttle") ||
      message.includes("usage limit") ||
      message.includes("quota") ||
      message.includes("too many requests") ||
      message.includes("upgrade")
    );
  }

  private isServerError(status: number): boolean {
    return status >= 500;
  }

  private isConnectionError(message: string): boolean {
    return (
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("etimedout") ||
      message.includes("enotfound") ||
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("fetch failed")
    );
  }

  // Record a failure against an endpoint. Does not manipulate `currentIndex`
  // — round-robin advancement happens in `pickNextEndpoint`. Blacklisting is
  // what removes a failing endpoint from rotation (via `getAvailableEndpoints`
  // filtering on `isBlacklisted`).
  private handleFailure(endpoint: RpcEndpoint, status: number | null, message: string): void {
    endpoint.failures += 1;
    endpoint.lastFailure = Date.now();

    const normalizedMessage = message.toLowerCase();
    const shouldBlacklistImmediately =
      this.isRateLimit(status ?? 0, normalizedMessage) ||
      this.isServerError(status ?? 0) ||
      this.isConnectionError(normalizedMessage);

    if (shouldBlacklistImmediately || endpoint.failures >= this.maxFailures) {
      endpoint.isBlacklisted = true;
    }
  }

  async request<TResponse>(method: string, params: unknown, contextLabel: string): Promise<TResponse> {
    let lastError: Error | null = null;
    // Track which endpoints responded with UNKNOWN_BLOCK-style errors so the
    // caller can require majority consensus before treating a height as
    // genuinely skipped.
    const unknownBlockEndpoints = new Set<string>();
    const healthyEndpointCount = this.endpoints.length;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const endpoint = this.pickNextEndpoint();
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => {
        abortController.abort(`timeout after ${this.requestTimeoutMs}ms`);
      }, this.requestTimeoutMs);

      try {
        const response = await fetch(endpoint.url, {
          method: "POST",
          signal: abortController.signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: this.requestId,
            method,
            params,
          }),
        });

        if (!response.ok) {
          const responseText = await response.text();
          const responseSnippet = responseText.slice(0, 220).replace(/\s+/g, " ").trim();
          const message = `NEAR ${contextLabel} request failed (${response.status}) via ${endpoint.url}${responseSnippet ? `: ${responseSnippet}` : "."}`;

          if (isUnknownBlockMessage(responseSnippet)) {
            unknownBlockEndpoints.add(endpoint.url);
          }
          lastError = new Error(message);
          this.handleFailure(endpoint, response.status, responseSnippet || message);
        } else {
          const payload = (await response.json()) as {
            error?: unknown;
          };

          if (payload && typeof payload === "object" && payload.error !== undefined) {
            const errorSnippet = JSON.stringify(payload.error).slice(0, 220).replace(/\s+/g, " ");
            const message = `NEAR ${contextLabel} RPC error via ${endpoint.url}${errorSnippet ? `: ${errorSnippet}` : "."}`;

            if (isUnknownBlockMessage(errorSnippet)) {
              unknownBlockEndpoints.add(endpoint.url);
            }
            lastError = new Error(message);
            this.handleFailure(endpoint, response.status, errorSnippet || message);
          } else {
            endpoint.failures = 0;
            endpoint.isBlacklisted = false;
            endpoint.lastFailure = undefined;
            return payload as TResponse;
          }
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.name === "AbortError"
              ? `timeout after ${this.requestTimeoutMs}ms`
              : error.message
            : `Unknown NEAR ${contextLabel} request failure via ${endpoint.url}.`;

        lastError = new Error(`NEAR ${contextLabel} request failed via ${endpoint.url}: ${message}`);
        this.handleFailure(endpoint, null, message);
      } finally {
        clearTimeout(timeoutHandle);
      }

      if (attempt < this.maxAttempts) {
        await sleep(Math.min(this.baseDelayMs * attempt, 2_000));
      }
    }

    const baseMessage = lastError?.message ?? `NEAR ${contextLabel} request failed.`;
    throw new NearRpcExhaustedError(
      baseMessage,
      unknownBlockEndpoints,
      healthyEndpointCount,
      this.maxAttempts,
    );
  }
}