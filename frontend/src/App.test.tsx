import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import App from "./App";

class FakeWebSocket {
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  close() {}
}

beforeEach(() => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ points: [] }) });
});

test("shows Timing Tower by default and switches panels on tab click", () => {
  render(<App />);
  expect(screen.getByText(/waiting for session data/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /tire strategy/i }));
  expect(screen.getAllByText(/waiting for session data/i).length).toBeGreaterThan(0);
});

test("switches to Track Map tab via number key 2", () => {
  render(<App />);
  fireEvent.keyDown(window, { key: "2" });
  expect(screen.getByText(/start a session/i)).toBeInTheDocument();
});
