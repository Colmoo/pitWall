import type { SessionState } from "../types";

export function TimingTower({ state }: { state: SessionState | null }) {
  if (!state) {
    return <p>Waiting for session data...</p>;
  }
  const drivers = [...state.drivers].sort((a, b) => a.position - b.position);
  return (
    <table>
      <thead>
        <tr>
          <th>Pos</th><th>Driver</th><th>Team</th><th>Last Lap</th><th>Best Lap</th><th>Tire</th>
        </tr>
      </thead>
      <tbody>
        {drivers.map((d) => (
          <tr key={d.driver_number}>
            <td>{d.position}</td>
            <td>{d.abbreviation}</td>
            <td>{d.team}</td>
            <td>{d.last_lap_time?.toFixed(3) ?? "-"}</td>
            <td>{d.best_lap_time?.toFixed(3) ?? "-"}</td>
            <td>{d.tire.compound} ({d.tire.age_laps})</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
