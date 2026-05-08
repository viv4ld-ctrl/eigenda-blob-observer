import StatusCards from "@/components/StatusCards";
import SurvivalCurve from "@/components/SurvivalCurve";
import LatencyChart from "@/components/LatencyChart";
import RelaySuccessRate from "@/components/RelaySuccessRate";
import AttestationChart from "@/components/AttestationChart";
import OperatorProbeChart from "@/components/OperatorProbeChart";
import ProbeLog from "@/components/ProbeLog";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <header className="mb-6">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              EigenDA Blob Observer
            </h1>
            <span className="text-xs text-gray-600 font-mono">mainnet</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Real-time blob collection + relay & operator chunk verification
          </p>
        </header>

        <div className="space-y-5">
          <StatusCards />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <SurvivalCurve />
            <LatencyChart />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <RelaySuccessRate />
            <AttestationChart />
          </div>

          <OperatorProbeChart />
          <ProbeLog />
        </div>

        <footer className="mt-8 pb-6 text-center text-xs text-gray-700">
          Independent EigenDA mainnet observer. Not affiliated with Eigen Labs.
        </footer>
      </div>
    </main>
  );
}
