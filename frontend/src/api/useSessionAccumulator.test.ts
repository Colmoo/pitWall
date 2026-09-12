import { renderHook } from "@testing-library/react";
import { useSessionAccumulator } from "./useSessionAccumulator";
import type { SessionState } from "../types";

function tick(lap: number): SessionState {
  return {
    timestamp: `t${lap}`,
    track_status: "green",
    drivers: [
      {
        driver_number: "1", abbreviation: "VER", team: "Red Bull", position: 1,
        gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
        tire: { compound: "SOFT", age_laps: 1 }, x: null, y: null,
        lap_number: lap, sector_1_time: null, sector_2_time: null, sector_3_time: null,
        micro_sectors: [], flying_lap: null, speed: null, throttle: null, brake: null,
        gear: null, rpm: null, drs: null,
      },
    ],
    weather: null,
    race_control_messages: [],
    team_radio: [],
  };
}

const collectLaps = (acc: number[], s: SessionState) => {
  acc.push(s.drivers[0].lap_number as number);
};

function renderAcc(history: SessionState[], resetKey?: unknown) {
  return renderHook(
    ({ h, k }: { h: SessionState[]; k?: unknown }) =>
      useSessionAccumulator<number[]>(h, () => [], collectLaps, k),
    { initialProps: { h: history, k: resetKey } },
  );
}

test("folds each state exactly once across renders", () => {
  const states = [tick(1), tick(2), tick(3)];
  const { result, rerender } = renderAcc(states.slice(0, 2));
  expect(result.current).toEqual([1, 2]);

  rerender({ h: states, k: undefined });
  expect(result.current).toEqual([1, 2, 3]);
});

test("keeps early data after it rolls off the bounded window", () => {
  const states = [tick(1), tick(2), tick(3)];
  const { result, rerender } = renderAcc(states.slice(0, 2));

  // window rolls: lap 1 dropped, lap 2 retained as the marker, lap 3 appended.
  rerender({ h: states.slice(1), k: undefined });
  expect(result.current).toEqual([1, 2, 3]);
});

test("does not double-count the marker when several states roll off at once", () => {
  const states = [tick(1), tick(2), tick(3), tick(4), tick(5)];
  const { result, rerender } = renderAcc(states.slice(0, 3));
  expect(result.current).toEqual([1, 2, 3]);

  // laps 1-2 drop; the marker (lap 3) is now at the FRONT of the window.
  rerender({ h: states.slice(2), k: undefined });
  expect(result.current).toEqual([1, 2, 3, 4, 5]);
});

test("rebuilds from the window when the marker is gone entirely", () => {
  const { result, rerender } = renderAcc([tick(1), tick(2)]);

  // a whole new session: nothing in the window is the marker.
  rerender({ h: [tick(9)], k: undefined });
  expect(result.current).toEqual([9]);
});

test("starts over when the reset key changes", () => {
  const states = [tick(1), tick(2)];
  const { result, rerender } = renderAcc(states, "44");
  expect(result.current).toEqual([1, 2]);

  rerender({ h: states, k: "1" });
  expect(result.current).toEqual([1, 2]);
  // same states, fresh accumulator - not 4 entries.
  expect(result.current).toHaveLength(2);
});

test("survives a consumer unmounting and remounting", () => {
  // The whole point of owning this above the tab switch: a dashboard unmount
  // must not silently rebuild the accumulator from a short window.
  const states = [tick(1), tick(2), tick(3)];
  const { result, rerender, unmount } = renderAcc(states.slice(0, 2));
  expect(result.current).toEqual([1, 2]);

  // App itself never unmounts, so the hook keeps folding while a panel is gone.
  rerender({ h: states, k: undefined });
  unmount();
  expect(result.current).toEqual([1, 2, 3]);
});
