import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TelemetryStack } from "./TelemetryStack";
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
  ],
};

test("fetches and renders traces for the selected driver's current lap", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ distance: [0, 10], speed: [250, 260], throttle: [100, 100], brake: [false, false], gear: [6, 6], rpm: [11000, 11200] }),
  });

  render(
    <TelemetryStack
      sessionParams={{ year: 2023, event: "British Grand Prix", sessionType: "R" }}
      state={sampleState}
      history={[sampleState]}
      selectedDriver="1"
    />,
  );

  await waitFor(() => expect(screen.getByTestId("telemetry-trace-speed")).toBeInTheDocument());
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/session/telemetry"));
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("driver=1"));
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("lap_number=5"));
});

test("shows waiting message in live mode with no telemetry yet", () => {
  render(<TelemetryStack sessionParams={null} state={sampleState} history={[sampleState]} selectedDriver="1" />);
  expect(screen.getByText(/waiting for live telemetry/i)).toBeInTheDocument();
});

test("renders live telemetry traces from session history in live mode", () => {
  const liveHistory: SessionState[] = [
    { ...sampleState, drivers: [{ ...sampleState.drivers[0], speed: 250, throttle: 100, brake: false, gear: 6, rpm: 11000 }] },
    { ...sampleState, drivers: [{ ...sampleState.drivers[0], speed: 260, throttle: 100, brake: false, gear: 6, rpm: 11200 }] },
  ];
  render(<TelemetryStack sessionParams={null} state={liveHistory[1]} history={liveHistory} selectedDriver="1" />);
  expect(screen.getByTestId("telemetry-trace-speed")).toBeInTheDocument();
});

test("shows placeholder when no driver is selected", () => {
  render(
    <TelemetryStack
      sessionParams={{ year: 2023, event: "British Grand Prix", sessionType: "R" }}
      state={sampleState}
      history={[sampleState]}
      selectedDriver={null}
    />,
  );
  expect(screen.getByText(/select a driver/i)).toBeInTheDocument();
});
