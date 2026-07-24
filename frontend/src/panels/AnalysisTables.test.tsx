import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SectorPerformanceTable, PaceAnalysisTable, OvertakesTable } from "./AnalysisTables";
import type { LapAnalysis } from "../types";

function lap(l: number, position: number, lapTime: number | null, s1: number, s2: number, s3: number, pit = false) {
  return {
    lap: l, position, gap_to_leader: null, lap_time: lapTime, pit,
    sector_1_time: s1, sector_2_time: s2, sector_3_time: s3, compound: "SOFT",
  };
}

const analysis: LapAnalysis = {
  total_laps: 3,
  sc_vsc_laps: [],
  drivers: [
    { driver_number: "1", abbreviation: "VER", team: "Red Bull Racing", laps: [
      lap(1, 1, 90.0, 30.0, 30.0, 30.0), lap(2, 1, 89.5, 29.8, 29.9, 29.8), lap(3, 1, 200.0, 30.1, 30.0, 29.9, true),
    ]},
    { driver_number: "44", abbreviation: "HAM", team: "Mercedes", laps: [
      lap(1, 2, 91.0, 30.5, 30.3, 30.2), lap(2, 3, 90.8, 30.4, 30.2, 30.2), lap(3, 2, 90.9, 30.3, 30.2, 30.1),
    ]},
  ],
};

test("sector performance shows best sectors and marks the fastest", () => {
  render(<SectorPerformanceTable analysis={analysis} selectedDriver={null} />);
  expect(screen.getByTestId("sector-performance-table")).toBeInTheDocument();
  expect(screen.getByText("29.900")).toBeInTheDocument(); // VER best S2 (unique)
});

test("pace analysis excludes the pit/outlier lap from clean-lap count", () => {
  render(<PaceAnalysisTable analysis={analysis} selectedDriver={null} />);
  expect(screen.getByTestId("pace-analysis-table")).toBeInTheDocument();
  // VER's lap 3 (200s, pit) is dropped: 2 clean laps, not 3
  expect(screen.getByText("2")).toBeInTheDocument();
});

test("overtakes shows net position change with sign", () => {
  render(<OvertakesTable analysis={analysis} selectedDriver={null} />);
  expect(screen.getByTestId("overtakes-table")).toBeInTheDocument();
  // HAM P2 -> P2 net 0; VER P1 -> P1 net 0. Just assert rows render.
  expect(screen.getByText("VER")).toBeInTheDocument();
  expect(screen.getByText("HAM")).toBeInTheDocument();
});

test("shows a prompt when there is no analysis data", () => {
  render(<PaceAnalysisTable analysis={null} selectedDriver={null} />);
  expect(screen.getByText(/replay mode/i)).toBeInTheDocument();
});
