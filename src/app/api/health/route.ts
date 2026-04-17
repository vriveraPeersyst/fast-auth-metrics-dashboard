import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "fast-auth-metrics-dashboard",
    timestamp: new Date().toISOString(),
  });
}
