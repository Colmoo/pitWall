import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TeamRadioPanel } from "./TeamRadioPanel";
import type { SessionState } from "../types";

function driver(num: string, abbr: string): SessionState["drivers"][number] {
  return {
    driver_number: num, abbreviation: abbr, team: "Team", position: 1,
    gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
    tire: { compound: "SOFT", age_laps: 1 }, x: null, y: null,
    lap_number: 5, sector_1_time: null, sector_2_time: null, sector_3_time: null,
    micro_sectors: [], flying_lap: null, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
  };
}

function baseState(overrides: Partial<SessionState>): SessionState {
  return {
    timestamp: "t1", track_status: "green",
    drivers: [driver("1", "VER"), driver("44", "HAM")],
    weather: null, race_control_messages: [], team_radio: [],
    ...overrides,
  };
}

test("shows a placeholder when there are no team radio clips", () => {
  render(<TeamRadioPanel state={baseState({})} />);
  expect(screen.getByText(/no team radio yet/i)).toBeInTheDocument();
});

test("shows a placeholder when there is no session state yet", () => {
  render(<TeamRadioPanel state={null} />);
  expect(screen.getByText(/no team radio yet/i)).toBeInTheDocument();
});

test("lists clips most-recent first with the driver's abbreviation and an audio player", () => {
  const state = baseState({
    team_radio: [
      { timestamp: "t1", driver_number: "1", url: "https://example.com/a.mp3" },
      { timestamp: "t2", driver_number: "44", url: "https://example.com/b.mp3" },
    ],
  });
  render(<TeamRadioPanel state={state} />);
  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("HAM");
  expect(rows[1]).toHaveTextContent("VER");
  const audios = document.querySelectorAll("audio");
  expect(audios).toHaveLength(2);
  expect(audios[0]).toHaveAttribute("src", "https://example.com/b.mp3");
});
