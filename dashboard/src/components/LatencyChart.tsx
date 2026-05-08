"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface ProbeEntry {
  probe_timestamp: string;
  latency_ms: number;
  success: boolean;
}

interface Bucket {
  range: string;
  count: number;
}

export default function LatencyChart() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [percentiles, setPercentiles] = useState({ p50: 0, p95: 0, p99: 0 });

  useEffect(() => {
    fetch("/api/probes?limit=200")
      .then((r) => r.json())
      .then((d) => {
        const latencies: number[] = d.probes
          .filter((p: ProbeEntry) => p.success && p.latency_ms > 0)
          .map((p: ProbeEntry) => p.latency_ms)
          .sort((a: number, b: number) => a - b);

        if (latencies.length === 0) return;

        // Percentiles
        const pct = (p: number) =>
          latencies[Math.floor((p / 100) * latencies.length)] || 0;
        setPercentiles({ p50: pct(50), p95: pct(95), p99: pct(99) });

        // Histogram buckets
        const ranges = [
          [0, 100],
          [100, 250],
          [250, 500],
          [500, 1000],
          [1000, 2000],
          [2000, 5000],
          [5000, Infinity],
        ];
        const b = ranges.map(([lo, hi]) => ({
          range: hi === Infinity ? `${lo}+` : `${lo}-${hi}`,
          count: latencies.filter((l) => l >= lo && l < hi).length,
        }));
        setBuckets(b);
      });
  }, []);

  if (buckets.length === 0)
    return <div className="text-gray-400 p-4">No latency data yet...</div>;

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800 p-5">
      <h2 className="text-lg font-semibold text-white mb-2">
        Retrieval Latency Distribution
      </h2>
      <div className="flex gap-4 text-sm text-gray-400 mb-4">
        <span>p50: {percentiles.p50}ms</span>
        <span>p95: {percentiles.p95}ms</span>
        <span>p99: {percentiles.p99}ms</span>
      </div>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={buckets}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="range" stroke="#9CA3AF" />
          <YAxis stroke="#9CA3AF" />
          <Tooltip
            contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151" }}
          />
          <ReferenceLine y={0} stroke="#374151" />
          <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
