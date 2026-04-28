type SegmentStatus = "healthy" | "lagging" | "stale" | "no_data";

type Point = {
  computedAt: Date;
  totalTransactions: number;
  successRatePct: number | null;
  attempted: number;
};

type UptimeBarProps = {
  label: string;
  points: Point[];
  emptyText?: string;
};

function classify(point: Point): SegmentStatus {
  if (point.attempted === 0) {
    return "no_data";
  }
  if (point.successRatePct === null) {
    return "no_data";
  }
  if (point.successRatePct >= 98) {
    return "healthy";
  }
  if (point.successRatePct >= 90) {
    return "lagging";
  }
  return "stale";
}

function formatAbsolute(date: Date): string {
  return date.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

function summarize(points: Point[]): {
  uptimePct: number | null;
  healthy: number;
  lagging: number;
  stale: number;
  noData: number;
} {
  let healthy = 0;
  let lagging = 0;
  let stale = 0;
  let noData = 0;

  for (const p of points) {
    switch (classify(p)) {
      case "healthy":
        healthy += 1;
        break;
      case "lagging":
        lagging += 1;
        break;
      case "stale":
        stale += 1;
        break;
      case "no_data":
        noData += 1;
        break;
    }
  }

  const probed = healthy + lagging + stale;
  const uptimePct = probed > 0 ? Math.round((healthy / probed) * 1000) / 10 : null;

  return { uptimePct, healthy, lagging, stale, noData };
}

export function UptimeBar({ label, points, emptyText = "No probes recorded in the last 24h." }: UptimeBarProps) {
  const summary = summarize(points);
  const probedCount = summary.healthy + summary.lagging + summary.stale;

  return (
    <div className="statusUptime">
      <div className="statusUptimeHeader">
        <span className="statusUptimeLabel">{label}</span>
        <span className="statusUptimeSummary">
          {summary.uptimePct === null
            ? "—"
            : `${summary.uptimePct.toLocaleString("en-US", { maximumFractionDigits: 1 })}% uptime`}
          <span className="statusUptimeHint">
            {" · "}
            {probedCount} probe{probedCount === 1 ? "" : "s"} with data
            {summary.noData > 0 ? ` · ${summary.noData} no-data` : ""}
          </span>
        </span>
      </div>

      {points.length === 0 ? (
        <p className="statusUptimeEmpty">{emptyText}</p>
      ) : (
        <div className="statusUptimeTrack" role="img" aria-label={`${label} uptime — last 24h`}>
          {points.map((p, i) => {
            const status = classify(p);
            const successText =
              p.successRatePct === null
                ? "no data"
                : `${p.successRatePct.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
            return (
              <span
                key={`${p.computedAt.getTime()}-${i}`}
                className={`statusUptimeSegment statusUptimeSegment--${status}`}
                title={`${formatAbsolute(p.computedAt)} · ${successText} (${p.attempted} attempts)`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
