"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface AttestationRow {
  hour: string;
  quorum_number: number;
  avg_signing_pct: string;
}

export default function AttestationChart() {
  const [data, setData] = useState<Record<string, number | string>[]>([]);

  useEffect(() => {
    fetch("/api/attestation")
      .then((r) => r.json())
      .then((d) => {
        const rows: AttestationRow[] = d.attestation;
        // Pivot: group by hour, columns per quorum
        const grouped = new Map<string, Record<string, number | string>>();
        for (const row of rows) {
          const hourKey = new Date(row.hour).toISOString().slice(0, 13);
          if (!grouped.has(hourKey)) {
            grouped.set(hourKey, { hour: hourKey });
          }
          const entry = grouped.get(hourKey)!;
          entry[`q${row.quorum_number}`] = parseFloat(row.avg_signing_pct);
        }
        setData(
          Array.from(grouped.values()).sort((a, b) =>
            (a.hour as string).localeCompare(b.hour as string)
          )
        );
      });
  }, []);

  if (data.length === 0)
    return <div className="text-gray-400 p-4">No attestation data yet...</div>;

  const quorumKeys = Array.from(
    new Set(data.flatMap((d) => Object.keys(d).filter((k) => k.startsWith("q"))))
  );

  const colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444"];

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800 p-5">
      <h2 className="text-lg font-semibold text-white mb-4">
        Quorum Signing Participation
      </h2>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="hour"
            stroke="#9CA3AF"
            tickFormatter={(v) => v.slice(5, 13)}
          />
          <YAxis domain={[0, 100]} stroke="#9CA3AF" />
          <Tooltip
            contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151" }}
            formatter={(value) => `${Number(value).toFixed(1)}%`}
          />
          <Legend />
          {quorumKeys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={`Quorum ${key.slice(1)}`}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
