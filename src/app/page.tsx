import { FastAuthLogo } from "@/components/fastauth-logo";
import { LocalTime } from "@/components/local-time";
import { NearblocksLink } from "@/components/nearblocks-link";
import { ConsumerOutcomesPanel } from "@/components/consumer-outcomes-panel";
import { RealActivityPanel } from "@/components/real-activity-panel";
import { FastAuthContractsSection } from "@/components/fastauth-contracts-section";
import { MpcNetworkSection } from "@/components/mpc-network-section";
import { TopAccountsTable } from "@/components/top-accounts-table";
import { TransactionsPanel } from "@/components/transactions-panel";
import { UptimeBar } from "@/components/uptime-bar";
import { getDashboardData } from "@/lib/dashboard-data";

// The dashboard reads from a database that the worker is constantly writing to.
// Static prerendering would freeze the page to deploy-time data, so we force a
// fresh server render on every request.
export const dynamic = "force-dynamic";

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function formatSignedNumber(value: number): string {
  if (value > 0) {
    return `+${value.toLocaleString("en-US")}`;
  }
  return value.toLocaleString("en-US");
}

function formatAgeMinutes(ageMinutes: number | null): string {
  if (ageMinutes === null) {
    return "-";
  }

  if (ageMinutes < 1) {
    return "just now";
  }

  if (ageMinutes < 60) {
    return `${ageMinutes}m ago`;
  }

  const hours = Math.floor(ageMinutes / 60);
  const minutes = ageMinutes % 60;

  if (minutes === 0) {
    return `${hours}h ago`;
  }

  return `${hours}h ${minutes}m ago`;
}

function toStatusLabel(status: "healthy" | "lagging" | "stale" | "no_data"): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "lagging":
      return "Lagging";
    case "stale":
      return "Stale";
    default:
      return "No data";
  }
}

function toLagStatus(blocksBehind: number | null): "healthy" | "lagging" | "stale" | "no_data" {
  if (blocksBehind === null) {
    return "no_data";
  }
  if (blocksBehind <= 150) {
    return "healthy";
  }
  if (blocksBehind <= 5_000) {
    return "lagging";
  }
  return "stale";
}

function formatDurationMinutes(minutes: number | null): string {
  if (minutes === null) {
    return "-";
  }

  if (minutes < 1) {
    return "<1m";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;

  if (hours < 24) {
    return remaining === 0 ? `${hours}h` : `${hours}h ${remaining}m`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`;
}

function toChainHealthStatus(
  successRatePct: number | null,
  totalTransactions: number,
  minutesSinceLastSuccess: number | null,
): "healthy" | "lagging" | "stale" | "no_data" {
  if (totalTransactions === 0 || successRatePct === null) {
    if (minutesSinceLastSuccess === null) {
      return "no_data";
    }
    if (minutesSinceLastSuccess <= 30) {
      return "healthy";
    }
    if (minutesSinceLastSuccess <= 180) {
      return "lagging";
    }
    return "stale";
  }

  if (successRatePct >= 98) {
    return "healthy";
  }
  if (successRatePct >= 90) {
    return "lagging";
  }
  return "stale";
}

function toMpcStatus(
  successRatePct: number | null,
  attempted: number,
): "healthy" | "lagging" | "stale" | "no_data" {
  if (attempted === 0 || successRatePct === null) {
    return "no_data";
  }
  if (successRatePct >= 98) {
    return "healthy";
  }
  if (successRatePct >= 90) {
    return "lagging";
  }
  return "stale";
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

type RecentFailure = {
  txHash: string;
  blockTimestamp: Date;
  outcome: string;
  failingExecutorId: string | null;
  failureReason: string | null;
};

function shortHash(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function RecentFailuresList({
  rows,
  heading,
  emptyText,
}: {
  rows: RecentFailure[];
  heading: string;
  emptyText: string;
}) {
  return (
    <details className="recentFailuresList">
      <summary className="recentFailuresHeader">
        {heading} ({rows.length})
      </summary>
      {rows.length === 0 ? (
        <p className="recentFailuresEmpty">{emptyText}</p>
      ) : (
        rows.map((row) => (
          <div key={row.txHash} className="recentFailuresRow">
            <div className="recentFailuresLine">
              <span className="failureWhen">
                <LocalTime iso={row.blockTimestamp} />
              </span>
              <span className={`failureKind failureKind--${row.outcome}`}>{row.outcome}</span>
              <span className="failureExecutor" title={row.failingExecutorId ?? ""}>
                {row.failingExecutorId ?? "—"}
              </span>
              <span className="failureLink">
                <NearblocksLink kind="tx" value={row.txHash}>
                  {shortHash(row.txHash)}
                </NearblocksLink>
              </span>
            </div>
            {row.failureReason ? (
              <div className="failureReason" title={row.failureReason}>
                {row.failureReason}
              </div>
            ) : null}
          </div>
        ))
      )}
    </details>
  );
}

export default async function Home() {
  const data = await getDashboardData();

  const fastAuthUptimePoints = data.chainHealthHistory.map((p) => ({
    computedAt: p.computedAt,
    totalTransactions: p.totalTransactions,
    successRatePct: p.fastAuthSuccessRatePct,
    attempted: p.totalTransactions,
  }));

  const mpcUptimePoints = data.chainHealthHistory.map((p) => ({
    computedAt: p.computedAt,
    totalTransactions: p.totalTransactions,
    successRatePct: p.mpcSuccessRatePct,
    attempted: p.mpcAttempted,
  }));

  return (
    <main className="dashboardRoot">
      <header className="dashboardTopbar">
        <div className="topbarBrand">
          <h1><FastAuthLogo /></h1>
          <p className="kicker" style={{ marginBottom: 0 }}>Metrics Dashboard</p>
        </div>
      </header>

      {/* 1. Status row — MPC + Fast Auth */}
      <p className="sectionKicker">Status</p>
      <section className="statusFocusGrid">
        <article className="healthCard">
          <div className="healthCardHeader">
            <h3>MPC Status</h3>
            <span
              className={`healthBadge healthBadge--${toMpcStatus(
                data.mpcChainHealth?.successRatePct ?? null,
                data.mpcChainHealth?.attemptedTransactions ?? 0,
              )}`}
            >
              {data.mpcChainHealth && data.mpcChainHealth.attemptedTransactions > 0
                ? formatPercent(data.mpcChainHealth.successRatePct)
                : "No data"}
            </span>
          </div>

          <dl className="healthMetaList">
            <div>
              <dt>Window</dt>
              <dd>
                {data.fastAuthChainHealth ? (
                  <>
                    <NearblocksLink
                      kind="block"
                      value={data.fastAuthChainHealth.windowStartHeight}
                    />
                    {" – "}
                    <NearblocksLink
                      kind="block"
                      value={data.fastAuthChainHealth.windowEndHeight}
                    />
                    {" "}
                    <span className="healthMetaHint">
                      ({data.fastAuthChainHealth.windowBlocks} blocks)
                    </span>
                  </>
                ) : (
                  "-"
                )}
              </dd>
            </div>
            <div>
              <dt>MPC attempts</dt>
              <dd>{data.mpcChainHealth?.attemptedTransactions ?? "-"}</dd>
            </div>
            <div>
              <dt>MPC failures</dt>
              <dd>{data.mpcChainHealth?.failedTransactions ?? "-"}</dd>
            </div>
            <div>
              <dt>MPC successes</dt>
              <dd>{data.mpcChainHealth?.successfulTransactions ?? "-"}</dd>
            </div>
            <div>
              <dt>RPC pending</dt>
              <dd>
                {data.mpcChainHealth?.rpcPendingTransactions ?? "-"}
                {data.mpcChainHealth && data.mpcChainHealth.rpcPendingTransactions > 0 ? (
                  <>
                    {" "}
                    <span className="healthMetaHint">(awaiting classification — will retry)</span>
                  </>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Computed at</dt>
              <dd>
                <LocalTime iso={data.mpcChainHealth?.computedAt ?? null} />
              </dd>
            </div>
          </dl>

          <UptimeBar label="Last 24h" points={mpcUptimePoints} />

          <p className="healthDetails">
            Success rate of MPC signing receipts. Excludes guard-side rejections to isolate MPC
            network health. Pending tx are excluded from the denominator until classified.
          </p>

          <RecentFailuresList
            heading="Recent MPC failures"
            rows={data.mpcChainHealth?.recentFailures ?? []}
            emptyText="No MPC failures recorded yet."
          />
        </article>

        <article className="healthCard">
          <div className="healthCardHeader">
            <h3>Fast Auth Status</h3>
            <span
              className={`healthBadge healthBadge--${toChainHealthStatus(
                data.fastAuthChainHealth?.successRatePct ?? null,
                data.fastAuthChainHealth?.totalTransactions ?? 0,
                data.fastAuthChainHealth?.minutesSinceLastSuccess ?? null,
              )}`}
            >
              {data.fastAuthChainHealth
                ? formatPercent(data.fastAuthChainHealth.successRatePct)
                : "No data"}
            </span>
          </div>

          <dl className="healthMetaList">
            <div>
              <dt>Window</dt>
              <dd>
                {data.fastAuthChainHealth ? (
                  <>
                    <NearblocksLink
                      kind="block"
                      value={data.fastAuthChainHealth.windowStartHeight}
                    />
                    {" – "}
                    <NearblocksLink
                      kind="block"
                      value={data.fastAuthChainHealth.windowEndHeight}
                    />
                    {" "}
                    <span className="healthMetaHint">
                      ({data.fastAuthChainHealth.windowBlocks} blocks)
                    </span>
                  </>
                ) : (
                  "-"
                )}
              </dd>
            </div>
            <div>
              <dt>FastAuth tx in window</dt>
              <dd>
                {data.fastAuthChainHealth
                  ? `${data.fastAuthChainHealth.successfulTransactions} ok / ` +
                    `${data.fastAuthChainHealth.failedTransactions} failed / ` +
                    `${data.fastAuthChainHealth.rpcPendingTransactions} pending ` +
                    `(${data.fastAuthChainHealth.totalTransactions} total)`
                  : "-"}
              </dd>
            </div>
            <div>
              <dt>Guard-side failures</dt>
              <dd>{data.fastAuthChainHealth?.guardFailedTransactions ?? "-"}</dd>
            </div>
            <div>
              <dt>RPC pending</dt>
              <dd>
                {data.fastAuthChainHealth?.rpcPendingTransactions ?? "-"}
                {data.fastAuthChainHealth &&
                data.fastAuthChainHealth.rpcPendingTransactions > 0 ? (
                  <>
                    {" "}
                    <span className="healthMetaHint">(awaiting classification — will retry)</span>
                  </>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Last success</dt>
              <dd>
                {data.fastAuthChainHealth?.lastSuccessTxHash ? (
                  <NearblocksLink kind="tx" value={data.fastAuthChainHealth.lastSuccessTxHash}>
                    <LocalTime iso={data.fastAuthChainHealth.lastSuccessTimestamp} />
                  </NearblocksLink>
                ) : (
                  "-"
                )}
                {data.fastAuthChainHealth?.minutesSinceLastSuccess !== null &&
                data.fastAuthChainHealth?.minutesSinceLastSuccess !== undefined ? (
                  <>
                    {" "}
                    <span className="healthMetaHint">
                      ({formatDurationMinutes(
                        data.fastAuthChainHealth.minutesSinceLastSuccess,
                      )} ago)
                    </span>
                  </>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Computed at</dt>
              <dd>
                <LocalTime iso={data.fastAuthChainHealth?.computedAt ?? null} />
              </dd>
            </div>
          </dl>

          <UptimeBar label="Last 24h" points={fastAuthUptimePoints} />

          <p className="healthDetails">
            Last 24h of FastAuth txs, classified by walking each tx&rsquo;s receipts. Share whose
            full receipt chain (guard → MPC) executed cleanly. Pending tx are excluded from the
            denominator until classified.
          </p>

          <RecentFailuresList
            heading="Recent failures"
            rows={data.fastAuthChainHealth?.recentFailures ?? []}
            emptyText="No failures recorded yet."
          />
        </article>
      </section>

      {/* 2. Accounts + 3. Transactions */}
      <p className="sectionKicker">Overview</p>

      <section className="logsPanel logsPanel--featured">
        <div className="panelTitleRow">
          <h2>Accounts</h2>
          <p>Total {formatNumber(data.accountsOverview.totalAccounts)} accounts indexed.</p>
        </div>

        <div className="kpiTileRow">
          <div className="kpiTile">
            <span className="kpiTileLabel">Total accounts</span>
            <span className="kpiTileValue">{formatNumber(data.accountsOverview.totalAccounts)}</span>
            <span className="kpiTileHint">All time</span>
          </div>
          <div className="kpiTile">
            <span className="kpiTileLabel">First seen</span>
            <span className="kpiTileValue">{formatNumber(data.accountsOverview.firstSeen.last24h)}</span>
            <span className="kpiTileHint">Last 24h</span>
          </div>
          <div className="kpiTile">
            <span className="kpiTileLabel">Active</span>
            <span className="kpiTileValue">{formatNumber(data.accountsOverview.active.last24h)}</span>
            <span className="kpiTileHint">Last 24h</span>
          </div>
        </div>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>24h</th>
                <th>7d</th>
                <th>30d</th>
                <th>All</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>First seen</td>
                <td>{formatNumber(data.accountsOverview.firstSeen.last24h)}</td>
                <td>{formatNumber(data.accountsOverview.firstSeen.last7d)}</td>
                <td>{formatNumber(data.accountsOverview.firstSeen.last30d)}</td>
                <td>{formatNumber(data.accountsOverview.firstSeen.all)}</td>
              </tr>
              <tr>
                <td>Active</td>
                <td>{formatNumber(data.accountsOverview.active.last24h)}</td>
                <td>{formatNumber(data.accountsOverview.active.last7d)}</td>
                <td>{formatNumber(data.accountsOverview.active.last30d)}</td>
                <td>{formatNumber(data.accountsOverview.active.all)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="logsPanel logsPanel--featured">
        <div className="panelTitleRow">
          <h2>Transactions</h2>
          <p>Sign-event volume per window. Tabs slice by provider, guard, or action type.</p>
        </div>

        <div className="kpiTileRow">
          <div className="kpiTile">
            <span className="kpiTileLabel">Signed</span>
            <span className="kpiTileValue">{formatNumber(data.transactionOverview.signed.last24h)}</span>
            <span className="kpiTileHint">Last 24h</span>
          </div>
          <div
            className={`kpiTile${data.transactionOverview.failed.last24h > 0 ? " kpiTile--alert" : ""}`}
          >
            <span className="kpiTileLabel">Failed</span>
            <span className="kpiTileValue">{formatNumber(data.transactionOverview.failed.last24h)}</span>
            <span className="kpiTileHint">Last 24h</span>
          </div>
          <div
            className={`kpiTile${data.transactionOverview.pending.last24h > 0 ? " kpiTile--warn" : ""}`}
          >
            <span className="kpiTileLabel">Pending</span>
            <span className="kpiTileValue">{formatNumber(data.transactionOverview.pending.last24h)}</span>
            <span className="kpiTileHint">Awaiting classification</span>
          </div>
          <div className="kpiTile">
            <span className="kpiTileLabel">Total</span>
            <span className="kpiTileValue">{formatNumber(data.transactionOverview.total.all)}</span>
            <span className="kpiTileHint">All time</span>
          </div>
        </div>

        <TransactionsPanel
          transactionOverview={data.transactionOverview}
          relayerBreakdown={data.relayerBreakdownByActivity}
          providerBreakdown={data.providerBreakdown}
          guardBreakdown={data.guardBreakdown}
          actionTypeBreakdown={data.actionTypeBreakdown}
        />
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Consumer transactions</h2>
          <p>Relayer-submitted txs signed by FastAuth&rsquo;s MPC — mostly <code>AddKey</code> / <code>DeleteKey</code> from login churn. Real user activity is signed locally; see &ldquo;Real activity&rdquo; below.</p>
        </div>
        <ConsumerOutcomesPanel data={data.consumerOutcomes} />
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Real activity</h2>
          <p>
            On-chain txs from accounts holding a FastAuth-derived MPC key (<code>K_FA</code>) —
            every action the user takes, regardless of which session key signed it.
          </p>
        </div>
        <RealActivityPanel data={data.realActivity} />
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Top accounts signing with <code>fast-auth.near</code></h2>
          <p>Accounts ranked by <code>FastAuth.sign()</code> calls — driven by login/logout key churn, not product activity. Pick a window to re-rank.</p>
        </div>
        <TopAccountsTable rows={data.topAccounts} />
      </section>

      {/* FastAuth contracts — current state from periodic view-calls */}
      <FastAuthContractsSection data={data.fastAuthContracts} />

      {/* MPC Network — consensus dashboard sections (Phase 3 of plan) */}
      <MpcNetworkSection data={data.mpcNetwork} />

      {/* 4. Indexer status — kept visible per ops needs */}
      <p className="sectionKicker">Indexer status</p>
      <section className="statusFocusGrid">
        <article className="healthCard">
          <div className="healthCardHeader">
            <h3>Indexer lag</h3>
            <span className={`healthBadge healthBadge--${toLagStatus(data.indexerLag.blocksBehind)}`}>
              {data.indexerLag.blocksBehind === null
                ? "No data"
                : `${formatSignedNumber(data.indexerLag.blocksBehind)} blocks`}
            </span>
          </div>

          <dl className="healthMetaList">
            <div>
              <dt>Chain head</dt>
              <dd>
                <NearblocksLink kind="block" value={data.indexerLag.chainHead} />
              </dd>
            </div>
            <div>
              <dt>Scanned from</dt>
              <dd>
                <NearblocksLink kind="block" value={data.indexerLag.backfillStartHeight} />
              </dd>
            </div>
            <div>
              <dt>Scanned to</dt>
              <dd>
                <NearblocksLink kind="block" value={data.indexerLag.scannedHeight} />
              </dd>
            </div>
            <div>
              <dt>Time behind</dt>
              <dd>{formatDurationMinutes(data.indexerLag.minutesBehind)}</dd>
            </div>
            <div>
              <dt>Last indexed block</dt>
              <dd>
                <LocalTime iso={data.indexerLag.latestIndexedBlockTimestamp} />
              </dd>
            </div>
          </dl>

          <p className="healthDetails">
            Gap between chain head and the last height the indexer has fully scanned.
          </p>
        </article>

        <article className="healthCard">
          <div className="healthCardHeader">
            <h3>Missing block ranges</h3>
            <span
              className={`healthBadge healthBadge--${
                data.missingBlockRanges.every((r) => r.status === "closed")
                  ? "healthy"
                  : "lagging"
              }`}
            >
              {data.missingBlockRanges.filter((r) => r.status === "open").length} open
            </span>
          </div>
          {data.missingBlockRanges.length === 0 ? (
            <p className="emptyState">No recorded gaps. Indexer history is contiguous.</p>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Range</th>
                    <th>Size</th>
                    <th>Processed</th>
                    <th>Pending</th>
                    <th>Asc cursor</th>
                    <th>Desc cursor</th>
                    <th>Status</th>
                    <th>Recorded</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data.missingBlockRanges.map((range) => {
                    const pctProcessed =
                      range.size > 0
                        ? Math.round((range.blocksProcessed / range.size) * 100)
                        : 0;
                    return (
                      <tr key={`${range.startHeight}-${range.endHeight}`}>
                        <td>
                          <NearblocksLink kind="block" value={String(range.startHeight)} />
                          {" – "}
                          <NearblocksLink kind="block" value={String(range.endHeight)} />
                        </td>
                        <td>{range.size.toLocaleString()}</td>
                        <td>
                          {range.blocksProcessed.toLocaleString()}
                          {" "}
                          <span className="healthMetaHint">({pctProcessed}%)</span>
                        </td>
                        <td>{range.blocksPending.toLocaleString()}</td>
                        <td>
                          {range.completedUpTo !== null ? (
                            <NearblocksLink kind="block" value={String(range.completedUpTo)} />
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>
                          {range.completedDownTo !== null ? (
                            <NearblocksLink kind="block" value={String(range.completedDownTo)} />
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>
                          <span
                            className={`healthBadge healthBadge--${
                              range.status === "closed" ? "healthy" : "lagging"
                            }`}
                          >
                            {range.status}
                          </span>
                        </td>
                        <td>
                          <LocalTime iso={range.recordedAt || null} />
                        </td>
                        <td>{range.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="healthDetails">
            Unindexed block ranges. Open ranges need an archival backfill
            (<code>pnpm backfill:range</code>).
          </p>
        </article>
      </section>

      {/* 6. Developer */}
      <p className="sectionKicker">Developer</p>

      <section className="healthPanel">
        <div className="panelTitleRow">
          <h2>Collector health</h2>
          <p>Freshness is relative to INDEXER_POLL_INTERVAL_MS.</p>
        </div>

        <div className="healthGrid">
          {data.collectorHealth.map((collector) => (
            <article className="healthCard" key={collector.source}>
              <div className="healthCardHeader">
                <h3>{collector.displayName}</h3>
                <span className={`healthBadge healthBadge--${collector.status}`}>
                  {toStatusLabel(collector.status)}
                </span>
              </div>

              <dl className="healthMetaList">
                <div>
                  <dt>Last write</dt>
                  <dd>
                    <LocalTime iso={collector.lastWriteAt} />
                  </dd>
                </div>
                <div>
                  <dt>Freshness</dt>
                  <dd>{formatAgeMinutes(collector.ageMinutes)}</dd>
                </div>
                <div>
                  <dt>Checkpoint</dt>
                  <dd>{collector.checkpoint ?? "-"}</dd>
                </div>
              </dl>

              <p className="healthDetails">{collector.details}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="dashboardFooter">
        <span>Built by Peersyst</span>
        <span>NEAR Protocol</span>
      </footer>
    </main>
  );
}
