import type { SessionState } from "../types";

export function GapTrendChart({
  history,
  selectedDriver,
}: {
  history: SessionState[];
  selectedDriver: string | null;
}) {
  if (!selectedDriver) {
    return <p>Select a driver to see their gap trend.</p>;
  }

  const points = history
    .map((state) => state.drivers.find((d) => d.driver_number === selectedDriver)?.gap_to_leader ?? null)
    .filter((gap): gap is number => gap !== null);

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
