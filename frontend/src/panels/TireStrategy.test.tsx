import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TireStrategy } from "./TireStrategy";
import type { SessionState } from "../types";

// The append-only lap->compound accumulation lives in useSessionAccumulator
// (App owns it) - see useSessionAccumulator.test.ts.

function driver(number: string, abbreviation: string) {
  return {
    driver_number: number, abbreviation, team: "Red Bull", position: 1,
    gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
    tire: { compound: "SOFT", age_laps: 1 }, x: null, y: null,
    lap_number: 1, sector_1_time: null, sector_2_time: null, sector_3_time: null,
    micro_sectors: [], flying_lap: null, speed: null, throttle: null, brake: null,
    gear: null, rpm: null, drs: null,
  };
}

function stateWith(...drivers: ReturnType<typeof driver>[]): SessionState {
  return {
    timestamp: "t1",
    track_status: "green",
    drivers,
    weather: null,
    race_control_messages: [],
    team_radio: [],
  };
}

// lap -> compound, the shape the accumulator hands over
function laps(entries: [number, string][]): Map<string, Map<number, string>> {
  return new Map([["1", new Map(entries)]]);
}

test("collapses consecutive same-compound laps into one stint", () => {
  const byDriver = laps([[1, "SOFT"], [2, "SOFT"], [3, "SOFT"]]);
  render(<TireStrategy state={stateWith(driver("1", "VER"))} byDriver={byDriver} maxLap={3} />);
  expect(screen.getByTestId("stint-1-SOFT-1-3")).toBeInTheDocument();
});

test("splits into multiple stints on a compound change", () => {
  const byDriver = laps([[1, "SOFT"], [2, "SOFT"], [3, "MEDIUM"]]);
  render(<TireStrategy state={stateWith(driver("1", "VER"))} byDriver={byDriver} maxLap={3} />);
  expect(screen.getByTestId("stint-1-SOFT-1-2")).toBeInTheDocument();
  expect(screen.getByTestId("stint-1-MEDIUM-3-3")).toBeInTheDocument();
});

test("shows a placeholder when there is no session data yet", () => {
  render(<TireStrategy state={null} byDriver={new Map()} maxLap={0} />);
  expect(screen.getByText(/waiting for session data/i)).toBeInTheDocument();
});

test("colors each stint segment by tire compound", () => {
  const byDriver = laps([[1, "SOFT"], [2, "SOFT"]]);
  render(<TireStrategy state={stateWith(driver("1", "VER"))} byDriver={byDriver} maxLap={2} />);
  expect(screen.getByTestId("stint-1-SOFT-1-2")).toHaveStyle({ background: "#e10600" });
});

test("shows the start and end lap on each stint", () => {
  const byDriver = laps([[1, "SOFT"], [2, "SOFT"], [3, "MEDIUM"]]);
  render(<TireStrategy state={stateWith(driver("1", "VER"))} byDriver={byDriver} maxLap={3} />);
  expect(screen.getByTestId("stint-1-SOFT-1-2")).toHaveTextContent("1-2");
  expect(screen.getByTestId("stint-1-MEDIUM-3-3")).toHaveTextContent("3");
});

test("shows a distinct background for laps not yet run by a driver", () => {
  // VER is on lap 3, HAM has run nothing - HAM's row is all "remaining".
  const byDriver = laps([[1, "SOFT"], [2, "SOFT"], [3, "SOFT"]]);
  render(
    <TireStrategy
      state={stateWith(driver("1", "VER"), driver("44", "HAM"))}
      byDriver={byDriver}
      maxLap={3}
    />,
  );
  expect(document.querySelector(".pitwall-tire-remaining")).toBeInTheDocument();
});
