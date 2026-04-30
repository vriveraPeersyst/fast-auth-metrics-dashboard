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

function formatNear(yocto: string | null): string {
  if (!yocto) return "—";
  let value: bigint;
  try {
    value = BigInt(yocto);
  } catch {
    return "—";
  }
  // Whole-NEAR + 6 decimals, no scientific notation.
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

type ConfigRow =
  | { kind: "text"; label: string; value: string; isAccount?: boolean }
  | { kind: "link"; label: string; value: string; href: string };

// Keys excluded from the generic config table — they're rendered by
// dedicated widgets (e.g. RSA public keys) or would dominate the card.
const CONFIG_KEYS_RENDERED_ELSEWHERE: ReadonlySet<string> = new Set([
  "get_public_keys",
]);

function isLikelyAccountId(value: string): boolean {
  // Conservative: non-empty, all lowercase, no spaces, ends with `.near`
  // or has the `account.parent.near` shape that view methods return.
  return /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(value);
}

function renderConfigField(label: string, raw: unknown): ConfigRow | null {
  if (raw === null || raw === undefined) return null;
  const str = asString(raw);
  if (str === null) {
    try {
      return { kind: "text", label, value: JSON.stringify(raw) };
    } catch {
      return null;
    }
  }
  return {
    kind: "text",
    label,
    value: str,
    isAccount: isLikelyAccountId(str),
  };
}

function buildConfigRows(
  config: Record<string, unknown>,
  sourceMetadataVersion: string | null,
): ConfigRow[] {
  // Render known fields in a stable order, then anything else (alphabetic).
  const ordered: Array<[string, string]> = [
    ["owner", "Owner"],
    ["paused", "Paused"],
    ["mpc_address", "MPC contract"],
    ["mpc_domain_id", "MPC domain ID"],
    ["mpc_key_version", "MPC key version"],
    ["version", "Version"],
  ];
  const seen = new Set<string>();
  const rows: ConfigRow[] = [];
  for (const [key, label] of ordered) {
    if (CONFIG_KEYS_RENDERED_ELSEWHERE.has(key)) continue;
    if (key in config) {
      // De-duplicate `version` if it matches the NEP-330 version we'll
      // already render under "Version (NEP-330)".
      if (key === "version" && sourceMetadataVersion !== null) {
        const v = asString(config[key]);
        if (v !== null && v === sourceMetadataVersion) {
          seen.add(key);
          continue;
        }
      }
      const r = renderConfigField(label, config[key]);
      if (r) rows.push(r);
      seen.add(key);
    }
  }
  // Anything else not yet rendered. Skip null values and excluded keys.
  for (const key of Object.keys(config).sort()) {
    if (seen.has(key)) continue;
    if (CONFIG_KEYS_RENDERED_ELSEWHERE.has(key)) continue;
    if (config[key] === null) continue;
    const r = renderConfigField(key, config[key]);
    if (r) rows.push(r);
  }
  return rows;
}

function buildSourceMetadataRows(metadata: Record<string, unknown> | null): ConfigRow[] {
  if (!metadata) return [];
  const rows: ConfigRow[] = [];
  const version = asString(metadata.version);
  if (version) rows.push({ kind: "text", label: "Version (NEP-330)", value: version });
  const link = asString(metadata.link);
  if (link) rows.push({ kind: "link", label: "Source link", value: link, href: link });
  const standards = metadata.standards;
  if (Array.isArray(standards) && standards.length > 0) {
    const flat = standards
      .map((s) => {
        if (s && typeof s === "object") {
          const standard = asString((s as Record<string, unknown>).standard);
          const ver = asString((s as Record<string, unknown>).version);
          if (standard && ver) return `${standard} v${ver}`;
        }
        return null;
      })
      .filter(Boolean);
    if (flat.length > 0) {
      rows.push({ kind: "text", label: "Standards", value: flat.join(", ") });
    }
  }
  return rows;
}

// Compute exponent value from a big-endian byte array (RSA `e` is small).
function rsaExponentValue(bytes: number[]): number {
  let v = 0;
  for (const b of bytes) v = v * 256 + (b & 0xff);
  return v;
}

// First N bytes of the modulus, hex — used as a stable visual fingerprint.
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
  // All same bit length? Stamp it in the summary.
  const bitsSet = new Set(formatted.map((f) => f.bits));
  const summaryBits = bitsSet.size === 1 ? `RSA-${[...bitsSet][0]}` : "RSA";
  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--color-ink-subtle)" }}>
        {keys.length} active {summaryBits} public key{keys.length === 1 ? "" : "s"}
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

function ConfigRowDd({ row }: { row: ConfigRow }) {
  if (row.kind === "link") {
    const display = row.value.replace(/^https?:\/\//, "");
    return (
      <a href={row.href} target="_blank" rel="noreferrer noopener">
        <code>{display.length > 60 ? `${display.slice(0, 48)}…` : display}</code>
      </a>
    );
  }
  if (row.isAccount) {
    return (
      <NearblocksLink kind="account" value={row.value}>
        <code>{row.value}</code>
      </NearblocksLink>
    );
  }
  return <code>{row.value.length > 80 ? `${row.value.slice(0, 64)}…` : row.value}</code>;
}

function ContractCard({ contract }: { contract: FastAuthContractState }) {
  const sourceRows = buildSourceMetadataRows(contract.sourceMetadata);
  const sourceMetadataVersion = contract.sourceMetadata
    ? asString(contract.sourceMetadata.version)
    : null;
  const configRows = buildConfigRows(contract.config, sourceMetadataVersion);
  const isAuth0Guard = contract.contractId === "auth0.jwt.fast-auth.near";
  const auth0PublicKeys = isAuth0Guard ? contract.config.get_public_keys : null;

  return (
    <article className="healthCard">
      <div className="healthCardHeader">
        <h3>{contract.label}</h3>
        <span className="healthBadge healthBadge--ok">
          <NearblocksLink kind="account" value={contract.contractId}>
            {contract.contractId}
          </NearblocksLink>
        </span>
      </div>
      {contract.description ? (
        <p className="healthDetails" style={{ marginTop: 4 }}>
          {contract.description}
        </p>
      ) : null}

      <dl className="healthMetaList">
        <div>
          <dt>Balance</dt>
          <dd>{formatNear(contract.balanceYocto)}</dd>
        </div>
        <div>
          <dt>Storage</dt>
          <dd>{formatStorage(contract.storageUsage)}</dd>
        </div>
        <div>
          <dt>Code hash</dt>
          <dd>
            <code title={contract.codeHash ?? ""}>{formatHash(contract.codeHash)}</code>
          </dd>
        </div>
        <div>
          <dt>Locked</dt>
          <dd>
            {contract.locked === null
              ? "—"
              : contract.locked
                ? "Yes (no full-access keys)"
                : `No (${contract.fullAccessKeys ?? "?"} full-access keys)`}
          </dd>
        </div>
        {configRows.map((row) => (
          <div key={`cfg-${row.label}`}>
            <dt>{row.label}</dt>
            <dd>
              <ConfigRowDd row={row} />
            </dd>
          </div>
        ))}
        {sourceRows.map((row) => (
          <div key={`src-${row.label}`}>
            <dt>{row.label}</dt>
            <dd>
              <ConfigRowDd row={row} />
            </dd>
          </div>
        ))}
        <div>
          <dt>Snapshot</dt>
          <dd>
            <LocalTime iso={contract.snapshotAt} />
          </dd>
        </div>
      </dl>

      {isAuth0Guard ? <PublicKeysSummary keys={auth0PublicKeys} /> : null}
    </article>
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

  return (
    <>
      <p className="sectionKicker">FastAuth Contracts</p>
      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>FastAuth Contracts — current state</h2>
          <p>
            Live view of the three FastAuth contracts on NEAR mainnet. Each card refreshes about
            every 5 minutes; code-hash changes indicate a contract upgrade.
          </p>
          {earliestSnapshotAt ? (
            <p className="healthMetaHint">
              History tracked since <LocalTime iso={earliestSnapshotAt} />.
            </p>
          ) : null}
        </div>

        <div className="statusFocusGrid">
          {contracts.map((c) => (
            <ContractCard key={c.contractId} contract={c} />
          ))}
        </div>
      </section>
    </>
  );
}
