import { renderHook } from "@testing-library/react";
import { useLiveDriverTelemetry } from "./useLiveDriverTelemetry";
import type { SessionState, DriverState } from "../types";

function driver(overrides: Partial<DriverState>): DriverState {
  return {
    driver_number: "1", abbreviation: "VER", team: "Red Bull Racing", position: 1,
    gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
    tire: { compound: "SOFT", age_laps: 1 }, x: null, y: null, lap_number: null,
    sector_1_time: null, sector_2_time: null, sector_3_time: null, micro_sectors: [],
    flying_lap: null, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
    ...overrides,
  };
}

function state(drivers: DriverState[]): SessionState {
  return { timestamp: "t", track_status: "green", drivers, weather: null, race_control_messages: [], team_radio: [] };
}

test("returns null when no driver is selected", () => {
  const { result } = renderHook(() => useLiveDriverTelemetry([], null));
  expect(result.current).toBeNull();
});

test("returns null when the driver has no car-data samples yet", () => {
  const history = [state([driver({ speed: null })])];
  const { result } = renderHook(() => useLiveDriverTelemetry(history, "1"))
  expect(result.current).toBeNull();
});

test("builds traces from consecutive session states for the selected driver", () => {
  const history = [
    state([driver({ speed: 250, throttle: 100, brake: false, gear: 6, rpm: 11000 })]),
    state([driver({ speed: 260, throttle: 80, brake: true, gear: 7, rpm: 11500 })]),
  ];
  const { result } = renderHook(() => useLiveDriverTelemetry(history, "1"));
  expect(result.current).toEqual({
    distance: [0, 1],
    speed: [250, 260],
    throttle: [100, 80],
    brake: [false, true],
    gear: [6, 7],
    rpm: [11000, 11500],
  });
});
