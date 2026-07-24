import { useState } from "react";
import type { ComponentType } from "react";
import type { LapAnalysis } from "../types";
import {
  GapVsFieldAverageChart,
  GapToLeaderChart,
  RelativeGapTrendChart,
  LapTimesChart,
  PositionChangesChart,
} from "./LapCharts";
import { SectorPerformanceTable, PaceAnalysisTable, OvertakesTable } from "./AnalysisTables";
import { WeatherHistoryChart, WeatherImpactChart } from "./WeatherCharts";

type SessionParams = { year: number; event: string; sessionType: string } | null;

type ChartProps = {
  analysis: LapAnalysis | null;
  selectedDriver: string | null;
  onSelectDriver?: (driverNumber: string) => void;
};

// Standard race-analysis views. Built ones map to a chart component; the rest
// are scaffolded on the same per-lap dataset and filled in incrementally.
const VIEWS: { name: string; chart?: ComponentType<ChartProps> }[] = [
  { name: "Position Changes", chart: PositionChangesChart },
  { name: "Lap Comparison" },
  { name: "Sector Performance", chart: SectorPerformanceTable },
  { name: "Relative Gap Trend", chart: RelativeGapTrendChart },
  { name: "Gap to Leader", chart: GapToLeaderChart },
  { name: "Gap vs Field Average", chart: GapVsFieldAverageChart },
  { name: "Weather Impact on Pace", chart: WeatherImpactChart },
  { name: "Weather History", chart: WeatherHistoryChart },
  { name: "Overtakes", chart: OvertakesTable },
  { name: "Lap Times", chart: LapTimesChart },
  { name: "Pace Analysis", chart: PaceAnalysisTable },
];

export function AnalysisTab({
  sessionParams,
  analysis,
  selectedDriver,
  onSelectDriver,
}: {
  sessionParams: SessionParams;
  analysis: LapAnalysis | null;
  selectedDriver: string | null;
  onSelectDriver: (driverNumber: string) => void;
}) {
  const [viewName, setViewName] = useState("Gap vs Field Average");
  const active = VIEWS.find((v) => v.name === viewName) ?? VIEWS[0];
  const Chart = active.chart;

  return (
    <div className="pitwall-analysis">
      <nav className="pitwall-analysis-nav">
        {VIEWS.map((v) => (
          <button
            key={v.name}
            type="button"
            className={v.name === viewName ? "pitwall-analysis-nav-item active" : "pitwall-analysis-nav-item"}
            onClick={() => setViewName(v.name)}
          >
            {v.name}
          </button>
        ))}
      </nav>
      <section className="pitwall-analysis-main">
        {!sessionParams ? (
          <p>Race analysis is available in replay mode. Start a replay from the landing page.</p>
        ) : Chart ? (
          <Chart analysis={analysis} selectedDriver={selectedDriver} onSelectDriver={onSelectDriver} />
        ) : (
          <p className="pitwall-analysis-placeholder">
            <strong>{viewName}</strong> — next up. Built on the same per-lap dataset.
          </p>
        )}
      </section>
    </div>
  );
}
