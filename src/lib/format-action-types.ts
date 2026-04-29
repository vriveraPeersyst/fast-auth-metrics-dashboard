// Action-type keys arrive as `+`-joined arrays of NEAR-protocol action enum
// tags (e.g. "DeleteKey+DeleteKey+DeleteKey"). Collapse repeats so a tx
// with N of the same action renders as "Batch(Name×N)" and mixed batches
// as "Batch(A, B×n)". Single-action keys pass through unchanged.
export function formatActionTypeKey(rawKey: string): string {
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
