import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { createNearRpcManager, type NearRpcManager } from "@/lib/indexers/near-rpc-manager";
import type { IndexerRunResult } from "@/lib/indexers/types";

// Periodic snapshots of FastAuth contract state. Throttled because
// config doesn't change often — config drift is observable via the
// MPC consensus events feed; this collector exists to expose the
// *current* state on the dashboard, not to track every block.
const SNAPSHOT_MIN_INTERVAL_MS = 5 * 60 * 1000;
const CHECKPOINT_KEY = "fastauth_contract_state_last_run_at";

// Mainnet trio. If/when testnet is wired in, parameterize via env.
type ContractKind = "fast_auth" | "jwt_router" | "auth0_guard";

const TRACKED_CONTRACTS: Array<{ accountId: string; kind: ContractKind }> = [
  { accountId: "fast-auth.near", kind: "fast_auth" },
  { accountId: "jwt.fast-auth.near", kind: "jwt_router" },
  { accountId: "auth0.jwt.fast-auth.near", kind: "auth0_guard" },
];

// View methods queried per contract kind. Ordering doesn't matter —
// each call is independent and gracefully tolerates a method that
// doesn't exist on the deployed contract version.
const VIEW_METHODS_BY_KIND: Record<ContractKind, ReadonlyArray<string>> = {
  fast_auth: [
    "owner",
    "paused",
    "mpc_address",
    "mpc_domain_id",
    "mpc_key_version",
    "version",
  ],
  jwt_router: ["owner", "version"],
  auth0_guard: ["owner", "get_public_keys", "version"],
};

type AccountViewResponse = {
  result?: {
    amount?: string;
    storage_usage?: number;
    code_hash?: string;
  };
};

type AccessKeyListResponse = {
  result?: {
    keys?: Array<{
      access_key?: { permission?: unknown };
    }>;
  };
};

type CallFunctionResponse = {
  result?: {
    result?: number[];
    error?: unknown;
  };
};

async function viewAccount(
  rpcManager: NearRpcManager,
  accountId: string,
): Promise<AccountViewResponse["result"] | null> {
  try {
    const response = await rpcManager.request<AccountViewResponse>(
      "query",
      {
        request_type: "view_account",
        finality: "final",
        account_id: accountId,
      },
      `contract-state:view_account ${accountId}`,
    );
    return response.result ?? null;
  } catch {
    return null;
  }
}

async function countFullAccessKeys(
  rpcManager: NearRpcManager,
  accountId: string,
): Promise<number | null> {
  try {
    const response = await rpcManager.request<AccessKeyListResponse>(
      "query",
      {
        request_type: "view_access_key_list",
        finality: "final",
        account_id: accountId,
      },
      `contract-state:view_access_key_list ${accountId}`,
    );
    const keys = response.result?.keys ?? [];
    let n = 0;
    for (const k of keys) {
      const perm = k.access_key?.permission;
      // NEAR encodes FullAccess as the literal string "FullAccess";
      // FunctionCall as { FunctionCall: { ... } }.
      if (perm === "FullAccess") n += 1;
    }
    return n;
  } catch {
    return null;
  }
}

async function viewMethod<T>(
  rpcManager: NearRpcManager,
  accountId: string,
  methodName: string,
): Promise<T | null> {
  try {
    const argsBase64 = Buffer.from("{}").toString("base64");
    const response = await rpcManager.request<CallFunctionResponse>(
      "query",
      {
        request_type: "call_function",
        finality: "final",
        account_id: accountId,
        method_name: methodName,
        args_base64: argsBase64,
      },
      `contract-state:${accountId}::${methodName}`,
    );
    if (response.result?.error) return null;
    const bytes = response.result?.result;
    if (!Array.isArray(bytes)) return null;
    const utf8 = Buffer.from(bytes).toString("utf8").trim();
    if (!utf8) return null;
    try {
      return JSON.parse(utf8) as T;
    } catch {
      // Some contracts return bare strings (not JSON-quoted). Fall back
      // to the raw utf8 in that case.
      return utf8 as unknown as T;
    }
  } catch {
    return null;
  }
}

async function snapshotContract(
  rpcManager: NearRpcManager,
  contract: (typeof TRACKED_CONTRACTS)[number],
): Promise<Prisma.FastAuthContractSnapshotCreateInput> {
  const [account, fullAccessKeys, sourceMetadata] = await Promise.all([
    viewAccount(rpcManager, contract.accountId),
    countFullAccessKeys(rpcManager, contract.accountId),
    viewMethod<unknown>(rpcManager, contract.accountId, "contract_source_metadata"),
  ]);

  const methods = VIEW_METHODS_BY_KIND[contract.kind];
  const config: Record<string, unknown> = {};
  await Promise.all(
    methods.map(async (m) => {
      const value = await viewMethod<unknown>(rpcManager, contract.accountId, m);
      // Store as null when the call failed or returned nothing — keeps
      // the schema visible across upgrades that add/remove view methods.
      config[m] = value ?? null;
    }),
  );

  return {
    contractId: contract.accountId,
    snapshotAt: new Date(),
    balanceYocto: account?.amount ?? null,
    storageUsage:
      typeof account?.storage_usage === "number" ? BigInt(account.storage_usage) : null,
    codeHash: account?.code_hash ?? null,
    fullAccessKeys,
    config: config as Prisma.InputJsonObject,
    sourceMetadata: (sourceMetadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
  };
}

export async function collectFastAuthContractState(
  prisma: PrismaClient,
): Promise<IndexerRunResult> {
  const checkpoint = await prisma.indexerCheckpoint.findUnique({
    where: { key: CHECKPOINT_KEY },
  });
  const lastRunMs = checkpoint ? Date.parse(checkpoint.value) : 0;
  const nowMs = Date.now();

  if (Number.isFinite(lastRunMs) && nowMs - lastRunMs < SNAPSHOT_MIN_INTERVAL_MS) {
    return {
      source: "fastauth_contract_state",
      status: "skipped",
      details: `Throttled — last run ${Math.round((nowMs - lastRunMs) / 1000)}s ago.`,
    };
  }

  const rpcManager = createNearRpcManager();
  const snapshots: Prisma.FastAuthContractSnapshotCreateInput[] = [];

  for (const contract of TRACKED_CONTRACTS) {
    try {
      const snapshot = await snapshotContract(rpcManager, contract);
      snapshots.push(snapshot);
    } catch (error) {
      // Tolerate per-contract failures — partial snapshot beats no snapshot.
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "Contract snapshot failed",
          source: "fastauth_contract_state",
          contractId: contract.accountId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  if (snapshots.length === 0) {
    return {
      source: "fastauth_contract_state",
      status: "error",
      details: "All contract snapshots failed.",
    };
  }

  let inserted = 0;
  for (const snap of snapshots) {
    await prisma.fastAuthContractSnapshot.create({ data: snap });
    inserted += 1;
  }

  await prisma.indexerCheckpoint.upsert({
    where: { key: CHECKPOINT_KEY },
    create: { key: CHECKPOINT_KEY, value: new Date(nowMs).toISOString() },
    update: { value: new Date(nowMs).toISOString() },
  });

  return {
    source: "fastauth_contract_state",
    status: "ok",
    inserted,
    details: `Snapshotted ${inserted}/${TRACKED_CONTRACTS.length} contracts.`,
  };
}
