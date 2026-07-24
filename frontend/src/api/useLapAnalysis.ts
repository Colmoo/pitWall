import { useEffect, useState } from "react";
import type { LapAnalysis } from "../types";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

type SessionParams = { year: number; event: string; sessionType: string } | null;

// Fetches the whole-race per-lap analysis dataset once per session. Replay only:
// live mode has no completed-race lap history to analyse (and no FastF1 load yet).
export function useLapAnalysis(sessionParams: SessionParams): LapAnalysis | null {
  const [data, setData] = useState<LapAnalysis | null>(null);
  useEffect(() => {
    if (!sessionParams) {
      setData(null);
      return;
    }
    let cancelled = false;
    const url = `${API_URL}/session/analysis?year=${sessionParams.year}&event=${encodeURIComponent(sessionParams.event)}&session_type=${sessionParams.sessionType}`;
    fetch(url)
      .then((res) => res.json())
      .then((d: LapAnalysis) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionParams]);
  return data;
}
