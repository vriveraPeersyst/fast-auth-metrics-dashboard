"use client";

import { useState } from "react";

import { LocalTime } from "@/components/local-time";
import { NearblocksLink } from "@/components/nearblocks-link";

type ConsumerOutcomeWindow = {
  total: number;
  succeeded: number;
  failed: number;
  successRatePct: number | null;
};

type ConsumerOutcomesByWindow = {
  last24h: ConsumerOutcomeWindow;
  last7d: ConsumerOutcomeWindow;
  last30d: ConsumerOutcomeWindow;
  all: ConsumerOutcomeWindow;
};

type ConsumerOutcomesGroup = {
  key: string;
  byWindow: ConsumerOutcomesByWindow;
};

type ConsumerFailureReasonRow = {
  reason: string;
  last24h: number;
  last7d: number;
  last30d: number;
  all: number;
};

type ConsumerOutcomes = {
  byWindow: ConsumerOutcomesByWindow;
  byRelayer: ConsumerOutcomesGroup[];
  byGuard: ConsumerOutcomesGroup[];
  byProvider: ConsumerOutcomesGroup[];
  byActionType: ConsumerOutcomesGroup[];
  topFailureReasons: ConsumerFailureReasonRow[];
  trackingStartedAt: {
    blockHeight: string;
    blockTimestamp: Date | string;
  } | null;
};

type SliceKey = "all" | "relayer" | "guard" | "provider" | "action";

const SLICES: Array<{ key: SliceKey; label: string }> = [
  { key: "all", label: "Overall" },
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

// Action-type keys come from the SQL as `+`-joined arrays of inner action
// names (e.g. "DeleteKey+DeleteKey+DeleteKey"). Collapse repeats so a tx
// with N of the same action renders as "Batch(Name×N)" and mixed batches
// as "Batch(A×n, B×m)". Single-action keys pass through unchanged.
function formatActionTypeKey(rawKey: string): string {
  if (!rawKey || !rawKey.includes("+")) return rawKey;

  const counts = new Map<string, number>();
  for (const a of rawKey.split("+")) {
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }

  if (counts.size === 1) {
    const [[name, count]] = counts;
    return `Batch(${name}×${count})`;
  }

  const parts = [...counts.entries()].map(([name, count]) =>
    count === 1 ? name : `${name}×${count}`,
  );
  return `Batch(${parts.join(", ")})`;
}

function OverallTable({ byWindow }: { byWindow: ConsumerOutcomesByWindow }) {
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
            <td>Total</td>
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
        </tbody>
      </table>
    </div>
  );
}

function GroupTable({
  groups,
  keyLabel,
}: {
  groups: ConsumerOutcomesGroup[];
  keyLabel: string;
}) {
  if (groups.length === 0) {
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
            <th>Total all</th>
            <th>Failed 24h</th>
            <th>Success 24h</th>
            <th>Success all</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key}>
              <td>{group.key}</td>
              <td>{formatNumber(group.byWindow.last24h.total)}</td>
              <td>{formatNumber(group.byWindow.last7d.total)}</td>
              <td>{formatNumber(group.byWindow.last30d.total)}</td>
              <td>{formatNumber(group.byWindow.all.total)}</td>
              <td>{formatNumber(group.byWindow.last24h.failed)}</td>
              <td>{formatPercent(group.byWindow.last24h.successRatePct)}</td>
              <td>{formatPercent(group.byWindow.all.successRatePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ConsumerOutcomesPanel({ data }: { data: ConsumerOutcomes }) {
  const [slice, setSlice] = useState<SliceKey>("all");

  if (data.byWindow.all.total === 0) {
    return (
      <p className="emptyState">
        No consumer transactions indexed yet. The collector will start populating these on its
        next run after a worker restart.
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
          <strong>Note:</strong> consumer transactions are indexed forward-only — historical txs
          before this collector started are not present. Earliest consumer tx in DB: block{" "}
          <NearblocksLink kind="block" value={data.trackingStartedAt.blockHeight} /> at{" "}
          <LocalTime iso={data.trackingStartedAt.blockTimestamp} />.
        </p>
      ) : null}

      <div className="metricTabsStrip" role="tablist" style={{ marginBottom: 12 }}>
        {SLICES.map((s) => (
          <button
            key={s.key}
            type="button"
            className="metricTab"
            role="tab"
            aria-selected={slice === s.key}
            onClick={() => setSlice(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {slice === "all" ? (
        <OverallTable byWindow={data.byWindow} />
      ) : slice === "relayer" ? (
        <GroupTable groups={data.byRelayer} keyLabel="Relayer" />
      ) : slice === "guard" ? (
        <GroupTable groups={data.byGuard} keyLabel="Guard" />
      ) : slice === "provider" ? (
        <GroupTable groups={data.byProvider} keyLabel="Provider" />
      ) : (
        <GroupTable
          groups={data.byActionType.map((g) => ({ ...g, key: formatActionTypeKey(g.key) }))}
          keyLabel="Action types"
        />
      )}

      {data.topFailureReasons.length > 0 ? (
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
              {data.topFailureReasons.map((row) => (
                <tr key={row.reason}>
                  <td>
                    <code>{row.reason}</code>
                  </td>
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
  );
}
