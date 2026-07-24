import { useMemo, useRef } from "react";
import type { SessionState } from "../types";
import { tireColor } from "../constants";

type Stint = { compound: string; startLap: number; endLap: number };

function stintsFromLapMap(lapEntries: Map<number, string> | undefined): Stint[] {
  if (!lapEntries) return [];
  const laps = [...lapEntries.keys()].sort((a, b) => a - b);

  const stints: Stint[] = [];
  for (const lap of laps) {
    const compound = lapEntries.get(lap) as string;
    const current = stints[stints.length - 1];
    if (current && current.compound === compound && lap === current.endLap + 1) {
      current.endLap = lap;
    } else {
      stints.push({ compound, startLap: lap, endLap: lap });
    }
  }
  return stints;
}

export function TireStrategy({ history }: { history: SessionState[] }) {
  // ponytail: raw `history` is a bounded rolling window (see useSessionSocket).
  // Accumulate each driver's lap->compound map append-only in a ref so stints
  // cover the WHOLE session even after early ticks roll off. Only new states
  // are scanned per render; stints rebuild from the compact per-driver maps.
  const accRef = useRef<{ last: SessionState | null; byDriver: Map<string, Map<number, string>>; maxLap: number }>({
    last: null,
    byDriver: new Map(),
    maxLap: 0,
  });

  const { byDriver, maxLap } = useMemo(() => {
    const acc = accRef.current;
    let start = 0;
    if (acc.last !== null) {
      const found = history.indexOf(acc.last);
      // marker missing => history reset (or window jumped past it): rebuild.
      if (found === -1) {
        acc.byDriver = new Map();
        acc.maxLap = 0;
      } else {
        start = found + 1;
      }
    }
    for (let i = start; i < history.length; i++) {
      for (const d of history[i].drivers) {
        if (d.lap_number === null) continue;
        let laps = acc.byDriver.get(d.driver_number);
        if (!laps) {
          laps = new Map();
          acc.byDriver.set(d.driver_number, laps);
        }
        laps.set(d.lap_number, d.tire.compound);
        if (d.lap_number > acc.maxLap) acc.maxLap = d.lap_number;
      }
    }
    if (history.length > 0) acc.last = history[history.length - 1];
    return { byDriver: acc.byDriver, maxLap: acc.maxLap };
  }, [history]);

  if (history.length === 0) {
    return <p>Waiting for session data...</p>;
  }

  const latestTick = history[history.length - 1];
  const driverNumbers = [...new Set(latestTick.drivers.map((d) => d.driver_number))];
  const totalLaps = Math.max(1, maxLap);

  return (
    <div>
      {driverNumbers.map((driverNumber) => {
        const driver = latestTick.drivers.find((d) => d.driver_number === driverNumber);
        const stints = stintsFromLapMap(byDriver.get(driverNumber));
        return (
          <div key={driverNumber} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ width: 40, flexShrink: 0 }}>{driver?.abbreviation}</span>
            <div style={{ display: "flex", flex: 1, gap: 1 }}>
              {stints.map((stint) => {
                const laps = stint.endLap - stint.startLap + 1;
                return (
                  <div
                    key={`${stint.compound}-${stint.startLap}`}
                    data-testid={`stint-${driverNumber}-${stint.compound}-${stint.startLap}-${stint.endLap}`}
                    title={`${stint.compound} (${stint.startLap}-${stint.endLap})`}
                    style={{
                      flex: `${laps} 0 0`,
                      padding: "2px 4px",
                      background: tireColor(stint.compound),
                      color: "#050607",
                      fontSize: 10,
                      fontWeight: 700,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "clip",
                    }}
                  >
                    {laps > 1 ? `${stint.startLap}-${stint.endLap}` : stint.startLap}
                  </div>
                );
              })}
              <div
                className="pitwall-tire-remaining"
                style={{ flex: `${totalLaps - (stints[stints.length - 1]?.endLap ?? 0)} 0 0` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
