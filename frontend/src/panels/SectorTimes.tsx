import type { SessionState, DriverState } from "../types";
import { formatGap } from "../constants";

type SectorField =
  | "sector_1_time" | "sector_2_time" | "sector_3_time"
  | "best_sector_1_time" | "best_sector_2_time" | "best_sector_3_time";

function bestDriverNumber(drivers: SessionState["drivers"], field: SectorField): string | null {
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
      {microSectors.length > 0 && (
        <span className="pitwall-micro-sectors" data-testid={`${testId}-micro`}>
          {microSectors.map((s, i) => (
            <span key={i} className={`pitwall-micro-sector ${microSectorClass(s)}`} />
          ))}
        </span>
      )}
    </td>
  );
}

export function SectorTimes({
  state,
  qualifyingMode = false,
}: {
  state: SessionState | null;
  qualifyingMode?: boolean;
}) {
  if (!state) {
    return <p>Waiting for session data...</p>;
  }

  // Qualifying/practice: show each driver's best sector times of the session.
  // Race: show the current-lap sector times with live mini-sectors under them.
  const fields: SectorField[] = qualifyingMode
    ? ["best_sector_1_time", "best_sector_2_time", "best_sector_3_time"]
    : ["sector_1_time", "sector_2_time", "sector_3_time"];
  const bests = fields.map((f) => bestDriverNumber(state.drivers, f));
  const microFor = (d: DriverState, i: number): string[] =>
    qualifyingMode ? [] : d.micro_sectors[i] ?? [];

  return (
    <table className="pitwall-sector-table">
      <thead>
        <tr><th>Driver</th><th>S1</th><th>S2</th><th>S3</th><th>Gap</th><th>Int</th></tr>
      </thead>
      <tbody>
        {state.drivers.map((d) => (
          <tr key={d.driver_number}>
            <td>{d.abbreviation}</td>
            {fields.map((f, i) => (
              <SectorCell
                key={f}
                time={d[f]}
                microSectors={microFor(d, i)}
                isBest={d.driver_number === bests[i]}
                testId={`sector${i + 1}-best-${d.driver_number}`}
              />
            ))}
            <td>{formatGap(d.gap_to_leader)}</td>
            <td>{formatGap(d.gap_to_ahead)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
