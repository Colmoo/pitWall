import { useEffect, useState } from "react";
import type { SessionState } from "../types";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

type Traces = { distance: number[]; speed: number[]; throttle: number[]; brake: boolean[]; gear: number[]; rpm: number[] };

type SessionParams = { year: number; event: string; sessionType: string } | null;

function Trace({ testId, values, max, color }: { testId: string; values: number[]; max: number; color: string }) {
  const width = 100;
  const height = 16;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 28 }}>
      <polyline data-testid={testId} points={points} fill="none" stroke={color} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function TelemetryStack({
  sessionParams,
  state,
  selectedDriver,
}: {
  sessionParams: SessionParams;
  state: SessionState | null;
  selectedDriver: string | null;
}) {
  const [traces, setTraces] = useState<Traces | null>(null);
  const driver = state?.drivers.find((d) => d.driver_number === selectedDriver) ?? null;
  const lapNumber = driver?.lap_number ?? null;

  useEffect(() => {
    setTraces(null);
    if (!sessionParams || !selectedDriver || !lapNumber) return;
    const url =
      `${API_URL}/session/telemetry?year=${sessionParams.year}&event=${encodeURIComponent(sessionParams.event)}` +
      `&session_type=${sessionParams.sessionType}&driver=${selectedDriver}&lap_number=${lapNumber}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: Traces) => setTraces(data));
  }, [sessionParams, selectedDriver, lapNumber]);

  if (!sessionParams) {
    return <p>Telemetry unavailable in live mode.</p>;
  }
  if (!selectedDriver) {
    return <p>Select a driver to see telemetry.</p>;
  }
  if (!traces || !traces.speed || traces.speed.length === 0) {
    return <p>Loading telemetry...</p>;
  }

  return (
    <div>
      <div className="pitwall-stat-label">Speed</div>
      <Trace testId="telemetry-trace-speed" values={traces.speed} max={Math.max(...traces.speed, 1)} color="#3ecbff" />
      <div className="pitwall-stat-label">Throttle</div>
      <Trace testId="telemetry-trace-throttle" values={traces.throttle} max={100} color="#4ade80" />
      <div className="pitwall-stat-label">Brake</div>
      <Trace testId="telemetry-trace-brake" values={traces.brake.map((b) => (b ? 1 : 0))} max={1} color="#f87171" />
      <div className="pitwall-stat-label">Gear</div>
      <Trace testId="telemetry-trace-gear" values={traces.gear} max={Math.max(...traces.gear, 1)} color="#facc15" />
      <div className="pitwall-stat-label">RPM</div>
      <Trace testId="telemetry-trace-rpm" values={traces.rpm} max={Math.max(...traces.rpm, 1)} color="#a78bfa" />
    </div>
  );
}
