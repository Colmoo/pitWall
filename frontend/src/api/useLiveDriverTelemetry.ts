import { useMemo } from "react";
import type { SessionState } from "../types";
import type { Traces } from "./useDriverLapTelemetry";

// ponytail: cap to the most recent samples so the trace stays readable and
// cheap to redraw over a long live session; raise if a longer window is needed.
// Scanning backwards keeps the cost O(MAX_SAMPLES) rather than O(history);
// switch to an append-only ref if even that shows up in a profile.
const MAX_SAMPLES = 300;

export function useLiveDriverTelemetry(
  history: SessionState[],
  driver: string | null,
  lapNumber: number | null,
): Traces | null {
  return useMemo(() => {
    if (!driver) return null;
    const samples: SessionState["drivers"] = [];
    for (let i = history.length - 1; i >= 0 && samples.length < MAX_SAMPLES; i--) {
      const d = history[i].drivers.find((x) => x.driver_number === driver);
      if (d != null && d.speed != null && (lapNumber == null || d.lap_number === lapNumber)) {
        samples.push(d);
      }
    }
    if (samples.length === 0) return null;
    samples.reverse();
    return {
      distance: samples.map((_, i) => i),
      speed: samples.map((d) => d.speed ?? 0),
      throttle: samples.map((d) => d.throttle ?? 0),
      brake: samples.map((d) => d.brake ?? false),
      gear: samples.map((d) => d.gear ?? 0),
      rpm: samples.map((d) => d.rpm ?? 0),
    };
  }, [history, driver, lapNumber]);
}
