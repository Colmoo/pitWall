import { useEffect, useRef, useState } from "react";
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
  const lapNumber = driver?.lap_number ?? null;

  // Running current-lap clock: reset when the driver or their lap changes, then
  // tick every 100ms so the card shows the lap time as it's happening.
  // ponytail: wall-clock since lap start assumes ~1x playback; drifts at other
  // replay speeds. Upgrade path: base it on state.timestamp deltas if that matters.
  const lapStartRef = useRef<number>(Date.now());
  const [nowTick, setNowTick] = useState<number>(Date.now());
  useEffect(() => {
    lapStartRef.current = Date.now();
    setNowTick(Date.now());
  }, [selectedDriver, lapNumber]);
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const runningLap = driver && driver.status !== "out" ? (nowTick - lapStartRef.current) / 1000 : null;

  if (!driver) {
    return <p>Select a driver to see details.</p>;
  }

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
