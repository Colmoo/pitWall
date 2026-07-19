import { useCallback, useState } from "react";
import type { SessionState } from "../types";
import { comparisonColor } from "../constants";
import { useDriverLapTelemetry } from "../api/useDriverLapTelemetry";
import type { Traces, TelemetrySessionParams } from "../api/useDriverLapTelemetry";
import { WidgetGrid } from "./WidgetGrid";
import type { WidgetLayoutItem } from "./WidgetGrid";
import { Panel } from "./Panel";

type ComparisonSelection = { id: string; driver: string; abbreviation: string; lapNumber: number; color: string };

const TELEMETRY_DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  { i: "driver-picker", x: 0, y: 0, w: 3, h: 14 },
  { i: "active-selections", x: 0, y: 14, w: 3, h: 10 },
  { i: "telemetry-charts", x: 3, y: 0, w: 9, h: 24 },
];

function TelemetryFetcher({
  sessionParams,
  selection,
  onData,
}: {
  sessionParams: TelemetrySessionParams;
  selection: ComparisonSelection;
  onData: (id: string, traces: Traces | null) => void;
}) {
  const traces = useDriverLapTelemetry(sessionParams, selection.driver, selection.lapNumber);
  onData(selection.id, traces);
  return null;
}

function OverlayTrace({
  testId,
  selections,
  tracesById,
  metric,
  max,
}: {
  testId: string;
  selections: ComparisonSelection[];
  tracesById: Record<string, Traces | null>;
  metric: (traces: Traces) => number[];
  max: number;
}) {
  const width = 100;
  const height = 40;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 80 }} data-testid={testId}>
      {selections.map((s) => {
        const traces = tracesById[s.id];
        if (!traces) return null;
        const values = metric(traces);
        const stepX = values.length > 1 ? width / (values.length - 1) : 0;
        const points = values
          .map((v, i) => `${(i * stepX).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`)
          .join(" ");
        return <polyline key={s.id} points={points} fill="none" stroke={s.color} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}

export function TelemetryTab({
  sessionParams,
  state,
}: {
  sessionParams: TelemetrySessionParams;
  state: SessionState | null;
}) {
  const [selections, setSelections] = useState<ComparisonSelection[]>([]);
  const [tracesById, setTracesById] = useState<Record<string, Traces | null>>({});

  const handleData = useCallback((id: string, traces: Traces | null) => {
    setTracesById((prev) => (prev[id] === traces ? prev : { ...prev, [id]: traces }));
  }, []);

  function addSelection(driverNumber: string, abbreviation: string) {
    const driver = state?.drivers.find((d) => d.driver_number === driverNumber);
    const id = `${driverNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setSelections((prev) => [
      ...prev,
      { id, driver: driverNumber, abbreviation, lapNumber: driver?.lap_number ?? 1, color: comparisonColor(prev.length) },
    ]);
  }

  function removeSelection(id: string) {
    setSelections((prev) => prev.filter((s) => s.id !== id));
    setTracesById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function updateLap(id: string, lapNumber: number) {
    setSelections((prev) => prev.map((s) => (s.id === id ? { ...s, lapNumber } : s)));
  }

  if (!sessionParams) {
    return <p>Telemetry unavailable in live mode.</p>;
  }

  const speedMax = Math.max(1, ...selections.flatMap((s) => tracesById[s.id]?.speed ?? []));
  const gearMax = Math.max(1, ...selections.flatMap((s) => tracesById[s.id]?.gear ?? []));
  const rpmMax = Math.max(1, ...selections.flatMap((s) => tracesById[s.id]?.rpm ?? []));

  return (
    <WidgetGrid storageKey="pitwall-telemetry-layout" defaultLayout={TELEMETRY_DEFAULT_LAYOUT}>
      <Panel key="driver-picker" id="driver-picker" title="Drivers">
        <ul className="pitwall-driver-picker">
          {(state?.drivers ?? []).map((d) => (
            <li key={d.driver_number}>
              <button type="button" onClick={() => addSelection(d.driver_number, d.abbreviation)}>
                {d.abbreviation}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel key="active-selections" id="active-selections" title="Comparing">
        {selections.map((s) => (
          <div key={s.id} className="pitwall-comparison-row">
            <span className="pitwall-team-stripe" style={{ background: s.color }} />
            <span>{s.abbreviation} — lap {s.lapNumber}</span>
            <label htmlFor={`lap-number-${s.id}`}>Lap number</label>
            <input
              id={`lap-number-${s.id}`}
              type="number"
              value={s.lapNumber}
              onChange={(e) => updateLap(s.id, Number(e.target.value))}
            />
            <button type="button" onClick={() => removeSelection(s.id)}>
              Remove
            </button>
          </div>
        ))}
        {selections.map((s) => (
          <TelemetryFetcher key={s.id} sessionParams={sessionParams} selection={s} onData={handleData} />
        ))}
      </Panel>
      <Panel key="telemetry-charts" id="telemetry-charts" title="Telemetry Comparison">
        <div className="pitwall-stat-label">Speed (km/h)</div>
        <OverlayTrace testId="telemetry-overlay-speed" selections={selections} tracesById={tracesById} metric={(t) => t.speed} max={speedMax} />
        <div className="pitwall-stat-label">Throttle (%)</div>
        <OverlayTrace testId="telemetry-overlay-throttle" selections={selections} tracesById={tracesById} metric={(t) => t.throttle} max={100} />
        <div className="pitwall-stat-label">Brake (on/off)</div>
        <OverlayTrace testId="telemetry-overlay-brake" selections={selections} tracesById={tracesById} metric={(t) => t.brake.map((b) => (b ? 1 : 0))} max={1} />
        <div className="pitwall-stat-label">Gear (1-8)</div>
        <OverlayTrace testId="telemetry-overlay-gear" selections={selections} tracesById={tracesById} metric={(t) => t.gear} max={gearMax} />
        <div className="pitwall-stat-label">RPM</div>
        <OverlayTrace testId="telemetry-overlay-rpm" selections={selections} tracesById={tracesById} metric={(t) => t.rpm} max={rpmMax} />
      </Panel>
    </WidgetGrid>
  );
}
