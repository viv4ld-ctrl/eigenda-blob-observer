import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);

  const rows = await query(
    `SELECT
      p.blob_key,
      p.probe_timestamp,
      p.blob_age_hours,
      p.relay_key,
      p.success,
      p.latency_ms,
      p.error_message,
      p.data_size_bytes
    FROM retrieval_probes p
    ORDER BY p.probe_timestamp DESC
    LIMIT $1`,
    [limit]
  );

  return NextResponse.json({ probes: rows });
}
