import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TelemetryTab } from "./TelemetryTab";
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
      gap_to_leader: null, gap_to_ahead: null, last_lap_time: 90, best_lap_time: 90,
      tire: { compound: "SOFT", age_laps: 3 }, x: null, y: null,
      lap_number: 5, sector_1_time: null, sector_2_time: null, sector_3_time: null,
    micro_sectors: [], flying_lap: null, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
    },
    {
      driver_number: "44", abbreviation: "HAM", team: "Mercedes", position: 2,
      gap_to_leader: 2, gap_to_ahead: 2, last_lap_time: 91, best_lap_time: 91,
      tire: { compound: "MEDIUM", age_laps: 5 }, x: null, y: null,
      lap_number: 5, sector_1_time: null, sector_2_time: null, sector_3_time: null,
    micro_sectors: [], flying_lap: null, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
    },
  ],
};

const sessionParams = { year: 2023, event: "British Grand Prix", sessionType: "R" };

function mockTelemetryFetch() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ distance: [0, 10], speed: [250, 260], throttle: [100, 100], brake: [false, false], gear: [6, 6], rpm: [11000, 11200] }),
  });
}

test("adds a driver as a comparison selection and fetches their current-lap telemetry", async () => {
  mockTelemetryFetch();
  render(<TelemetryTab sessionParams={sessionParams} state={sampleState} history={[sampleState]} />);

  fireEvent.click(screen.getByText("VER"));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("driver=1")));
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("lap_number=5"));
  expect(screen.getByText(/VER.*lap 5/i)).toBeInTheDocument();
});

test("overlays two selections' speed traces and removes one on request", async () => {
  mockTelemetryFetch();
  render(<TelemetryTab sessionParams={sessionParams} state={sampleState} history={[sampleState]} />);

  fireEvent.click(screen.getByText("VER"));
  fireEvent.click(screen.getByText("HAM"));

  await waitFor(() => expect(screen.getByTestId("telemetry-overlay-speed").querySelectorAll("polyline")).toHaveLength(2));

  fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);

  await waitFor(() => expect(screen.getByTestId("telemetry-overlay-speed").querySelectorAll("polyline")).toHaveLength(1));
});

test("editing a selection's lap number refetches that selection's telemetry", async () => {
  mockTelemetryFetch();
  render(<TelemetryTab sessionParams={sessionParams} state={sampleState} history={[sampleState]} />);

  fireEvent.click(screen.getByText("VER"));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("lap_number=5")));

  fireEvent.change(screen.getByLabelText(/lap number/i), { target: { value: "3" } });

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("lap_number=3")));
});

test("live mode adds a driver comparison sourced from session history, filterable by lap number", async () => {
  const liveHistory: SessionState[] = [
    { ...sampleState, drivers: sampleState.drivers.map((d) => ({ ...d, lap_number: 5, speed: 250, throttle: 100, brake: false, gear: 6, rpm: 11000 })) },
    { ...sampleState, drivers: sampleState.drivers.map((d) => ({ ...d, lap_number: 5, speed: 260, throttle: 100, brake: false, gear: 6, rpm: 11200 })) },
    { ...sampleState, drivers: sampleState.drivers.map((d) => ({ ...d, lap_number: 6, speed: 270, throttle: 100, brake: false, gear: 6, rpm: 11300 })) },
  ];
  // "latest" state has VER on lap 6 - that's the lap a new selection defaults to.
  render(<TelemetryTab sessionParams={null} state={liveHistory[2]} history={liveHistory} />);

  fireEvent.click(screen.getByText("VER"));

  expect(screen.getByText(/VER.*lap 6/i)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("telemetry-overlay-speed").querySelectorAll("polyline")).toHaveLength(1));

  // lap 5 has its own samples earlier in history - still resolves.
  fireEvent.change(screen.getByLabelText(/lap number/i), { target: { value: "5" } });
  await waitFor(() => expect(screen.getByTestId("telemetry-overlay-speed").querySelectorAll("polyline")).toHaveLength(1));

  // a lap that hasn't happened yet in this driver's history has no trace.
  fireEvent.change(screen.getByLabelText(/lap number/i), { target: { value: "9" } });
  await waitFor(() => expect(screen.getByTestId("telemetry-overlay-speed").querySelectorAll("polyline")).toHaveLength(0));
});

test("shows a no-data note instead of a permanently blank chart when the telemetry request fails", async () => {
  // Regression test: a backend 500 (e.g. car data not published yet for a
  // very recent session) used to leave the fetch promise unresolved forever,
  // so the chart stayed silently blank with no feedback at all.
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  render(<TelemetryTab sessionParams={sessionParams} state={sampleState} history={[sampleState]} />);

  fireEvent.click(screen.getByText("VER"));

  await waitFor(() => expect(screen.getByText(/no telemetry for this lap/i)).toBeInTheDocument());
  expect(screen.getByTestId("telemetry-overlay-speed").querySelector("polyline")).toHaveAttribute("points", "");
});
