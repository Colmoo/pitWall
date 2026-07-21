import { useState } from "react";
import type { SessionState } from "../types";
import { useRadioAutoplay } from "../api/useRadioAutoplay";

export function TeamRadioPanel({
  state,
  selectedDriver = null,
}: {
  state: SessionState | null;
  selectedDriver?: string | null;
}) {
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);
  const [followedDrivers, setFollowedDrivers] = useState<string[]>([]);
  const { audioRef, nowPlaying, onEnded } = useRadioAutoplay(state, selectedDriver, autoplayEnabled, followedDrivers);

  function toggleFollowed(driverNumber: string) {
    setFollowedDrivers((prev) =>
      prev.includes(driverNumber) ? prev.filter((d) => d !== driverNumber) : [...prev, driverNumber],
    );
  }

  const clips = state?.team_radio ?? [];
  const mostRecentFirst = [...clips].reverse();
  const nowPlayingDriver = state?.drivers.find((d) => d.driver_number === nowPlaying?.driver_number);

  return (
    <div>
      <audio ref={audioRef} onEnded={onEnded} data-testid="radio-autoplay-player" />
      <div className="pitwall-radio-controls">
        <label>
          <input
            type="checkbox"
            checked={autoplayEnabled}
            onChange={(e) => setAutoplayEnabled(e.target.checked)}
          />
          Autoplay radio
        </label>
        {nowPlaying && (
          <span className="pitwall-radio-now-playing">
            🔊 {nowPlayingDriver?.abbreviation ?? nowPlaying.driver_number}
          </span>
        )}
      </div>
      {state && state.drivers.length > 0 && (
        <div className="pitwall-radio-follow-list">
          <span className="pitwall-radio-follow-label">Follow:</span>
          {state.drivers.map((d) => (
            <label key={d.driver_number}>
              <input
                type="checkbox"
                checked={followedDrivers.includes(d.driver_number)}
                onChange={() => toggleFollowed(d.driver_number)}
              />
              {d.abbreviation}
            </label>
          ))}
        </div>
      )}
      {clips.length === 0 ? (
        <p>No team radio yet.</p>
      ) : (
        <ul className="pitwall-radio-list">
          {mostRecentFirst.map((clip, i) => {
            const driver = state?.drivers.find((d) => d.driver_number === clip.driver_number);
            return (
              <li key={`${clip.timestamp}-${i}`} className="pitwall-radio-row">
                <span className="pitwall-radio-driver">{driver?.abbreviation ?? clip.driver_number}</span>
                <audio controls src={clip.url} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
