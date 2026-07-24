import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { GapVsFieldAverageChart } from "./GapVsFieldAverageChart";
import type { LapAnalysis } from "../types";

function lap(l: number, gap: number | null, pit = false) {
  return {
    lap: l, position: 1, gap_to_leader: gap, lap_time: 90, pit,
    sector_1_time: null, sector_2_time: null, sector_3_time: null, compound: "SOFT",
  };
}

const analysis: LapAnalysis = {
  total_laps: 3,
  sc_vsc_laps: [[2, 2]],
  drivers: [
    { driver_number: "1", abbreviation: "VER", team: "Red Bull Racing", laps: [lap(1, null), lap(2, null), lap(3, null)] },
    { driver_number: "44", abbreviation: "HAM", team: "Mercedes", laps: [lap(1, 1.0), lap(2, 2.0, true), lap(3, 3.0)] },
  ],
};

test("draws a line per driver plus the SC/VSC band", () => {
  render(<GapVsFieldAverageChart analysis={analysis} selectedDriver={null} />);
  expect(screen.getByTestId("gap-vs-field-chart")).toBeInTheDocument();
  expect(screen.getByTestId("gap-line-1")).toBeInTheDocument();
  expect(screen.getByTestId("gap-line-44")).toBeInTheDocument();
  expect(screen.getAllByTestId("sc-vsc-band").length).toBe(1);
  expect(screen.getAllByTestId("pit-marker").length).toBe(1);
});

test("shows a prompt when there is no analysis data", () => {
  render(<GapVsFieldAverageChart analysis={null} selectedDriver={null} />);
  expect(screen.getByText(/replay mode/i)).toBeInTheDocument();
});
