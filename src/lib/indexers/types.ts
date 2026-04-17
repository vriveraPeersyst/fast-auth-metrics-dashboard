export type IndexerRunResult = {
  source: string;
  status: "ok" | "skipped" | "error";
  inserted?: number;
  details?: string;
};
