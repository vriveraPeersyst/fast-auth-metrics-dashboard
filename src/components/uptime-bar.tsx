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

// Each bin covers this many minutes — must stay in sync with the date_bin
// interval in loadChainHealth. Used to convert "bins with data" into a human
// duration ("1h 45m covered") and to label the tooltip's bin window.
const BIN_MINUTES = 15;

function formatAbsolute(date: Date): string {
  return date.toLocaleString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    hour12: false,
  });
}

function formatCoveredDuration(binsWithData: number): string {
  const totalMinutes = binsWithData * BIN_MINUTES;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m covered`;
  if (minutes === 0) return `${hours}h covered`;
  return `${hours}h ${minutes}m covered`;
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

export function UptimeBar({ label, points, emptyText = "No data for the last 24h yet." }: UptimeBarProps) {
  const summary = summarize(points);
  const binsWithData = summary.healthy + summary.lagging + summary.stale;

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
            {formatCoveredDuration(binsWithData)}
            {summary.noData > 0 ? ` · ${summary.noData} idle bin${summary.noData === 1 ? "" : "s"}` : ""}
          </span>
        </span>
      </div>

      {points.length === 0 ? (
        <p className="statusUptimeEmpty">{emptyText}</p>
      ) : (
        <div className="statusUptimeTrackWrap" tabIndex={0}>
          <div className="statusUptimeTrack" role="img" aria-label={`${label} uptime — last 24h`}>
            {points.map((p, i) => {
              const status = classify(p);
              const successText =
                p.successRatePct === null
                  ? "no data"
                  : `${p.successRatePct.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
              const binEnd = new Date(p.computedAt.getTime() + BIN_MINUTES * 60_000);
              const window = `${formatAbsolute(p.computedAt)}–${binEnd.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
              return (
                <span
                  key={`${p.computedAt.getTime()}-${i}`}
                  className={`statusUptimeSegment statusUptimeSegment--${status}`}
                  title={`${window} · ${successText} (${p.attempted} attempts)`}
                />
              );
            })}
          </div>
          <div className="statusUptimeLegend" role="tooltip">
            <strong>Legend ({BIN_MINUTES}-min bins)</strong>
            <ul>
              <li>
                <span className="legendSwatch statusUptimeSegment--healthy" />
                Healthy: ≥98% success
              </li>
              <li>
                <span className="legendSwatch statusUptimeSegment--lagging" />
                Lagging: 90–98% success
              </li>
              <li>
                <span className="legendSwatch statusUptimeSegment--stale" />
                Stale: &lt;90% success
              </li>
              <li>
                <span className="legendSwatch statusUptimeSegment--no_data" />
                Idle: no FastAuth tx in this window
              </li>
            </ul>
            <p>
              Pending tx (awaiting receipt classification) are excluded from the success-rate
              calculation, so a bin where everything is still pending renders as idle, not stale.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
