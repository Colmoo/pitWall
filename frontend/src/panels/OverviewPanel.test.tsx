import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OverviewPanel } from "./OverviewPanel";
import type { SessionState } from "../types";

test("shows placeholder dashes when no state yet", () => {
  render(<OverviewPanel state={null} />);
  expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
});

test("shows track status, leader, and lap from the latest state", () => {
  const state: SessionState = {
    timestamp: "t1",
    track_status: "yellow",
    drivers: [
      {
        driver_number: "1", abbreviation: "VER", team: "Red Bull", position: 1,
        gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
        tire: { compound: "SOFT", age_laps: 1 }, x: null, y: null,
        lap_number: 12, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      micro_sectors: [], flying_lap: null, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
      },
    ],
    weather: null,
    race_control_messages: [],
  team_radio: [],
  };
  render(<OverviewPanel state={state} />);
  expect(screen.getByText("YELLOW")).toBeInTheDocument();
  expect(screen.getByText("VER")).toBeInTheDocument();
  expect(screen.getByText("12")).toBeInTheDocument();
});

test("replaces every underscore in a multi-word track status and colors it yellow", () => {
  const state: SessionState = {
    timestamp: "t1",
    track_status: "virtual_safety_car",
    drivers: [],
    weather: null,
    race_control_messages: [],
  team_radio: [],
  };
  render(<OverviewPanel state={state} />);
  const value = screen.getByText("VIRTUAL SAFETY CAR");
  expect(value).toBeInTheDocument();
  expect(value.textContent).not.toContain("_");
  expect(value).toHaveClass("yellow");
});

test("colors a red flag status red", () => {
  const state: SessionState = {
    timestamp: "t1",
    track_status: "red",
    drivers: [],
    weather: null,
    race_control_messages: [],
  team_radio: [],
  };
  render(<OverviewPanel state={state} />);
  const value = screen.getByText("RED");
  expect(value).toHaveClass("red");
});
