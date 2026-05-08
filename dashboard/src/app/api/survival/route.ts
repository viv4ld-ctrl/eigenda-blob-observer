import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  // Bucket blob_age_hours into 12-hour intervals and compute success rate per bucket
  const rows = await query(`
    SELECT
      FLOOR(blob_age_hours / 12) * 12 AS age_bucket,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE success = true) AS successes,
      COUNT(*) FILTER (WHERE success = true)::float /
        NULLIF(COUNT(*)::float, 0) * 100 AS success_rate
    FROM retrieval_probes
    WHERE blob_age_hours IS NOT NULL AND blob_age_hours >= 0
    GROUP BY age_bucket
    ORDER BY age_bucket
  `);

  // Compute Wilson score 95% CI for each bucket
  const data = rows.map((r: Record<string, string>) => {
    const n = parseInt(r.total);
    const p = parseInt(r.successes) / n;
    const z = 1.96;
    const denominator = 1 + (z * z) / n;
    const center = (p + (z * z) / (2 * n)) / denominator;
    const margin =
      (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;

    return {
      age_hours: parseFloat(r.age_bucket),
      success_rate: parseFloat(r.success_rate),
      total: n,
      ci_lower: Math.max(0, (center - margin) * 100),
      ci_upper: Math.min(100, (center + margin) * 100),
    };
  });

  return NextResponse.json({ survival: data });
}
