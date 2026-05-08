"use client";

import { useEffect, useState } from "react";

interface Probe {
  blob_key: string;
  probe_timestamp: string;
  blob_age_hours: number;
  relay_key: number;
  success: boolean;
  latency_ms: number;
  error_message: string | null;
}

export default function ProbeLog() {
  const [probes, setProbes] = useState<Probe[]>([]);

  useEffect(() => {
    const f = async () => setProbes((await (await fetch("/api/probes?limit=20")).json()).probes);
    f();
    const i = setInterval(f, 10_000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/30 p-4">
      <h2 className="text-sm font-medium text-zinc-300 mb-3">Recent Relay Probes</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-600 uppercase tracking-wider border-b border-zinc-800/50">
              <th className="text-left py-1.5 px-2 font-medium">time</th>
              <th className="text-left py-1.5 px-2 font-medium">blob</th>
              <th className="text-left py-1.5 px-2 font-medium">age</th>
              <th className="text-left py-1.5 px-2 font-medium">status</th>
              <th className="text-left py-1.5 px-2 font-medium">latency</th>
              <th className="text-left py-1.5 px-2 font-medium">error</th>
            </tr>
          </thead>
          <tbody className="text-zinc-400">
            {probes.map((p, i) => (
              <tr key={i} className="border-b border-zinc-800/20 hover:bg-zinc-800/30">
                <td className="py-1 px-2 tabular-nums text-zinc-600">
                  {new Date(p.probe_timestamp).toLocaleTimeString()}
                </td>
                <td className="py-1 px-2 font-mono">{p.blob_key.slice(0, 12)}</td>
                <td className="py-1 px-2 tabular-nums">{p.blob_age_hours?.toFixed(1) ?? "-"}h</td>
                <td className="py-1 px-2">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${p.success ? "bg-emerald-500" : "bg-red-500"}`} />
                  {p.success ? "ok" : "fail"}
                </td>
                <td className="py-1 px-2 tabular-nums">{p.latency_ms ?? "-"}ms</td>
                <td className="py-1 px-2 text-zinc-600 truncate max-w-[200px]">{p.error_message || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
