import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { GapTrendChart } from "./GapTrendChart";

// The append-only accumulation these points come from lives in
// useSessionAccumulator (App owns it) - see useSessionAccumulator.test.ts.

test("draws a line for the selected driver's gap history", () => {
  render(<GapTrendChart points={[2.0, 2.5, 1.8]} selectedDriver="44" />);
  expect(screen.getByTestId("gap-trend-line")).toBeInTheDocument();
});

test("shows a placeholder when no driver is selected", () => {
  render(<GapTrendChart points={[]} selectedDriver={null} />);
  expect(screen.getByText(/select a driver/i)).toBeInTheDocument();
});

test("shows a placeholder when the selected driver has no gaps yet", () => {
  render(<GapTrendChart points={[]} selectedDriver="44" />);
  expect(screen.getByText(/no gap data yet/i)).toBeInTheDocument();
});

test("plots one coordinate pair per accumulated gap", () => {
  render(<GapTrendChart points={[2.0, 1.8]} selectedDriver="44" />);
  const line = screen.getByTestId("gap-trend-line");
  expect(line.getAttribute("points")?.trim().split(" ")).toHaveLength(2);
});
