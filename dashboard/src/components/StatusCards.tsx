"use client";

import { useEffect, useState } from "react";

interface StatusData {
  relay: { success_rate: number; avg_latency_ms: number; total_probes: number };
  operator: { success_rate: number; avg_latency_ms: number; total_probes: number; unique_operators: number };
  blobs: { total: number; probed: number; last_hour: number };
  status: "healthy" | "degraded" | "down";
}

export default function StatusCards() {
  const [d, setD] = useState<StatusData | null>(null);

  useEffect(() => {
    const f = async () => setD(await (await fetch("/api/status")).json());
    f();
    const i = setInterval(f, 10_000);
    return () => clearInterval(i);
  }, []);

  if (!d) return <div className="h-24 rounded-lg bg-zinc-900 animate-pulse" />;

  const coverage = d.blobs.total > 0 ? ((d.blobs.probed / d.blobs.total) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800/50">
        <StatusDot status={d.status} />
        <span className="text-sm text-zinc-300 font-medium">
          {d.status === "healthy" ? "All systems operational" :
           d.status === "degraded" ? "Degraded performance" : "System issues detected"}
        </span>
        <span className="ml-auto text-xs text-zinc-600 tabular-nums">
          {d.blobs.last_hour.toLocaleString()} blobs/hr
        </span>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        <Metric label="Relay" value={`${d.relay.success_rate.toFixed(1)}%`} ok={d.relay.success_rate >= 99} />
        <Metric label="Relay latency" value={`${d.relay.avg_latency_ms.toFixed(0)}ms`} />
        <Metric label="Operators" value={`${d.operator.success_rate.toFixed(1)}%`} ok={d.operator.success_rate >= 85} />
        <Metric label="Op latency" value={`${d.operator.avg_latency_ms.toFixed(0)}ms`} />
        <Metric label="Blobs" value={d.blobs.total.toLocaleString()} />
        <Metric label="Coverage" value={`${coverage.toFixed(1)}%`} sub={`${d.blobs.probed.toLocaleString()} verified`} />
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const c = status === "healthy" ? "bg-emerald-500" : status === "degraded" ? "bg-amber-500" : "bg-red-500";
  return (
    <span className="relative flex h-2 w-2">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${c}`} />
      <span className={`relative inline-flex rounded-full h-2 w-2 ${c}`} />
    </span>
  );
}

function Metric({ label, value, sub, ok }: { label: string; value: string; sub?: string; ok?: boolean }) {
  return (
    <div className="px-3 py-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/30">
      <p className="text-[10px] text-zinc-600 uppercase tracking-wider">{label}</p>
      <p className={`text-base font-semibold tabular-nums mt-0.5 ${
        ok === undefined ? "text-zinc-200" : ok ? "text-emerald-400" : "text-red-400"
      }`}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-600 mt-0.5">{sub}</p>}
    </div>
  );
}
