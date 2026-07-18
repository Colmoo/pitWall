import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

export type Traces = { distance: number[]; speed: number[]; throttle: number[]; brake: boolean[]; gear: number[]; rpm: number[] };

export type TelemetrySessionParams = { year: number; event: string; sessionType: string } | null;

export function useDriverLapTelemetry(
  sessionParams: TelemetrySessionParams,
  driver: string | null,
  lapNumber: number | null,
): Traces | null {
  const [traces, setTraces] = useState<Traces | null>(null);

  useEffect(() => {
    setTraces(null);
    if (!sessionParams || !driver || !lapNumber) return;
    const url =
      `${API_URL}/session/telemetry?year=${sessionParams.year}&event=${encodeURIComponent(sessionParams.event)}` +
      `&session_type=${sessionParams.sessionType}&driver=${driver}&lap_number=${lapNumber}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: Traces) => setTraces(data));
  }, [sessionParams, driver, lapNumber]);

  return traces;
}
