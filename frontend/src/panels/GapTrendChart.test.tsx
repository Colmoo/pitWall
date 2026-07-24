import { render, screen } from "@testing-library/react";
import { act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { GapTrendChart } from "./GapTrendChart";
import type { SessionState } from "../types";

function stateWithGap(lap: number, gap: number | null): SessionState {
  return {
    timestamp: `t${lap}`,
    track_status: "green",
    weather: null,
    race_control_messages: [],
    team_radio: [],
    drivers: [
      {
        driver_number: "44", abbreviation: "HAM", team: "Mercedes", position: 2,
        gap_to_leader: gap, gap_to_ahead: gap, last_lap_time: 90, best_lap_time: 90,
        tire: { compound: "MEDIUM", age_laps: lap }, x: null, y: null,
        lap_number: lap, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      micro_sectors: [], flying_lap: null, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
      },
    ],
  };
}

test("draws a line for the selected driver's gap history", () => {
  const history = [stateWithGap(1, 2.0), stateWithGap(2, 2.5), stateWithGap(3, 1.8)];
  render(<GapTrendChart history={history} selectedDriver="44" />);
  expect(screen.getByTestId("gap-trend-line")).toBeInTheDocument();
});

test("shows a placeholder when no driver is selected", () => {
  render(<GapTrendChart history={[]} selectedDriver={null} />);
  expect(screen.getByText(/select a driver/i)).toBeInTheDocument();
});

test("keeps early-session gaps after they roll off the bounded window", () => {
  const s1 = stateWithGap(1, 5.0);
  const s2 = stateWithGap(2, 4.0);
  const s3 = stateWithGap(3, 3.0);
  // first window holds laps 1-2.
  const { rerender } = render(<GapTrendChart history={[s1, s2]} selectedDriver="44" />);
  expect(screen.getByTestId("gap-trend-line").getAttribute("points")?.trim().split(" ")).toHaveLength(2);

  // window rolls: s1 dropped, s2 retained as the marker, s3 appended.
  act(() => {
    rerender(<GapTrendChart history={[s2, s3]} selectedDriver="44" />);
  });
  // s1's gap survives via the append-only accumulator -> 3 points, not 2.
  const coords = screen.getByTestId("gap-trend-line").getAttribute("points")?.trim().split(" ");
  expect(coords).toHaveLength(3);
});

test("skips ticks where the gap is unknown", () => {
  const history = [stateWithGap(1, 2.0), stateWithGap(2, null), stateWithGap(3, 1.8)];
  render(<GapTrendChart history={history} selectedDriver="44" />);
  const line = screen.getByTestId("gap-trend-line");
  // 2 known points -> polyline has exactly 2 coordinate pairs
  expect(line.getAttribute("points")?.trim().split(" ")).toHaveLength(2);
});
