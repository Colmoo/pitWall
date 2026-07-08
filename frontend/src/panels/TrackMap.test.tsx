import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TrackMap } from "./TrackMap";
import type { SessionState } from "../types";

test("fetches and renders the track outline for the given session params", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ points: [[0, 0], [10, 0], [10, 10], [0, 10]] }),
  });

  render(<TrackMap state={null} sessionParams={{ year: 2023, event: "Silverstone", sessionType: "R" }} />);

  await waitFor(() => expect(screen.getByTestId("track-outline")).toBeInTheDocument());
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/session/track-layout"));
});

test("shows a placeholder message when no session has been started", () => {
  render(<TrackMap state={null} sessionParams={null} />);
  expect(screen.getByText(/start a session/i)).toBeInTheDocument();
});

test("plots a dot for each driver with known x/y", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ points: [[0, 0], [10, 10]] }),
  });

  const state: SessionState = {
    timestamp: "t1",
    track_status: "green",
    drivers: [
      {
        driver_number: "1", abbreviation: "VER", team: "Red Bull", position: 1,
        gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
        tire: { compound: "SOFT", age_laps: 1 }, x: 5, y: 5,
        lap_number: 1, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      },
    ],
  };

  render(<TrackMap state={state} sessionParams={{ year: 2023, event: "Silverstone", sessionType: "R" }} />);
  await waitFor(() => expect(screen.getByTestId("driver-dot-1")).toBeInTheDocument());
});
