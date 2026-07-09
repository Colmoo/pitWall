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
  const size = Math.max(width, height);
  const padding = size * 0.05;
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;
  const viewSize = size + padding * 2;

  const pathD = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ") + " Z";

  const driversWithPosition = state?.drivers.filter((d) => d.x !== null && d.y !== null) ?? [];

  return (
    <>
      <svg
        viewBox={`${centerX - viewSize / 2} ${centerY - viewSize / 2} ${viewSize} ${viewSize}`}
        style={{ width: "100%", height: "auto" }}
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
      {sessionParams && <div className="pitwall-circuit-name">{sessionParams.event}</div>}
    </>
  );
}
