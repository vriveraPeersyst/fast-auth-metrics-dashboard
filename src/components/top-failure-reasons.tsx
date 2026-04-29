"use client";

import { useState } from "react";

type FailureReasonRow = {
  reason: string;
  last24h: number;
  last7d: number;
  last30d: number;
  all: number;
};

const PAGE_SIZE = 5;

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function TopFailureReasons({ rows }: { rows: FailureReasonRow[] }) {
  const [page, setPage] = useState(0);

  if (rows.length === 0) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);

  return (
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
          {visible.map((row) => (
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

      {totalPages > 1 ? (
        <div className="topFailureReasonsPagination">
          <span className="topFailureReasonsPaginationCount">
            Showing {start + 1}–{Math.min(start + PAGE_SIZE, rows.length)} of {rows.length}
          </span>
          <span className="topFailureReasonsPaginationControls">
            <button
              type="button"
              className="metricTab"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              aria-label="Previous page"
            >
              ‹ Prev
            </button>
            <span>
              Page {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="metricTab"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              aria-label="Next page"
            >
              Next ›
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
