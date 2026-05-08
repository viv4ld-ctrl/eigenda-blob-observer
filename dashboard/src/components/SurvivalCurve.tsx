"use client";

import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";

interface Point { age_hours: number; success_rate: number; total: number; ci_lower: number; ci_upper: number }

export default function SurvivalCurve() {
  const [data, setData] = useState<Point[]>([]);
  useEffect(() => { fetch("/api/survival").then(r => r.json()).then(d => setData(d.survival)); }, []);

  if (data.length === 0) return (
    <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/30 p-4">
      <h2 className="text-sm font-medium text-zinc-300 mb-2">Survival Curve</h2>
      <p className="text-xs text-zinc-600">Accumulating data... (needs 2+ weeks)</p>
    </div>
  );

  return (
    <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/30 p-4">
      <h2 className="text-sm font-medium text-zinc-300 mb-3">Data Survival Curve</h2>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="age_hours" stroke="#52525b" fontSize={10}
            label={{ value: "blob age (hours)", position: "bottom", fill: "#52525b", fontSize: 10 }} />
          <YAxis domain={[0, 100]} stroke="#52525b" fontSize={10} />
          <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "6px", fontSize: "11px" }}
            formatter={(v) => `${Number(v).toFixed(1)}%`} labelFormatter={(l) => `${l}h`} />
          <ReferenceLine x={336} stroke="#ef4444" strokeDasharray="5 5"
            label={{ value: "14d", fill: "#ef4444", fontSize: 10 }} />
          <Area type="monotone" dataKey="ci_upper" stackId="ci" stroke="none" fill="#3b82f6" fillOpacity={0.08} />
          <Area type="monotone" dataKey="ci_lower" stackId="ci" stroke="none" fill="#09090b" fillOpacity={1} />
          <Area type="monotone" dataKey="success_rate" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
