import { FastAuthLogo } from "@/components/fastauth-logo";
import { LocalTime } from "@/components/local-time";
import { NearblocksLink } from "@/components/nearblocks-link";
import { TopAccountsTable } from "@/components/top-accounts-table";
import { UptimeBar } from "@/components/uptime-bar";
import { getDashboardData } from "@/lib/dashboard-data";

// The dashboard reads from a database that the worker is constantly writing to.
// Static prerendering would freeze the page to deploy-time data, so we force a
// fresh server render on every request.
export const dynamic = "force-dynamic";

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

function toProviderDisplayName(providerType: string): string {
  switch (providerType) {
    case "auth0":
      return "Auth0";
    case "firebase":
      return "Firebase";
    case "custom_issuer":
      return "Custom issuer";
    case "unknown":
      return "Unknown";
    default:
      return providerType;
  }
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function formatSignedNumber(value: number): string {
  if (value > 0) {
    return `+${value.toLocaleString("en-US")}`;
  }
  return value.toLocaleString("en-US");
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
              <dt>Probed at</dt>
              <dd>
                <LocalTime iso={data.mpcChainHealth?.computedAt ?? null} />
              </dd>
            </div>
          </dl>

          <UptimeBar label="Last 24h" points={mpcUptimePoints} />

          <p className="healthDetails">
            Success rate of MPC signing receipts. Counts only FastAuth transactions whose
            execution chain reached the MPC contract — guard-side rejections (JWT/auth) are
            excluded so this metric isolates MPC network health.
          </p>
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
                    `${data.fastAuthChainHealth.failedTransactions} failed ` +
                    `(${data.fastAuthChainHealth.totalTransactions} total)`
                  : "-"}
              </dd>
            </div>
            <div>
              <dt>Guard-side failures</dt>
              <dd>{data.fastAuthChainHealth?.guardFailedTransactions ?? "-"}</dd>
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
              <dt>Probed at</dt>
              <dd>
                <LocalTime iso={data.fastAuthChainHealth?.computedAt ?? null} />
              </dd>
            </div>
          </dl>

          <UptimeBar label="Last 24h" points={fastAuthUptimePoints} />

          <p className="healthDetails">
            Live probe of the last {data.fastAuthChainHealth?.windowBlocks ?? "~"} NEAR blocks from
            chain head. Success rate is the share of FastAuth transactions whose receipts chain
            executed without failure (guard verification, MPC call, callback).
          </p>
        </article>
      </section>

      {/* 2. Accounts + 3. Transactions */}
      <p className="sectionKicker">Overview</p>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Accounts</h2>
          <p>Total {formatNumber(data.accountsOverview.totalAccounts)} accounts indexed.</p>
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
                <td>Created</td>
                <td>{formatNumber(data.accountsOverview.created.last24h)}</td>
                <td>{formatNumber(data.accountsOverview.created.last7d)}</td>
                <td>{formatNumber(data.accountsOverview.created.last30d)}</td>
                <td>{formatNumber(data.accountsOverview.created.all)}</td>
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

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Transactions</h2>
          <p>FastAuth sign-event volume per window.</p>
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
                <td>Signed</td>
                <td>{formatNumber(data.transactionOverview.signed.last24h)}</td>
                <td>{formatNumber(data.transactionOverview.signed.last7d)}</td>
                <td>{formatNumber(data.transactionOverview.signed.last30d)}</td>
                <td>{formatNumber(data.transactionOverview.signed.all)}</td>
              </tr>
              <tr>
                <td>Failed</td>
                <td>{formatNumber(data.transactionOverview.failed.last24h)}</td>
                <td>{formatNumber(data.transactionOverview.failed.last7d)}</td>
                <td>{formatNumber(data.transactionOverview.failed.last30d)}</td>
                <td>{formatNumber(data.transactionOverview.failed.all)}</td>
              </tr>
              <tr>
                <td>Total</td>
                <td>{formatNumber(data.transactionOverview.total.last24h)}</td>
                <td>{formatNumber(data.transactionOverview.total.last7d)}</td>
                <td>{formatNumber(data.transactionOverview.total.last30d)}</td>
                <td>{formatNumber(data.transactionOverview.total.all)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Activity by provider</h2>
          <p>Sign events grouped by classified provider type (Auth0 / Firebase / Custom issuer / Unknown).</p>
        </div>

        {data.providerBreakdown.length === 0 ? (
          <p className="emptyState">No FastAuth sign events indexed yet.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Total 24h</th>
                  <th>Total 7d</th>
                  <th>Total 30d</th>
                  <th>Failed 24h</th>
                  <th>Success 24h</th>
                  <th>Distinct users 24h</th>
                  <th>Distinct users 30d</th>
                </tr>
              </thead>
              <tbody>
                {data.providerBreakdown.map((row) => (
                  <tr key={row.providerType}>
                    <td>{toProviderDisplayName(row.providerType)}</td>
                    <td>{formatNumber(row.last24h.total)}</td>
                    <td>{formatNumber(row.last7d.total)}</td>
                    <td>{formatNumber(row.last30d.total)}</td>
                    <td>{formatNumber(row.last24h.failed)}</td>
                    <td>{formatPercent(row.last24h.successRatePct)}</td>
                    <td>{formatNumber(row.last24h.distinctUsers)}</td>
                    <td>{formatNumber(row.last30d.distinctUsers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Activity by guard</h2>
          <p>Sign events split by guard name (the part after <code>jwt#</code>) — totals, failures, and distinct users.</p>
        </div>

        {data.guardBreakdown.length === 0 ? (
          <p className="emptyState">No FastAuth sign events indexed yet.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Guard</th>
                  <th>Total 24h</th>
                  <th>Total 7d</th>
                  <th>Total 30d</th>
                  <th>Failed 24h</th>
                  <th>Success 24h</th>
                  <th>Distinct users 24h</th>
                  <th>Distinct users 30d</th>
                </tr>
              </thead>
              <tbody>
                {data.guardBreakdown.map((row) => (
                  <tr key={row.guardName}>
                    <td>{row.guardName}</td>
                    <td>{formatNumber(row.last24h.total)}</td>
                    <td>{formatNumber(row.last7d.total)}</td>
                    <td>{formatNumber(row.last30d.total)}</td>
                    <td>{formatNumber(row.last24h.failed)}</td>
                    <td>{formatPercent(row.last24h.successRatePct)}</td>
                    <td>{formatNumber(row.last24h.distinctUsers)}</td>
                    <td>{formatNumber(row.last30d.distinctUsers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Activity by action type</h2>
          <p>Sign events split by the first action inside the signed NEP-366 DelegateAction. AddKey/DeleteKey reflect setup &amp; key-rotation flows; FunctionCall/Transfer reflect actual on-chain user activity.</p>
        </div>
        {data.actionTypeBreakdown.length === 0 ? (
          <p className="emptyState">No sign events with parsed action type yet.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>24h</th>
                  <th>7d</th>
                  <th>30d</th>
                  <th>All</th>
                </tr>
              </thead>
              <tbody>
                {data.actionTypeBreakdown.map((row) => (
                  <tr key={row.actionType}>
                    <td>{row.actionType}</td>
                    <td>{formatNumber(row.last24h)}</td>
                    <td>{formatNumber(row.last7d)}</td>
                    <td>{formatNumber(row.last30d)}</td>
                    <td>{formatNumber(row.all)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Consumer transaction outcomes</h2>
          <p>Relayer-submitted txs that consume FastAuth signatures (AddKey, Transfer, FunctionCall, …). Failures here mean the signature reached chain but the action didn&rsquo;t apply — e.g. <code>DelegateActionInvalidSignature</code> or <code>AddKeyAlreadyExists</code>.</p>
        </div>
        {data.consumerOutcomes.byWindow.all.total === 0 ? (
          <p className="emptyState">No consumer transactions indexed yet. The collector will start populating these on its next run after a worker restart.</p>
        ) : (
          <>
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
                    <td>Total</td>
                    <td>{formatNumber(data.consumerOutcomes.byWindow.last24h.total)}</td>
                    <td>{formatNumber(data.consumerOutcomes.byWindow.last7d.total)}</td>
                    <td>{formatNumber(data.consumerOutcomes.byWindow.last30d.total)}</td>
                    <td>{formatNumber(data.consumerOutcomes.byWindow.all.total)}</td>
                  </tr>
                  <tr>
                    <td>Succeeded</td>
                    <td>{formatNumber(data.consumerOutcomes.byWindow.last24h.succeeded)}</td>
                    <td>{formatNumber(data.consumerOutcomes.byWindow.last7d.succeeded)}</td>
                    <td>{formatNumber(data.consumerOutcomes.byWindow.last30d.succeeded)}</td>
                    <td>{formatNumber(data.consumerOutcomes.byWindow.all.succeeded)}</td>
                  </tr>
                  <tr>
                    <td>Failed</td>
                    <td>{formatNumber(data.consumerOutcomes.byWindow.last24h.failed)}</td>
                    <td>{formatNumber(data.consumerOutcomes.byWindow.last7d.failed)}</td>
                    <td>{formatNumber(data.consumerOutcomes.byWindow.last30d.failed)}</td>
                    <td>{formatNumber(data.consumerOutcomes.byWindow.all.failed)}</td>
                  </tr>
                  <tr>
                    <td>Success rate</td>
                    <td>{formatPercent(data.consumerOutcomes.byWindow.last24h.successRatePct)}</td>
                    <td>{formatPercent(data.consumerOutcomes.byWindow.last7d.successRatePct)}</td>
                    <td>{formatPercent(data.consumerOutcomes.byWindow.last30d.successRatePct)}</td>
                    <td>{formatPercent(data.consumerOutcomes.byWindow.all.successRatePct)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {data.consumerOutcomes.topFailureReasons.length > 0 ? (
              <div className="tableWrap" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Top failure reason</th>
                      <th>24h</th>
                      <th>7d</th>
                      <th>30d</th>
                      <th>All</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.consumerOutcomes.topFailureReasons.map((row) => (
                      <tr key={row.reason}>
                        <td><code>{row.reason}</code></td>
                        <td>{formatNumber(row.last24h)}</td>
                        <td>{formatNumber(row.last7d)}</td>
                        <td>{formatNumber(row.last30d)}</td>
                        <td>{formatNumber(row.all)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Top accounts</h2>
          <p>Most active NEAR accounts ranked by sign event count. Pick a window to re-rank. First/last seen reflect FastAuth activity, not on-chain account age. Note: counts include AddKey-type signs (setup churn) — see the Activity by action type panel above for the breakdown.</p>
        </div>
        <TopAccountsTable rows={data.topAccounts} />
      </section>

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
            Gap between the NEAR chain head and the last height the indexer has fully scanned. The
            24h window is measured against <code>blockTimestamp</code>, so it stays at zero until
            the indexer catches up to the last 24 hours of blocks.
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
            Block ranges that are not yet indexed. Source of truth is the{" "}
            <code>missing_block_ranges</code> table. Closed ranges are filled; open ranges still
            need an archival-backed backfill (<code>pnpm backfill:range</code>).
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
