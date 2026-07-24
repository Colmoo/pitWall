import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  GapVsFieldAverageChart,
  GapToLeaderChart,
  PositionChangesChart,
  LapTimesChart,
} from "./LapCharts";
import type { LapAnalysis } from "../types";

function lap(l: number, gap: number | null, position: number, pit = false) {
  return {
    lap: l, position, gap_to_leader: gap, lap_time: 90 + l * 0.1, pit,
    sector_1_time: null, sector_2_time: null, sector_3_time: null, compound: "SOFT",
  };
}

const analysis: LapAnalysis = {
  total_laps: 3,
  sc_vsc_laps: [[2, 2]],
  drivers: [
    { driver_number: "1", abbreviation: "VER", team: "Red Bull Racing", laps: [lap(1, null, 1), lap(2, null, 1), lap(3, null, 1)] },
    { driver_number: "44", abbreviation: "HAM", team: "Mercedes", laps: [lap(1, 1.0, 2), lap(2, 2.0, 2, true), lap(3, 3.0, 2)] },
  ],
};

test("gap-vs-field draws a line per driver, SC/VSC band and pit marker", () => {
  render(<GapVsFieldAverageChart analysis={analysis} selectedDriver={null} />);
  expect(screen.getByTestId("gap-vs-field-chart")).toBeInTheDocument();
  expect(screen.getByTestId("chart-line-1")).toBeInTheDocument();
  expect(screen.getByTestId("chart-line-44")).toBeInTheDocument();
  expect(screen.getAllByTestId("sc-vsc-band").length).toBe(1);
  expect(screen.getAllByTestId("pit-marker").length).toBe(1);
});

test("gap-to-leader renders", () => {
  render(<GapToLeaderChart analysis={analysis} selectedDriver="44" />);
  expect(screen.getByTestId("gap-to-leader-chart")).toBeInTheDocument();
});

test("position-changes renders inverted position axis", () => {
  render(<PositionChangesChart analysis={analysis} selectedDriver={null} />);
  expect(screen.getByTestId("position-changes-chart")).toBeInTheDocument();
  expect(screen.getAllByText(/^P\d+$/).length).toBeGreaterThan(0);
});

test("lap-times renders", () => {
  render(<LapTimesChart analysis={analysis} selectedDriver={null} />);
  expect(screen.getByTestId("lap-times-chart")).toBeInTheDocument();
});

test("shows a prompt when there is no analysis data", () => {
  render(<GapVsFieldAverageChart analysis={null} selectedDriver={null} />);
  expect(screen.getByText(/replay mode/i)).toBeInTheDocument();
});
