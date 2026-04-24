import type { ReactNode } from "react";

type NearblocksKind = "account" | "tx" | "block";

const NEARBLOCKS_BASE_URL = "https://nearblocks.io";

function buildHref(kind: NearblocksKind, value: string): string {
  switch (kind) {
    case "account":
      return `${NEARBLOCKS_BASE_URL}/address/${encodeURIComponent(value)}`;
    case "tx":
      return `${NEARBLOCKS_BASE_URL}/txns/${encodeURIComponent(value)}`;
    case "block":
      return `${NEARBLOCKS_BASE_URL}/blocks/${encodeURIComponent(value)}`;
  }
}

export function NearblocksLink({
  kind,
  value,
  children,
  emptyFallback = "-",
}: {
  kind: NearblocksKind;
  value: string | number | bigint | null | undefined;
  children?: ReactNode;
  emptyFallback?: ReactNode;
}) {
  if (value === null || value === undefined || value === "") {
    return <>{emptyFallback}</>;
  }

  const asString = typeof value === "string" ? value : String(value);

  return (
    <a
      className="explorerLink"
      href={buildHref(kind, asString)}
      target="_blank"
      rel="noopener noreferrer"
      title={asString}
    >
      {children ?? asString}
    </a>
  );
}
