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

function microSectorClass(status: string): string {
  if (status === "purple") return "purple";
  if (status === "green") return "green";
  if (status === "yellow") return "yellow";
  return "gray";
}

function SectorCell({
  time,
  microSectors,
  isBest,
  testId,
}: {
  time: number | null;
  microSectors: string[];
  isBest: boolean;
  testId: string;
}) {
  return (
    <td
      className="pitwall-sector-cell"
      data-testid={isBest ? testId : undefined}
      style={isBest ? { color: "purple" } : undefined}
    >
      {time?.toFixed(3) ?? "-"}
      <span className="pitwall-micro-sectors" data-testid={`${testId}-micro`}>
        {microSectors.map((s, i) => (
          <span key={i} className={`pitwall-micro-sector ${microSectorClass(s)}`} />
        ))}
      </span>
    </td>
  );
}

export function SectorTimes({ state }: { state: SessionState | null }) {
  if (!state) {
    return <p>Waiting for session data...</p>;
  }

  const bestS1 = bestDriverNumber(state.drivers, "sector_1_time");
  const bestS2 = bestDriverNumber(state.drivers, "sector_2_time");
  const bestS3 = bestDriverNumber(state.drivers, "sector_3_time");

  return (
    <table className="pitwall-sector-table">
      <thead>
        <tr><th>Driver</th><th>S1</th><th>S2</th><th>S3</th></tr>
      </thead>
      <tbody>
        {state.drivers.map((d) => (
          <tr key={d.driver_number}>
            <td>{d.abbreviation}</td>
            <SectorCell
              time={d.sector_1_time}
              microSectors={d.micro_sectors[0] ?? []}
              isBest={d.driver_number === bestS1}
              testId={`sector1-best-${d.driver_number}`}
            />
            <SectorCell
              time={d.sector_2_time}
              microSectors={d.micro_sectors[1] ?? []}
              isBest={d.driver_number === bestS2}
              testId={`sector2-best-${d.driver_number}`}
            />
            <SectorCell
              time={d.sector_3_time}
              microSectors={d.micro_sectors[2] ?? []}
              isBest={d.driver_number === bestS3}
              testId={`sector3-best-${d.driver_number}`}
            />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
