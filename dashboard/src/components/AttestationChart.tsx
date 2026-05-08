"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface Row { hour: string; quorum_number: number; avg_signing_pct: string }

export default function AttestationChart() {
  const [data, setData] = useState<Record<string, number | string>[]>([]);

  useEffect(() => {
    fetch("/api/attestation").then(r => r.json()).then(d => {
      const rows: Row[] = d.attestation;
      const grouped = new Map<string, Record<string, number | string>>();
      for (const row of rows) {
        const key = new Date(row.hour).toISOString().slice(0, 13);
        if (!grouped.has(key)) grouped.set(key, { hour: key });
        grouped.get(key)![`q${row.quorum_number}`] = parseFloat(row.avg_signing_pct);
      }
      setData(Array.from(grouped.values()).sort((a, b) => (a.hour as string).localeCompare(b.hour as string)));
    });
  }, []);

  if (!data.length) return (
    <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/30 p-4">
      <h2 className="text-sm font-medium text-zinc-300">Quorum Signing</h2>
      <p className="text-xs text-zinc-600 mt-1">No data yet</p>
    </div>
  );

  const qKeys = Array.from(new Set(data.flatMap(d => Object.keys(d).filter(k => k.startsWith("q")))));
  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

  return (
    <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/30 p-4">
      <h2 className="text-sm font-medium text-zinc-300 mb-3">Quorum Signing Rate</h2>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="hour" stroke="#52525b" fontSize={9} tickFormatter={v => v.slice(5, 13)} />
          <YAxis domain={[0, 100]} stroke="#52525b" fontSize={10} />
          <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "6px", fontSize: "11px" }}
            formatter={(v) => `${Number(v).toFixed(1)}%`} />
          <Legend wrapperStyle={{ fontSize: "10px" }} />
          {qKeys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} name={`Q${k.slice(1)}`}
              stroke={colors[i % colors.length]} strokeWidth={1.5} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
