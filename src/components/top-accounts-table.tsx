"use client";

import { useMemo, useState } from "react";

import { LocalTime } from "@/components/local-time";
import { NearblocksLink } from "@/components/nearblocks-link";

type TopAccountRow = {
  accountId: string;
  signEventsAll: number;
  signEvents30d: number;
  signEvents7d: number;
  signEvents24h: number;
  firstEventAt: Date | string | null;
  lastEventAt: Date | string | null;
};

type SortWindow = "24h" | "7d" | "30d" | "all";

const WINDOWS: SortWindow[] = ["24h", "7d", "30d", "all"];
const WINDOW_LABELS: Record<SortWindow, string> = {
  "24h": "24H",
  "7d": "7D",
  "30d": "30D",
  all: "ALL",
};

const SORT_KEYS: Record<SortWindow, keyof TopAccountRow> = {
  "24h": "signEvents24h",
  "7d": "signEvents7d",
  "30d": "signEvents30d",
  all: "signEventsAll",
};

function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

const PAGE_SIZE = 10;

export function TopAccountsTable({ rows }: { rows: TopAccountRow[] }) {
  const [sortBy, setSortBy] = useState<SortWindow>("all");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const key = SORT_KEYS[sortBy];
    return [...rows].sort((a, b) => (b[key] as number) - (a[key] as number));
  }, [rows, sortBy]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * PAGE_SIZE;
  const visible = sorted.slice(start, start + PAGE_SIZE);

  if (rows.length === 0) {
    return <p className="emptyState">No accounts have been resolved from sign events yet.</p>;
  }

  return (
    <>
      <div className="metricTabsStrip" role="tablist" style={{ marginBottom: 12 }}>
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            className="metricTab"
            role="tab"
            aria-selected={sortBy === w}
            onClick={() => {
              setSortBy(w);
              setPage(0);
            }}
          >
            {WINDOW_LABELS[w]}
          </button>
        ))}
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Account</th>
              <th>24h</th>
              <th>7d</th>
              <th>30d</th>
              <th>All</th>
              <th>First seen</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={row.accountId}>
                <td>{start + i + 1}</td>
                <td>
                  <NearblocksLink kind="account" value={row.accountId}>
                    {truncateMiddle(row.accountId, 28)}
                  </NearblocksLink>
                </td>
                <td>{formatNumber(row.signEvents24h)}</td>
                <td>{formatNumber(row.signEvents7d)}</td>
                <td>{formatNumber(row.signEvents30d)}</td>
                <td>{formatNumber(row.signEventsAll)}</td>
                <td>
                  <LocalTime iso={row.firstEventAt} />
                </td>
                <td>
                  <LocalTime iso={row.lastEventAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 12,
          gap: 12,
        }}
      >
        <span className="healthMetaHint">
          Showing {start + 1}–{Math.min(start + PAGE_SIZE, sorted.length)} of{" "}
          {formatNumber(sorted.length)}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="metricTab"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
          >
            Prev
          </button>
          <span className="healthMetaHint" style={{ alignSelf: "center" }}>
            Page {currentPage + 1} / {totalPages}
          </span>
          <button
            type="button"
            className="metricTab"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage >= totalPages - 1}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
