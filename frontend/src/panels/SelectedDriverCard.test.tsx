import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SelectedDriverCard } from "./SelectedDriverCard";
import type { SessionState } from "../types";

const sampleState: SessionState = {
  timestamp: "t1",
  track_status: "green",
  weather: null,
  race_control_messages: [],
  team_radio: [],
  drivers: [
    {
      driver_number: "1", abbreviation: "VER", team: "Red Bull Racing", position: 1,
      gap_to_leader: null, gap_to_ahead: null, last_lap_time: 90.5, best_lap_time: 90.1,
      tire: { compound: "SOFT", age_laps: 3 }, x: null, y: null,
      lap_number: 12, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      micro_sectors: [], flying_lap: null, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
    },
    {
      driver_number: "44", abbreviation: "HAM", team: "Mercedes", position: 2,
      gap_to_leader: 5.2, gap_to_ahead: 3.1, last_lap_time: 91.2, best_lap_time: 90.8,
      tire: { compound: "MEDIUM", age_laps: 5 }, x: null, y: null,
      lap_number: 12, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      micro_sectors: [], flying_lap: null, speed: 312, throttle: 100, brake: false, gear: 7, rpm: 11500, drs: true,
    },
  ],
};

test("shows the selected driver's stats", () => {
  render(<SelectedDriverCard state={sampleState} selectedDriver="44" />);
  expect(screen.getByText("HAM")).toBeInTheDocument();
  expect(screen.getByText("MEDIUM (5)")).toBeInTheDocument();
  expect(screen.getByText("+5.200")).toBeInTheDocument();
  expect(screen.getByText("+3.100")).toBeInTheDocument();
});

test("shows a live telemetry readout when the driver's speed is populated (live mode)", () => {
  render(<SelectedDriverCard state={sampleState} selectedDriver="44" />);
  expect(screen.getByTestId("live-telemetry")).toBeInTheDocument();
  expect(screen.getByText("312 km/h")).toBeInTheDocument();
});

test("hides the live telemetry readout when speed is null (replay mode)", () => {
  render(<SelectedDriverCard state={sampleState} selectedDriver="1" />);
  expect(screen.queryByTestId("live-telemetry")).not.toBeInTheDocument();
});

test("shows a placeholder when no driver is selected", () => {
  render(<SelectedDriverCard state={sampleState} selectedDriver={null} />);
  expect(screen.getByText(/select a driver/i)).toBeInTheDocument();
});

test("shows a placeholder when there is no session state yet", () => {
  render(<SelectedDriverCard state={null} selectedDriver="1" />);
  expect(screen.getByText(/select a driver/i)).toBeInTheDocument();
});
