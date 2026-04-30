import { LocalTime } from "@/components/local-time";
import { MpcRecentEventsTable } from "@/components/mpc-recent-events-table";
import { NearblocksLink } from "@/components/nearblocks-link";

type MpcLatencyRow = {
  signerId: string;
  responses: number;
  avgLatencySec: number;
  p50LatencySec: number;
  p95LatencySec: number;
  p99LatencySec: number;
};

type MpcRosterRow = {
  accountId: string;
  firstSeenAt: Date | string;
  lastSeenAt: Date | string;
  responses24h: number;
  responses7d: number;
  responsesAll: number;
};

type MpcLivenessSeries = {
  accountId: string;
  buckets: number[];
  total: number;
};

type MpcPendingRequest = {
  txHash: string;
  predecessorId: string;
  scheme: string;
  path: string | null;
  source: string;
  trafficSource: string;
  blockTimestamp: Date | string;
  pendingSec: number;
};

type MpcGovernanceCategoryCount = {
  category: string;
  count24h: number;
  count7d: number;
  count30d: number;
};

type MpcGovernanceEvent = {
  txHash: string;
  blockTimestamp: Date | string;
  eventType: string;
  category: string;
  actorId: string;
  payloadSummary: string | null;
};

type MpcVersionDriftRow = {
  actorId: string;
  votedHashShort: string;
  votedHashFull: string;
  votedAt: Date | string;
};

type MpcGovernanceOverview = {
  total24h: number;
  total7d: number;
  byCategory: MpcGovernanceCategoryCount[];
  recent: MpcGovernanceEvent[];
  codeHashDrift: MpcVersionDriftRow[];
};

type MpcDataRange = {
  earliestSignResponseAt: Date | string | null;
  earliestSignRequestAt: Date | string | null;
  earliestGovernanceEventAt: Date | string | null;
};

type MpcNetworkOverview = {
  windowHours: number;
  responses: number;
  signsTotal: number;
  signsOrganic: number;
  signsSynthetic: number;
  signsByFastAuth: number;
  pendingCount: number;
  bucketHours: number;
  livenessAnchorMs: number;
  latencyByNode: MpcLatencyRow[];
  liveness: MpcLivenessSeries[];
  roster: MpcRosterRow[];
  pending: MpcPendingRequest[];
  governance: MpcGovernanceOverview;
  dataRange: MpcDataRange;
};

function formatWindowLabel(hours: number): string {
  if (hours >= 24) return "Last 24h";
  if (hours === 1) return "Last hour";
  return `Last ${hours}h`;
}

const CATEGORY_LABELS: Record<string, string> = {
  tee: "TEE attestation",
  version: "Code / version votes",
  key_events: "Key events",
  updates: "Contract updates",
  foreign_chains: "Foreign chains",
  migration: "Node migration",
  other: "Other",
};

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatLatency(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "-";
  if (sec < 1) return `${(sec * 1000).toFixed(0)}ms`;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

function formatPath(path: string | null): string {
  if (path === null || path === "") return "(empty)";
  return path.length > 48 ? `${path.slice(0, 32)}…${path.slice(-12)}` : path;
}

function shortHash(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatBucketTooltip(
  count: number,
  bucketStartMs: number,
  bucketHours: number,
): string {
  const start = new Date(bucketStartMs);
  const end = new Date(bucketStartMs + bucketHours * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const dayLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const range = `${fmt(start)}–${fmt(end)}`;
  const noun = count === 1 ? "respond" : "responds";
  return `${dayLabel} ${range} • ${count} ${noun}`;
}

function classifyHeatCell(count: number, max: number): string {
  if (count === 0) return "mpcLivenessCell mpcLivenessCell--empty";
  const ratio = max > 0 ? count / max : 0;
  if (ratio < 0.25) return "mpcLivenessCell mpcLivenessCell--lo";
  if (ratio < 0.5) return "mpcLivenessCell mpcLivenessCell--mid";
  if (ratio < 0.75) return "mpcLivenessCell mpcLivenessCell--hi";
  return "mpcLivenessCell mpcLivenessCell--peak";
}

export function MpcNetworkSection({ data }: { data: MpcNetworkOverview }) {
  const hasAnyData =
    data.responses > 0 ||
    data.signsTotal > 0 ||
    data.roster.length > 0;

  if (!hasAnyData) {
    return (
      <>
        <p className="sectionKicker">MPC Network</p>
        <section className="logsPanel">
          <div className="panelTitleRow">
            <h2>MPC Network</h2>
            <p>No MPC consensus data yet — collector is warming up.</p>
          </div>
        </section>
      </>
    );
  }

  // Find the max bucket value across all node series for the heatmap scale.
  const livenessMax = data.liveness.reduce(
    (acc, s) => Math.max(acc, ...s.buckets),
    0,
  );

  return (
    <>
      <p className="sectionKicker">MPC Network</p>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>MPC Network — overview</h2>
          <p>
            Aggregated activity across the <code>v1.signer</code> MPC network on NEAR mainnet.
          </p>
          {data.dataRange.earliestSignResponseAt ? (
            <p className="healthMetaHint">
              Data available since <LocalTime iso={data.dataRange.earliestSignResponseAt} />.
            </p>
          ) : null}
        </div>

        <div className="kpiTileRow">
          <div className="kpiTile">
            <span className="kpiTileLabel">Responses</span>
            <span className="kpiTileValue">{formatNumber(data.responses)}</span>
            <span className="kpiTileHint">{formatWindowLabel(data.windowHours)}</span>
          </div>
          <div className="kpiTile">
            <span className="kpiTileLabel">Sign requests</span>
            <span className="kpiTileValue">{formatNumber(data.signsTotal)}</span>
            <span className="kpiTileHint">
              {formatNumber(data.signsOrganic)} organic / {formatNumber(data.signsSynthetic)} synthetic
            </span>
          </div>
          <div className="kpiTile">
            <span className="kpiTileLabel">From FastAuth</span>
            <span className="kpiTileValue">
              {formatNumber(data.signsByFastAuth)}
              {data.signsTotal > 0 ? (
                <span style={{ fontSize: "0.6em", marginLeft: 6, opacity: 0.7 }}>
                  ({Math.round((data.signsByFastAuth / data.signsTotal) * 100)}%)
                </span>
              ) : null}
            </span>
            <span className="kpiTileHint">
              Of all signs · {formatWindowLabel(data.windowHours).toLowerCase()}
            </span>
          </div>
          <div
            className={`kpiTile${data.pendingCount > 0 ? " kpiTile--alert" : ""}`}
          >
            <span className="kpiTileLabel">Pending</span>
            <span className="kpiTileValue">{formatNumber(data.pendingCount)}</span>
            <span className="kpiTileHint">Sign w/o respond &gt;1 min, last hour</span>
          </div>
        </div>
      </section>

      {/* 7.1 Latency yield→resume */}
      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Yield→resume latency by node</h2>
          <p>
            Time between the user&apos;s sign() yield and each node&apos;s respond. Last 24h.
            Sorted by p50.
          </p>
        </div>

        {data.latencyByNode.length === 0 ? (
          <p className="emptyState">No matched sign↔respond pairs in the last 24h.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Responses</th>
                  <th>p50</th>
                  <th>p95</th>
                  <th>p99</th>
                  <th>Avg</th>
                </tr>
              </thead>
              <tbody>
                {data.latencyByNode.map((row) => (
                  <tr key={row.signerId}>
                    <td>
                      <NearblocksLink kind="account" value={row.signerId}>
                        {row.signerId}
                      </NearblocksLink>
                    </td>
                    <td>{formatNumber(row.responses)}</td>
                    <td>{formatLatency(row.p50LatencySec)}</td>
                    <td>{formatLatency(row.p95LatencySec)}</td>
                    <td>{formatLatency(row.p99LatencySec)}</td>
                    <td>{formatLatency(row.avgLatencySec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 7.2 Liveness heatmap */}
      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Liveness — last 24h</h2>
          <p>
            Respond count per node, hourly buckets. Empty cells = silent hour.
          </p>
        </div>

        {data.liveness.length === 0 ? (
          <p className="emptyState">No respond activity in the last 24h.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>Node</th>
                  <th>Last 24h</th>
                  <th className="mpcLivenessTotalCol">Total responses</th>
                </tr>
              </thead>
              <tbody>
                {data.liveness.map((series) => (
                  <tr key={series.accountId}>
                    <td>
                      <NearblocksLink kind="account" value={series.accountId}>
                        {series.accountId}
                      </NearblocksLink>
                    </td>
                    <td>
                      <div className="mpcLivenessRow">
                        {series.buckets.map((count, i) => {
                          const bucketStartMs =
                            data.livenessAnchorMs + i * data.bucketHours * 60 * 60 * 1000;
                          const tooltip = formatBucketTooltip(
                            count,
                            bucketStartMs,
                            data.bucketHours,
                          );
                          return (
                            <span
                              key={i}
                              className={classifyHeatCell(count, livenessMax)}
                              data-tooltip={tooltip}
                              title={tooltip}
                            />
                          );
                        })}
                      </div>
                    </td>
                    <td className="mpcLivenessTotalCol">{formatNumber(series.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 7.3 Roster */}
      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Network roster</h2>
          <p>All MPC node accounts observed by traffic.</p>
        </div>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>24h</th>
                <th>7d</th>
                <th>All</th>
                <th>First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.roster.map((row) => (
                <tr key={row.accountId}>
                  <td>
                    <NearblocksLink kind="account" value={row.accountId}>
                      {row.accountId}
                    </NearblocksLink>
                  </td>
                  <td>{formatNumber(row.responses24h)}</td>
                  <td>{formatNumber(row.responses7d)}</td>
                  <td>{formatNumber(row.responsesAll)}</td>
                  <td>
                    <LocalTime iso={row.firstSeenAt} />
                  </td>
                  <td>
                    <LocalTime iso={row.lastSeenAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 7.4 Pending requests */}
      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Pending sign requests</h2>
          <p>
            Sign requests pending for more than 1 min, within the last hour. Sub-minute pending
            is normal MPC propagation (yield→quorum→resume) and is filtered out. Distinct from
            FastAuth&apos;s rpc_pending — this is on-chain state, not a classifier backlog.
          </p>
        </div>

        {data.pending.length === 0 ? (
          <p className="emptyState">No sign requests pending more than 1 min in the last hour.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Tx</th>
                  <th>Predecessor</th>
                  <th>Source</th>
                  <th>Traffic</th>
                  <th>Scheme</th>
                  <th>Path</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {data.pending.map((row) => (
                  <tr key={row.txHash}>
                    <td>
                      <NearblocksLink kind="tx" value={row.txHash}>
                        {shortHash(row.txHash)}
                      </NearblocksLink>
                    </td>
                    <td>
                      <NearblocksLink kind="account" value={row.predecessorId}>
                        {row.predecessorId}
                      </NearblocksLink>
                    </td>
                    <td>{row.source}</td>
                    <td>{row.trafficSource}</td>
                    <td>{row.scheme}</td>
                    <td>
                      <code>{formatPath(row.path)}</code>
                    </td>
                    <td>{formatLatency(row.pendingSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 7.5 Governance & key events */}
      <GovernancePanels
        governance={data.governance}
        earliestEventAt={data.dataRange.earliestGovernanceEventAt}
      />
    </>
  );
}

function GovernancePanels({
  governance,
  earliestEventAt,
}: {
  governance: MpcGovernanceOverview;
  earliestEventAt: Date | string | null;
}) {
  const driftHashes = new Set(
    governance.codeHashDrift.map((r) => r.votedHashShort).filter((h) => h !== "(unknown)"),
  );
  const driftStatus =
    governance.codeHashDrift.length === 0
      ? "no-data"
      : driftHashes.size <= 1
        ? "consensus"
        : "drift";

  return (
    <>
      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Governance &amp; key events</h2>
          <p>
            TEE attestations, code / launcher / OS hash votes, key event lifecycle, and contract
            upgrade proposals on the MPC network.
          </p>
          {earliestEventAt ? (
            <p className="healthMetaHint">
              Events tracked since <LocalTime iso={earliestEventAt} />.
            </p>
          ) : null}
        </div>

        <div className="kpiTileRow">
          <div className="kpiTile">
            <span className="kpiTileLabel">Events</span>
            <span className="kpiTileValue">{formatNumber(governance.total24h)}</span>
            <span className="kpiTileHint">Last 24h</span>
          </div>
          <div className="kpiTile">
            <span className="kpiTileLabel">Events</span>
            <span className="kpiTileValue">{formatNumber(governance.total7d)}</span>
            <span className="kpiTileHint">Last 7d</span>
          </div>
          <div
            className={`kpiTile${driftStatus === "drift" ? " kpiTile--alert" : ""}`}
          >
            <span className="kpiTileLabel">Code-hash consensus</span>
            <span className="kpiTileValue">
              {driftStatus === "no-data"
                ? "—"
                : driftStatus === "consensus"
                  ? "1 hash"
                  : `${driftHashes.size} hashes`}
            </span>
            <span className="kpiTileHint">
              {driftStatus === "no-data"
                ? "No vote_code_hash in 30d"
                : `Across ${governance.codeHashDrift.length} nodes (30d)`}
            </span>
          </div>
        </div>

        {governance.byCategory.length > 0 ? (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>24h</th>
                  <th>7d</th>
                  <th>30d</th>
                </tr>
              </thead>
              <tbody>
                {governance.byCategory.map((row) => (
                  <tr key={row.category}>
                    <td>{CATEGORY_LABELS[row.category] ?? row.category}</td>
                    <td>{formatNumber(row.count24h)}</td>
                    <td>{formatNumber(row.count7d)}</td>
                    <td>{formatNumber(row.count30d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="emptyState">No governance events in the last 30 days.</p>
        )}
      </section>

      {governance.codeHashDrift.length > 0 ? (
        <section className="logsPanel">
          <div className="panelTitleRow">
            <h2>Code-hash drift by node</h2>
            <p>
              Latest <code>vote_code_hash</code> per MPC node (last 30 days). All values matching
              = network in consensus. Divergence usually means a rolling upgrade is in progress;
              persistent divergence is worth investigating.
            </p>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Voted hash</th>
                  <th>Voted at</th>
                </tr>
              </thead>
              <tbody>
                {governance.codeHashDrift.map((row) => (
                  <tr key={row.actorId}>
                    <td>
                      <NearblocksLink kind="account" value={row.actorId}>
                        {row.actorId}
                      </NearblocksLink>
                    </td>
                    <td>
                      <code title={row.votedHashFull}>{row.votedHashShort}</code>
                    </td>
                    <td>
                      <LocalTime iso={row.votedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {governance.recent.length > 0 ? (
        <section className="logsPanel">
          <div className="panelTitleRow">
            <h2>Recent events timeline</h2>
            <p>
              Latest {governance.recent.length} governance event
              {governance.recent.length === 1 ? "" : "s"} across all categories. 10 per page.
            </p>
          </div>

          <MpcRecentEventsTable
            events={governance.recent}
            categoryLabels={CATEGORY_LABELS}
          />
        </section>
      ) : null}
    </>
  );
}
