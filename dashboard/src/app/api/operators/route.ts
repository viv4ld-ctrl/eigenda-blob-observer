import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  // Overall operator probe stats (24h)
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

  // Recoverability: per-blob chunk totals for recently probed blobs
  const recoverability = await query(`
    SELECT
      blob_key,
      SUM(chunks_returned) FILTER (WHERE success = true) AS total_chunks,
      COUNT(*) FILTER (WHERE success = true) AS operators_ok,
      COUNT(*) FILTER (WHERE success = false) AS operators_fail,
      CASE WHEN SUM(chunks_returned) FILTER (WHERE success = true) >= 1024
        THEN true ELSE false END AS recoverable
    FROM operator_probes
    WHERE probe_timestamp > NOW() - INTERVAL '1 hour'
    GROUP BY blob_key
    ORDER BY MAX(probe_timestamp) DESC
    LIMIT 30
  `);

  const recoverableCount = recoverability.filter(
    (r: Record<string, unknown>) => r.recoverable === true
  ).length;
  const totalBlobs = recoverability.length;

  // Per-operator stats (all time, top 30)
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
    LIMIT 30
  `);

  return NextResponse.json({
    stats: {
      total: parseInt(stats?.total ?? "0"),
      successes: parseInt(stats?.successes ?? "0"),
      success_rate: parseFloat(stats?.success_rate ?? "0"),
      avg_latency: parseFloat(stats?.avg_latency ?? "0"),
    },
    recovery: {
      blobs_checked: totalBlobs,
      blobs_recoverable: recoverableCount,
      recovery_rate: totalBlobs > 0 ? (recoverableCount / totalBlobs) * 100 : 0,
      details: recoverability,
    },
    operators,
  });
}
