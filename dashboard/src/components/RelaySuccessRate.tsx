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

interface RelayStats {
  relay_key: number;
  total: string;
  successes: string;
  success_rate: string;
  avg_latency: string;
}

export default function RelaySuccessRate() {
  const [data, setData] = useState<RelayStats[]>([]);

  useEffect(() => {
    fetch("/api/relays")
      .then((r) => r.json())
      .then((d) => setData(d.relays));
  }, []);

  if (data.length === 0)
    return <div className="text-gray-400 p-4">No relay data yet...</div>;

  const chartData = data.map((r) => ({
    relay: `Relay ${r.relay_key}`,
    success_rate: parseFloat(r.success_rate),
    total: parseInt(r.total),
    avg_latency: parseFloat(r.avg_latency || "0"),
  }));

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800 p-5">
      <h2 className="text-lg font-semibold text-white mb-4">
        Relay Success Rate
      </h2>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="relay" stroke="#9CA3AF" />
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
                fill={entry.success_rate >= 99 ? "#10B981" : entry.success_rate >= 95 ? "#F59E0B" : "#EF4444"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
