import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TimingTower } from "./TimingTower";
import type { SessionState } from "../types";
import { vi } from "vitest";

const sampleState: SessionState = {
  timestamp: "2026-07-07T13:00:00Z",
  track_status: "green",
  drivers: [
    {
      driver_number: "1", abbreviation: "VER", team: "Red Bull", position: 1,
      gap_to_leader: null, gap_to_ahead: null, last_lap_time: 90.5, best_lap_time: 90.1,
      tire: { compound: "SOFT", age_laps: 3 }, x: null, y: null,
      lap_number: null, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      micro_sectors: [], flying_lap: true, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
    },
    {
      driver_number: "44", abbreviation: "HAM", team: "Mercedes", position: 2,
      gap_to_leader: null, gap_to_ahead: null, last_lap_time: 91.2, best_lap_time: 90.8,
      tire: { compound: "MEDIUM", age_laps: 5 }, x: null, y: null,
      lap_number: null, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      micro_sectors: [], flying_lap: false, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
    },
  ],
  weather: null,
  race_control_messages: [],
  team_radio: [],
};

test("renders drivers sorted by position with tire and lap info", () => {
  render(<TimingTower state={sampleState} selectedDriver={null} onSelectDriver={vi.fn()} />);
  const rows = screen.getAllByRole("row");
  expect(rows).toHaveLength(3); // header + 2 drivers
  expect(screen.getByText("VER")).toBeInTheDocument();
  expect(screen.getByText("SOFT (3)")).toBeInTheDocument();
});

test("renders empty message when state is null", () => {
  render(<TimingTower state={null} selectedDriver={null} onSelectDriver={vi.fn()} />);
  expect(screen.getByText(/waiting for session data/i)).toBeInTheDocument();
});

test("highlights the selected driver's row", () => {
  render(<TimingTower state={sampleState} selectedDriver="1" onSelectDriver={vi.fn()} />);
  const row = screen.getByText("VER").closest("tr");
  expect(row).toHaveClass("pitwall-row-selected");
});

test("clicking a row calls onSelectDriver with that driver's number", () => {
  const onSelectDriver = vi.fn();
  render(<TimingTower state={sampleState} selectedDriver={null} onSelectDriver={onSelectDriver} />);
  fireEvent.click(screen.getByText("HAM").closest("tr")!);
  expect(onSelectDriver).toHaveBeenCalledWith("44");
});

test("shows a push/in-out badge per driver based on flying_lap", () => {
  render(<TimingTower state={sampleState} selectedDriver={null} onSelectDriver={vi.fn()} />);
  expect(screen.getByText("PUSH")).toBeInTheDocument();
  expect(screen.getByText("IN/OUT")).toBeInTheDocument();
});

test("toggling fastest lap only emphasizes the best lap column", () => {
  render(<TimingTower state={sampleState} selectedDriver={null} onSelectDriver={vi.fn()} />);
  const toggle = screen.getByLabelText(/fastest lap only/i);
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(toggle).toBeChecked();
});
