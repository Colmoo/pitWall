import type { SessionState } from "../types";
import { tireColor } from "../constants";

type Stint = { compound: string; startLap: number; endLap: number };

function stintsForDriver(history: SessionState[], driverNumber: string): Stint[] {
  const lapEntries = new Map<number, string>();
  for (const tick of history) {
    const driver = tick.drivers.find((d) => d.driver_number === driverNumber);
    if (driver && driver.lap_number !== null) {
      lapEntries.set(driver.lap_number, driver.tire.compound);
    }
  }
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
  if (history.length === 0) {
    return <p>Waiting for session data...</p>;
  }

  const latestTick = history[history.length - 1];
  const driverNumbers = [...new Set(latestTick.drivers.map((d) => d.driver_number))];
  const totalLaps = Math.max(
    1,
    ...history.flatMap((tick) => tick.drivers.map((d) => d.lap_number ?? 0)),
  );

  return (
    <div>
      {driverNumbers.map((driverNumber) => {
        const driver = latestTick.drivers.find((d) => d.driver_number === driverNumber);
        const stints = stintsForDriver(history, driverNumber);
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
