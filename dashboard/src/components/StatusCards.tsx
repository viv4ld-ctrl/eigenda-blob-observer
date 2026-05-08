"use client";

import { useEffect, useState } from "react";

interface Status {
  success_rate: number;
  avg_latency_ms: number;
  total_probes: number;
  total_blobs: number;
  status: "healthy" | "degraded" | "down";
}

const statusConfig = {
  healthy: { label: "Healthy", color: "bg-green-500", icon: "\u{1F7E2}" },
  degraded: { label: "Degraded", color: "bg-yellow-500", icon: "\u{1F7E1}" },
  down: { label: "Down", color: "bg-red-500", icon: "\u{1F534}" },
};

export default function StatusCards() {
  const [data, setData] = useState<Status | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const res = await fetch("/api/status");
      setData(await res.json());
    };
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return <div className="text-gray-400">Loading status...</div>;

  const s = statusConfig[data.status];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card
        title="System Status"
        value={`${s.icon} ${s.label}`}
        sub=""
        accent={s.color}
      />
      <Card
        title="Success Rate (1h)"
        value={`${data.success_rate.toFixed(1)}%`}
        sub={`${data.total_probes} probes`}
      />
      <Card
        title="Avg Latency (1h)"
        value={`${data.avg_latency_ms.toFixed(0)} ms`}
        sub="successful probes"
      />
      <Card
        title="Observed Blobs"
        value={data.total_blobs.toLocaleString()}
        sub="total tracked"
      />
    </div>
  );
}

function Card({
  title,
  value,
  sub,
  accent,
}: {
  title: string;
  value: string;
  sub: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800 p-5">
      <p className="text-sm text-gray-400 mb-1">{title}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      {accent && (
        <div className={`mt-2 h-1 w-12 rounded ${accent}`} />
      )}
    </div>
  );
}
