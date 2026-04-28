import type { TokenRegistry } from "@/lib/indexers/token-prices";

const NATIVE_NEAR_DECIMALS = 24;

export type TokenMovement = {
  symbol: string;
  decimals: number;
  rawAmount: string; // u128-ish string, kept as text so we don't lose precision
  valueUsd: number;
};

export type ComputedTxValue = {
  totalUsd: number | null; // null when no priceable movement
  tokens: TokenMovement[];
};

/**
 * Walk an action list and return:
 *   - totalUsd: sum of USD value moved (null if no priced movement)
 *   - tokens:   per-token breakdown (one entry per priced movement)
 *
 * Sources of value we count:
 *   - Transfer { deposit }                                   → native NEAR
 *   - FunctionCall { method_name: "ft_transfer" | "ft_transfer_call" | "ft_burn", args }
 *                                                            → FT transfer
 *   - FunctionCall.deposit (rare, when a FunctionCall also attaches NEAR)
 *
 * `receiverId` is the FT contract address for FunctionCall path. For native
 * Transfer it's irrelevant.
 */
export function computeActionsValue(params: {
  actions: unknown[];
  receiverId: string;
  registry: TokenRegistry | null;
}): ComputedTxValue {
  const { actions, receiverId, registry } = params;
  const empty: ComputedTxValue = { totalUsd: null, tokens: [] };
  if (!registry) return empty;
  if (!Array.isArray(actions) || actions.length === 0) return empty;

  const tokens: TokenMovement[] = [];

  for (const action of actions) {
    if (!action || typeof action !== "object") continue;

    // Native NEAR Transfer
    const transfer = (action as Record<string, unknown>).Transfer;
    if (transfer && typeof transfer === "object") {
      const deposit = (transfer as Record<string, unknown>).deposit;
      if (typeof deposit === "string" && registry.nativeNearPrice !== null) {
        const usd = yoctoNearToUsd(deposit, registry.nativeNearPrice);
        if (usd !== null && usd > 0) {
          tokens.push({
            symbol: "NEAR",
            decimals: NATIVE_NEAR_DECIMALS,
            rawAmount: deposit,
            valueUsd: usd,
          });
        }
      }
      continue;
    }

    const fc = (action as Record<string, unknown>).FunctionCall;
    if (fc && typeof fc === "object") {
      const fcRecord = fc as Record<string, unknown>;
      const methodName = fcRecord.method_name;
      const argsField = fcRecord.args;
      const fcDeposit = fcRecord.deposit;

      // Native NEAR attached to the FunctionCall itself.
      if (typeof fcDeposit === "string" && registry.nativeNearPrice !== null) {
        const usd = yoctoNearToUsd(fcDeposit, registry.nativeNearPrice);
        if (usd !== null && usd > 0) {
          tokens.push({
            symbol: "NEAR",
            decimals: NATIVE_NEAR_DECIMALS,
            rawAmount: fcDeposit,
            valueUsd: usd,
          });
        }
      }

      // FT transfer to a known token contract.
      if (
        typeof methodName === "string" &&
        (methodName === "ft_transfer" ||
          methodName === "ft_transfer_call" ||
          methodName === "ft_burn") &&
        typeof argsField === "string"
      ) {
        const tokenInfo = registry.byContract.get(receiverId.trim().toLowerCase());
        if (tokenInfo) {
          const amount = decodeFtTransferAmount(argsField);
          if (amount !== null) {
            const usd = rawAmountToUsd(amount, tokenInfo.decimals, tokenInfo.usdPrice);
            if (usd !== null && usd > 0) {
              tokens.push({
                symbol: tokenInfo.symbol,
                decimals: tokenInfo.decimals,
                rawAmount: amount,
                valueUsd: usd,
              });
            }
          }
        }
      }
      continue;
    }
  }

  if (tokens.length === 0) return empty;

  const totalUsd = tokens.reduce((sum, t) => sum + t.valueUsd, 0);
  return {
    totalUsd: Math.round(totalUsd * 10000) / 10000,
    tokens,
  };
}

/** Backwards-compatible scalar wrapper kept so older callers don't break. */
export function computeActionsValueUsd(params: {
  actions: unknown[];
  receiverId: string;
  registry: TokenRegistry | null;
}): number | null {
  return computeActionsValue(params).totalUsd;
}

function yoctoNearToUsd(yoctoStr: string, price: number): number | null {
  let yocto: bigint;
  try {
    yocto = BigInt(yoctoStr);
  } catch {
    return null;
  }
  if (yocto <= BigInt(0)) return null;
  const SCALE = BigInt(10) ** BigInt(18);
  const scaled = Number(yocto / SCALE) / 1_000_000;
  return scaled * price;
}

function rawAmountToUsd(rawAmount: string, decimals: number, price: number): number | null {
  let amount: bigint;
  try {
    amount = BigInt(rawAmount);
  } catch {
    return null;
  }
  if (amount <= BigInt(0)) return null;

  const SAFE_PRECISION = 6;
  const dropPlaces = Math.max(0, decimals - SAFE_PRECISION);
  const dropScale = BigInt(10) ** BigInt(dropPlaces);
  const safeInt = Number(amount / dropScale);
  if (!Number.isFinite(safeInt)) return null;

  const remainingDivisor = 10 ** Math.min(decimals, SAFE_PRECISION);
  const tokens = safeInt / remainingDivisor;
  return tokens * price;
}

function decodeFtTransferAmount(argsField: string): string | null {
  try {
    const json = Buffer.from(argsField, "base64").toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const amount = parsed.amount;
    return typeof amount === "string" ? amount : null;
  } catch {
    return null;
  }
}
