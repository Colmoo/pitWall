import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SectorTimes } from "./SectorTimes";
import type { SessionState } from "../types";

function driver(
  num: string,
  abbr: string,
  s1: number,
  s2: number,
  s3: number,
  microSectors: string[][] = [],
): SessionState["drivers"][number] {
  return {
    driver_number: num, abbreviation: abbr, team: "Team", position: 1,
    gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
    tire: { compound: "SOFT", age_laps: 1 }, x: null, y: null,
    lap_number: 5, sector_1_time: s1, sector_2_time: s2, sector_3_time: s3,
    micro_sectors: microSectors, flying_lap: null, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
  };
}

test("renders one row per driver with sector times", () => {
  const state: SessionState = {
    timestamp: "t1", track_status: "green",
    drivers: [driver("1", "VER", 28.0, 32.0, 31.0), driver("44", "HAM", 28.5, 31.5, 31.2)],
    weather: null,
    race_control_messages: [],
    team_radio: [],
  };
  render(<SectorTimes state={state} />);
  expect(screen.getByText("VER")).toBeInTheDocument();
  expect(screen.getByText("28.000")).toBeInTheDocument();
});

test("marks the session-best sector time cell", () => {
  const state: SessionState = {
    timestamp: "t1", track_status: "green",
    drivers: [driver("1", "VER", 28.0, 32.0, 31.0), driver("44", "HAM", 27.5, 31.5, 31.2)],
    weather: null,
    race_control_messages: [],
    team_radio: [],
  };
  render(<SectorTimes state={state} />);
  expect(screen.getByTestId("sector1-best-44")).toBeInTheDocument();
});

test("shows a placeholder when there is no state yet", () => {
  render(<SectorTimes state={null} />);
  expect(screen.getByText(/waiting for session data/i)).toBeInTheDocument();
});

test("renders one block per micro sector under its own sector column, colored by status", () => {
  const state: SessionState = {
    timestamp: "t1", track_status: "green",
    drivers: [driver("1", "VER", 28.0, 32.0, 31.0, [["purple", "green"], ["yellow"], ["none"]])],
    weather: null,
    race_control_messages: [],
    team_radio: [],
  };
  render(<SectorTimes state={state} />);
  const s1Blocks = screen.getByTestId("sector1-best-1-micro").children;
  expect(s1Blocks).toHaveLength(2);
  expect(s1Blocks[0]).toHaveClass("purple");
  expect(s1Blocks[1]).toHaveClass("green");

  const s3Blocks = screen.getByTestId("sector3-best-1-micro").children;
  expect(s3Blocks).toHaveLength(1);
  expect(s3Blocks[0]).toHaveClass("gray");
});
