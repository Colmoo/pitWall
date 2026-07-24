import { useMemo } from "react";
import type { AnalysisDriver, LapAnalysis } from "../types";
import { teamColor } from "../constants";

type ViewProps = {
  analysis: LapAnalysis | null;
  selectedDriver: string | null;
  onSelectDriver?: (driverNumber: string) => void;
};

function Empty() {
  return <p>Load a race (replay mode) to see this analysis.</p>;
}

function DriverCell({ d }: { d: { abbreviation: string; team: string } }) {
  return (
    <td>
      <span className="pitwall-team-stripe" style={{ background: teamColor(d.team) }} /> {d.abbreviation}
    </td>
  );
}

function rowProps(driverNumber: string, selectedDriver: string | null, onSelectDriver?: (n: string) => void) {
  return {
    className: "pitwall-row-selectable" + (driverNumber === selectedDriver ? " pitwall-row-selected" : ""),
    onClick: () => onSelectDriver?.(driverNumber),
  };
}

// Laps that count toward pace: a real timed lap (not a pit lap) and within 107%
// of the driver's own best, which drops safety-car / traffic / in-laps.
function cleanLapTimes(d: AnalysisDriver): number[] {
  const timed = d.laps.filter((l) => l.lap_time !== null && !l.pit).map((l) => l.lap_time as number);
  if (timed.length === 0) return [];
  const best = Math.min(...timed);
  return timed.filter((t) => t <= best * 1.07);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stdDev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
}

function bestSector(d: AnalysisDriver, key: "sector_1_time" | "sector_2_time" | "sector_3_time"): number | null {
  const vals = d.laps.map((l) => l[key]).filter((v): v is number => v !== null);
  return vals.length ? Math.min(...vals) : null;
}

export function SectorPerformanceTable({ analysis, selectedDriver, onSelectDriver }: ViewProps) {
  const rows = useMemo(() => {
    if (!analysis) return [];
    const data = analysis.drivers.map((d) => ({
      driver_number: d.driver_number,
      abbreviation: d.abbreviation,
      team: d.team,
      s1: bestSector(d, "sector_1_time"),
      s2: bestSector(d, "sector_2_time"),
      s3: bestSector(d, "sector_3_time"),
    }));
    return data.map((r) => ({ ...r, ideal: r.s1 !== null && r.s2 !== null && r.s3 !== null ? r.s1 + r.s2 + r.s3 : null }));
  }, [analysis]);
  if (!analysis) return <Empty />;
  const bestOf = (k: "s1" | "s2" | "s3" | "ideal") => {
    const vals = rows.map((r) => r[k]).filter((v): v is number => v !== null);
    return vals.length ? Math.min(...vals) : null;
  };
  const bests = { s1: bestOf("s1"), s2: bestOf("s2"), s3: bestOf("s3"), ideal: bestOf("ideal") };
  const cell = (v: number | null, isBest: boolean) => (
    <td style={isBest ? { color: "var(--purple)", fontWeight: 700 } : undefined}>{v?.toFixed(3) ?? "-"}</td>
  );
  const sorted = [...rows].sort((a, b) => (a.ideal ?? Infinity) - (b.ideal ?? Infinity));
  return (
    <div className="pitwall-analysis-table-wrap">
      <table data-testid="sector-performance-table">
        <thead>
          <tr><th>Driver</th><th>Best S1</th><th>Best S2</th><th>Best S3</th><th>Ideal Lap</th></tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.driver_number} {...rowProps(r.driver_number, selectedDriver, onSelectDriver)}>
              <DriverCell d={r} />
              {cell(r.s1, r.s1 === bests.s1)}
              {cell(r.s2, r.s2 === bests.s2)}
              {cell(r.s3, r.s3 === bests.s3)}
              {cell(r.ideal, r.ideal === bests.ideal)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaceAnalysisTable({ analysis, selectedDriver, onSelectDriver }: ViewProps) {
  const rows = useMemo(() => {
    if (!analysis) return [];
    return analysis.drivers
      .map((d) => {
        const clean = cleanLapTimes(d);
        return {
          driver_number: d.driver_number,
          abbreviation: d.abbreviation,
          team: d.team,
          count: clean.length,
          best: clean.length ? Math.min(...clean) : null,
          median: median(clean),
          consistency: stdDev(clean),
        };
      })
      .sort((a, b) => (a.median ?? Infinity) - (b.median ?? Infinity));
  }, [analysis]);
  if (!analysis) return <Empty />;
  const fastestMedian = rows.find((r) => r.median !== null)?.median ?? null;
  return (
    <div className="pitwall-analysis-table-wrap">
      <table data-testid="pace-analysis-table">
        <thead>
          <tr><th>Driver</th><th>Clean Laps</th><th>Best</th><th>Median Pace</th><th>Consistency (σ)</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.driver_number} {...rowProps(r.driver_number, selectedDriver, onSelectDriver)}>
              <DriverCell d={r} />
              <td>{r.count}</td>
              <td>{r.best?.toFixed(3) ?? "-"}</td>
              <td style={r.median !== null && r.median === fastestMedian ? { color: "var(--purple)", fontWeight: 700 } : undefined}>
                {r.median?.toFixed(3) ?? "-"}
              </td>
              <td>{r.consistency !== null ? `±${r.consistency.toFixed(3)}` : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OvertakesTable({ analysis, selectedDriver, onSelectDriver }: ViewProps) {
  const rows = useMemo(() => {
    if (!analysis) return [];
    return analysis.drivers
      .map((d) => {
        const laps = [...d.laps].sort((a, b) => a.lap - b.lap);
        let gained = 0;
        let lost = 0;
        for (let i = 1; i < laps.length; i++) {
          const delta = laps[i - 1].position - laps[i].position; // +ve = moved up
          if (delta > 0) gained += delta;
          else if (delta < 0) lost += -delta;
        }
        const start = laps[0]?.position ?? null;
        const finish = laps[laps.length - 1]?.position ?? null;
        return {
          driver_number: d.driver_number,
          abbreviation: d.abbreviation,
          team: d.team,
          start,
          finish,
          net: start !== null && finish !== null ? start - finish : 0,
          gained,
          lost,
        };
      })
      .sort((a, b) => b.net - a.net);
  }, [analysis]);
  if (!analysis) return <Empty />;
  return (
    <div className="pitwall-analysis-table-wrap">
      <p className="pitwall-analysis-hint">Position changes lap-to-lap (includes pit cycles — not purely on-track passes).</p>
      <table data-testid="overtakes-table">
        <thead>
          <tr><th>Driver</th><th>Start</th><th>Finish</th><th>Net</th><th>Places Gained</th><th>Places Lost</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.driver_number} {...rowProps(r.driver_number, selectedDriver, onSelectDriver)}>
              <DriverCell d={r} />
              <td>{r.start !== null ? `P${r.start}` : "-"}</td>
              <td>{r.finish !== null ? `P${r.finish}` : "-"}</td>
              <td style={{ color: r.net > 0 ? "var(--green)" : r.net < 0 ? "var(--red)" : undefined, fontWeight: 700 }}>
                {r.net > 0 ? `+${r.net}` : r.net}
              </td>
              <td style={{ color: "var(--green)" }}>{r.gained}</td>
              <td style={{ color: "var(--red)" }}>{r.lost}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
