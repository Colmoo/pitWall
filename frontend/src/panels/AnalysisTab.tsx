import { useState } from "react";
import type { LapAnalysis } from "../types";
import { GapVsFieldAverageChart } from "./GapVsFieldAverageChart";

type SessionParams = { year: number; event: string; sessionType: string } | null;

// Standard race-analysis views. Gap vs Field Average is built; the rest are
// scaffolded on the same per-lap dataset and filled in incrementally.
const VIEWS = [
  "Position Changes",
  "Lap Comparison",
  "Sector Performance",
  "Relative Gap Trend",
  "Gap to Leader",
  "Gap vs Field Average",
  "Weather Impact on Pace",
  "Weather History",
  "Overtakes",
  "Lap Times",
  "Pace Analysis",
] as const;
type View = (typeof VIEWS)[number];

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
  const [view, setView] = useState<View>("Gap vs Field Average");

  return (
    <div className="pitwall-analysis">
      <nav className="pitwall-analysis-nav">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            className={v === view ? "pitwall-analysis-nav-item active" : "pitwall-analysis-nav-item"}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </nav>
      <section className="pitwall-analysis-main">
        {!sessionParams ? (
          <p>Race analysis is available in replay mode. Start a replay from the landing page.</p>
        ) : view === "Gap vs Field Average" ? (
          <GapVsFieldAverageChart analysis={analysis} selectedDriver={selectedDriver} onSelectDriver={onSelectDriver} />
        ) : (
          <p className="pitwall-analysis-placeholder">
            <strong>{view}</strong> — next up. Built on the same per-lap dataset as Gap vs Field Average.
          </p>
        )}
      </section>
    </div>
  );
}
