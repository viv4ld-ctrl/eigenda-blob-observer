import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
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

  // Recoverability per blob
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

  // Per-operator stats (all operators)
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
    ORDER BY success_rate ASC, total DESC
  `);

  // Dead operators (100% failure rate, 5+ probes)
  const deadOperators = await query(`
    SELECT
      operator_id,
      operator_socket,
      COUNT(*) AS total_probes,
      MAX(error_message) AS last_error,
      MAX(probe_timestamp) AS last_seen
    FROM operator_probes
    WHERE success = false
    GROUP BY operator_id, operator_socket
    HAVING COUNT(*) = (
      SELECT COUNT(*) FROM operator_probes op2
      WHERE op2.operator_id = operator_probes.operator_id
    ) AND COUNT(*) >= 5
    ORDER BY total_probes DESC
  `);

  return NextResponse.json({
    stats: {
      total: parseInt(stats?.total ?? "0"),
      successes: parseInt(stats?.successes ?? "0"),
      success_rate: parseFloat(stats?.success_rate ?? "0"),
      avg_latency: parseFloat(stats?.avg_latency ?? "0"),
    },
    recovery: {
      blobs_checked: recoverability.length,
      blobs_recoverable: recoverableCount,
      recovery_rate: recoverability.length > 0 ? (recoverableCount / recoverability.length) * 100 : 0,
      details: recoverability,
    },
    operators,
    dead_operators: deadOperators,
  });
}
