type RpcEndpoint = {
  url: string;
  failures: number;
  lastFailure?: number;
  isBlacklisted: boolean;
};

const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;
const DEFAULT_BLACKLIST_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RPC_FAILURES = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_ID = "fast-auth-metrics-dashboard";

export const DEFAULT_NORMAL_NEAR_RPC_URLS = [
  "https://near.lava.build",
  "https://near.blockpi.network/v1/rpc/public",
  "https://rpc.shitzuapes.xyz",
];
export const DEFAULT_ARCHIVAL_NEAR_RPC_URLS = [
  "https://archival-rpc.mainnet.near.org",
  "https://archival-rpc.mainnet.fastnear.com",
];
export const DEFAULT_NORMAL_NEAR_RPC_URL = DEFAULT_NORMAL_NEAR_RPC_URLS[0];
export const DEFAULT_ARCHIVAL_NEAR_RPC_URL = "https://archival-rpc.mainnet.fastnear.com";

function normalizeUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRequestTimeoutMs(): number {
  const raw = process.env.NEAR_RPC_REQUEST_TIMEOUT_MS;

  if (!raw) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1_000) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  return Math.floor(parsed);
}

export function uniqueUrls(urls: Array<string | null | undefined>): string[] {
  const normalized = urls
    .map((url) => normalizeUrl(url))
    .filter((url): url is string => Boolean(url));

  return [...new Set(normalized)];
}

export function parseRpcFallbackUrls(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

export function resolveNearRpcManagerUrls(params: {
  primaryUrl?: string | null;
  defaultUrls: string[];
  fallbackRaw?: string | null;
}): string[] {
  const defaults = uniqueUrls(params.defaultUrls);

  if (defaults.length === 0) {
    throw new Error("resolveNearRpcManagerUrls requires at least one default RPC URL.");
  }

  const primary = normalizeUrl(params.primaryUrl) ?? defaults[0];

  return uniqueUrls([primary, ...defaults, ...parseRpcFallbackUrls(params.fallbackRaw)]);
}

export function resolveNormalNearRpcManagerUrlsFromEnv(): string[] {
  return resolveNearRpcManagerUrls({
    primaryUrl: process.env.NEAR_RPC_URL ?? DEFAULT_NORMAL_NEAR_RPC_URL,
    defaultUrls: DEFAULT_NORMAL_NEAR_RPC_URLS,
    fallbackRaw: process.env.NEAR_RPC_FALLBACKS,
  });
}

export function resolveArchivalNearRpcManagerUrlsFromEnv(): string[] {
  return resolveNearRpcManagerUrls({
    primaryUrl: process.env.NEAR_ARCHIVAL_RPC_URL ?? DEFAULT_ARCHIVAL_NEAR_RPC_URL,
    defaultUrls: DEFAULT_ARCHIVAL_NEAR_RPC_URLS,
    fallbackRaw: process.env.NEAR_ARCHIVAL_RPC_FALLBACKS,
  });
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
    this.requestTimeoutMs = options?.requestTimeoutMs ?? resolveRequestTimeoutMs();
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

  private getCurrentEndpoint(): RpcEndpoint {
    const available = this.getAvailableEndpoints();

    if (this.currentIndex >= available.length) {
      this.currentIndex = 0;
    }

    return available[this.currentIndex];
  }

  private switchToNextEndpoint(): void {
    const available = this.getAvailableEndpoints();

    if (available.length <= 1) {
      this.currentIndex = 0;
      return;
    }

    this.currentIndex = (this.currentIndex + 1) % available.length;
  }

  private isRateLimit(status: number, message: string): boolean {
    return status === 429 || message.includes("rate") || message.includes("throttle");
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

  private handleFailure(endpoint: RpcEndpoint, status: number | null, message: string): void {
    endpoint.failures += 1;
    endpoint.lastFailure = Date.now();

    const normalizedMessage = message.toLowerCase();
    const shouldSwitchImmediately =
      this.isRateLimit(status ?? 0, normalizedMessage) ||
      this.isServerError(status ?? 0) ||
      this.isConnectionError(normalizedMessage);

    if (shouldSwitchImmediately || endpoint.failures >= this.maxFailures) {
      endpoint.isBlacklisted = true;
    }

    this.switchToNextEndpoint();
  }

  async request<TResponse>(method: string, params: unknown, contextLabel: string): Promise<TResponse> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const endpoint = this.getCurrentEndpoint();
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

          lastError = new Error(message);
          this.handleFailure(endpoint, response.status, responseSnippet || message);
        } else {
          const payload = (await response.json()) as {
            error?: unknown;
          };

          if (payload && typeof payload === "object" && payload.error !== undefined) {
            const errorSnippet = JSON.stringify(payload.error).slice(0, 220).replace(/\s+/g, " ");
            const message = `NEAR ${contextLabel} RPC error via ${endpoint.url}${errorSnippet ? `: ${errorSnippet}` : "."}`;

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

    throw lastError ?? new Error(`NEAR ${contextLabel} request failed.`);
  }
}