import type { SessionState } from "../types";

function bestDriverNumber(
  drivers: SessionState["drivers"],
  field: "sector_1_time" | "sector_2_time" | "sector_3_time",
): string | null {
  let best: { driverNumber: string; time: number } | null = null;
  for (const d of drivers) {
    const time = d[field];
    if (time !== null && (best === null || time < best.time)) {
      best = { driverNumber: d.driver_number, time };
    }
  }
  return best?.driverNumber ?? null;
}

export function SectorTimes({ state }: { state: SessionState | null }) {
  if (!state) {
    return <p>Waiting for session data...</p>;
  }

  const bestS1 = bestDriverNumber(state.drivers, "sector_1_time");
  const bestS2 = bestDriverNumber(state.drivers, "sector_2_time");
  const bestS3 = bestDriverNumber(state.drivers, "sector_3_time");

  return (
    <table>
      <thead>
        <tr><th>Driver</th><th>S1</th><th>S2</th><th>S3</th></tr>
      </thead>
      <tbody>
        {state.drivers.map((d) => (
          <tr key={d.driver_number}>
            <td>{d.abbreviation}</td>
            <td
              data-testid={d.driver_number === bestS1 ? `sector1-best-${d.driver_number}` : undefined}
              style={d.driver_number === bestS1 ? { color: "purple" } : undefined}
            >
              {d.sector_1_time?.toFixed(3) ?? "-"}
            </td>
            <td
              data-testid={d.driver_number === bestS2 ? `sector2-best-${d.driver_number}` : undefined}
              style={d.driver_number === bestS2 ? { color: "purple" } : undefined}
            >
              {d.sector_2_time?.toFixed(3) ?? "-"}
            </td>
            <td
              data-testid={d.driver_number === bestS3 ? `sector3-best-${d.driver_number}` : undefined}
              style={d.driver_number === bestS3 ? { color: "purple" } : undefined}
            >
              {d.sector_3_time?.toFixed(3) ?? "-"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
