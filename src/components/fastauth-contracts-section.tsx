import { LocalTime } from "@/components/local-time";
import { NearblocksLink } from "@/components/nearblocks-link";

type FastAuthContractState = {
  contractId: string;
  label: string;
  description: string;
  snapshotAt: Date | string;
  balanceYocto: string | null;
  storageUsage: bigint | number | string | null;
  codeHash: string | null;
  fullAccessKeys: number | null;
  locked: boolean | null;
  config: Record<string, unknown>;
  sourceMetadata: Record<string, unknown> | null;
};

type FastAuthContractsOverview = {
  contracts: FastAuthContractState[];
  earliestSnapshotAt: Date | string | null;
};

const YOCTO_PER_NEAR = BigInt("1000000000000000000000000");
const AUTH0_GUARD_CONTRACT_ID = "auth0.jwt.fast-auth.near";

function formatNear(yocto: string | null): string {
  if (!yocto) return "—";
  let value: bigint;
  try {
    value = BigInt(yocto);
  } catch {
    return "—";
  }
  const whole = value / YOCTO_PER_NEAR;
  const remainder = value % YOCTO_PER_NEAR;
  const remainderStr = remainder.toString().padStart(24, "0").slice(0, 6);
  return `${whole.toLocaleString("en-US")}.${remainderStr} Ⓝ`;
}

function formatStorage(bytes: bigint | number | string | null): string {
  if (bytes === null) return "—";
  const n = typeof bytes === "bigint" ? Number(bytes) : Number(bytes);
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatHash(hash: string | null): string {
  if (!hash || hash.length < 14) return hash ?? "—";
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

function isLikelyAccountId(value: string): boolean {
  return /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(value);
}

function pickOwner(config: Record<string, unknown>): string | null {
  return asString(config.owner);
}

function pickVersion(
  config: Record<string, unknown>,
  sourceMetadata: Record<string, unknown> | null,
): string | null {
  const fromMetadata = sourceMetadata ? asString(sourceMetadata.version) : null;
  if (fromMetadata) return fromMetadata;
  return asString(config.version);
}

function pickSourceLink(sourceMetadata: Record<string, unknown> | null): string | null {
  if (!sourceMetadata) return null;
  return asString(sourceMetadata.link);
}

function formatLocked(locked: boolean | null, fullAccessKeys: number | null): string {
  if (locked === null) return "—";
  if (locked) return "Yes";
  return `No (${fullAccessKeys ?? "?"} keys)`;
}

function rsaExponentValue(bytes: number[]): number {
  let v = 0;
  for (const b of bytes) v = v * 256 + (b & 0xff);
  return v;
}

function rsaModulusFingerprint(bytes: number[], take = 8): string {
  return bytes
    .slice(0, take)
    .map((b) => (b & 0xff).toString(16).padStart(2, "0"))
    .join("");
}

type FormattedRsaKey = { label: string; bits: number; fingerprint: string };

function formatRsaKey(key: unknown): FormattedRsaKey | null {
  if (!key || typeof key !== "object") return null;
  const obj = key as { e?: unknown; n?: unknown };
  const eArr = Array.isArray(obj.e)
    ? (obj.e.filter((b) => typeof b === "number") as number[])
    : [];
  const nArr = Array.isArray(obj.n)
    ? (obj.n.filter((b) => typeof b === "number") as number[])
    : [];
  if (nArr.length === 0) return null;
  const bits = nArr.length * 8;
  const exponent = rsaExponentValue(eArr);
  const fingerprint = rsaModulusFingerprint(nArr);
  return {
    label: `RSA-${bits} · n=${fingerprint}… · e=${exponent || "?"}`,
    bits,
    fingerprint,
  };
}

function PublicKeysSummary({ keys }: { keys: unknown }) {
  if (!Array.isArray(keys) || keys.length === 0) return null;
  const formatted = keys.map((k) => formatRsaKey(k)).filter((k): k is FormattedRsaKey => k !== null);
  const bitsSet = new Set(formatted.map((f) => f.bits));
  const summaryBits = bitsSet.size === 1 ? `RSA-${[...bitsSet][0]}` : "RSA";
  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--color-ink-subtle)" }}>
        Auth0 Guard: {keys.length} active {summaryBits} public key{keys.length === 1 ? "" : "s"}
      </summary>
      <ul
        style={{
          marginTop: 8,
          paddingLeft: 16,
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--color-ink-subtle)",
        }}
      >
        {formatted.length > 0
          ? formatted.map((f, i) => <li key={i}>{f.label}</li>)
          : keys.map((_, i) => <li key={i}>(unparseable key #{i + 1})</li>)}
      </ul>
    </details>
  );
}

function ContractRow({ contract }: { contract: FastAuthContractState }) {
  const owner = pickOwner(contract.config);
  const version = pickVersion(contract.config, contract.sourceMetadata);
  const sourceLink = pickSourceLink(contract.sourceMetadata);
  const sourceLinkDisplay = sourceLink
    ? sourceLink.replace(/^https?:\/\//, "")
    : null;

  return (
    <tr>
      <td>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <strong>{contract.label}</strong>
          <NearblocksLink kind="account" value={contract.contractId}>
            <code style={{ fontSize: 11 }}>{contract.contractId}</code>
          </NearblocksLink>
        </div>
      </td>
      <td>{formatNear(contract.balanceYocto)}</td>
      <td>{formatStorage(contract.storageUsage)}</td>
      <td>{formatLocked(contract.locked, contract.fullAccessKeys)}</td>
      <td>
        <code title={contract.codeHash ?? ""}>{formatHash(contract.codeHash)}</code>
      </td>
      <td>{version ?? "—"}</td>
      <td>
        {owner === null ? (
          "—"
        ) : isLikelyAccountId(owner) ? (
          <NearblocksLink kind="account" value={owner}>
            <code>{owner}</code>
          </NearblocksLink>
        ) : (
          <code>{owner}</code>
        )}
      </td>
      <td>
        {sourceLink && sourceLinkDisplay ? (
          <a href={sourceLink} target="_blank" rel="noreferrer noopener">
            <code>
              {sourceLinkDisplay.length > 32
                ? `${sourceLinkDisplay.slice(0, 28)}…`
                : sourceLinkDisplay}
            </code>
          </a>
        ) : (
          "—"
        )}
      </td>
      <td>
        <LocalTime iso={contract.snapshotAt} />
      </td>
    </tr>
  );
}

export function FastAuthContractsSection({
  data,
}: {
  data: FastAuthContractsOverview;
}) {
  const { contracts, earliestSnapshotAt } = data;
  if (contracts.length === 0) {
    return (
      <>
        <p className="sectionKicker">FastAuth Contracts</p>
        <section className="logsPanel">
          <div className="panelTitleRow">
            <h2>FastAuth Contracts</h2>
            <p>No contract data yet — refreshing soon.</p>
          </div>
        </section>
      </>
    );
  }

  const auth0Guard = contracts.find((c) => c.contractId === AUTH0_GUARD_CONTRACT_ID);
  const auth0PublicKeys = auth0Guard ? auth0Guard.config.get_public_keys : null;

  return (
    <>
      <p className="sectionKicker">FastAuth Contracts</p>
      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>FastAuth Contracts — current state</h2>
          <p>
            Live view of the FastAuth contracts on NEAR mainnet. Refreshed about every 5 minutes;
            code-hash changes indicate a contract upgrade.
          </p>
          {earliestSnapshotAt ? (
            <p className="healthMetaHint">
              History tracked since <LocalTime iso={earliestSnapshotAt} />.
            </p>
          ) : null}
        </div>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Balance</th>
                <th>Storage</th>
                <th>Locked</th>
                <th>Code hash</th>
                <th>Version</th>
                <th>Owner</th>
                <th>Source</th>
                <th>Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <ContractRow key={c.contractId} contract={c} />
              ))}
            </tbody>
          </table>
        </div>

        {auth0PublicKeys ? <PublicKeysSummary keys={auth0PublicKeys} /> : null}
      </section>
    </>
  );
}
