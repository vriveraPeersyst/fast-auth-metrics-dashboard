"use client";

import { useState } from "react";

type TimeWindowMetrics = {
  last24h: number;
  last7d: number;
  last30d: number;
  all: number;
};

type TransactionMetrics = {
  signed: TimeWindowMetrics;
  failed: TimeWindowMetrics;
  total: TimeWindowMetrics;
};

type WindowStats = {
  signed: number;
  failed: number;
  total: number;
  distinctUsers: number;
  successRatePct: number | null;
};

type GuardBreakdownItem = {
  guardName: string;
  last24h: WindowStats;
  last7d: WindowStats;
  last30d: WindowStats;
};

type ProviderBreakdownItem = {
  providerType: string;
  last24h: WindowStats;
  last7d: WindowStats;
  last30d: WindowStats;
};

type RelayerBreakdownItem = {
  relayerAccountId: string;
  last24h: WindowStats;
  last7d: WindowStats;
  last30d: WindowStats;
};

type ActionTypeBreakdownItem = {
  actionType: string;
  last24h: number;
  last7d: number;
  last30d: number;
  all: number;
};

type TabKey = "overall" | "relayer" | "provider" | "guard" | "action";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overall", label: "Overall" },
  { key: "relayer", label: "By relayer" },
  { key: "provider", label: "By provider" },
  { key: "guard", label: "By guard" },
  { key: "action", label: "By action type" },
];

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatPercent(value: number | null): string {
  if (value === null) return "-";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
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

function OverallTable({ data }: { data: TransactionMetrics }) {
  return (
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
            <td>{formatNumber(data.signed.last24h)}</td>
            <td>{formatNumber(data.signed.last7d)}</td>
            <td>{formatNumber(data.signed.last30d)}</td>
            <td>{formatNumber(data.signed.all)}</td>
          </tr>
          <tr>
            <td>Failed</td>
            <td>{formatNumber(data.failed.last24h)}</td>
            <td>{formatNumber(data.failed.last7d)}</td>
            <td>{formatNumber(data.failed.last30d)}</td>
            <td>{formatNumber(data.failed.all)}</td>
          </tr>
          <tr>
            <td>Total</td>
            <td>{formatNumber(data.total.last24h)}</td>
            <td>{formatNumber(data.total.last7d)}</td>
            <td>{formatNumber(data.total.last30d)}</td>
            <td>{formatNumber(data.total.all)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BreakdownTable<T extends { last24h: WindowStats; last7d: WindowStats; last30d: WindowStats }>({
  rows,
  keyLabel,
  rowKey,
  rowLabel,
}: {
  rows: T[];
  keyLabel: string;
  rowKey: (row: T) => string;
  rowLabel: (row: T) => string;
}) {
  if (rows.length === 0) {
    return <p className="emptyState">No data for this slice yet.</p>;
  }
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>{keyLabel}</th>
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
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              <td>{rowLabel(row)}</td>
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
  );
}

function ActionTypeTable({ rows }: { rows: ActionTypeBreakdownItem[] }) {
  const hiddenUnclassified = rows.filter((r) => r.actionType === "(unclassified)").length;
  const hiddenNone = rows.filter((r) => r.actionType === "(none)").length;
  const filteredRows = rows.filter(
    (r) => r.actionType !== "(unclassified)" && r.actionType !== "(none)",
  );

  if (filteredRows.length === 0) {
    return (
      <>
        <p className="emptyState">No sign events with parsed action type yet.</p>
        <HiddenRowsFooter unclassified={hiddenUnclassified} none={hiddenNone} />
      </>
    );
  }
  return (
    <>
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
            {filteredRows.map((row) => (
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
      <HiddenRowsFooter unclassified={hiddenUnclassified} none={hiddenNone} />
    </>
  );
}

function HiddenRowsFooter({ unclassified, none }: { unclassified: number; none: number }) {
  if (unclassified === 0 && none === 0) return null;
  const parts: string[] = [];
  if (unclassified > 0) parts.push(`${unclassified} rows with (unclassified)`);
  if (none > 0) parts.push(`${none} rows with (none)`);
  return (
    <p className="healthMetaHint" style={{ marginTop: 8 }}>
      Hidden: {parts.join(", ")}.
    </p>
  );
}

export function TransactionsPanel({
  transactionOverview,
  relayerBreakdown,
  providerBreakdown,
  guardBreakdown,
  actionTypeBreakdown,
}: {
  transactionOverview: TransactionMetrics;
  relayerBreakdown: RelayerBreakdownItem[];
  providerBreakdown: ProviderBreakdownItem[];
  guardBreakdown: GuardBreakdownItem[];
  actionTypeBreakdown: ActionTypeBreakdownItem[];
}) {
  const [tab, setTab] = useState<TabKey>("overall");

  return (
    <>
      <div className="metricTabsStrip" role="tablist" style={{ marginBottom: 12 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="metricTab"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overall" ? (
        <OverallTable data={transactionOverview} />
      ) : tab === "relayer" ? (
        <BreakdownTable
          rows={relayerBreakdown}
          keyLabel="Relayer"
          rowKey={(r) => r.relayerAccountId}
          rowLabel={(r) => r.relayerAccountId}
        />
      ) : tab === "provider" ? (
        <BreakdownTable
          rows={providerBreakdown}
          keyLabel="Provider"
          rowKey={(r) => r.providerType}
          rowLabel={(r) => toProviderDisplayName(r.providerType)}
        />
      ) : tab === "guard" ? (
        <BreakdownTable
          rows={guardBreakdown}
          keyLabel="Guard"
          rowKey={(r) => r.guardName}
          rowLabel={(r) => r.guardName}
        />
      ) : (
        <ActionTypeTable rows={actionTypeBreakdown} />
      )}
    </>
  );
}
