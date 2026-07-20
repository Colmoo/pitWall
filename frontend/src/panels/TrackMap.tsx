import { useEffect, useRef, useState } from "react";
import type { SessionState } from "../types";
import { teamColor } from "../constants";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

type SessionParams = { year: number; event: string; sessionType: string } | null;

// pan offset (in viewBox units) and zoom scale, relative to the default fit view
type View = { panX: number; panY: number; scale: number };
const DEFAULT_VIEW: View = { panX: 0, panY: 0, scale: 1 };

// [x, y] or [x, y, distanceAlongLap] - distance is only present in replay mode
// (from FastF1 telemetry) and drives the per-sector coloring below.
type LayoutPoint = number[];
type Corner = { number: number; x: number; y: number };

// Marshal-sector colors, matching the yellow/blue/magenta convention on official circuit posters.
const SECTOR_COLORS = ["#f4437d", "#ffd400", "#3ecbff"];

function sectorIndex(distance: number, boundaries: number[]): number {
  let index = 0;
  for (let i = 1; i < boundaries.length; i++) {
    if (distance >= boundaries[i]) index = i;
  }
  return Math.min(index, SECTOR_COLORS.length - 1);
}

// Splits the lap outline into per-sector-colored segments (sharing endpoints so
// the line stays visually continuous), falling back to one plain-colored line
// when there's no distance/boundary data (live mode) to color by.
function buildSectorSegments(points: LayoutPoint[], boundaries: number[]): { color: string; points: LayoutPoint[] }[] {
  if (boundaries.length < 2 || points[0]?.[2] === undefined) {
    return [{ color: "#3ecbff", points: [...points, points[0]] }];
  }
  const segments: { color: string; points: LayoutPoint[] }[] = [];
  let current: LayoutPoint[] = [points[0]];
  let currentSector = sectorIndex(points[0][2], boundaries);
  for (let i = 1; i < points.length; i++) {
    const s = sectorIndex(points[i][2], boundaries);
    if (s !== currentSector) {
      current.push(points[i]);
      segments.push({ color: SECTOR_COLORS[currentSector], points: current });
      current = [points[i]];
      currentSector = s;
    } else {
      current.push(points[i]);
    }
  }
  current.push(points[0]); // close the loop
  segments.push({ color: SECTOR_COLORS[currentSector], points: current });
  return segments;
}

function pathD(points: LayoutPoint[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
}

export function TrackMap({
  state,
  sessionParams,
  history = [],
  selectedDriver = null,
  onSelectDriver,
}: {
  state: SessionState | null;
  sessionParams: SessionParams;
  history?: SessionState[];
  selectedDriver?: string | null;
  onSelectDriver?: (driverNumber: string) => void;
}) {
  const [fetchedPoints, setFetchedPoints] = useState<LayoutPoint[]>([]);
  const [corners, setCorners] = useState<Corner[]>([]);
  const [sectorBoundaries, setSectorBoundaries] = useState<number[]>([]);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!sessionParams) return;
    const url = `${API_URL}/session/track-layout?year=${sessionParams.year}&event=${encodeURIComponent(sessionParams.event)}&session_type=${sessionParams.sessionType}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: { points: LayoutPoint[]; corners?: Corner[]; sector_boundaries?: number[] }) => {
        setFetchedPoints(data.points);
        setCorners(data.corners ?? []);
        setSectorBoundaries(data.sector_boundaries ?? []);
      });
  }, [sessionParams]);

  // Live mode has no FastF1 (year/event/session) identifier to fetch a layout
  // with, so trace the circuit from the leader's live x/y positions instead -
  // no separate request, no waiting on a FastF1 session load.
  const tracedPoints: LayoutPoint[] = sessionParams
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

  const segments = sessionParams ? buildSectorSegments(points, sectorBoundaries) : [{ color: "#3ecbff", points: [...points, points[0]] }];

  const driversWithPosition = state?.drivers.filter((d) => d.x !== null && d.y !== null) ?? [];
  const selected = driversWithPosition.find((d) => d.driver_number === selectedDriver) ?? null;

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
          style={{ width: "100%", height: "auto", background: "#05070a", cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
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
        <g data-testid="track-outline">
          {segments.map((seg, i) => (
            <path key={i} d={pathD(seg.points)} fill="none" stroke={seg.color} strokeWidth={width * 0.006} strokeLinecap="round" />
          ))}
        </g>
        {corners.map((c) => (
          <g key={c.number}>
            <circle cx={c.x} cy={c.y} r={width * 0.011} fill="#05070a" stroke="#4b5563" strokeWidth={width * 0.0015} />
            <text x={c.x} y={c.y} fontSize={width * 0.013} fill="#c7ccd6" textAnchor="middle" dominantBaseline="central">
              {c.number}
            </text>
          </g>
        ))}
        {driversWithPosition.map((d) => (
          <circle
            key={d.driver_number}
            data-testid={`driver-dot-${d.driver_number}`}
            cx={d.x as number}
            cy={d.y as number}
            r={d.driver_number === selectedDriver ? width * 0.017 : width * 0.01}
            fill={teamColor(d.team)}
            stroke={d.driver_number === selectedDriver ? "#ffffff" : "#05070a"}
            strokeWidth={width * 0.002}
            style={{ cursor: onSelectDriver ? "pointer" : undefined }}
            onClick={() => onSelectDriver?.(d.driver_number)}
          />
        ))}
        {selected && (
          <g data-testid="selected-driver-flag">
            <line
              x1={selected.x as number}
              y1={selected.y as number}
              x2={(selected.x as number) + width * 0.02}
              y2={(selected.y as number) - width * 0.045}
              stroke="#e5e7eb"
              strokeWidth={width * 0.0015}
            />
            <rect
              x={(selected.x as number) + width * 0.015}
              y={(selected.y as number) - width * 0.065}
              width={width * 0.06}
              height={width * 0.025}
              rx={width * 0.003}
              fill={teamColor(selected.team)}
            />
            <text
              x={(selected.x as number) + width * 0.045}
              y={(selected.y as number) - width * 0.0525}
              fontSize={width * 0.017}
              fontWeight="bold"
              fill="#05070a"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {selected.abbreviation}
            </text>
          </g>
        )}
        </svg>
      </div>
      {sessionParams && <div className="pitwall-circuit-name">{sessionParams.event}</div>}
    </>
  );
}
