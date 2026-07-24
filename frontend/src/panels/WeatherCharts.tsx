import { useMemo } from "react";
import type { LapAnalysis } from "../types";

type ViewProps = {
  analysis: LapAnalysis | null;
  selectedDriver: string | null;
  onSelectDriver?: (driverNumber: string) => void;
};

const W = 1000;
const H = 500;
const PAD = { top: 16, right: 24, bottom: 40, left: 68 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function NoWeather() {
  return <p>No weather data for this session.</p>;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function contiguous(laps: number[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const lap of laps) {
    const last = ranges[ranges.length - 1];
    if (last && lap === last[1] + 1) last[1] = lap;
    else ranges.push([lap, lap]);
  }
  return ranges;
}

export function WeatherHistoryChart({ analysis }: ViewProps) {
  if (!analysis || analysis.weather.length === 0) return <NoWeather />;
  const weather = analysis.weather;
  const totalLaps = Math.max(analysis.total_laps, 2);
  const temps = weather.flatMap((w) => [w.air_temp, w.track_temp]);
  const minT = Math.min(...temps);
  const maxT = Math.max(...temps);
  const span = maxT - minT || 1;
  const lapX = (lap: number) => PAD.left + ((lap - 1) / (totalLaps - 1)) * PLOT_W;
  const tempY = (t: number) => PAD.top + (1 - (t - minT) / span) * PLOT_H;
  const line = (key: "air_temp" | "track_temp") =>
    weather.map((w, i) => `${i === 0 ? "M" : "L"}${lapX(w.lap).toFixed(1)},${tempY(w[key]).toFixed(1)}`).join(" ");
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => minT + span * f);
  const xTicks = Array.from({ length: 6 }, (_, i) => Math.round(1 + (i / 5) * (totalLaps - 1)));
  const rainRanges = contiguous(weather.filter((w) => w.rainfall).map((w) => w.lap));

  return (
    <div className="pitwall-analysis-chart">
      <div className="pitwall-analysis-toolbar">
        <span className="pitwall-legend"><i style={{ background: "#f87171" }} /> Track °C</span>
        <span className="pitwall-legend"><i style={{ background: "#3ecbff" }} /> Air °C</span>
        <span className="pitwall-legend"><i style={{ background: "#3b82f6", opacity: 0.3 }} /> Rain</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} data-testid="weather-history-chart">
        {rainRanges.map(([s, e], i) => (
          <rect key={i} data-testid="rain-band" x={lapX(Math.max(1, s - 0.5))} y={PAD.top} width={lapX(e + 0.5) - lapX(Math.max(1, s - 0.5))} height={PLOT_H} fill="#3b82f6" opacity={0.14} />
        ))}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={tempY(t)} x2={W - PAD.right} y2={tempY(t)} stroke="#2a2f37" strokeWidth={1} strokeDasharray="3 4" />
            <text x={PAD.left - 8} y={tempY(t)} fontSize={12} fill="#8b93a1" textAnchor="end" dominantBaseline="central">{t.toFixed(0)}°</text>
          </g>
        ))}
        {xTicks.map((lap, i) => (
          <text key={i} x={lapX(lap)} y={H - 20} fontSize={12} fill="#8b93a1" textAnchor="middle">L{lap}</text>
        ))}
        <path d={line("track_temp")} fill="none" stroke="#f87171" strokeWidth={2} vectorEffect="non-scaling-stroke" data-testid="track-temp-line" />
        <path d={line("air_temp")} fill="none" stroke="#3ecbff" strokeWidth={2} vectorEffect="non-scaling-stroke" data-testid="air-temp-line" />
      </svg>
    </div>
  );
}

export function WeatherImpactChart({ analysis }: ViewProps) {
  const points = useMemo(() => {
    if (!analysis || analysis.weather.length === 0) return [];
    const trackByLap = new Map(analysis.weather.map((w) => [w.lap, w.track_temp]));
    const timesByLap = new Map<number, number[]>();
    for (const d of analysis.drivers) {
      for (const l of d.laps) {
        if (l.lap_time !== null && !l.pit) {
          const arr = timesByLap.get(l.lap) ?? [];
          arr.push(l.lap_time);
          timesByLap.set(l.lap, arr);
        }
      }
    }
    const pts: { track: number; pace: number }[] = [];
    for (const [lap, times] of timesByLap) {
      const track = trackByLap.get(lap);
      const pace = median(times);
      if (track !== undefined && pace !== null) pts.push({ track, pace });
    }
    return pts;
  }, [analysis]);

  if (!analysis || points.length === 0) return <NoWeather />;
  const txs = points.map((p) => p.track);
  const pys = points.map((p) => p.pace);
  const minX = Math.min(...txs);
  const maxX = Math.max(...txs);
  const minY = Math.min(...pys);
  const maxY = Math.max(...pys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const px = (t: number) => PAD.left + ((t - minX) / spanX) * PLOT_W;
  const py = (p: number) => PAD.top + (1 - (p - minY) / spanY) * PLOT_H;
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => minX + spanX * f);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => minY + spanY * f);

  return (
    <div className="pitwall-analysis-chart">
      <p className="pitwall-analysis-hint">Field median lap time vs track temperature — each point is one race lap.</p>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} data-testid="weather-impact-chart">
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={py(v)} x2={W - PAD.right} y2={py(v)} stroke="#2a2f37" strokeWidth={1} strokeDasharray="3 4" />
            <text x={PAD.left - 8} y={py(v)} fontSize={12} fill="#8b93a1" textAnchor="end" dominantBaseline="central">{v.toFixed(1)}s</text>
          </g>
        ))}
        {xTicks.map((v, i) => (
          <text key={i} x={px(v)} y={H - 20} fontSize={12} fill="#8b93a1" textAnchor="middle">{v.toFixed(0)}°C</text>
        ))}
        <text x={PAD.left + PLOT_W / 2} y={H - 4} fontSize={12} fill="#6b7280" textAnchor="middle">Track temperature</text>
        {points.map((p, i) => (
          <circle key={i} data-testid="impact-point" cx={px(p.track)} cy={py(p.pace)} r={4} fill="#a78bfa" opacity={0.7} />
        ))}
      </svg>
    </div>
  );
}
