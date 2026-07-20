import { useEffect, useRef, useState } from "react";
import type { SessionState } from "../types";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

type SessionParams = { year: number; event: string; sessionType: string } | null;

// pan offset (in viewBox units) and zoom scale, relative to the default fit view
type View = { panX: number; panY: number; scale: number };
const DEFAULT_VIEW: View = { panX: 0, panY: 0, scale: 1 };

export function TrackMap({
  state,
  sessionParams,
  history = [],
}: {
  state: SessionState | null;
  sessionParams: SessionParams;
  history?: SessionState[];
}) {
  const [fetchedPoints, setFetchedPoints] = useState<[number, number][]>([]);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!sessionParams) return;
    const url = `${API_URL}/session/track-layout?year=${sessionParams.year}&event=${encodeURIComponent(sessionParams.event)}&session_type=${sessionParams.sessionType}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: { points: [number, number][] }) => setFetchedPoints(data.points));
  }, [sessionParams]);

  // Live mode has no FastF1 (year/event/session) identifier to fetch a layout
  // with, so trace the circuit from the leader's live x/y positions instead -
  // no separate request, no waiting on a FastF1 session load.
  const tracedPoints: [number, number][] = sessionParams
    ? []
    : history
        .map((s) => s.drivers.find((d) => d.position === 1) ?? s.drivers[0])
        .filter((d): d is NonNullable<typeof d> => d != null && d.x != null && d.y != null)
        .map((d) => [d.x as number, d.y as number]);

  const points = sessionParams ? fetchedPoints : tracedPoints;

  if (points.length < 2) {
    return <p>{sessionParams ? "Loading track layout..." : "Tracing track from live car positions..."}</p>;
  }

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const size = Math.max(width, height);
  const padding = size * 0.05;
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;
  const viewSize = size + padding * 2;

  const pathD = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ") + " Z";

  const driversWithPosition = state?.drivers.filter((d) => d.x !== null && d.y !== null) ?? [];

  const scaledSize = viewSize / view.scale;
  const vbX = centerX - scaledSize / 2 + view.panX;
  const vbY = centerY - scaledSize / 2 + view.panY;

  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => ({ ...v, scale: Math.min(8, Math.max(0.5, v.scale * factor)) }));
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    dragRef.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    // viewBox units per screen pixel, roughly (svg is square and rendered at ~panel width)
    const unitsPerPx = scaledSize / (e.currentTarget.clientWidth || scaledSize);
    setView((v) => ({ ...v, panX: v.panX - dx * unitsPerPx, panY: v.panY - dy * unitsPerPx }));
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  return (
    <>
      <div style={{ position: "relative", width: "100%" }}>
        <button
          type="button"
          className="pitwall-reset-view-button"
          onClick={() => setView(DEFAULT_VIEW)}
        >
          Reset view
        </button>
        <svg
          viewBox={`${vbX} ${vbY} ${scaledSize} ${scaledSize}`}
          style={{ width: "100%", height: "auto", cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
        <circle
          cx={centerX}
          cy={centerY}
          r={size / 2 + padding * 0.6}
          fill="none"
          stroke="#1a1d1f"
          strokeWidth={width * 0.003}
        />
        <path data-testid="track-outline" d={pathD} fill="none" stroke="#3ecbff" strokeWidth={width * 0.004} />
        {driversWithPosition.map((d) => (
          <circle
            key={d.driver_number}
            data-testid={`driver-dot-${d.driver_number}`}
            cx={d.x as number}
            cy={d.y as number}
            r={width * 0.01}
            fill="#facc15"
          />
        ))}
        </svg>
      </div>
      {sessionParams && <div className="pitwall-circuit-name">{sessionParams.event}</div>}
    </>
  );
}
