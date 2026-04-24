import { createHmac, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { runAllIndexers } from "@/lib/indexers/run-all";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_REQUEST_SKEW_SECONDS = 5 * 60;

function constantTimeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

function getRequesterIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    return first || null;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || null;
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.INDEXER_CRON_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "INDEXER_CRON_SECRET is not configured." },
      { status: 500 },
    );
  }

  const allowedIps = (process.env.INDEXER_ALLOWED_IPS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (allowedIps.length > 0) {
    const requesterIp = getRequesterIp(request);
    if (!requesterIp || !allowedIps.includes(requesterIp)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  const timestampHeader = request.headers.get("x-indexer-ts")?.trim();
  const signatureHeader = request.headers.get("x-indexer-signature")?.trim().toLowerCase();

  if (!timestampHeader || !signatureHeader) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > MAX_REQUEST_SKEW_SECONDS) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const expectedSignature = createHmac("sha256", expectedSecret)
    .update(`${timestampHeader}:${request.nextUrl.pathname}`)
    .digest("hex");

  if (!constantTimeEqual(signatureHeader, expectedSignature)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const results = await runAllIndexers();

  return NextResponse.json({
    ok: true,
    executedAt: new Date().toISOString(),
    results,
  });
}
