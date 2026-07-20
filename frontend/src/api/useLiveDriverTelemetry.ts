import { useMemo } from "react";
import type { SessionState } from "../types";
import type { Traces } from "./useDriverLapTelemetry";

// ponytail: cap to the most recent samples so the trace stays readable and
// cheap to redraw over a long live session; raise if a longer window is needed.
const MAX_SAMPLES = 300;

export function useLiveDriverTelemetry(
  history: SessionState[],
  driver: string | null,
  lapNumber: number | null,
): Traces | null {
  return useMemo(() => {
    if (!driver) return null;
    const samples = history
      .map((state) => state.drivers.find((d) => d.driver_number === driver))
      .filter(
        (d): d is NonNullable<typeof d> =>
          d != null && d.speed != null && (lapNumber == null || d.lap_number === lapNumber),
      )
      .slice(-MAX_SAMPLES);
    if (samples.length === 0) return null;
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
