import { useEffect, useState } from "react";
import type { SessionState } from "../types";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

type SessionParams = { year: number; event: string; sessionType: string } | null;

export function TrackMap({ state, sessionParams }: { state: SessionState | null; sessionParams: SessionParams }) {
  const [points, setPoints] = useState<[number, number][]>([]);

  useEffect(() => {
    if (!sessionParams) return;
    const url = `${API_URL}/session/track-layout?year=${sessionParams.year}&event=${encodeURIComponent(sessionParams.event)}&session_type=${sessionParams.sessionType}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: { points: [number, number][] }) => setPoints(data.points));
  }, [sessionParams]);

  if (!sessionParams) {
    return <p>Start a session to see the track map.</p>;
  }

  if (points.length === 0) {
    return <p>Loading track layout...</p>;
  }

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const padding = Math.max(width, height) * 0.05;

  const pathD = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ") + " Z";

  const driversWithPosition = state?.drivers.filter((d) => d.x !== null && d.y !== null) ?? [];

  return (
    <svg
      viewBox={`${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`}
      style={{ width: "100%", height: "auto" }}
    >
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
  );
}
