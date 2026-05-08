"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface RelayStats { relay_key: number; total: string; success_rate: string; avg_latency: string }

export default function RelaySuccessRate() {
  const [data, setData] = useState<RelayStats[]>([]);
  useEffect(() => { fetch("/api/relays").then(r => r.json()).then(d => setData(d.relays)); }, []);

  if (!data.length) return (
    <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/30 p-4">
      <h2 className="text-sm font-medium text-zinc-300">Relay Success Rate</h2>
      <p className="text-xs text-zinc-600 mt-1">No data yet</p>
    </div>
  );

  const chartData = data.map(r => ({
    relay: `Relay ${r.relay_key}`,
    rate: parseFloat(r.success_rate),
    total: parseInt(r.total),
  }));

  return (
    <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/30 p-4">
      <h2 className="text-sm font-medium text-zinc-300 mb-3">Relay Success Rate</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="relay" stroke="#52525b" fontSize={10} />
          <YAxis domain={[0, 100]} stroke="#52525b" fontSize={10} />
          <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "6px", fontSize: "11px" }}
            formatter={(v) => `${Number(v).toFixed(1)}%`} />
          <Bar dataKey="rate" radius={[2, 2, 0, 0]}>
            {chartData.map((e, i) => (
              <Cell key={i} fill={e.rate >= 99 ? "#10b981" : e.rate >= 95 ? "#f59e0b" : "#ef4444"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
