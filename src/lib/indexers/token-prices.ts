/**
 * Token price registry — fetches a snapshot of NEAR-mainnet FT prices from
 * the 1click cross-chain DeFi router (https://1click.chaindefuser.com/v0/tokens)
 * and exposes a `Map<contractAddress, TokenInfo>` for USD-value computation.
 *
 * Designed to be called once per worker iteration. Robust to the upstream
 * being slow or down — getCachedRegistry() returns the last-known-good map;
 * a failure on the very first call returns an empty registry (no pricing,
 * not a crash).
 */
const TOKENS_URL = "https://1click.chaindefuser.com/v0/tokens";
const FETCH_TIMEOUT_MS = 8_000;

export type TokenInfo = {
  contractAddress: string;
  symbol: string;
  decimals: number;
  usdPrice: number; // price per whole token (post-decimal-normalization)
  priceUpdatedAt: Date | null;
};

export type TokenRegistry = {
  // Map keyed by lowercased contract address.
  byContract: Map<string, TokenInfo>;
  // Convenience: native NEAR price (NEAR is wrap.near in the API) — used
  // for raw `Transfer` actions whose deposit is in yoctoNEAR with no
  // contract address.
  nativeNearPrice: number | null;
  fetchedAt: Date;
};

let cached: TokenRegistry | null = null;

type ApiToken = {
  blockchain?: string;
  contractAddress?: string;
  symbol?: string;
  decimals?: number;
  price?: number;
  priceUpdatedAt?: string;
};

async function fetchTokenList(): Promise<ApiToken[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(TOKENS_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`token-prices: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as ApiToken[];
    if (!Array.isArray(data)) {
      throw new Error("token-prices: response was not an array");
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function buildRegistry(tokens: ApiToken[]): TokenRegistry {
  const byContract = new Map<string, TokenInfo>();
  let nativeNearPrice: number | null = null;

  for (const t of tokens) {
    if (t.blockchain !== "near") continue;
    if (typeof t.contractAddress !== "string") continue;
    if (typeof t.decimals !== "number") continue;
    if (typeof t.price !== "number" || !Number.isFinite(t.price)) continue;

    const key = t.contractAddress.trim().toLowerCase();
    if (!key) continue;

    const info: TokenInfo = {
      contractAddress: key,
      symbol: typeof t.symbol === "string" ? t.symbol : key,
      decimals: t.decimals,
      usdPrice: t.price,
      priceUpdatedAt: t.priceUpdatedAt ? new Date(t.priceUpdatedAt) : null,
    };
    byContract.set(key, info);

    // Use wrap.near's price as the native NEAR price (1:1 by design).
    if (key === "wrap.near") {
      nativeNearPrice = t.price;
    }
  }

  return { byContract, nativeNearPrice, fetchedAt: new Date() };
}

/**
 * Refresh the in-process cache. Call once per worker iteration. Failures
 * leave the previous cache intact; we never throw to the caller.
 */
export async function refreshTokenRegistry(): Promise<TokenRegistry | null> {
  try {
    const tokens = await fetchTokenList();
    cached = buildRegistry(tokens);
    return cached;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.log(
      JSON.stringify({
        level: "warn",
        message: "token-prices: refresh failed; using stale cache",
        error: message,
        cacheAgeMs: cached ? Date.now() - cached.fetchedAt.getTime() : null,
      }),
    );
    return cached;
  }
}

/** Get the current cached registry without making a network request. */
export function getCachedRegistry(): TokenRegistry | null {
  return cached;
}
