import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SelectedDriverCard } from "./SelectedDriverCard";
import type { SessionState } from "../types";

const sampleState: SessionState = {
  timestamp: "t1",
  track_status: "green",
  weather: null,
  race_control_messages: [],
  drivers: [
    {
      driver_number: "1", abbreviation: "VER", team: "Red Bull Racing", position: 1,
      gap_to_leader: null, gap_to_ahead: null, last_lap_time: 90.5, best_lap_time: 90.1,
      tire: { compound: "SOFT", age_laps: 3 }, x: null, y: null,
      lap_number: 12, sector_1_time: null, sector_2_time: null, sector_3_time: null,
    },
    {
      driver_number: "44", abbreviation: "HAM", team: "Mercedes", position: 2,
      gap_to_leader: 5.2, gap_to_ahead: 3.1, last_lap_time: 91.2, best_lap_time: 90.8,
      tire: { compound: "MEDIUM", age_laps: 5 }, x: null, y: null,
      lap_number: 12, sector_1_time: null, sector_2_time: null, sector_3_time: null,
    },
  ],
};

test("shows the selected driver's stats", () => {
  render(<SelectedDriverCard state={sampleState} selectedDriver="44" />);
  expect(screen.getByText("HAM")).toBeInTheDocument();
  expect(screen.getByText("MEDIUM (5)")).toBeInTheDocument();
  expect(screen.getByText("+5.200")).toBeInTheDocument();
});

test("shows a placeholder when no driver is selected", () => {
  render(<SelectedDriverCard state={sampleState} selectedDriver={null} />);
  expect(screen.getByText(/select a driver/i)).toBeInTheDocument();
});

test("shows a placeholder when there is no session state yet", () => {
  render(<SelectedDriverCard state={null} selectedDriver="1" />);
  expect(screen.getByText(/select a driver/i)).toBeInTheDocument();
});
