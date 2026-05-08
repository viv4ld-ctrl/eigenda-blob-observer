"use client";

import { useEffect, useState } from "react";

interface StatusData {
  relay: { success_rate: number; avg_latency_ms: number; total_probes: number };
  operator: { success_rate: number; avg_latency_ms: number; total_probes: number; unique_operators: number };
  blobs: { total: number; probed: number; last_hour: number };
  status: "healthy" | "degraded" | "down";
}

const statusStyle = {
  healthy: { label: "Healthy", bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-400", dot: "bg-green-400" },
  degraded: { label: "Degraded", bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-400", dot: "bg-yellow-400" },
  down: { label: "Down", bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", dot: "bg-red-400" },
};

export default function StatusCards() {
  const [data, setData] = useState<StatusData | null>(null);

  useEffect(() => {
    const f = async () => setData(await (await fetch("/api/status")).json());
    f();
    const i = setInterval(f, 15_000);
    return () => clearInterval(i);
  }, []);

  if (!data) return <div className="text-gray-500 p-4">Loading...</div>;

  const s = statusStyle[data.status];
  const coverage = data.blobs.total > 0 ? ((data.blobs.probed / data.blobs.total) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-4">
      {/* Top status banner */}
      <div className={`flex items-center justify-between rounded-xl border ${s.border} ${s.bg} px-6 py-4`}>
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${s.dot} animate-pulse`} />
          <span className={`text-lg font-semibold ${s.text}`}>{s.label}</span>
          <span className="text-gray-500 text-sm ml-2">EigenDA Mainnet</span>
        </div>
        <div className="text-sm text-gray-400">
          {data.blobs.last_hour} blobs/hr collected
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Relay Success"
          value={`${data.relay.success_rate.toFixed(1)}%`}
          sub={`${data.relay.total_probes} probes`}
          good={data.relay.success_rate >= 99}
        />
        <MetricCard
          label="Relay Latency"
          value={`${data.relay.avg_latency_ms.toFixed(0)}ms`}
          sub="avg (1h)"
        />
        <MetricCard
          label="Operator Success"
          value={`${data.operator.success_rate.toFixed(1)}%`}
          sub={`${data.operator.total_probes} probes`}
          good={data.operator.success_rate >= 90}
        />
        <MetricCard
          label="Operator Latency"
          value={`${data.operator.avg_latency_ms.toFixed(0)}ms`}
          sub={`${data.operator.unique_operators} operators seen`}
        />
        <MetricCard
          label="Blobs Observed"
          value={data.blobs.total.toLocaleString()}
          sub="total collected"
        />
        <MetricCard
          label="Probe Coverage"
          value={`${coverage}%`}
          sub={`${data.blobs.probed.toLocaleString()} verified`}
        />
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, good }: {
  label: string; value: string; sub: string; good?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-700/50 bg-gray-800/50 p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold mt-1 ${good === undefined ? "text-white" : good ? "text-green-400" : "text-red-400"}`}>
        {value}
      </p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  );
}
