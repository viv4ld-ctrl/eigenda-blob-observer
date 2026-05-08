import StatusCards from "@/components/StatusCards";
import SurvivalCurve from "@/components/SurvivalCurve";
import LatencyChart from "@/components/LatencyChart";
import RelaySuccessRate from "@/components/RelaySuccessRate";
import AttestationChart from "@/components/AttestationChart";
import OperatorProbeChart from "@/components/OperatorProbeChart";
import ProbeLog from "@/components/ProbeLog";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#09090b]">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100 tracking-tight">
              EigenDA Observer
            </h1>
            <p className="text-xs text-zinc-600 mt-0.5 font-mono">
              mainnet / real-time blob verification
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-zinc-600">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            live
          </div>
        </div>

        <div className="space-y-4">
          <StatusCards />

          {/* Recovery + Operators */}
          <OperatorProbeChart />

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SurvivalCurve />
            <LatencyChart />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RelaySuccessRate />
            <AttestationChart />
          </div>

          <ProbeLog />
        </div>

        <footer className="mt-6 pb-4 text-center text-[11px] text-zinc-700">
          Independent observer. Not affiliated with Eigen Labs.
        </footer>
      </div>
    </main>
  );
}
