import { Disclosure } from "@/components/disclosure";
import { FastAuthLogo } from "@/components/fastauth-logo";
import { LocalTime } from "@/components/local-time";
import { MetricTabs } from "@/components/metric-tabs";
import { NearblocksLink } from "@/components/nearblocks-link";
import { getDashboardData } from "@/lib/dashboard-data";

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

function toProviderLabel(provider: "firebase" | "auth0"): string {
  return provider === "firebase" ? "Firebase" : "Auth0";
}

function truncateMiddle(value: string | null | undefined, max = 18): string {
  if (!value) {
    return "-";
  }

  if (value.length <= max) {
    return value;
  }

  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
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
    // No activity in the window — fall back to liveness signal.
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

function formatPercent(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  if (Math.abs(value) >= 1000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export default async function Home() {
  const data = await getDashboardData();

  return (
    <main className="dashboardRoot">
      <header className="dashboardTopbar">
        <div className="topbarBrand">
          <h1><FastAuthLogo /></h1>
          <p className="kicker" style={{ marginBottom: 0 }}>Metrics Dashboard</p>
        </div>
      </header>

      <p className="sectionKicker">System status</p>
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
              <dt>Distinct relayers</dt>
              <dd>{data.fastAuthChainHealth?.distinctRelayers ?? "-"}</dd>
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

          <p className="healthDetails">
            Live probe of the last {data.fastAuthChainHealth?.windowBlocks ?? "~"} NEAR blocks from
            chain head. Success rate is the share of FastAuth transactions whose chunk-level
            execution outcome did not report a failure. This metric is independent of the indexer
            backfill — it always reflects current chain activity.
          </p>
        </article>
      </section>

      <article className="healthCard" style={{ marginBottom: "1.5rem" }}>
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
          Block ranges that are not yet indexed. Source of truth is{" "}
          <code>data/missing-block-ranges.json</code>. Closed ranges are filled; open ranges still
          need an archival-backed backfill (<code>pnpm backfill:range</code>).
        </p>
      </article>

      <p className="sectionKicker">Overview</p>
      <section className="metricsGrid">
        <MetricTabs
          title="Accounts"
          headline={{ label: "Total accounts", value: data.accountsOverview.totalAccounts }}
          rows={[
            {
              label: "Created",
              values: {
                "24h": data.accountsOverview.created.last24h,
                "7d": data.accountsOverview.created.last7d,
                "30d": data.accountsOverview.created.last30d,
              },
            },
            {
              label: "Active",
              values: {
                "24h": data.accountsOverview.active.last24h,
                "7d": data.accountsOverview.active.last7d,
                "30d": data.accountsOverview.active.last30d,
              },
            },
          ]}
        />

        <MetricTabs
          title="Transactions"
          rows={[
            {
              label: "Signed",
              values: {
                "24h": data.transactionOverview.signed.last24h,
                "7d": data.transactionOverview.signed.last7d,
                "30d": data.transactionOverview.signed.last30d,
              },
            },
            {
              label: "Failed",
              values: {
                "24h": data.transactionOverview.failed.last24h,
                "7d": data.transactionOverview.failed.last7d,
                "30d": data.transactionOverview.failed.last30d,
              },
            },
            {
              label: "Total",
              values: {
                "24h": data.transactionOverview.total.last24h,
                "7d": data.transactionOverview.total.last7d,
                "30d": data.transactionOverview.total.last30d,
              },
            },
          ]}
        />
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Relayer breakdown</h2>
          <p>Sponsored-account coverage and relayer activity</p>
        </div>

        {data.relayerBreakdown.length === 0 ? (
          <p className="emptyState">No relayer activity has been indexed yet.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Transactions</th>
                  <th>Fees paid (gas burnt)</th>
                  <th>Project owner</th>
                  <th>Sponsored unique (24h)</th>
                  <th>Sponsored unique (7d)</th>
                  <th>Sponsored unique (30d)</th>
                  <th>Sponsored unique (total)</th>
                  <th>Unique accounts list</th>
                  <th>TVL</th>
                </tr>
              </thead>
              <tbody>
                {data.relayerBreakdown.map((relayer) => (
                  <tr key={relayer.address}>
                    <td>
                      <NearblocksLink kind="account" value={relayer.address} />
                    </td>
                    <td>{relayer.transactions}</td>
                    <td>{relayer.feesPaidGasBurnt ?? "-"}</td>
                    <td>{relayer.projectOwner ?? "-"}</td>
                    <td>{relayer.sponsoredUniqueAccounts.last24h}</td>
                    <td>{relayer.sponsoredUniqueAccounts.last7d}</td>
                    <td>{relayer.sponsoredUniqueAccounts.last30d}</td>
                    <td>{relayer.sponsoredUniqueAccounts.total}</td>
                    <td>
                      {relayer.uniqueAccountsList.length > 0
                        ? relayer.uniqueAccountsList.map((account, index) => (
                            <span key={account}>
                              {index > 0 ? ", " : null}
                              <NearblocksLink kind="account" value={account} />
                            </span>
                          ))
                        : "-"}
                    </td>
                    <td>{relayer.tvl ?? "N/A"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Recent NEAR transactions</h2>
          <p>All indexed transactions in scanned blocks</p>
        </div>

        {data.recentNearTransactions.length === 0 ? (
          <p className="emptyState">No NEAR transactions ingested yet.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Timestamp</th>
                  <th>Signer</th>
                  <th>Receiver</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {data.recentNearTransactions.map((tx) => (
                  <tr key={tx.txHash}>
                    <td>
                      <NearblocksLink kind="block" value={tx.blockHeight} />
                    </td>
                    <td>
                      <LocalTime iso={tx.blockTimestamp} />
                    </td>
                    <td>
                      <NearblocksLink kind="account" value={tx.signerAccountId} />
                    </td>
                    <td>
                      <NearblocksLink kind="account" value={tx.receiverId} />
                    </td>
                    <td>{tx.methodName ?? "-"}</td>
                    <td>{tx.executionStatus ?? "-"}</td>
                    <td>
                      <NearblocksLink kind="tx" value={tx.txHash} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="sectionKicker">Developer</p>

      <Disclosure title="Recent FastAuth sign events" description="Latest rows from fastauth_sign_events">
        {data.recentSignEvents.length === 0 ? (
          <p className="emptyState">No FastAuth sign events indexed yet.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Block ts</th>
                  <th>Block #</th>
                  <th>Relayer</th>
                  <th>Guard</th>
                  <th>Algo</th>
                  <th>Domain</th>
                  <th>Derived pubkey</th>
                  <th>Status</th>
                  <th>Tx hash</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSignEvents.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <LocalTime iso={event.blockTimestamp} />
                    </td>
                    <td>
                      <NearblocksLink kind="block" value={event.blockHeight} />
                    </td>
                    <td>
                      <NearblocksLink kind="account" value={event.relayerAccountId}>
                        {truncateMiddle(event.relayerAccountId, 22)}
                      </NearblocksLink>
                    </td>
                    <td>{event.guardName ?? "-"}</td>
                    <td>{event.algorithm ?? "-"}</td>
                    <td>{event.userDomainId ?? "-"}</td>
                    <td>{truncateMiddle(event.userDerivedPublicKey, 20)}</td>
                    <td>{event.executionStatus ?? "-"}</td>
                    <td>
                      <NearblocksLink kind="tx" value={event.txHash}>
                        {truncateMiddle(event.txHash, 18)}
                      </NearblocksLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Disclosure>

      <Disclosure title="Public-key accounts" description="Latest rows from fastauth_public_key_accounts">
        {data.topPublicKeyAccounts.length === 0 ? (
          <p className="emptyState">No public-key account mappings indexed yet.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Public key</th>
                  <th>Account</th>
                  <th>Key path</th>
                  <th>Predecessor</th>
                  <th>Domain</th>
                  <th>First seen</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.topPublicKeyAccounts.map((row) => (
                  <tr key={`${row.publicKey}-${row.accountId}`}>
                    <td>{truncateMiddle(row.publicKey, 22)}</td>
                    <td>
                      <NearblocksLink kind="account" value={row.accountId}>
                        {truncateMiddle(row.accountId, 22)}
                      </NearblocksLink>
                    </td>
                    <td>{row.keyPath ?? "-"}</td>
                    <td>
                      <NearblocksLink kind="account" value={row.predecessorId}>
                        {truncateMiddle(row.predecessorId, 18)}
                      </NearblocksLink>
                    </td>
                    <td>{row.domainId ?? "-"}</td>
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
        )}
      </Disclosure>

      <Disclosure title="Database tables" description="Row counts across the Prisma schema">
        <div className="metricsGrid metricsGrid--dense">
          <article className="metricCard metricCard--small">
            <h2>near_transactions</h2>
            <p>{formatNumber(data.tableCounts.nearTransactions)}</p>
          </article>
          <article className="metricCard metricCard--small">
            <h2>fastauth_sign_events</h2>
            <p>{formatNumber(data.tableCounts.fastAuthSignEvents)}</p>
          </article>
          <article className="metricCard metricCard--small">
            <h2>accounts</h2>
            <p>{formatNumber(data.tableCounts.accounts)}</p>
          </article>
          <article className="metricCard metricCard--small">
            <h2>fastauth_public_key_accounts</h2>
            <p>{formatNumber(data.tableCounts.publicKeyAccounts)}</p>
          </article>
          <article className="metricCard metricCard--small">
            <h2>relayers</h2>
            <p>{formatNumber(data.tableCounts.relayers)}</p>
          </article>
          <article className="metricCard metricCard--small">
            <h2>indexer_checkpoints</h2>
            <p>{formatNumber(data.tableCounts.indexerCheckpoints)}</p>
          </article>
        </div>
      </Disclosure>

      <Disclosure title="Indexer checkpoints" description="Key/value state from indexer_checkpoints">
        {data.indexerCheckpoints.length === 0 ? (
          <p className="emptyState">No checkpoints recorded yet.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Updated at</th>
                </tr>
              </thead>
              <tbody>
                {data.indexerCheckpoints.map((checkpoint) => (
                  <tr key={checkpoint.key}>
                    <td>{checkpoint.key}</td>
                    <td>{truncateMiddle(checkpoint.value, 48)}</td>
                    <td>
                      <LocalTime iso={checkpoint.updatedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Disclosure>
      <footer className="dashboardFooter">
        <span>Built by Peersyst</span>
        <span>NEAR Protocol</span>
      </footer>
    </main>
  );
}
