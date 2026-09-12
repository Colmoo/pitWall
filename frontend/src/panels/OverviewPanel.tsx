import { memo } from "react";
import type { SessionState } from "../types";

function statusColorClass(status: SessionState["track_status"] | undefined): string {
  if (status === "green") return "green";
  if (status === "yellow" || status === "safety_car" || status === "virtual_safety_car") return "yellow";
  if (status === "red") return "red";
  return "";
}

export const OverviewPanel = memo(function OverviewPanel({ state }: { state: SessionState | null }) {
  const leader = state && state.drivers.length > 0 ? state.drivers[0] : null;

  return (
    <>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Track Status</div>
        <div className={`pitwall-stat-value ${statusColorClass(state?.track_status)}`}>
          {state ? state.track_status.replaceAll("_", " ").toUpperCase() : "—"}
        </div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Leader</div>
        <div className="pitwall-stat-value cyan">{leader ? leader.abbreviation : "—"}</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Lap</div>
        <div className="pitwall-stat-value">{leader?.lap_number ?? "—"}</div>
      </div>
    </>
  );
});
