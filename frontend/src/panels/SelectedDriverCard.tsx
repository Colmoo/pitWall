import type { SessionState } from "../types";
import { formatGap, tireColor } from "../constants";

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

  // Current lap progress straight from the timing feed: sum of this lap's posted
  // sector times (it fills in S1 -> S1+S2 -> full lap as each sector completes).
  // No wall-clock stopwatch - the feed carries no live lap timer, so we only
  // show real, API-sourced sector splits rather than a clock that starts on click.
  const posted = [driver.sector_1_time, driver.sector_2_time, driver.sector_3_time].filter(
    (t): t is number => t !== null,
  );
  const runningLap = driver.status !== "out" && posted.length > 0 ? posted.reduce((a, b) => a + b, 0) : null;

  const radioClips = (state?.team_radio ?? [])
    .filter((clip) => clip.driver_number === selectedDriver)
    .reverse();

  return (
    <div style={driver.status === "out" ? { opacity: 0.4 } : undefined}>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Driver</div>
        <div className="pitwall-stat-value cyan">
          <span>{driver.abbreviation}</span> · {driver.status === "out" ? "OUT" : `P${driver.position}`}
        </div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Tire</div>
        <div className="pitwall-stat-value" style={{ color: tireColor(driver.tire.compound) }}>
          {driver.tire.compound} ({driver.tire.age_laps})
        </div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Current Lap</div>
        <div className="pitwall-stat-value cyan" data-testid="current-lap-time">
          {runningLap !== null ? runningLap.toFixed(1) : "-"}
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
          {formatGap(driver.gap_to_leader)}
        </div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Gap Ahead</div>
        <div className="pitwall-stat-value">
          {formatGap(driver.gap_to_ahead)}
        </div>
      </div>
      {[driver.speed_i1, driver.speed_i2, driver.speed_fl, driver.speed_st].some((s) => s !== null) && (
        <div className="pitwall-speed-traps" data-testid="speed-traps">
          <div className="pitwall-stat">
            <div className="pitwall-stat-label">Speed I1 / I2</div>
            <div className="pitwall-stat-value cyan">
              {driver.speed_i1?.toFixed(0) ?? "-"} / {driver.speed_i2?.toFixed(0) ?? "-"} km/h
            </div>
          </div>
          <div className="pitwall-stat">
            <div className="pitwall-stat-label">Finish Line / Speed Trap</div>
            <div className="pitwall-stat-value cyan">
              {driver.speed_fl?.toFixed(0) ?? "-"} / {driver.speed_st?.toFixed(0) ?? "-"} km/h
            </div>
          </div>
        </div>
      )}
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
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Team Radio</div>
      </div>
      {radioClips.length === 0 ? (
        <p>No team radio yet.</p>
      ) : (
        <ul className="pitwall-radio-list" data-testid="selected-driver-radio">
          {radioClips.map((clip, i) => (
            <li key={`${clip.timestamp}-${i}`} className="pitwall-radio-row">
              <audio controls src={clip.url} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
