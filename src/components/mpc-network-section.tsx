import { LocalTime } from "@/components/local-time";
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

type MpcNetworkOverview = {
  responses24h: number;
  signsTotal24h: number;
  signsOrganic24h: number;
  signsSynthetic24h: number;
  signsByFastAuth24h: number;
  pendingCount: number;
  bucketHours: number;
  latencyByNode: MpcLatencyRow[];
  liveness: MpcLivenessSeries[];
  roster: MpcRosterRow[];
  pending: MpcPendingRequest[];
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
    data.responses24h > 0 ||
    data.signsTotal24h > 0 ||
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
            Aggregated activity across the v1.signer MPC contract. Path B&apos; correlation by
            payload bytes (`{`{scheme}:{hex(payload)}`}`).
          </p>
        </div>

        <div className="kpiTileRow">
          <div className="kpiTile">
            <span className="kpiTileLabel">Responses</span>
            <span className="kpiTileValue">{formatNumber(data.responses24h)}</span>
            <span className="kpiTileHint">Last 24h</span>
          </div>
          <div className="kpiTile">
            <span className="kpiTileLabel">Sign requests</span>
            <span className="kpiTileValue">{formatNumber(data.signsTotal24h)}</span>
            <span className="kpiTileHint">
              {formatNumber(data.signsOrganic24h)} organic / {formatNumber(data.signsSynthetic24h)} synthetic
            </span>
          </div>
          <div className="kpiTile">
            <span className="kpiTileLabel">From FastAuth</span>
            <span className="kpiTileValue">{formatNumber(data.signsByFastAuth24h)}</span>
            <span className="kpiTileHint">Of all signs (24h)</span>
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
                        {series.buckets.map((count, i) => (
                          <span
                            key={i}
                            className={classifyHeatCell(count, livenessMax)}
                            title={`Hour −${series.buckets.length - i}: ${count}`}
                          />
                        ))}
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
          <p>All MPC node accounts observed by traffic. Phase 4 will add TEE attestation status.</p>
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
    </>
  );
}
