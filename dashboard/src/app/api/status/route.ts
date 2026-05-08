import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  const [relay] = await query(`
    SELECT
      COUNT(*) FILTER (WHERE success = true)::float /
        NULLIF(COUNT(*)::float, 0) * 100 AS success_rate,
      AVG(latency_ms) FILTER (WHERE success = true) AS avg_latency,
      COUNT(*) AS total_probes
    FROM retrieval_probes
    WHERE probe_timestamp > NOW() - INTERVAL '1 hour'
      AND relay_key >= 0
  `);

  const [ops] = await query(`
    SELECT
      COUNT(*) FILTER (WHERE success = true)::float /
        NULLIF(COUNT(*)::float, 0) * 100 AS success_rate,
      AVG(latency_ms) FILTER (WHERE success = true) AS avg_latency,
      COUNT(*) AS total_probes,
      COUNT(DISTINCT operator_id) AS unique_operators
    FROM operator_probes
    WHERE probe_timestamp > NOW() - INTERVAL '1 hour'
  `);

  const [blobCount] = await query(
    `SELECT COUNT(*) AS total_blobs FROM observed_blobs`
  );

  const [probed] = await query(`
    SELECT COUNT(DISTINCT rp.blob_key) AS probed
    FROM retrieval_probes rp
    WHERE rp.relay_key >= 0
  `);

  const [recent] = await query(`
    SELECT COUNT(*) AS count FROM observed_blobs
    WHERE first_observed_at > NOW() - INTERVAL '1 hour'
  `);

  const relayRate = parseFloat(relay?.success_rate ?? "0");
  const opsRate = parseFloat(ops?.success_rate ?? "0");
  const totalProbes = parseInt(relay?.total_probes ?? "0");

  let status: "healthy" | "degraded" | "down" = "healthy";
  if (totalProbes === 0) {
    status = "healthy";
  } else if (relayRate < 95) {
    status = "down";
  } else if (relayRate < 99 || opsRate < 90) {
    status = "degraded";
  }

  return NextResponse.json({
    relay: {
      success_rate: relayRate,
      avg_latency_ms: parseFloat(relay?.avg_latency ?? "0"),
      total_probes: totalProbes,
    },
    operator: {
      success_rate: opsRate,
      avg_latency_ms: parseFloat(ops?.avg_latency ?? "0"),
      total_probes: parseInt(ops?.total_probes ?? "0"),
      unique_operators: parseInt(ops?.unique_operators ?? "0"),
    },
    blobs: {
      total: parseInt(blobCount?.total_blobs ?? "0"),
      probed: parseInt(probed?.probed ?? "0"),
      last_hour: parseInt(recent?.count ?? "0"),
    },
    status,
  });
}
