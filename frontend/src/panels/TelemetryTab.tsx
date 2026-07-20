import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionState } from "../types";
import { comparisonColor } from "../constants";
import { useDriverLapTelemetry } from "../api/useDriverLapTelemetry";
import type { Traces, TelemetrySessionParams } from "../api/useDriverLapTelemetry";
import { useLiveDriverTelemetry } from "../api/useLiveDriverTelemetry";
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
  history,
  onData,
}: {
  sessionParams: TelemetrySessionParams;
  selection: ComparisonSelection;
  history: SessionState[];
  onData: (id: string, traces: Traces | null) => void;
}) {
  const replayTraces = useDriverLapTelemetry(sessionParams, selection.driver, selection.lapNumber);
  const liveTraces = useLiveDriverTelemetry(history, selection.driver, selection.lapNumber);
  const traces = sessionParams ? replayTraces : liveTraces;
  useEffect(() => {
    onData(selection.id, traces);
  }, [selection.id, traces, onData]);
  return null;
}

type ZoomDomain = { start: number; end: number };
const FULL_DOMAIN: ZoomDomain = { start: 0, end: 1 };

// Points for one trace, sliced to the visible zoom domain and rescaled to fill the chart width.
function domainPoints(values: number[], max: number, domain: ZoomDomain, width: number, height: number) {
  if (values.length === 0) return "";
  if (values.length === 1) return `0,${(height - (values[0] / max) * height).toFixed(2)}`;
  const lastIndex = values.length - 1;
  const startIdx = domain.start * lastIndex;
  const endIdx = domain.end * lastIndex;
  const span = endIdx - startIdx || 1;
  return values
    .map((v, i) => `${(((i - startIdx) / span) * width).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`)
    .join(" ");
}

function OverlayTrace({
  testId,
  label,
  selections,
  tracesById,
  metric,
  max,
  yLabels,
  domain,
  onZoom,
}: {
  testId: string;
  label: string;
  selections: ComparisonSelection[];
  tracesById: Record<string, Traces | null>;
  metric: (traces: Traces) => number[];
  max: number;
  yLabels?: [string, string];
  domain: ZoomDomain;
  onZoom: (domain: ZoomDomain) => void;
}) {
  const width = 1000;
  const height = 220;
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);

  function fractionAt(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    svgRef.current?.setPointerCapture(e.pointerId);
    setDragStart(fractionAt(e.clientX));
    setDragX(fractionAt(e.clientX));
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (dragStart === null) return;
    setDragX(fractionAt(e.clientX));
  }

  function handlePointerUp() {
    if (dragStart !== null && dragX !== null && Math.abs(dragX - dragStart) > 0.02) {
      const lo = Math.min(dragStart, dragX);
      const hi = Math.max(dragStart, dragX);
      const span = domain.end - domain.start;
      onZoom({ start: domain.start + lo * span, end: domain.start + hi * span });
    }
    setDragStart(null);
    setDragX(null);
  }

  const [yMax, yMin] = yLabels ?? [String(Math.round(max)), "0"];

  return (
    <div>
      <div className="pitwall-stat-label">{label}</div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: 220, cursor: "crosshair", touchAction: "none" }}
        data-testid={testId}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <text x={4} y={16} fontSize={16} fill="var(--pitwall-muted, #8892a6)">{yMax}</text>
        <text x={4} y={height - 6} fontSize={16} fill="var(--pitwall-muted, #8892a6)">{yMin}</text>
        {selections.map((s) => {
          const traces = tracesById[s.id];
          if (!traces) return null;
          const points = domainPoints(metric(traces), max, domain, width, height);
          return <polyline key={s.id} points={points} fill="none" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
        })}
        {dragStart !== null && dragX !== null && (
          <rect
            x={Math.min(dragStart, dragX) * width}
            y={0}
            width={Math.abs(dragX - dragStart) * width}
            height={height}
            fill="rgba(62, 203, 255, 0.15)"
            stroke="rgba(62, 203, 255, 0.6)"
          />
        )}
      </svg>
    </div>
  );
}

export function TelemetryTab({
  sessionParams,
  state,
  history,
}: {
  sessionParams: TelemetrySessionParams;
  state: SessionState | null;
  history: SessionState[];
}) {
  const [selections, setSelections] = useState<ComparisonSelection[]>([]);
  const [tracesById, setTracesById] = useState<Record<string, Traces | null>>({});
  const [zoomDomain, setZoomDomain] = useState<ZoomDomain>(FULL_DOMAIN);

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
            <span>
              {s.abbreviation} — lap {s.lapNumber}
              {tracesById[s.id] && tracesById[s.id]!.speed.length === 0 ? " (no telemetry for this lap)" : ""}
            </span>
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
          <TelemetryFetcher key={s.id} sessionParams={sessionParams} selection={s} history={history} onData={handleData} />
        ))}
      </Panel>
      <Panel key="telemetry-charts" id="telemetry-charts" title="Telemetry Comparison">
        <div className="pitwall-telemetry-toolbar">
          <button type="button" onClick={() => setZoomDomain(FULL_DOMAIN)} disabled={zoomDomain.start === 0 && zoomDomain.end === 1}>
            Reset view
          </button>
          <span className="pitwall-stat-label">Click and drag on a chart to zoom</span>
        </div>
        <OverlayTrace
          testId="telemetry-overlay-speed"
          label="Speed (km/h)"
          selections={selections}
          tracesById={tracesById}
          metric={(t) => t.speed}
          max={speedMax}
          domain={zoomDomain}
          onZoom={setZoomDomain}
        />
        <OverlayTrace
          testId="telemetry-overlay-throttle"
          label="Throttle (%)"
          selections={selections}
          tracesById={tracesById}
          metric={(t) => t.throttle}
          max={100}
          domain={zoomDomain}
          onZoom={setZoomDomain}
        />
        <OverlayTrace
          testId="telemetry-overlay-brake"
          label="Brake (on/off)"
          selections={selections}
          tracesById={tracesById}
          metric={(t) => t.brake.map((b) => (b ? 1 : 0))}
          max={1}
          yLabels={["On", "Off"]}
          domain={zoomDomain}
          onZoom={setZoomDomain}
        />
        <OverlayTrace
          testId="telemetry-overlay-gear"
          label="Gear (1-8)"
          selections={selections}
          tracesById={tracesById}
          metric={(t) => t.gear}
          max={gearMax}
          domain={zoomDomain}
          onZoom={setZoomDomain}
        />
        <OverlayTrace
          testId="telemetry-overlay-rpm"
          label="RPM"
          selections={selections}
          tracesById={tracesById}
          metric={(t) => t.rpm}
          max={rpmMax}
          domain={zoomDomain}
          onZoom={setZoomDomain}
        />
      </Panel>
    </WidgetGrid>
  );
}
