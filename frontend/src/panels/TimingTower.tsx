import type { SessionState } from "../types";
import { teamColor, tireColor } from "../constants";

function bestSectorDriver(
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

export function TimingTower({
  state,
  selectedDriver,
  onSelectDriver,
}: {
  state: SessionState | null;
  selectedDriver: string | null;
  onSelectDriver: (driverNumber: string) => void;
}) {
  if (!state) {
    return <p>Waiting for session data...</p>;
  }
  const drivers = [...state.drivers].sort((a, b) => a.position - b.position);
  // ponytail: sector cells only mark session-best (purple), matching the
  // existing SectorTimes convention. Per-driver personal-best tracking needs
  // history threaded into this panel; add if that distinction is requested.
  const bestS1 = bestSectorDriver(state.drivers, "sector_1_time");
  const bestS2 = bestSectorDriver(state.drivers, "sector_2_time");
  const bestS3 = bestSectorDriver(state.drivers, "sector_3_time");

  return (
    <table>
      <thead>
        <tr>
          <th>Pos</th><th>Driver</th><th>Tire</th><th>Last Lap</th><th>Best Lap</th>
          <th>Gap</th><th>Int</th><th>S1</th><th>S2</th><th>S3</th>
        </tr>
      </thead>
      <tbody>
        {drivers.map((d) => (
          <tr
            key={d.driver_number}
            className={
              "pitwall-row-selectable" + (d.driver_number === selectedDriver ? " pitwall-row-selected" : "")
            }
            onClick={() => onSelectDriver(d.driver_number)}
          >
            <td>{d.position}</td>
            <td>
              <span className="pitwall-team-stripe" style={{ background: teamColor(d.team) }} />
              {d.abbreviation}
            </td>
            <td style={{ color: tireColor(d.tire.compound) }}>
              {d.tire.compound} ({d.tire.age_laps})
            </td>
            <td>{d.last_lap_time?.toFixed(3) ?? "-"}</td>
            <td>{d.best_lap_time?.toFixed(3) ?? "-"}</td>
            <td>{d.gap_to_leader !== null ? `+${d.gap_to_leader.toFixed(3)}` : "-"}</td>
            <td>{d.gap_to_ahead !== null ? `+${d.gap_to_ahead.toFixed(3)}` : "-"}</td>
            <td style={d.driver_number === bestS1 ? { color: "var(--purple)" } : undefined}>
              {d.sector_1_time?.toFixed(3) ?? "-"}
            </td>
            <td style={d.driver_number === bestS2 ? { color: "var(--purple)" } : undefined}>
              {d.sector_2_time?.toFixed(3) ?? "-"}
            </td>
            <td style={d.driver_number === bestS3 ? { color: "var(--purple)" } : undefined}>
              {d.sector_3_time?.toFixed(3) ?? "-"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
