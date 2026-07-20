import type { SessionState } from "../types";
import { useDriverLapTelemetry } from "../api/useDriverLapTelemetry";
import type { TelemetrySessionParams } from "../api/useDriverLapTelemetry";
import { useLiveDriverTelemetry } from "../api/useLiveDriverTelemetry";

function Trace({ testId, values, max, color }: { testId: string; values: number[]; max: number; color: string }) {
  const width = 100;
  const height = 16;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 34 }}>
      <polyline data-testid={testId} points={points} fill="none" stroke={color} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function TelemetryStack({
  sessionParams,
  state,
  history,
  selectedDriver,
}: {
  sessionParams: TelemetrySessionParams;
  state: SessionState | null;
  history: SessionState[];
  selectedDriver: string | null;
}) {
  const driver = state?.drivers.find((d) => d.driver_number === selectedDriver) ?? null;
  const lapNumber = driver?.lap_number ?? null;
  const replayTraces = useDriverLapTelemetry(sessionParams, selectedDriver, lapNumber);
  const liveTraces = useLiveDriverTelemetry(history, selectedDriver, lapNumber);
  const traces = sessionParams ? replayTraces : liveTraces;

  if (!selectedDriver) {
    return <p>Select a driver to see telemetry.</p>;
  }
  if (!traces || !traces.speed || traces.speed.length === 0) {
    return <p>{sessionParams ? "Loading telemetry..." : "Waiting for live telemetry..."}</p>;
  }

  const speedMax = Math.max(...traces.speed, 1);
  const gearMax = Math.max(...traces.gear, 1);
  const rpmMax = Math.max(...traces.rpm, 1);

  return (
    <div>
      <div className="pitwall-stat-label">Speed (km/h) — max {speedMax}</div>
      <Trace testId="telemetry-trace-speed" values={traces.speed} max={speedMax} color="#3ecbff" />
      <div className="pitwall-stat-label">Throttle (%)</div>
      <Trace testId="telemetry-trace-throttle" values={traces.throttle} max={100} color="#4ade80" />
      <div className="pitwall-stat-label">Brake (on/off)</div>
      <Trace testId="telemetry-trace-brake" values={traces.brake.map((b) => (b ? 1 : 0))} max={1} color="#f87171" />
      <div className="pitwall-stat-label">Gear (1-8) — max {gearMax}</div>
      <Trace testId="telemetry-trace-gear" values={traces.gear} max={gearMax} color="#facc15" />
      <div className="pitwall-stat-label">RPM — max {rpmMax}</div>
      <Trace testId="telemetry-trace-rpm" values={traces.rpm} max={rpmMax} color="#a78bfa" />
    </div>
  );
}
