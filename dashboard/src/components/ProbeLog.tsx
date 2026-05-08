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
  data_size_bytes: number | null;
}

export default function ProbeLog() {
  const [probes, setProbes] = useState<Probe[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const res = await fetch("/api/probes?limit=30");
      const d = await res.json();
      setProbes(d.probes);
    };
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800 p-5">
      <h2 className="text-lg font-semibold text-white mb-4">
        Recent Probe Log
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase text-gray-400 border-b border-gray-700">
            <tr>
              <th className="py-2 px-3">Time</th>
              <th className="py-2 px-3">Blob Key</th>
              <th className="py-2 px-3">Age (h)</th>
              <th className="py-2 px-3">Relay</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Latency</th>
              <th className="py-2 px-3">Error</th>
            </tr>
          </thead>
          <tbody>
            {probes.map((p, i) => (
              <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                <td className="py-2 px-3 text-gray-300 whitespace-nowrap">
                  {new Date(p.probe_timestamp).toLocaleTimeString()}
                </td>
                <td className="py-2 px-3 font-mono text-gray-300">
                  {p.blob_key.slice(0, 16)}...
                </td>
                <td className="py-2 px-3 text-gray-300">
                  {p.blob_age_hours?.toFixed(1) ?? "-"}
                </td>
                <td className="py-2 px-3 text-gray-300">
                  {p.relay_key >= 0 ? p.relay_key : "-"}
                </td>
                <td className="py-2 px-3">
                  {p.success ? (
                    <span className="text-green-400 font-medium">OK</span>
                  ) : (
                    <span className="text-red-400 font-medium">FAIL</span>
                  )}
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
  );
}
