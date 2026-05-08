import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  // Exclude relay_key = -1 probes (certificate-not-found skips from early data)
  // Only count actual relay retrieval attempts
  const [stats] = await query(`
    SELECT
      COUNT(*) FILTER (WHERE success = true)::float /
        NULLIF(COUNT(*)::float, 0) * 100 AS success_rate,
      AVG(latency_ms) FILTER (WHERE success = true) AS avg_latency,
      COUNT(*) AS total_probes
    FROM retrieval_probes
    WHERE probe_timestamp > NOW() - INTERVAL '1 hour'
      AND relay_key >= 0
  `);

  const [blobCount] = await query(
    `SELECT COUNT(*) AS total_blobs FROM observed_blobs`
  );

  const successRate = parseFloat(stats?.success_rate ?? "0");
  const totalProbes = parseInt(stats?.total_probes ?? "0");

  let status: "healthy" | "degraded" | "down" = "healthy";
  if (totalProbes === 0) {
    status = "healthy"; // no data yet, don't alarm
  } else if (successRate < 95) {
    status = "down";
  } else if (successRate < 99) {
    status = "degraded";
  }

  return NextResponse.json({
    success_rate: successRate,
    avg_latency_ms: parseFloat(stats?.avg_latency ?? "0"),
    total_probes: totalProbes,
    total_blobs: parseInt(blobCount?.total_blobs ?? "0"),
    status,
  });
}
