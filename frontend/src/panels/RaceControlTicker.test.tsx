import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RaceControlTicker } from "./RaceControlTicker";
import type { SessionState } from "../types";

const stateWithMessages: SessionState = {
  timestamp: "t1",
  track_status: "yellow",
  weather: null,
  drivers: [],
  race_control_messages: [
    { timestamp: "2026-07-09T13:05:00Z", category: "Other", message: "PIT EXIT OPEN", flag: null },
    { timestamp: "2026-07-09T13:10:00Z", category: "Flag", message: "YELLOW FLAG SECTOR 3", flag: "YELLOW" },
  ],
};

test("renders messages newest first", () => {
  render(<RaceControlTicker state={stateWithMessages} />);
  const items = screen.getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("YELLOW FLAG SECTOR 3");
  expect(items[1]).toHaveTextContent("PIT EXIT OPEN");
});

test("highlights flagged messages", () => {
  render(<RaceControlTicker state={stateWithMessages} />);
  const flagged = screen.getByText(/YELLOW FLAG SECTOR 3/);
  expect(flagged).toHaveStyle({ color: "var(--yellow)" });
});

test("shows a placeholder when there are no messages yet", () => {
  render(<RaceControlTicker state={{ ...stateWithMessages, race_control_messages: [] }} />);
  expect(screen.getByText(/no race control messages/i)).toBeInTheDocument();
});
