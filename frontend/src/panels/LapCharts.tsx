import { useMemo, useState } from "react";
import type { AnalysisDriver, AnalysisLap, LapAnalysis } from "../types";
import { teamColor } from "../constants";

// Shared per-lap line chart used by every gap/position/lap-time analysis view.
// Each view just supplies a value(driver, lap) -> number|null; this owns the
// axes, SC/VSC shading, pit markers, teammate solid/dashed, and highlighting.

const W = 1000;
const H = 500;
const PAD = { top: 16, right: 24, bottom: 28, left: 68 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export type Series = { driver: string; team: string; dashed: boolean; points: { lap: number; v: number; pit: boolean }[] };

export function seriesFromValues(
  analysis: LapAnalysis,
  value: (d: AnalysisDriver, l: AnalysisLap) => number | null,
): { series: Series[]; minV: number; maxV: number } {
  const seenTeam = new Map<string, number>();
  let minV = Infinity;
  let maxV = -Infinity;
  const series = analysis.drivers.map((d) => {
    const idx = seenTeam.get(d.team) ?? 0;
    seenTeam.set(d.team, idx + 1);
    const points: Series["points"] = [];
    for (const l of d.laps) {
      const v = value(d, l);
      if (v === null || !isFinite(v)) continue;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
      points.push({ lap: l.lap, v, pit: l.pit });
    }
    return { driver: d.driver_number, team: d.team, dashed: idx > 0, points };
  });
  if (!isFinite(minV)) {
    minV = 0;
    maxV = 1;
  }
  return { series, minV, maxV };
}

// per-lap field-average of gap-to-leader (leader's null gap counts as 0)
function fieldAvgGap(analysis: LapAnalysis): Map<number, number> {
  const sum = new Map<number, { s: number; n: number }>();
  for (const d of analysis.drivers) {
    for (const l of d.laps) {
      const agg = sum.get(l.lap) ?? { s: 0, n: 0 };
      agg.s += l.gap_to_leader ?? 0;
      agg.n += 1;
      sum.set(l.lap, agg);
    }
  }
  const avg = new Map<number, number>();
  for (const [lap, { s, n }] of sum) avg.set(lap, s / n);
  return avg;
}

function LapLineChart({
  analysis,
  series,
  minV,
  maxV,
  selectedDriver,
  onSelectDriver,
  testId,
  invert = false,
  formatY = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}s`,
}: {
  analysis: LapAnalysis;
  series: Series[];
  minV: number;
  maxV: number;
  selectedDriver: string | null;
  onSelectDriver?: (driverNumber: string) => void;
  testId: string;
  invert?: boolean;
  formatY?: (v: number) => string;
}) {
  const [showScVsc, setShowScVsc] = useState(true);
  const [showPit, setShowPit] = useState(true);

  const totalLaps = Math.max(analysis.total_laps, 2);
  const span = maxV - minV || 1;
  const lapX = (lap: number) => PAD.left + ((lap - 1) / (totalLaps - 1)) * PLOT_W;
  const valY = (v: number) => {
    const t = (v - minV) / span;
    return PAD.top + (invert ? t : 1 - t) * PLOT_H;
  };
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => minV + span * f);
  const xTicks = Array.from({ length: 6 }, (_, i) => Math.round(1 + (i / 5) * (totalLaps - 1)));
  const path = (pts: Series["points"]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${lapX(p.lap).toFixed(1)},${valY(p.v).toFixed(1)}`).join(" ");
  const dimmed = (driver: string) => selectedDriver !== null && driver !== selectedDriver;

  return (
    <div className="pitwall-analysis-chart">
      <div className="pitwall-analysis-toolbar">
        <label className={`pitwall-pill ${showScVsc ? "on" : ""}`}>
          <input type="checkbox" checked={showScVsc} onChange={(e) => setShowScVsc(e.target.checked)} />
          SC/VSC
        </label>
        <label className={`pitwall-pill ${showPit ? "on" : ""}`}>
          <input type="checkbox" checked={showPit} onChange={(e) => setShowPit(e.target.checked)} />
          PIT
        </label>
        <span className="pitwall-analysis-hint">Select a driver to highlight</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} data-testid={testId}>
        {showScVsc &&
          analysis.sc_vsc_laps.map(([start, end], i) => (
            <rect
              key={i}
              data-testid="sc-vsc-band"
              x={lapX(Math.max(1, start - 0.5))}
              y={PAD.top}
              width={lapX(end + 0.5) - lapX(Math.max(1, start - 0.5))}
              height={PLOT_H}
              fill="#facc15"
              opacity={0.08}
            />
          ))}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={valY(v)} x2={W - PAD.right} y2={valY(v)} stroke="#2a2f37" strokeWidth={1} strokeDasharray="3 4" />
            <text x={PAD.left - 8} y={valY(v)} fontSize={12} fill="#8b93a1" textAnchor="end" dominantBaseline="central">
              {formatY(v)}
            </text>
          </g>
        ))}
        {xTicks.map((lap, i) => (
          <text key={i} x={lapX(lap)} y={H - 8} fontSize={12} fill="#8b93a1" textAnchor="middle">
            L{lap}
          </text>
        ))}
        {series.map((s) => (
          <path
            key={s.driver}
            data-testid={`chart-line-${s.driver}`}
            d={path(s.points)}
            fill="none"
            stroke={teamColor(s.team)}
            strokeWidth={s.driver === selectedDriver ? 3 : 1.5}
            strokeDasharray={s.dashed ? "6 4" : undefined}
            opacity={dimmed(s.driver) ? 0.18 : 1}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: onSelectDriver ? "pointer" : undefined }}
            onClick={() => onSelectDriver?.(s.driver)}
          />
        ))}
        {showPit &&
          series.flatMap((s) =>
            s.points
              .filter((p) => p.pit)
              .map((p) => (
                <circle
                  key={`${s.driver}-${p.lap}`}
                  data-testid="pit-marker"
                  cx={lapX(p.lap)}
                  cy={valY(p.v)}
                  r={4}
                  fill={teamColor(s.team)}
                  stroke="#0a0c10"
                  strokeWidth={1}
                  opacity={dimmed(s.driver) ? 0.18 : 1}
                />
              )),
          )}
      </svg>
    </div>
  );
}

type ViewProps = {
  analysis: LapAnalysis | null;
  selectedDriver: string | null;
  onSelectDriver?: (driverNumber: string) => void;
};

function Empty() {
  return <p>Load a race (replay mode) to see this analysis.</p>;
}

export function GapVsFieldAverageChart({ analysis, selectedDriver, onSelectDriver }: ViewProps) {
  const model = useMemo(() => {
    if (!analysis) return null;
    const avg = fieldAvgGap(analysis);
    return seriesFromValues(analysis, (_d, l) => (l.gap_to_leader ?? 0) - (avg.get(l.lap) ?? 0));
  }, [analysis]);
  if (!analysis || !model) return <Empty />;
  return <LapLineChart analysis={analysis} {...model} selectedDriver={selectedDriver} onSelectDriver={onSelectDriver} testId="gap-vs-field-chart" />;
}

export function GapToLeaderChart({ analysis, selectedDriver, onSelectDriver }: ViewProps) {
  const model = useMemo(() => (analysis ? seriesFromValues(analysis, (_d, l) => l.gap_to_leader ?? 0) : null), [analysis]);
  if (!analysis || !model) return <Empty />;
  return <LapLineChart analysis={analysis} {...model} selectedDriver={selectedDriver} onSelectDriver={onSelectDriver} testId="gap-to-leader-chart" />;
}

export function RelativeGapTrendChart({ analysis, selectedDriver, onSelectDriver }: ViewProps) {
  // gap relative to the selected driver (positive = behind that driver). With no
  // selection, the reference is the leader, so it matches Gap to Leader.
  const model = useMemo(() => {
    if (!analysis) return null;
    const ref = new Map<number, number>();
    const refDriver = analysis.drivers.find((d) => d.driver_number === selectedDriver);
    for (const l of refDriver?.laps ?? []) ref.set(l.lap, l.gap_to_leader ?? 0);
    return seriesFromValues(analysis, (_d, l) => (l.gap_to_leader ?? 0) - (ref.get(l.lap) ?? 0));
  }, [analysis, selectedDriver]);
  if (!analysis || !model) return <Empty />;
  return <LapLineChart analysis={analysis} {...model} selectedDriver={selectedDriver} onSelectDriver={onSelectDriver} testId="relative-gap-chart" />;
}

export function LapTimesChart({ analysis, selectedDriver, onSelectDriver }: ViewProps) {
  const model = useMemo(() => (analysis ? seriesFromValues(analysis, (_d, l) => l.lap_time) : null), [analysis]);
  if (!analysis || !model) return <Empty />;
  return (
    <LapLineChart
      analysis={analysis}
      {...model}
      selectedDriver={selectedDriver}
      onSelectDriver={onSelectDriver}
      testId="lap-times-chart"
      formatY={(v) => `${v.toFixed(1)}s`}
    />
  );
}

export function PositionChangesChart({ analysis, selectedDriver, onSelectDriver }: ViewProps) {
  const model = useMemo(() => (analysis ? seriesFromValues(analysis, (_d, l) => l.position) : null), [analysis]);
  if (!analysis || !model) return <Empty />;
  return (
    <LapLineChart
      analysis={analysis}
      {...model}
      selectedDriver={selectedDriver}
      onSelectDriver={onSelectDriver}
      testId="position-changes-chart"
      invert
      formatY={(v) => `P${Math.round(v)}`}
    />
  );
}
