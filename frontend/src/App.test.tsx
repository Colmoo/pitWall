import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import App from "./App";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    FakeWebSocket.instances.push(this);
  }
  close() {}
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/meta/years")) return Promise.resolve({ ok: true, json: async () => ({ years: [2023] }) });
    if (url.includes("/meta/events")) return Promise.resolve({ ok: true, json: async () => ({ events: ["British Grand Prix"] }) });
    if (url.includes("/meta/sessions")) return Promise.resolve({ ok: true, json: async () => ({ sessions: ["Race"] }) });
    if (url.includes("/session/replay")) return Promise.resolve({ ok: true, json: async () => ({ status: "started", states: 0 }) });
    if (url.includes("/session/live")) return Promise.resolve({ ok: true, json: async () => ({ status: "started" }) });
    if (url.includes("/session/track-layout")) return Promise.resolve({ ok: true, json: async () => ({ points: [] }) });
    if (url.includes("/session/telemetry"))
      return Promise.resolve({
        ok: true,
        json: async () => ({
          distance: [0, 100, 200],
          speed: [0, 50, 100],
          throttle: [0, 50, 100],
          brake: [false, false, true],
          gear: [0, 1, 2],
          rpm: [0, 2000, 4000],
        }),
      });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
});

async function startReplay() {
  render(<App />);
  await waitFor(() => expect(screen.getByLabelText(/year/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/year/i), { target: { value: "2023" } });
  await waitFor(() => expect(screen.getByText("British Grand Prix")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/track/i), { target: { value: "British Grand Prix" } });
  await waitFor(() => expect(screen.getByText("Race")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/session/i), { target: { value: "Race" } });
  fireEvent.click(screen.getByRole("button", { name: /start replay/i }));
  await waitFor(() => expect(screen.queryByLabelText(/year/i)).not.toBeInTheDocument());
}

test("shows the landing page before a session starts", () => {
  render(<App />);
  expect(screen.getByText(/select year/i)).toBeInTheDocument();
});

test("renders all panels simultaneously after starting a replay session", async () => {
  await startReplay();
  // TimingTower, TireStrategy, and SectorTimes each show their own "waiting" message at once
  expect(screen.getAllByText(/waiting for session data/i).length).toBeGreaterThanOrEqual(3);
  expect(screen.getByText(/overview/i)).toBeInTheDocument();
});

test("renders Race Engineer Notes and AI Chat panels alongside everything else", async () => {
  await startReplay();
  expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/ask a question/i)).toBeInTheDocument();
});

test("switches to the telemetry tab and back without losing dashboard state", async () => {
  await startReplay();
  expect(screen.getByText(/overview/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /^telemetry$/i }));
  expect(screen.queryByText(/overview/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /^dashboard$/i }));
  expect(screen.getByText(/overview/i)).toBeInTheDocument();
});

function driverState(position: number, driverNumber: string, abbreviation: string) {
  return {
    driver_number: driverNumber, abbreviation, team: "Red Bull Racing", position,
    gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
    tire: { compound: "SOFT", age_laps: 1 }, x: null, y: null,
    lap_number: 1, sector_1_time: null, sector_2_time: null, sector_3_time: null,
  };
}

test("auto-selects the race leader once session data arrives and highlights their timing tower row", async () => {
  await startReplay();
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  act(() => {
    socket.onmessage?.({
      data: JSON.stringify({
        timestamp: "t1",
        track_status: "green",
        weather: null,
        race_control_messages: [],
        drivers: [driverState(1, "1", "VER"), driverState(2, "44", "HAM")],
      }),
    });
  });

  await waitFor(() => {
    const row = screen.getAllByText("VER").map((el) => el.closest("tr.pitwall-row-selectable")).find(Boolean);
    expect(row).toHaveClass("pitwall-row-selected");
  });
});

test("telemetry tab lets you add a driver comparison selection", async () => {
  await startReplay();
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  act(() => {
    socket.onmessage?.({
      data: JSON.stringify({
        timestamp: "t1",
        track_status: "green",
        weather: null,
        race_control_messages: [],
        drivers: [driverState(1, "1", "VER"), driverState(2, "44", "HAM")],
      }),
    });
  });

  fireEvent.click(screen.getByRole("button", { name: /^telemetry$/i }));
  await waitFor(() => expect(screen.getAllByText("VER").length).toBeGreaterThan(0));

  fireEvent.click(screen.getAllByText("VER")[0]);
  await waitFor(() => expect(screen.getByText(/VER.*lap 1/i)).toBeInTheDocument());
});
