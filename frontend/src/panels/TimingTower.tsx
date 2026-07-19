import { useState } from "react";
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
  // ponytail: no reliable data source for which qualifying segment (Q1/Q2/Q3)
  // is currently active or how many cars remain, so elimination-zone cutoff
  // highlighting is skipped rather than faked. Add once real segment data exists.
  const [fastestLapOnly, setFastestLapOnly] = useState(false);

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

  let fastestOverall: string | null = null;
  for (const d of state.drivers) {
    if (d.best_lap_time === null) continue;
    if (fastestOverall === null || d.best_lap_time < (state.drivers.find((x) => x.driver_number === fastestOverall)?.best_lap_time ?? Infinity)) {
      fastestOverall = d.driver_number;
    }
  }

  return (
    <>
      <label className="pitwall-fastest-lap-toggle">
        <input
          type="checkbox"
          checked={fastestLapOnly}
          onChange={(e) => setFastestLapOnly(e.target.checked)}
        />
        Fastest lap only
      </label>
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
                {d.flying_lap !== null && (
                  <span className={`pitwall-lap-badge ${d.flying_lap ? "push" : "inout"}`}>
                    {d.flying_lap ? "PUSH" : "IN/OUT"}
                  </span>
                )}
              </td>
              <td style={{ color: tireColor(d.tire.compound) }}>
                {d.tire.compound} ({d.tire.age_laps})
              </td>
              <td style={fastestLapOnly ? { opacity: 0.4 } : undefined}>
                {d.last_lap_time?.toFixed(3) ?? "-"}
              </td>
              <td
                style={{
                  color: d.driver_number === fastestOverall ? "var(--purple)" : undefined,
                  fontWeight: fastestLapOnly ? 700 : undefined,
                }}
              >
                {d.best_lap_time?.toFixed(3) ?? "-"}
              </td>
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
    </>
  );
}
