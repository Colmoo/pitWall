import type { SessionState } from "../types";
import { tireColor } from "../constants";

export function SelectedDriverCard({
  state,
  selectedDriver,
}: {
  state: SessionState | null;
  selectedDriver: string | null;
}) {
  const driver = state?.drivers.find((d) => d.driver_number === selectedDriver) ?? null;

  if (!driver) {
    return <p>Select a driver to see details.</p>;
  }

  return (
    <div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Driver</div>
        <div className="pitwall-stat-value cyan">
          <span>{driver.abbreviation}</span> · P{driver.position}
        </div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Tire</div>
        <div className="pitwall-stat-value" style={{ color: tireColor(driver.tire.compound) }}>
          {driver.tire.compound} ({driver.tire.age_laps})
        </div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Last Lap</div>
        <div className="pitwall-stat-value">{driver.last_lap_time?.toFixed(3) ?? "-"}</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Best Lap</div>
        <div className="pitwall-stat-value">{driver.best_lap_time?.toFixed(3) ?? "-"}</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Gap to Leader</div>
        <div className="pitwall-stat-value">
          {driver.gap_to_leader !== null ? `+${driver.gap_to_leader.toFixed(3)}` : "-"}
        </div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Gap Ahead</div>
        <div className="pitwall-stat-value">
          {driver.gap_to_ahead !== null ? `+${driver.gap_to_ahead.toFixed(3)}` : "-"}
        </div>
      </div>
      {driver.speed !== null && (
        <div className="pitwall-live-telemetry" data-testid="live-telemetry">
          <div className="pitwall-stat">
            <div className="pitwall-stat-label">Speed</div>
            <div className="pitwall-stat-value cyan">{driver.speed.toFixed(0)} km/h</div>
          </div>
          <div className="pitwall-stat">
            <div className="pitwall-stat-label">Throttle</div>
            <div className="pitwall-stat-value green">{driver.throttle?.toFixed(0) ?? "-"}%</div>
          </div>
          <div className="pitwall-stat">
            <div className="pitwall-stat-label">Brake</div>
            <div className={`pitwall-stat-value ${driver.brake ? "red" : ""}`}>{driver.brake ? "ON" : "OFF"}</div>
          </div>
          <div className="pitwall-stat">
            <div className="pitwall-stat-label">Gear</div>
            <div className="pitwall-stat-value">{driver.gear ?? "-"}</div>
          </div>
          <div className="pitwall-stat">
            <div className="pitwall-stat-label">RPM</div>
            <div className="pitwall-stat-value">{driver.rpm ?? "-"}</div>
          </div>
          <div className="pitwall-stat">
            <div className="pitwall-stat-label">DRS</div>
            <div className={`pitwall-stat-value ${driver.drs ? "cyan" : ""}`}>{driver.drs ? "OPEN" : "CLOSED"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
