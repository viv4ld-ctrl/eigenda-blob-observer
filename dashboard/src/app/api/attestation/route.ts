import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  const rows = await query(`
    SELECT
      DATE_TRUNC('hour', snapshot_timestamp) AS hour,
      quorum_number,
      AVG(signing_stake_percentage) AS avg_signing_pct,
      AVG(total_signers) AS avg_signers,
      AVG(total_nonsigners) AS avg_nonsigners
    FROM attestation_snapshots
    GROUP BY hour, quorum_number
    ORDER BY hour DESC
    LIMIT 500
  `);

  return NextResponse.json({ attestation: rows });
}
