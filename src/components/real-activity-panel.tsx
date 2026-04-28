"use client";

import { useState } from "react";

import { LocalTime } from "@/components/local-time";
import { NearblocksLink } from "@/components/nearblocks-link";

type ActivityWindow = {
  total: number;
  succeeded: number;
  failed: number;
  successRatePct: number | null;
  distinctUsers: number;
  volumeUsd: number;
};

type GroupRow = {
  key: string;
  last24h: number;
  last7d: number;
  last30d: number;
  all: number;
  volumeUsdAll: number;
};

type CrossRow = {
  classKey: string;
  innerKey: string;
  last24h: number;
  last7d: number;
  last30d: number;
  all: number;
  volumeUsdAll: number;
};

type Nested = {
  overall: GroupRow[];
  byReceiver: CrossRow[];
  byMethod: CrossRow[];
};

type RealActivity = {
  byWindow: {
    last24h: ActivityWindow;
    last7d: ActivityWindow;
    last30d: ActivityWindow;
    all: ActivityWindow;
  };
  byReceiver: GroupRow[];
  byMethod: GroupRow[];
  byRelayer: Nested;
  byProvider: Nested;
  byGuard: Nested;
  trackingStartedAt: {
    blockHeight: string;
    blockTimestamp: Date | string;
  } | null;
};

type TopTabKey = "overall" | "receiver" | "method" | "relayer" | "provider" | "guard";
type SubTabKey = "overall" | "receiver" | "method";

const TOP_TABS: Array<{ key: TopTabKey; label: string }> = [
  { key: "overall", label: "Overall" },
  { key: "receiver", label: "By receiver / dApp" },
  { key: "method", label: "By method" },
  { key: "relayer", label: "By relayer" },
  { key: "provider", label: "By provider" },
  { key: "guard", label: "By guard" },
];

const SUB_TABS: Array<{ key: SubTabKey; label: string }> = [
  { key: "overall", label: "Overall" },
  { key: "receiver", label: "By receiver / dApp" },
  { key: "method", label: "By method" },
];

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

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatPercent(value: number | null): string {
  if (value === null) return "-";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0";
  if (Math.abs(value) >= 1) {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
}

function OverallTable({ byWindow }: { byWindow: RealActivity["byWindow"] }) {
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
            <td>Total txs</td>
            <td>{formatNumber(byWindow.last24h.total)}</td>
            <td>{formatNumber(byWindow.last7d.total)}</td>
            <td>{formatNumber(byWindow.last30d.total)}</td>
            <td>{formatNumber(byWindow.all.total)}</td>
          </tr>
          <tr>
            <td>Succeeded</td>
            <td>{formatNumber(byWindow.last24h.succeeded)}</td>
            <td>{formatNumber(byWindow.last7d.succeeded)}</td>
            <td>{formatNumber(byWindow.last30d.succeeded)}</td>
            <td>{formatNumber(byWindow.all.succeeded)}</td>
          </tr>
          <tr>
            <td>Failed</td>
            <td>{formatNumber(byWindow.last24h.failed)}</td>
            <td>{formatNumber(byWindow.last7d.failed)}</td>
            <td>{formatNumber(byWindow.last30d.failed)}</td>
            <td>{formatNumber(byWindow.all.failed)}</td>
          </tr>
          <tr>
            <td>Success rate</td>
            <td>{formatPercent(byWindow.last24h.successRatePct)}</td>
            <td>{formatPercent(byWindow.last7d.successRatePct)}</td>
            <td>{formatPercent(byWindow.last30d.successRatePct)}</td>
            <td>{formatPercent(byWindow.all.successRatePct)}</td>
          </tr>
          <tr>
            <td>Active users</td>
            <td>{formatNumber(byWindow.last24h.distinctUsers)}</td>
            <td>{formatNumber(byWindow.last7d.distinctUsers)}</td>
            <td>{formatNumber(byWindow.last30d.distinctUsers)}</td>
            <td>{formatNumber(byWindow.all.distinctUsers)}</td>
          </tr>
          <tr>
            <td>USD volume</td>
            <td>{formatUsd(byWindow.last24h.volumeUsd)}</td>
            <td>{formatUsd(byWindow.last7d.volumeUsd)}</td>
            <td>{formatUsd(byWindow.last30d.volumeUsd)}</td>
            <td>{formatUsd(byWindow.all.volumeUsd)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

type RenderMode = "code" | "account-link" | "plain";

function GroupTable({
  rows,
  keyLabel,
  renderMode = "code",
  formatLabel,
}: {
  rows: GroupRow[];
  keyLabel: string;
  renderMode?: RenderMode;
  formatLabel?: (key: string) => string;
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
            <th>24h</th>
            <th>7d</th>
            <th>30d</th>
            <th>All</th>
            <th>USD volume (all)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const display = formatLabel ? formatLabel(row.key) : row.key;
            return (
              <tr key={row.key}>
                <td>
                  {renderMode === "account-link" ? (
                    <NearblocksLink kind="account" value={row.key}>
                      {display}
                    </NearblocksLink>
                  ) : renderMode === "plain" ? (
                    display
                  ) : (
                    <code>{display}</code>
                  )}
                </td>
                <td>{formatNumber(row.last24h)}</td>
                <td>{formatNumber(row.last7d)}</td>
                <td>{formatNumber(row.last30d)}</td>
                <td>{formatNumber(row.all)}</td>
                <td>{formatUsd(row.volumeUsdAll)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CrossTable({
  rows,
  classLabel,
  innerLabel,
  classRenderMode = "code",
  innerRenderMode = "code",
  formatClassLabel,
}: {
  rows: CrossRow[];
  classLabel: string;
  innerLabel: string;
  classRenderMode?: RenderMode;
  innerRenderMode?: RenderMode;
  formatClassLabel?: (key: string) => string;
}) {
  if (rows.length === 0) {
    return <p className="emptyState">No data for this slice yet.</p>;
  }
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>{classLabel}</th>
            <th>{innerLabel}</th>
            <th>24h</th>
            <th>7d</th>
            <th>30d</th>
            <th>All</th>
            <th>USD volume (all)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const classDisplay = formatClassLabel
              ? formatClassLabel(row.classKey)
              : row.classKey;
            return (
              <tr key={`${row.classKey}|${row.innerKey}`}>
                <td>
                  {classRenderMode === "account-link" ? (
                    <NearblocksLink kind="account" value={row.classKey}>
                      {classDisplay}
                    </NearblocksLink>
                  ) : classRenderMode === "plain" ? (
                    classDisplay
                  ) : (
                    <code>{classDisplay}</code>
                  )}
                </td>
                <td>
                  {innerRenderMode === "account-link" ? (
                    <NearblocksLink kind="account" value={row.innerKey}>
                      {row.innerKey}
                    </NearblocksLink>
                  ) : (
                    <code>{row.innerKey}</code>
                  )}
                </td>
                <td>{formatNumber(row.last24h)}</td>
                <td>{formatNumber(row.last7d)}</td>
                <td>{formatNumber(row.last30d)}</td>
                <td>{formatNumber(row.all)}</td>
                <td>{formatUsd(row.volumeUsdAll)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NestedClassificationView({
  data,
  classLabel,
  classRenderMode,
  formatClassLabel,
}: {
  data: Nested;
  classLabel: string;
  classRenderMode: RenderMode;
  formatClassLabel?: (key: string) => string;
}) {
  const [sub, setSub] = useState<SubTabKey>("overall");
  return (
    <>
      <div className="metricTabsStrip" role="tablist" style={{ marginBottom: 12 }}>
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="metricTab"
            role="tab"
            aria-selected={sub === t.key}
            onClick={() => setSub(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sub === "overall" ? (
        <GroupTable
          rows={data.overall}
          keyLabel={classLabel}
          renderMode={classRenderMode}
          formatLabel={formatClassLabel}
        />
      ) : sub === "receiver" ? (
        <CrossTable
          rows={data.byReceiver}
          classLabel={classLabel}
          innerLabel="Receiver / contract"
          classRenderMode={classRenderMode}
          innerRenderMode="account-link"
          formatClassLabel={formatClassLabel}
        />
      ) : (
        <CrossTable
          rows={data.byMethod}
          classLabel={classLabel}
          innerLabel="Method name"
          classRenderMode={classRenderMode}
          innerRenderMode="code"
          formatClassLabel={formatClassLabel}
        />
      )}
    </>
  );
}

export function RealActivityPanel({ data }: { data: RealActivity }) {
  const [tab, setTab] = useState<TopTabKey>("overall");

  if (data.byWindow.all.total === 0) {
    return (
      <p className="emptyState">
        No user activity indexed yet. The collector will start populating this on its next run
        after a worker restart.
      </p>
    );
  }

  return (
    <>
      {data.trackingStartedAt ? (
        <p
          className="healthDetails"
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-surface-muted)",
          }}
        >
          <strong>Note:</strong> user activity is indexed forward-only — historical txs before this
          collector started are not present. Earliest user tx in DB: block{" "}
          <NearblocksLink kind="block" value={data.trackingStartedAt.blockHeight} /> at{" "}
          <LocalTime iso={data.trackingStartedAt.blockTimestamp} />.
        </p>
      ) : null}

      <div className="metricTabsStrip" role="tablist" style={{ marginBottom: 12 }}>
        {TOP_TABS.map((t) => (
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
        <OverallTable byWindow={data.byWindow} />
      ) : tab === "receiver" ? (
        <GroupTable
          rows={data.byReceiver}
          keyLabel="Receiver / contract"
          renderMode="account-link"
        />
      ) : tab === "method" ? (
        <GroupTable rows={data.byMethod} keyLabel="Method name" renderMode="code" />
      ) : tab === "relayer" ? (
        <NestedClassificationView
          data={data.byRelayer}
          classLabel="Relayer"
          classRenderMode="account-link"
        />
      ) : tab === "provider" ? (
        <NestedClassificationView
          data={data.byProvider}
          classLabel="Provider"
          classRenderMode="plain"
          formatClassLabel={toProviderDisplayName}
        />
      ) : (
        <NestedClassificationView
          data={data.byGuard}
          classLabel="Guard"
          classRenderMode="code"
        />
      )}
    </>
  );
}
