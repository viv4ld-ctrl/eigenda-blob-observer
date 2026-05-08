"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface ProbeEntry { latency_ms: number; success: boolean }
interface Bucket { range: string; count: number }

export default function LatencyChart() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [pcts, setPcts] = useState({ p50: 0, p95: 0, p99: 0 });

  useEffect(() => {
    fetch("/api/probes?limit=200").then(r => r.json()).then(d => {
      const lats: number[] = d.probes
        .filter((p: ProbeEntry) => p.success && p.latency_ms > 0)
        .map((p: ProbeEntry) => p.latency_ms)
        .sort((a: number, b: number) => a - b);
      if (!lats.length) return;
      const pct = (p: number) => lats[Math.floor((p / 100) * lats.length)] || 0;
      setPcts({ p50: pct(50), p95: pct(95), p99: pct(99) });
      const ranges: [number, number][] = [[0,100],[100,250],[250,500],[500,1000],[1000,2000],[2000,5000],[5000,Infinity]];
      setBuckets(ranges.map(([lo, hi]) => ({
        range: hi === Infinity ? `${lo}+` : `${lo}-${hi}`,
        count: lats.filter(l => l >= lo && l < hi).length,
      })));
    });
  }, []);

  if (!buckets.length) return (
    <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/30 p-4">
      <h2 className="text-sm font-medium text-zinc-300">Relay Latency</h2>
      <p className="text-xs text-zinc-600 mt-1">No data yet</p>
    </div>
  );

  return (
    <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-zinc-300">Relay Latency</h2>
        <div className="flex gap-3 text-[10px] text-zinc-500 tabular-nums">
          <span>p50: {pcts.p50}ms</span>
          <span>p95: {pcts.p95}ms</span>
          <span>p99: {pcts.p99}ms</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={buckets}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="range" stroke="#52525b" fontSize={10} />
          <YAxis stroke="#52525b" fontSize={10} />
          <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "6px", fontSize: "11px" }} />
          <Bar dataKey="count" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
