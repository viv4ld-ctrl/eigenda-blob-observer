"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";

interface RecoveryDetail {
  blob_key: string;
  total_chunks: string;
  operators_ok: string;
  operators_fail: string;
  recoverable: boolean;
}

interface ApiResponse {
  stats: { total: number; successes: number; success_rate: number; avg_latency: number };
  recovery: { blobs_checked: number; blobs_recoverable: number; recovery_rate: number; details: RecoveryDetail[] };
  operators: { operator_id: string; success_rate: string; avg_chunks: string; total: string }[];
}

export default function OperatorProbeChart() {
  const [d, setD] = useState<ApiResponse | null>(null);

  useEffect(() => {
    const f = async () => setD(await (await fetch("/api/operators")).json());
    f();
    const i = setInterval(f, 15_000);
    return () => clearInterval(i);
  }, []);

  if (!d) return null;
  const { recovery, operators } = d;

  const chartData = operators.map((o) => ({
    op: o.operator_id.slice(0, 6),
    chunks: parseFloat(o.avg_chunks || "0"),
    rate: parseFloat(o.success_rate),
  }));

  return (
    <div className="space-y-4">
      {/* Recovery summary */}
      <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-300">Blob Recoverability</h2>
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            <span>checked: {recovery.blobs_checked}</span>
            <span className={recovery.recovery_rate >= 95 ? "text-emerald-400" : "text-red-400"}>
              {recovery.recovery_rate.toFixed(0)}% recoverable
            </span>
          </div>
        </div>

        {recovery.details.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-1.5">
            {recovery.details.slice(0, 10).map((r, i) => {
              const chunks = parseInt(r.total_chunks || "0");
              const pct = Math.min(100, (chunks / 1024) * 100);
              return (
                <div key={i} className="relative px-3 py-2 rounded bg-zinc-800/50 overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 ${r.recoverable ? "bg-emerald-500/10" : "bg-red-500/10"}`}
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center justify-between">
                    <span className="font-mono text-[10px] text-zinc-500">{r.blob_key.slice(0, 10)}</span>
                    <span className={`text-[10px] font-medium ${r.recoverable ? "text-emerald-400" : "text-red-400"}`}>
                      {chunks}/{1024}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Operator chunks chart */}
      {chartData.length > 0 && (
        <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/30 p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">Avg Chunks per Operator</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="op" stroke="#52525b" fontSize={9} angle={-45} textAnchor="end" />
              <YAxis stroke="#52525b" fontSize={10} />
              <Tooltip
                contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "6px", fontSize: "11px" }}
                formatter={(v) => [`${Number(v).toFixed(0)} chunks`]}
              />
              <Bar dataKey="chunks" radius={[2, 2, 0, 0]}>
                {chartData.map((e, i) => (
                  <Cell key={i} fill={e.rate >= 90 ? "#10b981" : e.rate >= 50 ? "#f59e0b" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
