import type { SessionState } from "../types";

export function TeamRadioPanel({ state }: { state: SessionState | null }) {
  const clips = state?.team_radio ?? [];

  if (clips.length === 0) {
    return <p>No team radio yet.</p>;
  }

  const mostRecentFirst = [...clips].reverse();

  return (
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
  );
}
