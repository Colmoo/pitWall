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
type Corner = { number: number; x: number; y: number; angle: number };
type DrsZone = { start_x: number; start_y: number; end_x: number; end_y: number };

// Which boundary set colors the outline: no division, the 3 real timing
// sectors, or FastF1's much finer-grained marshal ("micro") sectors.
type MapLayer = "blank" | "sectors" | "micro";
const MAP_LAYERS: { id: MapLayer; label: string }[] = [
  { id: "blank", label: "Blank" },
  { id: "sectors", label: "Sectors" },
  { id: "micro", label: "Micro sectors" },
];

// Sector colors, matching the red/blue/yellow convention on official circuit
// posters - cycles for layers with more than 3 boundaries (micro sectors).
const SECTOR_COLORS = ["#e10600", "#3ecbff", "#ffd400"];

// `boundaries` are the distances where the lap moves into the next sector -
// e.g. [b1, b2] for a 3-way split means: index 0 below b1, 1 from b1 to b2,
// 2 from b2 on. Each boundary crossed bumps the index by one.
function sectorIndex(distance: number, boundaries: number[]): number {
  let index = 0;
  for (let i = 0; i < boundaries.length; i++) {
    if (distance >= boundaries[i]) index = i + 1;
  }
  return index % SECTOR_COLORS.length;
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

function nearestIndex(points: LayoutPoint[], x: number, y: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i][0] - x;
    const dy = points[i][1] - y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

// Offsets a polyline sideways by `distance`, so a DRS zone can be drawn as its
// own parallel dashed line alongside the track instead of on top of it.
function offsetPolyline(points: LayoutPoint[], distance: number): LayoutPoint[] {
  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return [p[0] + nx * distance, p[1] + ny * distance];
  });
}

export function TrackMap({
  state,
  sessionParams,
  tracedPoints = [],
  selectedDriver = null,
  onSelectDriver,
}: {
  state: SessionState | null;
  sessionParams: SessionParams;
  tracedPoints?: LayoutPoint[];
  selectedDriver?: string | null;
  onSelectDriver?: (driverNumber: string) => void;
}) {
  const [fetchedPoints, setFetchedPoints] = useState<LayoutPoint[]>([]);
  const [corners, setCorners] = useState<Corner[]>([]);
  const [sectorBoundaries, setSectorBoundaries] = useState<number[]>([]);
  const [microSectorBoundaries, setMicroSectorBoundaries] = useState<number[]>([]);
  const [drsZones, setDrsZones] = useState<DrsZone[]>([]);
  const [layer, setLayer] = useState<MapLayer>("sectors");
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  type TrackLayoutResponse = {
    points: LayoutPoint[];
    corners?: Corner[];
    sector_boundaries?: number[];
    micro_sector_boundaries?: number[];
    drs_zones?: DrsZone[];
  };

  useEffect(() => {
    if (!sessionParams) return;
    const url = `${API_URL}/session/track-layout?year=${sessionParams.year}&event=${encodeURIComponent(sessionParams.event)}&session_type=${sessionParams.sessionType}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: TrackLayoutResponse) => {
        setFetchedPoints(data.points);
        setCorners(data.corners ?? []);
        setSectorBoundaries(data.sector_boundaries ?? []);
        setMicroSectorBoundaries(data.micro_sector_boundaries ?? []);
        setDrsZones(data.drs_zones ?? []);
      });
  }, [sessionParams]);

  // Live mode has no year/event/session identifier up front, but the backend
  // resolves one from the live feed itself and loads matching FastF1 circuit
  // info (corners/sectors/DRS zones) in the background - poll until that
  // shows up, so live mode gets the same decorated map as replay.
  useEffect(() => {
    if (sessionParams) return;
    let cancelled = false;
    let found = false;
    async function poll() {
      while (!cancelled && !found) {
        try {
          const res = await fetch(`${API_URL}/session/live/track-layout`);
          const data: TrackLayoutResponse = await res.json();
          if (data.points?.length) {
            found = true;
            if (!cancelled) {
              setFetchedPoints(data.points);
              setCorners(data.corners ?? []);
              setSectorBoundaries(data.sector_boundaries ?? []);
              setMicroSectorBoundaries(data.micro_sector_boundaries ?? []);
              setDrsZones(data.drs_zones ?? []);
            }
          }
        } catch {
          // backend not reachable yet / session not resolved - retry below.
        }
        if (!found) await new Promise((r) => setTimeout(r, 5000));
      }
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, [sessionParams]);

  // Prefer a real fetched outline (replay, or the live past-year fallback);
  // fall back to points traced from live car positions if that's all we have.
  const rawPoints = fetchedPoints.length >= 2 ? fetchedPoints : tracedPoints;

  // Tracks the canvas box's real pixel size so the viewBox can be shaped to
  // exactly match it (see "cover fit" below) instead of leaving blank bars.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0) {
        setContainerSize({ w: box.width, h: box.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
    // re-attach once the canvas div actually mounts (it doesn't exist yet
    // while the "loading"/"tracing" placeholder below is showing instead).
  }, [rawPoints.length >= 2]);

  // React's onWheel is attached as a passive listener, so preventDefault()
  // inside it silently no-ops and the page scrolls/zooms along with the map.
  // A native listener registered with {passive: false} actually blocks that.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setView((v) => ({ ...v, scale: Math.min(8, Math.max(0.5, v.scale * factor)) }));
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
    // re-attach once the svg actually mounts (it doesn't exist yet while the
    // "loading"/"tracing" placeholder below is showing instead).
  }, [rawPoints.length >= 2]);

  if (rawPoints.length < 2) {
    return <p>Loading track layout...</p>;
  }

  const rawXs = rawPoints.map((p) => p[0]);
  const rawYs = rawPoints.map((p) => p[1]);
  const rawMinX = Math.min(...rawXs);
  const rawMaxX = Math.max(...rawXs);
  const rawMinY = Math.min(...rawYs);
  const rawMaxY = Math.max(...rawYs);
  const rawWidth = rawMaxX - rawMinX || 1;
  const rawHeight = rawMaxY - rawMinY || 1;
  const rawCenterX = rawMinX + rawWidth / 2;
  const rawCenterY = rawMinY + rawHeight / 2;

  // Rotate the whole circuit 90° when its own orientation (wide vs tall)
  // doesn't match the panel's, so it uses the available space instead of
  // rendering sideways-cramped inside a portrait or landscape box.
  const trackIsLandscape = rawWidth >= rawHeight;
  const containerIsLandscape = containerSize ? containerSize.w >= containerSize.h : trackIsLandscape;
  const rotate = trackIsLandscape !== containerIsLandscape;

  function tp(x: number, y: number): [number, number] {
    if (!rotate) return [x, y];
    const dx = x - rawCenterX;
    const dy = y - rawCenterY;
    return [rawCenterX - dy, rawCenterY + dx];
  }

  const points: LayoutPoint[] = rawPoints.map(([x, y, ...rest]) => [...tp(x, y), ...rest]);
  const rotatedCorners = corners.map((c) => {
    const [x, y] = tp(c.x, c.y);
    return { ...c, x, y };
  });
  const rotatedDrsZones = drsZones.map((z) => {
    const [sx, sy] = tp(z.start_x, z.start_y);
    const [ex, ey] = tp(z.end_x, z.end_y);
    return { start_x: sx, start_y: sy, end_x: ex, end_y: ey };
  });

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const size = Math.max(width, height);
  const padding = size * 0.06;
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;
  const contentW = width + padding * 2;
  const contentH = height + padding * 2;

  // "Cover" fit: expand whichever dimension is relatively short so the
  // viewBox's own aspect ratio matches the panel's exactly - that's what
  // eliminates the blank letterbox bars a plain "contain" fit would leave.
  const containerAspect = containerSize && containerSize.h > 0 ? containerSize.w / containerSize.h : contentW / contentH;
  const contentAspect = contentW / contentH;
  const viewW = contentAspect > containerAspect ? contentH * containerAspect : contentW;
  const viewH = contentAspect > containerAspect ? contentH : contentW / containerAspect;

  // buildSectorSegments itself falls back to a single plain-colored line when
  // points carry no per-point distance (traced live points never do), or when
  // the "blank" layer is picked (an empty boundary list forces that fallback).
  const activeBoundaries = layer === "blank" ? [] : layer === "micro" ? microSectorBoundaries : sectorBoundaries;
  const segments = buildSectorSegments(points, activeBoundaries);
  const roadPoints = [...points, points[0]];

  // Corner numbers sit on the racing line itself unless nudged outward - each
  // corner's own Angle (FastF1 circuit info) points in the direction that
  // reads as "outside the turn", per FastF1's own offset-marker convention.
  const cornerLabelOffset = width * 0.03;
  const cornerMarkers = rotatedCorners.map((c) => {
    const angleRad = (c.angle * Math.PI) / 180 + (rotate ? Math.PI / 2 : 0);
    const [ox, oy] = [c.x + Math.cos(angleRad) * cornerLabelOffset, c.y + Math.sin(angleRad) * cornerLabelOffset];
    return { ...c, labelX: ox, labelY: oy };
  });

  const drsOverlays = rotatedDrsZones.map((z) => {
    const startIdx = nearestIndex(points, z.start_x, z.start_y);
    const endIdx = nearestIndex(points, z.end_x, z.end_y);
    const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    const segment = points.slice(lo, hi + 1);
    return offsetPolyline(segment, width * 0.03);
  });

  const driversWithPosition = (state?.drivers.filter((d) => d.x !== null && d.y !== null) ?? []).map((d) => {
    const [x, y] = tp(d.x as number, d.y as number);
    return { ...d, plotX: x, plotY: y };
  });
  const selected = driversWithPosition.find((d) => d.driver_number === selectedDriver) ?? null;

  const scaledW = viewW / view.scale;
  const scaledH = viewH / view.scale;
  const vbX = centerX - scaledW / 2 + view.panX;
  const vbY = centerY - scaledH / 2 + view.panY;

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    dragRef.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    const unitsPerPxX = scaledW / (e.currentTarget.clientWidth || scaledW);
    const unitsPerPxY = scaledH / (e.currentTarget.clientHeight || scaledH);
    setView((v) => ({ ...v, panX: v.panX - dx * unitsPerPxX, panY: v.panY - dy * unitsPerPxY }));
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  return (
    <>
      <div ref={canvasRef} className="pitwall-circuit-canvas" style={{ position: "relative", width: "100%", height: "100%" }}>
        <div className="pitwall-map-layers" role="radiogroup" aria-label="Map layer">
          {MAP_LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={layer === l.id}
              className={layer === l.id ? "pitwall-map-layer-active" : ""}
              onClick={() => setLayer(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="pitwall-reset-view-button"
          onClick={() => setView(DEFAULT_VIEW)}
        >
          Reset view
        </button>
        <svg
          ref={svgRef}
          viewBox={`${vbX} ${vbY} ${scaledW} ${scaledH}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%", display: "block", background: "var(--panel)", cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
        <g data-testid="track-outline">
          {/* grey tarmac road bed, readable against the dark panel background */}
          <path d={pathD(roadPoints)} fill="none" stroke="#3a4048" strokeWidth={width * 0.022} strokeLinejoin="round" strokeLinecap="round" />
          {/* thin sector-colored centerline on top */}
          {segments.map((seg, i) => (
            <path key={i} d={pathD(seg.points)} fill="none" stroke={seg.color} strokeWidth={width * 0.006} strokeLinecap="round" />
          ))}
        </g>
        {drsOverlays.map((overlay, i) => (
          <g key={i}>
            <path
              data-testid="drs-zone"
              d={pathD(overlay)}
              fill="none"
              stroke="#22c55e"
              strokeWidth={width * 0.005}
              strokeDasharray={`${width * 0.01} ${width * 0.008}`}
              strokeLinecap="round"
            />
            {overlay[0] && <circle cx={overlay[0][0]} cy={overlay[0][1]} r={width * 0.009} fill="#22c55e" />}
          </g>
        ))}
        {cornerMarkers.map((c) => (
          <g key={c.number}>
            <circle cx={c.labelX} cy={c.labelY} r={width * 0.012} fill="#e5e7eb" stroke="#0a0c10" strokeWidth={width * 0.0018} />
            <text x={c.labelX} y={c.labelY} fontSize={width * 0.013} fontWeight="bold" fill="#0a0c10" textAnchor="middle" dominantBaseline="central">
              {c.number}
            </text>
          </g>
        ))}
        {driversWithPosition.map((d) => (
          <circle
            key={d.driver_number}
            data-testid={`driver-dot-${d.driver_number}`}
            cx={d.plotX}
            cy={d.plotY}
            r={d.driver_number === selectedDriver ? width * 0.017 : width * 0.01}
            fill={teamColor(d.team)}
            stroke={d.driver_number === selectedDriver ? "#3ecbff" : "#0a0c10"}
            strokeWidth={width * 0.002}
            style={{ cursor: onSelectDriver ? "pointer" : undefined, transition: "cx 0.2s linear, cy 0.2s linear" }}
            onClick={() => onSelectDriver?.(d.driver_number)}
          />
        ))}
        {selected && (
          <g data-testid="selected-driver-flag" style={{ transition: "transform 0.2s linear" }} transform={`translate(${selected.plotX}, ${selected.plotY})`}>
            <line
              x1={0}
              y1={0}
              x2={width * 0.02}
              y2={-width * 0.045}
              stroke="#e5e7eb"
              strokeWidth={width * 0.0015}
            />
            <rect
              x={width * 0.015}
              y={-width * 0.065}
              width={width * 0.06}
              height={width * 0.025}
              rx={width * 0.003}
              fill={teamColor(selected.team)}
            />
            <text
              x={width * 0.045}
              y={-width * 0.0525}
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
