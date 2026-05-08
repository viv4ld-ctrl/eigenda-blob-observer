import StatusCards from "@/components/StatusCards";
import SurvivalCurve from "@/components/SurvivalCurve";
import LatencyChart from "@/components/LatencyChart";
import RelaySuccessRate from "@/components/RelaySuccessRate";
import AttestationChart from "@/components/AttestationChart";
import OperatorProbeChart from "@/components/OperatorProbeChart";
import ProbeLog from "@/components/ProbeLog";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-900 text-white p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">EigenDA Blob Observer</h1>
        <p className="text-gray-400 mt-1">
          Mainnet blob retrieval monitoring dashboard
        </p>
      </header>

      <div className="space-y-6">
        <StatusCards />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SurvivalCurve />
          <LatencyChart />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RelaySuccessRate />
          <AttestationChart />
        </div>

        <OperatorProbeChart />

        <ProbeLog />
      </div>
    </main>
  );
}
