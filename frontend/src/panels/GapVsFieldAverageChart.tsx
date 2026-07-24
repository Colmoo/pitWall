import { useMemo, useState } from "react";
import type { LapAnalysis } from "../types";
import { teamColor } from "../constants";

// Gap vs field average: at each lap, a driver's gap-to-leader minus the field's
// mean gap-to-leader. Below the axis = ahead of the average car, above = behind.
// The leader's absolute time cancels, so only the gaps are needed.

const W = 1000;
const H = 500;
const PAD = { top: 16, right: 24, bottom: 28, left: 64 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

type Series = { driver: string; team: string; dashed: boolean; points: { lap: number; v: number; pit: boolean }[] };

function buildSeries(analysis: LapAnalysis): { series: Series[]; minV: number; maxV: number } {
  // field-average gap per lap (leader's null gap counts as 0)
  const gapAt = new Map<string, Map<number, number>>();
  const sumByLap = new Map<number, { sum: number; n: number }>();
  for (const d of analysis.drivers) {
    const perLap = new Map<number, number>();
    for (const l of d.laps) {
      const g = l.gap_to_leader ?? 0;
      perLap.set(l.lap, g);
      const agg = sumByLap.get(l.lap) ?? { sum: 0, n: 0 };
      agg.sum += g;
      agg.n += 1;
      sumByLap.set(l.lap, agg);
    }
    gapAt.set(d.driver_number, perLap);
  }

  // teammates share a colour: first seen solid, second dashed
  const seenTeam = new Map<string, number>();
  let minV = Infinity;
  let maxV = -Infinity;
  const series: Series[] = analysis.drivers.map((d) => {
    const idx = seenTeam.get(d.team) ?? 0;
    seenTeam.set(d.team, idx + 1);
    const perLap = gapAt.get(d.driver_number)!;
    const points = d.laps.map((l) => {
      const agg = sumByLap.get(l.lap)!;
      const avg = agg.sum / agg.n;
      const v = (perLap.get(l.lap) ?? 0) - avg;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
      return { lap: l.lap, v, pit: l.pit };
    });
    return { driver: d.driver_number, team: d.team, dashed: idx > 0, points };
  });
  if (!isFinite(minV)) {
    minV = -1;
    maxV = 1;
  }
  return { series, minV, maxV };
}

export function GapVsFieldAverageChart({
  analysis,
  selectedDriver,
  onSelectDriver,
}: {
  analysis: LapAnalysis | null;
  selectedDriver: string | null;
  onSelectDriver?: (driverNumber: string) => void;
}) {
  const [showScVsc, setShowScVsc] = useState(true);
  const [showPit, setShowPit] = useState(true);

  const model = useMemo(() => (analysis ? buildSeries(analysis) : null), [analysis]);

  if (!analysis || !model || analysis.total_laps < 1) {
    return <p>Load a race (replay mode) to see gap-vs-field analysis.</p>;
  }

  const totalLaps = Math.max(analysis.total_laps, 2);
  const { minV, maxV } = model;
  const span = maxV - minV || 1;
  const lapX = (lap: number) => PAD.left + ((lap - 1) / (totalLaps - 1)) * PLOT_W;
  const valY = (v: number) => PAD.top + (1 - (v - minV) / span) * PLOT_H;

  const yTicks = [maxV, minV + span * 0.75, minV + span * 0.5, minV + span * 0.25, minV];
  const xTicks = Array.from({ length: 6 }, (_, i) => Math.round(1 + (i / 5) * (totalLaps - 1)));

  const path = (pts: { lap: number; v: number }[]) =>
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
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} data-testid="gap-vs-field-chart">
        {/* SC/VSC shaded lap bands */}
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
        {/* y gridlines + labels (seconds) */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={valY(v)} x2={W - PAD.right} y2={valY(v)} stroke="#2a2f37" strokeWidth={1} strokeDasharray="3 4" />
            <text x={PAD.left - 8} y={valY(v)} fontSize={12} fill="#8b93a1" textAnchor="end" dominantBaseline="central">
              {v >= 0 ? "+" : ""}{v.toFixed(1)}s
            </text>
          </g>
        ))}
        {/* x lap labels */}
        {xTicks.map((lap, i) => (
          <text key={i} x={lapX(lap)} y={H - 8} fontSize={12} fill="#8b93a1" textAnchor="middle">
            L{lap}
          </text>
        ))}
        {/* driver lines */}
        {model.series.map((s) => (
          <path
            key={s.driver}
            data-testid={`gap-line-${s.driver}`}
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
        {/* pit markers */}
        {showPit &&
          model.series.flatMap((s) =>
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
