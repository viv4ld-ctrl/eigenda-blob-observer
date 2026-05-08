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
  Cell,
} from "recharts";

interface OperatorStats {
  operator_id: string;
  operator_socket: string;
  total: string;
  successes: string;
  success_rate: string;
  avg_latency: string;
  avg_chunks: string;
}

interface RecoveryDetail {
  blob_key: string;
  total_chunks: string;
  operators_ok: string;
  operators_fail: string;
  recoverable: boolean;
}

interface RecoveryStats {
  blobs_checked: number;
  blobs_recoverable: number;
  recovery_rate: number;
  details: RecoveryDetail[];
}

interface OverallStats {
  total: number;
  successes: number;
  success_rate: number;
  avg_latency: number;
}

interface ApiResponse {
  stats: OverallStats;
  recovery: RecoveryStats;
  operators: OperatorStats[];
}

export default function OperatorProbeChart() {
  const [data, setData] = useState<ApiResponse | null>(null);

  useEffect(() => {
    const f = async () => {
      const res = await fetch("/api/operators");
      setData(await res.json());
    };
    f();
    const interval = setInterval(f, 15_000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return null;

  const { stats, recovery, operators } = data;

  const chartData = operators.map((o) => ({
    operator: o.operator_id.slice(0, 8),
    success_rate: parseFloat(o.success_rate),
    avg_chunks: parseFloat(o.avg_chunks || "0"),
    total: parseInt(o.total),
  }));

  return (
    <div className="space-y-5">
      {/* Recovery Assessment */}
      <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-5">
        <h2 className="text-lg font-semibold text-white mb-4">
          Blob Recoverability (Operator Chunk Verification)
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <MiniCard
            label="Recovery Rate"
            value={`${recovery.recovery_rate.toFixed(0)}%`}
            good={recovery.recovery_rate >= 95}
          />
          <MiniCard
            label="Blobs Checked"
            value={`${recovery.blobs_checked}`}
          />
          <MiniCard
            label="Recoverable"
            value={`${recovery.blobs_recoverable}/${recovery.blobs_checked}`}
            good={recovery.blobs_recoverable === recovery.blobs_checked}
          />
          <MiniCard
            label="Operator Probe Success"
            value={`${stats.success_rate.toFixed(1)}%`}
            good={stats.success_rate >= 90}
          />
        </div>

        {/* Recovery details table */}
        {recovery.details.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase text-gray-500 border-b border-gray-700">
                <tr>
                  <th className="py-2 px-3">Blob</th>
                  <th className="py-2 px-3">Chunks</th>
                  <th className="py-2 px-3">Operators OK/Fail</th>
                  <th className="py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {recovery.details.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-b border-gray-700/30">
                    <td className="py-1.5 px-3 font-mono text-gray-400 text-xs">
                      {r.blob_key.slice(0, 16)}...
                    </td>
                    <td className="py-1.5 px-3 text-gray-300">
                      {parseInt(r.total_chunks || "0").toLocaleString()}/1024
                    </td>
                    <td className="py-1.5 px-3 text-gray-300">
                      {r.operators_ok}/{parseInt(r.operators_ok) + parseInt(r.operators_fail)}
                    </td>
                    <td className="py-1.5 px-3">
                      {r.recoverable ? (
                        <span className="text-green-400 text-xs font-medium">RECOVERABLE</span>
                      ) : (
                        <span className="text-red-400 text-xs font-medium">AT RISK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-Operator Chart */}
      {chartData.length > 0 && (
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-5">
          <h3 className="text-md font-semibold text-white mb-4">
            Per-Operator Chunk Availability
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="operator" stroke="#6B7280" fontSize={10} angle={-45} textAnchor="end" height={60} />
              <YAxis stroke="#6B7280" />
              <Tooltip
                contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151", fontSize: "12px" }}
                formatter={(value, name) => {
                  if (name === "avg_chunks") return [`${Number(value).toFixed(0)} chunks`, "Avg Chunks"];
                  if (name === "success_rate") return [`${Number(value).toFixed(1)}%`, "Success Rate"];
                  return [String(value), String(name)];
                }}
              />
              <Bar dataKey="avg_chunks" name="avg_chunks" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.success_rate >= 90 ? "#10B981" : entry.success_rate >= 50 ? "#F59E0B" : "#EF4444"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function MiniCard({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-700/30 bg-gray-900/50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${good === undefined ? "text-white" : good ? "text-green-400" : "text-red-400"}`}>
        {value}
      </p>
    </div>
  );
}
