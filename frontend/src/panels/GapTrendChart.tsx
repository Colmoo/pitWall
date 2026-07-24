import { useMemo, useRef } from "react";
import type { SessionState } from "../types";

export function GapTrendChart({
  history,
  selectedDriver,
}: {
  history: SessionState[];
  selectedDriver: string | null;
}) {
  // ponytail: raw `history` is a bounded rolling window (see useSessionSocket),
  // so accumulate the selected driver's gaps append-only in a ref keyed on the
  // last-processed state's identity. Only new states are scanned per render,
  // and early-session points survive after they roll off the window.
  const accRef = useRef<{ driver: string | null; last: SessionState | null; points: number[] }>({
    driver: null,
    last: null,
    points: [],
  });

  const points = useMemo(() => {
    const acc = accRef.current;
    if (acc.driver !== selectedDriver) {
      acc.driver = selectedDriver;
      acc.last = null;
      acc.points = [];
    }
    if (!selectedDriver) return acc.points;
    let start = 0;
    if (acc.last !== null) {
      const found = history.indexOf(acc.last);
      // marker missing => history reset (or window jumped past it): rebuild.
      if (found === -1) acc.points = [];
      else start = found + 1;
    }
    for (let i = start; i < history.length; i++) {
      const gap = history[i].drivers.find((d) => d.driver_number === selectedDriver)?.gap_to_leader ?? null;
      if (gap !== null) acc.points.push(gap);
    }
    if (history.length > 0) acc.last = history[history.length - 1];
    return acc.points;
  }, [history, selectedDriver]);

  if (!selectedDriver) {
    return <p>Select a driver to see their gap trend.</p>;
  }

  if (points.length === 0) {
    return <p>No gap data yet.</p>;
  }

  const width = 100;
  const height = 30;
  const maxGap = Math.max(...points, 0.1);
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;

  const coords = points
    .map((gap, i) => `${(i * stepX).toFixed(2)},${(height - (gap / maxGap) * height).toFixed(2)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 80 }}>
      <polyline
        data-testid="gap-trend-line"
        points={coords}
        fill="none"
        stroke="#3ecbff"
        strokeWidth={0.6}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
