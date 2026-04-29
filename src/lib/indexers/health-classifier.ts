import { createNearRpcManager } from "@/lib/indexers/near-rpc-manager";

// Shared per-tx receipt-walking primitives used by all three health collectors
// (fastauth-health, fastauth-consumer-health, fastauth-user-health). The
// FA-receiver collector does an extra guard/MPC attribution step on top of the
// generic outcome; the consumer/user collectors only care about success vs
// failure (no MPC contract is on their receipt path).

export type GenericOutcome = "success" | "failure" | "rpc_pending";

export type GenericClassification = {
  outcome: GenericOutcome;
  failingExecutorId: string | null;
  failureReason: string | null;
  // RPC-level error message — only set when the tx RPC call itself failed
  // (network error, timeout, endpoint exhausted) and we couldn't classify.
  lastError: string | null;
};

export type NearRpcManager = ReturnType<typeof createNearRpcManager>;

type NearReceiptOutcome = {
  outcome?: {
    executor_id?: string;
    status?: unknown;
  };
};

type NearTxStatusResponse = {
  result?: {
    transaction_outcome?: {
      outcome?: {
        executor_id?: string;
        status?: unknown;
      };
    };
    receipts_outcome?: NearReceiptOutcome[];
  };
};

export function isFailureStatus(status: unknown): boolean {
  if (!status) {
    return false;
  }
  if (typeof status === "string") {
    return status.toLowerCase().includes("failure");
  }
  if (typeof status === "object") {
    const entries = Object.entries(status as Record<string, unknown>);
    if (entries.length === 0) {
      return false;
    }
    return entries[0][0].toLowerCase().includes("failure");
  }
  return false;
}

// Pulls the most-specific human-readable error string out of a NEAR receipt's
// Failure status. Walks common shapes; falls back to a JSON dump so we never
// silently drop the reason.
export function extractFailureReason(status: unknown): string | null {
  if (!status || typeof status !== "object") {
    return null;
  }
  const failure = (status as Record<string, unknown>).Failure;
  if (failure === undefined || failure === null) {
    return null;
  }

  if (typeof failure === "string") {
    return failure;
  }
  if (typeof failure === "object") {
    const action = (failure as Record<string, unknown>).ActionError;
    if (action && typeof action === "object") {
      const kind = (action as Record<string, unknown>).kind;
      if (typeof kind === "string") return kind;
      if (kind && typeof kind === "object") {
        const kindEntries = Object.entries(kind as Record<string, unknown>);
        if (kindEntries.length > 0) {
          const [kindName, kindPayload] = kindEntries[0];
          if (kindName === "FunctionCallError" && kindPayload && typeof kindPayload === "object") {
            const fnEntries = Object.entries(kindPayload as Record<string, unknown>);
            if (fnEntries.length > 0) {
              const [fnVariant, fnMsg] = fnEntries[0];
              if (typeof fnMsg === "string") return fnMsg;
              return `${fnVariant}: ${JSON.stringify(fnMsg)}`;
            }
          }
          if (typeof kindPayload === "string") return `${kindName}: ${kindPayload}`;
          return `${kindName}: ${JSON.stringify(kindPayload)}`;
        }
      }
    }
    const invalidTx = (failure as Record<string, unknown>).InvalidTxError;
    if (invalidTx) {
      if (typeof invalidTx === "string") return `InvalidTxError: ${invalidTx}`;
      return `InvalidTxError: ${JSON.stringify(invalidTx)}`;
    }
  }

  try {
    return JSON.stringify(failure);
  } catch {
    return null;
  }
}

export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const effectiveConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  const runners = Array.from({ length: effectiveConcurrency }, async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= items.length) {
        return;
      }
      await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
}

// Generic success/failure/pending classifier. Used by consumer + user health
// collectors. Walks the tx's receipts; if any receipt failed, captures the
// first failure's executor and reason. RPC errors → rpc_pending so they get
// retried later.
export async function classifyTxGeneric(
  rpcManager: NearRpcManager,
  txHash: string,
  signerId: string,
  source: string,
): Promise<GenericClassification> {
  let txStatus: NearTxStatusResponse;
  try {
    txStatus = await rpcManager.request<NearTxStatusResponse>(
      "tx",
      [txHash, signerId],
      `${source}:tx ${txHash}`,
    );
  } catch (error) {
    return {
      outcome: "rpc_pending",
      failingExecutorId: null,
      failureReason: null,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }

  const receipts = txStatus.result?.receipts_outcome ?? [];
  let firstFailingExecutor: string | null = null;
  let firstFailingStatus: unknown = null;

  for (const receipt of receipts) {
    if (
      firstFailingExecutor === null &&
      isFailureStatus(receipt.outcome?.status)
    ) {
      firstFailingExecutor =
        receipt.outcome?.executor_id?.trim().toLowerCase() ?? null;
      firstFailingStatus = receipt.outcome?.status;
    }
  }

  const txConversionStatus = txStatus.result?.transaction_outcome?.outcome?.status;
  const txConversionFailed = isFailureStatus(txConversionStatus);
  const anyFailure = firstFailingExecutor !== null || txConversionFailed;

  if (!anyFailure) {
    return {
      outcome: "success",
      failingExecutorId: null,
      failureReason: null,
      lastError: null,
    };
  }

  const failureReason =
    extractFailureReason(firstFailingStatus) ??
    extractFailureReason(txConversionStatus);

  return {
    outcome: "failure",
    failingExecutorId: firstFailingExecutor,
    failureReason,
    lastError: null,
  };
}
