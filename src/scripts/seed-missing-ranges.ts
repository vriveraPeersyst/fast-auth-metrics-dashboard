import "dotenv/config";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { prisma } from "@/lib/prisma";

const MISSING_RANGES_FILE = resolve(process.cwd(), "data/missing-block-ranges.json");

type FileEntry = {
  startHeight: number;
  endHeight: number;
  reason?: string;
  recordedAt?: string;
  completedUpTo?: number | null;
  completedDownTo?: number | null;
  status?: "open" | "closed";
};

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync(MISSING_RANGES_FILE, "utf8");
  } catch (err) {
    console.error(`Could not read ${MISSING_RANGES_FILE}:`, err);
    process.exit(1);
  }

  const parsed = JSON.parse(raw) as { ranges?: FileEntry[] };
  const ranges = Array.isArray(parsed.ranges) ? parsed.ranges : [];

  if (ranges.length === 0) {
    console.log("No ranges in JSON file. Nothing to seed.");
    return;
  }

  console.log(`Seeding ${ranges.length} range(s) from ${MISSING_RANGES_FILE} into missing_block_ranges...`);

  for (const r of ranges) {
    if (!Number.isInteger(r.startHeight) || !Number.isInteger(r.endHeight)) {
      console.warn(`  skipping malformed entry:`, r);
      continue;
    }

    const recordedAt = r.recordedAt ? new Date(r.recordedAt) : new Date();
    const status = r.status === "closed" ? "closed" : "open";

    const startHeight = BigInt(r.startHeight);
    const endHeight = BigInt(r.endHeight);

    // Upsert by (startHeight, endHeight). If the row already exists, only fill
    // in null fields rather than clobbering progress that the backfill may
    // have already recorded.
    const existing = await prisma.missingBlockRange.findUnique({
      where: { startHeight_endHeight: { startHeight, endHeight } },
    });

    if (existing) {
      console.log(`  ${r.startHeight}..${r.endHeight} already exists (id=${existing.id}, status=${existing.status}) — leaving as-is`);
      continue;
    }

    const created = await prisma.missingBlockRange.create({
      data: {
        startHeight,
        endHeight,
        reason: r.reason ?? "",
        status,
        completedUpTo: r.completedUpTo != null ? BigInt(r.completedUpTo) : null,
        completedDownTo: r.completedDownTo != null ? BigInt(r.completedDownTo) : null,
        recordedAt,
      },
    });

    console.log(`  inserted id=${created.id}: ${r.startHeight}..${r.endHeight} (${status})`);
  }

  const all = await prisma.missingBlockRange.findMany({ orderBy: { startHeight: "asc" } });
  console.log(`\nTable contents (${all.length} row(s)):`);
  for (const row of all) {
    console.log(`  id=${row.id} ${row.startHeight}..${row.endHeight}  status=${row.status}  upTo=${row.completedUpTo ?? "-"}  downTo=${row.completedDownTo ?? "-"}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
