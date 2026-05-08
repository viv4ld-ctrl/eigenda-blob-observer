import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  const rows = await query(`
    SELECT
      relay_key,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE success = true) AS successes,
      COUNT(*) FILTER (WHERE success = true)::float /
        NULLIF(COUNT(*)::float, 0) * 100 AS success_rate,
      AVG(latency_ms) FILTER (WHERE success = true) AS avg_latency
    FROM retrieval_probes
    WHERE relay_key >= 0
    GROUP BY relay_key
    ORDER BY relay_key
  `);

  return NextResponse.json({ relays: rows });
}
