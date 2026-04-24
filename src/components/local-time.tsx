"use client";

import { useSyncExternalStore } from "react";

type LocalTimeProps = {
  iso: string | Date | null | undefined;
  fallback?: string;
};

const FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
};

function formatLocal(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return date.toLocaleString(undefined, FORMAT_OPTIONS);
}

function subscribe(): () => void {
  return () => {};
}

function getClientSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

export function LocalTime({ iso, fallback = "-" }: LocalTimeProps) {
  const isHydrated = useIsHydrated();

  const isoString = iso instanceof Date ? iso.toISOString() : iso ?? null;

  if (!isoString) {
    return <>{fallback}</>;
  }

  const display = isHydrated ? formatLocal(isoString) : isoString;

  return (
    <time dateTime={isoString} suppressHydrationWarning title={isoString}>
      {display}
    </time>
  );
}
