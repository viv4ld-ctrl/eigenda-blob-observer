import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  // Overall operator probe stats
  const [stats] = await query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE success = true) AS successes,
      COUNT(*) FILTER (WHERE success = true)::float /
        NULLIF(COUNT(*)::float, 0) * 100 AS success_rate,
      AVG(latency_ms) FILTER (WHERE success = true) AS avg_latency
    FROM operator_probes
    WHERE probe_timestamp > NOW() - INTERVAL '24 hours'
  `);

  // Per-operator stats (top 20 most probed)
  const operators = await query(`
    SELECT
      operator_id,
      operator_socket,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE success = true) AS successes,
      COUNT(*) FILTER (WHERE success = true)::float /
        NULLIF(COUNT(*)::float, 0) * 100 AS success_rate,
      AVG(latency_ms) FILTER (WHERE success = true) AS avg_latency,
      AVG(chunks_returned) FILTER (WHERE success = true) AS avg_chunks
    FROM operator_probes
    GROUP BY operator_id, operator_socket
    ORDER BY total DESC
    LIMIT 20
  `);

  // Recent probes
  const recent = await query(`
    SELECT blob_key, probe_timestamp, operator_id, operator_socket,
           success, latency_ms, chunks_returned, error_message
    FROM operator_probes
    ORDER BY probe_timestamp DESC
    LIMIT 20
  `);

  return NextResponse.json({
    stats: {
      total: parseInt(stats?.total ?? "0"),
      successes: parseInt(stats?.successes ?? "0"),
      success_rate: parseFloat(stats?.success_rate ?? "0"),
      avg_latency: parseFloat(stats?.avg_latency ?? "0"),
    },
    operators,
    recent,
  });
}
