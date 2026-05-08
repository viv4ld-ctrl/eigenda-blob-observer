"use client";

import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface SurvivalPoint {
  age_hours: number;
  success_rate: number;
  total: number;
  ci_lower: number;
  ci_upper: number;
}

export default function SurvivalCurve() {
  const [data, setData] = useState<SurvivalPoint[]>([]);

  useEffect(() => {
    fetch("/api/survival")
      .then((r) => r.json())
      .then((d) => setData(d.survival));
  }, []);

  if (data.length === 0)
    return (
      <div className="text-gray-400 p-4">
        Waiting for data to accumulate...
      </div>
    );

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800 p-5">
      <h2 className="text-lg font-semibold text-white mb-4">
        Data Survival Curve
      </h2>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="age_hours"
            stroke="#9CA3AF"
            label={{ value: "Blob Age (hours)", position: "bottom", fill: "#9CA3AF" }}
          />
          <YAxis
            domain={[0, 100]}
            stroke="#9CA3AF"
            label={{
              value: "Retrieval Success %",
              angle: -90,
              position: "insideLeft",
              fill: "#9CA3AF",
            }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151" }}
            formatter={(value) => `${Number(value).toFixed(1)}%`}
            labelFormatter={(label) => `Age: ${label}h`}
          />
          <ReferenceLine
            x={336}
            stroke="#EF4444"
            strokeDasharray="5 5"
            label={{ value: "14d expiry", fill: "#EF4444", position: "top" }}
          />
          <Area
            type="monotone"
            dataKey="ci_upper"
            stackId="ci"
            stroke="none"
            fill="#3B82F6"
            fillOpacity={0.1}
          />
          <Area
            type="monotone"
            dataKey="ci_lower"
            stackId="ci"
            stroke="none"
            fill="#1F2937"
            fillOpacity={1}
          />
          <Area
            type="monotone"
            dataKey="success_rate"
            stroke="#3B82F6"
            fill="#3B82F6"
            fillOpacity={0.3}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
