import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { LogoutButton } from "@/components/logout-button";
import { allowedGoogleDomain, authOptions } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";

function formatMetricValue(value: number | null): string {
  if (value === null) {
    return "-";
  }

  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
}

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email?.toLowerCase().endsWith(`@${allowedGoogleDomain}`)) {
    redirect("/sign-in");
  }

  const data = await getDashboardData();
  const trackedNearAccounts =
    process.env.NEAR_TRACKED_ACCOUNT_IDS
      ?.split(",")
      .map((accountId) => accountId.trim())
      .filter(Boolean)
      .join(", ") ?? "fast-auth.near";
  const failureRate =
    data.latestRelayerSignTotal && data.latestRelayerSignTotal > 0
      ? ((data.latestRelayerSignFailed ?? 0) / data.latestRelayerSignTotal) * 100
      : null;

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

      <section className="metricsGrid">
        <article className="metricCard">
          <h2>Auth0 events (24h)</h2>
          <p>{data.auth0EventsLast24h}</p>
        </article>

        <article className="metricCard">
          <h2>Relayer sign_total</h2>
          <p>{formatMetricValue(data.latestRelayerSignTotal)}</p>
        </article>

        <article className="metricCard">
          <h2>Relayer sign_failed</h2>
          <p>{formatMetricValue(data.latestRelayerSignFailed)}</p>
        </article>

        <article className="metricCard">
          <h2>Relayer failure rate</h2>
          <p>{failureRate === null ? "-" : `${failureRate.toFixed(2)}%`}</p>
        </article>

        <article className="metricCard">
          <h2>Latest NEAR final block</h2>
          <p>{data.latestNearFinalBlock ?? "-"}</p>
        </article>

        <article className="metricCard">
          <h2>Tracked NEAR tx (24h)</h2>
          <p>{data.nearTrackedTxLast24h}</p>
        </article>

        <article className="metricCard">
          <h2>Last ingestion write</h2>
          <p>{data.lastIngestionAt ? data.lastIngestionAt.toISOString() : "-"}</p>
        </article>
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Recent Auth0 logs</h2>
          <p>PII-safe fields only</p>
        </div>

        {data.recentAuth0Logs.length === 0 ? (
          <p className="emptyState">No Auth0 logs ingested yet.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Type</th>
                  <th>Connection</th>
                  <th>Description</th>
                  <th>Log ID</th>
                </tr>
              </thead>
              <tbody>
                {data.recentAuth0Logs.map((log) => (
                  <tr key={log.logId}>
                    <td>{log.timestamp.toISOString()}</td>
                    <td>{log.type}</td>
                    <td>{log.connection ?? "-"}</td>
                    <td>{log.description ?? "-"}</td>
                    <td>{log.logId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="logsPanel">
        <div className="panelTitleRow">
          <h2>Recent NEAR transactions</h2>
          <p>Tracked accounts: {trackedNearAccounts}</p>
        </div>

        {data.recentNearTransactions.length === 0 ? (
          <p className="emptyState">No tracked NEAR transactions ingested yet.</p>
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
    </main>
  );
}
