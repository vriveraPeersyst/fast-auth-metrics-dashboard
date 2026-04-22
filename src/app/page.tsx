import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { LogoutButton } from "@/components/logout-button";
import { allowedGoogleDomain, authOptions } from "@/lib/auth";
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

function toUptimePercent(status: "healthy" | "lagging" | "stale" | "no_data"): number {
  switch (status) {
    case "healthy":
      return 100;
    case "lagging":
      return 70;
    case "stale":
      return 35;
    default:
      return 10;
  }
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

function formatIsoDate(date: Date | null | undefined): string {
  if (!date) {
    return "-";
  }

  return date.toISOString();
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
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
  const session = await getServerSession(authOptions);

  if (!session?.user?.email?.toLowerCase().endsWith(`@${allowedGoogleDomain}`)) {
    redirect("/sign-in");
  }

  const data = await getDashboardData();
  const fastAuthCollector = data.collectorHealth.find((collector) => collector.source === "near");

  return (
    <main className="dashboardRoot">
      <header className="dashboardTopbar">
        <div>
          <p className="kicker">FastAuth Metrics Dashboard</p>
          <h1>Private {allowedGoogleDomain} Ops View</h1>
          <p className="metaLine">Signed in as {session.user.email}</p>
        </div>
        <div className="topbarActions">
          <LogoutButton />
        </div>
      </header>

      <section className="statusFocusGrid">
        <article className="healthCard">
          <div className="healthCardHeader">
            <h3>Fast Auth Status</h3>
            <span className={`healthBadge healthBadge--${fastAuthCollector?.status ?? "no_data"}`}>
              {toStatusLabel(fastAuthCollector?.status ?? "no_data")}
            </span>
          </div>

          <dl className="healthMetaList">
            <div>
              <dt>Last write</dt>
              <dd>
                {fastAuthCollector?.lastWriteAt ? fastAuthCollector.lastWriteAt.toISOString() : "-"}
              </dd>
            </div>
            <div>
              <dt>Checkpoint</dt>
              <dd>{fastAuthCollector?.checkpoint ?? "-"}</dd>
            </div>
          </dl>

          <div className="uptimeBarTrack" aria-hidden>
            <div
              className={`uptimeBarFill uptimeBarFill--${fastAuthCollector?.status ?? "no_data"}`}
              style={{ width: `${toUptimePercent(fastAuthCollector?.status ?? "no_data")}%` }}
            />
          </div>
        </article>
      </section>

      <section className="metricsGrid">
        <article className="metricCard">
          <h2>Total accounts</h2>
          <p>{data.accountsOverview.totalAccounts}</p>
        </article>

        <article className="metricCard">
          <h2>Created (24h)</h2>
          <p>{data.accountsOverview.created.last24h}</p>
        </article>

        <article className="metricCard">
          <h2>Created (7d)</h2>
          <p>{data.accountsOverview.created.last7d}</p>
        </article>

        <article className="metricCard">
          <h2>Created (30d)</h2>
          <p>{data.accountsOverview.created.last30d}</p>
        </article>

        <article className="metricCard">
          <h2>Active (24h)</h2>
          <p>{data.accountsOverview.active.last24h}</p>
        </article>

        <article className="metricCard">
          <h2>Active (7d)</h2>
          <p>{data.accountsOverview.active.last7d}</p>
        </article>

        <article className="metricCard">
          <h2>Active (30d)</h2>
          <p>{data.accountsOverview.active.last30d}</p>
        </article>
      </section>

      <section className="metricsGrid">
        <article className="metricCard">
          <h2>Total signed (24h)</h2>
          <p>{data.transactionOverview.signed.last24h}</p>
        </article>

        <article className="metricCard">
          <h2>Total signed (7d)</h2>
          <p>{data.transactionOverview.signed.last7d}</p>
        </article>

        <article className="metricCard">
          <h2>Total signed (30d)</h2>
          <p>{data.transactionOverview.signed.last30d}</p>
        </article>

        <article className="metricCard">
          <h2>Total failed (24h)</h2>
          <p>{data.transactionOverview.failed.last24h}</p>
        </article>

        <article className="metricCard">
          <h2>Total failed (7d)</h2>
          <p>{data.transactionOverview.failed.last7d}</p>
        </article>

        <article className="metricCard">
          <h2>Total failed (30d)</h2>
          <p>{data.transactionOverview.failed.last30d}</p>
        </article>

        <article className="metricCard">
          <h2>Total (success + failed) 24h</h2>
          <p>{data.transactionOverview.total.last24h}</p>
        </article>

        <article className="metricCard">
          <h2>Total (success + failed) 7d</h2>
          <p>{data.transactionOverview.total.last7d}</p>
        </article>

        <article className="metricCard">
          <h2>Total (success + failed) 30d</h2>
          <p>{data.transactionOverview.total.last30d}</p>
        </article>

        <article className="metricCard">
          <h2>Latest NEAR final block</h2>
          <p>{data.latestNearFinalBlock ?? "-"}</p>
        </article>
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
                    <td>{relayer.address}</td>
                    <td>{relayer.transactions}</td>
                    <td>{relayer.feesPaidGasBurnt ?? "-"}</td>
                    <td>{relayer.projectOwner ?? "-"}</td>
                    <td>{relayer.sponsoredUniqueAccounts.last24h}</td>
                    <td>{relayer.sponsoredUniqueAccounts.last7d}</td>
                    <td>{relayer.sponsoredUniqueAccounts.last30d}</td>
                    <td>{relayer.sponsoredUniqueAccounts.total}</td>
                    <td>
                      {relayer.uniqueAccountsList.length > 0
                        ? relayer.uniqueAccountsList.join(", ")
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
                  <dd>{collector.lastWriteAt ? collector.lastWriteAt.toISOString() : "-"}</dd>
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
                    <td>{tx.blockHeight ?? "-"}</td>
                    <td>{tx.blockTimestamp ? tx.blockTimestamp.toISOString() : "-"}</td>
                    <td>{tx.signerAccountId ?? "-"}</td>
                    <td>{tx.receiverId ?? "-"}</td>
                    <td>{tx.methodName ?? "-"}</td>
                    <td>{tx.executionStatus ?? "-"}</td>
                    <td>{tx.txHash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Database tables</h2>
          <p>Row counts across the Prisma schema</p>
        </div>

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
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Recent FastAuth sign events</h2>
          <p>Latest rows from fastauth_sign_events</p>
        </div>

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
                  <th>Provider</th>
                  <th>Algo</th>
                  <th>Domain</th>
                  <th>Dapp</th>
                  <th>Sponsored acct</th>
                  <th>Derived pubkey</th>
                  <th>Status</th>
                  <th>Gas burnt</th>
                  <th>Tx hash</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSignEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{formatIsoDate(event.blockTimestamp)}</td>
                    <td>{event.blockHeight}</td>
                    <td>{truncateMiddle(event.relayerAccountId, 22)}</td>
                    <td>{event.guardName ?? "-"}</td>
                    <td>{event.providerType}</td>
                    <td>{event.algorithm ?? "-"}</td>
                    <td>{event.userDomainId ?? "-"}</td>
                    <td>{truncateMiddle(event.projectDappId, 18)}</td>
                    <td>{truncateMiddle(event.sponsoredAccountId, 22)}</td>
                    <td>{truncateMiddle(event.userDerivedPublicKey, 20)}</td>
                    <td>{event.executionStatus ?? "-"}</td>
                    <td>{event.gasBurnt ?? "-"}</td>
                    <td>{truncateMiddle(event.txHash, 18)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Public-key accounts</h2>
          <p>Latest rows from fastauth_public_key_accounts</p>
        </div>

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
                    <td>{truncateMiddle(row.accountId, 22)}</td>
                    <td>{row.keyPath ?? "-"}</td>
                    <td>{truncateMiddle(row.predecessorId, 18)}</td>
                    <td>{row.domainId ?? "-"}</td>
                    <td>{formatIsoDate(row.firstSeenAt)}</td>
                    <td>{formatIsoDate(row.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Indexer checkpoints</h2>
          <p>Key/value state from indexer_checkpoints</p>
        </div>

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
                    <td>{formatIsoDate(checkpoint.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
