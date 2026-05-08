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

interface DeadOperator {
  operator_id: string;
  operator_socket: string;
  total_probes: string;
  last_error: string;
}

interface ApiResponse {
  stats: { total: number; success_rate: number; avg_latency: number };
  recovery: { blobs_checked: number; blobs_recoverable: number; recovery_rate: number; details: RecoveryDetail[] };
  operators: { operator_id: string; success_rate: string; avg_chunks: string; total: string }[];
  dead_operators: DeadOperator[];
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
  const { recovery, operators, dead_operators } = d;

  const chartData = operators
    .filter(o => parseFloat(o.total) >= 3)
    .map((o) => ({
      op: o.operator_id.slice(0, 6),
      chunks: parseFloat(o.avg_chunks || "0"),
      rate: parseFloat(o.success_rate),
    }));

  return (
    <div className="space-y-4">
      {/* Recovery */}
      <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-300">Blob Recoverability</h2>
          <span className={`text-xs font-medium ${recovery.recovery_rate >= 95 ? "text-emerald-400" : "text-red-400"}`}>
            {recovery.blobs_recoverable}/{recovery.blobs_checked} recoverable
          </span>
        </div>

        {recovery.details.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
            {recovery.details.slice(0, 10).map((r, i) => {
              const chunks = parseInt(r.total_chunks || "0");
              const pct = Math.min(100, (chunks / 1024) * 100);
              return (
                <div key={i} className="relative px-2.5 py-1.5 rounded bg-zinc-800/40 overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 ${r.recoverable ? "bg-emerald-500/8" : "bg-red-500/8"}`}
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center justify-between">
                    <span className="font-mono text-[9px] text-zinc-600">{r.blob_key.slice(0, 8)}</span>
                    <span className={`text-[9px] tabular-nums ${r.recoverable ? "text-emerald-500" : "text-red-400"}`}>
                      {chunks}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Dead Operators */}
      {dead_operators.length > 0 && (
        <div className="rounded-lg bg-red-950/20 border border-red-900/20 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-red-400">
              Unresponsive Operators
            </h2>
            <span className="text-xs text-red-400/60">
              {dead_operators.length}/{operators.length} operators ({((dead_operators.length / operators.length) * 100).toFixed(0)}%)
            </span>
          </div>
          <div className="space-y-1">
            {dead_operators.map((op, i) => {
              const socket = op.operator_socket.split(";").pop() || op.operator_socket;
              const host = op.operator_socket.split(":")[0];
              const errorType = op.last_error.includes("connection refused") ? "refused" : "timeout";
              return (
                <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded bg-zinc-900/40 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    <span className="font-mono text-zinc-400">{op.operator_id.slice(0, 12)}</span>
                    <span className="text-zinc-600">{host}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-600">{op.total_probes} probes</span>
                    <span className="text-red-400/80">{errorType}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-red-400/40 mt-2">
            These operators are registered on-chain but not serving chunk data. Not slashed or ejected.
          </p>
        </div>
      )}

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
