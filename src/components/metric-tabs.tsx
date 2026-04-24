"use client";

import { useState } from "react";

type TimeWindow = "24h" | "7d" | "30d";

type MetricRow = {
  label: string;
  values: Record<TimeWindow, number | string>;
};

type MetricTabsProps = {
  title: string;
  headline?: { label: string; value: number | string };
  rows: MetricRow[];
};

const WINDOWS: TimeWindow[] = ["24h", "7d", "30d"];
const WINDOW_LABELS: Record<TimeWindow, string> = {
  "24h": "24H",
  "7d": "7D",
  "30d": "30D",
};

export function MetricTabs({ title, headline, rows }: MetricTabsProps) {
  const [active, setActive] = useState<TimeWindow>("24h");

  return (
    <div className="metricTabsCard">
      <div className="metricTabsHeader">
        <h2 className="metricTabsTitle">{title}</h2>
        <div className="metricTabsStrip" role="tablist">
          {WINDOWS.map((w) => (
            <button
              key={w}
              className="metricTab"
              role="tab"
              aria-selected={active === w}
              onClick={() => setActive(w)}
            >
              {WINDOW_LABELS[w]}
            </button>
          ))}
        </div>
      </div>

      <div className="metricTabsBody">
        {headline ? (
          <div className="metricTabsRow metricTabsRow--headline">
            <span className="metricTabsLabel">{headline.label}</span>
            <span className="metricTabsValue metricTabsValue--headline">
              {typeof headline.value === "number"
                ? headline.value.toLocaleString("en-US")
                : headline.value}
            </span>
          </div>
        ) : null}

        {rows.map((row) => (
          <div className="metricTabsRow" key={row.label}>
            <span className="metricTabsLabel">{row.label}</span>
            <span className="metricTabsValue">
              {typeof row.values[active] === "number"
                ? (row.values[active] as number).toLocaleString("en-US")
                : row.values[active]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
