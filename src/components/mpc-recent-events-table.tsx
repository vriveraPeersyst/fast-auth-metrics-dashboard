"use client";

import { useMemo, useState } from "react";

import { LocalTime } from "@/components/local-time";
import { NearblocksLink } from "@/components/nearblocks-link";

type MpcGovernanceEvent = {
  txHash: string;
  blockTimestamp: Date | string;
  eventType: string;
  category: string;
  actorId: string;
  payloadSummary: string | null;
};

const PAGE_SIZE = 10;

function shortHash(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function MpcRecentEventsTable({
  events,
  categoryLabels,
}: {
  events: MpcGovernanceEvent[];
  categoryLabels: Record<string, string>;
}) {
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const visible = useMemo(
    () => events.slice(start, start + PAGE_SIZE),
    [events, start],
  );

  if (events.length === 0) return null;

  return (
    <>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Event</th>
              <th>Category</th>
              <th>Details</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.txHash}>
                <td>
                  <LocalTime iso={row.blockTimestamp} />
                </td>
                <td>
                  <NearblocksLink kind="account" value={row.actorId}>
                    {row.actorId}
                  </NearblocksLink>
                </td>
                <td>
                  <code>{row.eventType}</code>
                </td>
                <td>{categoryLabels[row.category] ?? row.category}</td>
                <td>{row.payloadSummary ? <code>{row.payloadSummary}</code> : "—"}</td>
                <td>
                  <NearblocksLink kind="tx" value={row.txHash}>
                    {shortHash(row.txHash)}
                  </NearblocksLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="tablePagination">
          <span className="healthMetaHint">
            Showing {start + 1}–{Math.min(start + PAGE_SIZE, events.length)} of {events.length}
          </span>
          <div className="tablePagination__controls">
            <button
              type="button"
              className="metricTab"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              aria-label="Previous page"
            >
              ‹ Prev
            </button>
            <span className="healthMetaHint">
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
          </div>
        </div>
      ) : null}
    </>
  );
}
