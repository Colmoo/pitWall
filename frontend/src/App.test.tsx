import { render, screen } from "@testing-library/react";
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

test("renders all panels simultaneously with no tab switching", () => {
  render(<App />);
  // TimingTower, TireStrategy, and SectorTimes each show their own "waiting" message at once
  expect(screen.getAllByText(/waiting for session data/i).length).toBeGreaterThanOrEqual(3);
  // Track Map shows its own independent placeholder
  expect(screen.getByText(/start a session/i)).toBeInTheDocument();
  // Overview panel is present
  expect(screen.getByText(/overview/i)).toBeInTheDocument();
});

test("replay and live controls remain visible alongside all panels", () => {
  render(<App />);
  expect(screen.getByRole("button", { name: /start replay/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /start live/i })).toBeInTheDocument();
});

test("renders Race Engineer Notes and AI Chat panels alongside everything else", () => {
  render(<App />);
  expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/ask a question/i)).toBeInTheDocument();
});
