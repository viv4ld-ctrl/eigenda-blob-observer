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
  total: string;
  successes: string;
  success_rate: string;
  avg_latency: string;
  avg_chunks: string;
}

interface OverallStats {
  total: number;
  successes: number;
  success_rate: number;
  avg_latency: number;
}

interface RecentProbe {
  blob_key: string;
  probe_timestamp: string;
  operator_id: string;
  operator_socket: string;
  success: boolean;
  latency_ms: number;
  chunks_returned: number;
  error_message: string | null;
}

export default function OperatorProbeChart() {
  const [stats, setStats] = useState<OverallStats | null>(null);
  const [operators, setOperators] = useState<OperatorStats[]>([]);
  const [recent, setRecent] = useState<RecentProbe[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const res = await fetch("/api/operators");
      const d = await res.json();
      setStats(d.stats);
      setOperators(d.operators);
      setRecent(d.recent);
    };
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, []);

  const chartData = operators.map((o) => ({
    operator: o.operator_id.slice(0, 8) + "...",
    success_rate: parseFloat(o.success_rate),
    total: parseInt(o.total),
  }));

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="rounded-xl border border-gray-700 bg-gray-800 p-5">
        <h2 className="text-lg font-semibold text-white mb-3">
          Operator Chunk Retrieval (Direct)
        </h2>
        {stats && stats.total > 0 ? (
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-gray-400">Success Rate (24h): </span>
              <span className={stats.success_rate >= 90 ? "text-green-400" : "text-red-400"}>
                {stats.success_rate.toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-gray-400">Avg Latency: </span>
              <span className="text-white">{stats.avg_latency.toFixed(0)}ms</span>
            </div>
            <div>
              <span className="text-gray-400">Total Probes: </span>
              <span className="text-white">{stats.total}</span>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No operator probe data yet...</p>
        )}
      </div>

      {/* Per-Operator Bar Chart */}
      {chartData.length > 0 && (
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-5">
          <h3 className="text-md font-semibold text-white mb-4">
            Per-Operator Success Rate
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="operator" stroke="#9CA3AF" fontSize={11} />
              <YAxis domain={[0, 100]} stroke="#9CA3AF" />
              <Tooltip
                contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151" }}
                formatter={(value, name) => {
                  if (name === "success_rate") return `${Number(value).toFixed(1)}%`;
                  return String(value);
                }}
              />
              <Bar dataKey="success_rate" radius={[4, 4, 0, 0]}>
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

      {/* Recent Operator Probes Log */}
      {recent.length > 0 && (
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-5">
          <h3 className="text-md font-semibold text-white mb-4">
            Recent Operator Probes
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase text-gray-400 border-b border-gray-700">
                <tr>
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Blob</th>
                  <th className="py-2 px-3">Operator</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Chunks</th>
                  <th className="py-2 px-3">Latency</th>
                  <th className="py-2 px-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p, i) => (
                  <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-2 px-3 text-gray-300 whitespace-nowrap">
                      {new Date(p.probe_timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-3 font-mono text-gray-300">
                      {p.blob_key.slice(0, 12)}...
                    </td>
                    <td className="py-2 px-3 font-mono text-gray-300">
                      {p.operator_id.slice(0, 10)}...
                    </td>
                    <td className="py-2 px-3">
                      {p.success ? (
                        <span className="text-green-400 font-medium">OK</span>
                      ) : (
                        <span className="text-red-400 font-medium">FAIL</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-gray-300">
                      {p.chunks_returned ?? "-"}
                    </td>
                    <td className="py-2 px-3 text-gray-300">
                      {p.latency_ms ? `${p.latency_ms}ms` : "-"}
                    </td>
                    <td className="py-2 px-3 text-gray-500 text-xs max-w-xs truncate">
                      {p.error_message || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
