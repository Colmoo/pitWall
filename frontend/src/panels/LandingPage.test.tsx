import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LandingPage } from "./LandingPage";

function mockFetchSequence(responses: unknown[]) {
  let call = 0;
  global.fetch = vi.fn().mockImplementation(() => {
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve({ ok: true, json: async () => response });
  });
}

test("loads years on mount, then events after picking a year, then sessions after picking an event", async () => {
  mockFetchSequence([
    { years: [2022, 2023] },
    { events: ["Bahrain Grand Prix", "British Grand Prix"] },
    { sessions: ["Practice 1", "Qualifying", "Race"] },
  ]);

  render(<LandingPage onReplayStarted={vi.fn()} onLiveStarted={vi.fn()} />);

  await waitFor(() => expect(screen.getByLabelText(/year/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/year/i), { target: { value: "2023" } });

  await waitFor(() => expect(screen.getByText("British Grand Prix")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/track/i), { target: { value: "British Grand Prix" } });

  await waitFor(() => expect(screen.getByText("Race")).toBeInTheDocument());
});

test("submitting the session form calls onReplayStarted with the selected year/event/session", async () => {
  mockFetchSequence([
    { years: [2023] },
    { events: ["British Grand Prix"] },
    { sessions: ["Race"] },
    { status: "started", states: 10 },
  ]);
  const onReplayStarted = vi.fn();

  render(<LandingPage onReplayStarted={onReplayStarted} onLiveStarted={vi.fn()} />);

  await waitFor(() => expect(screen.getByLabelText(/year/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/year/i), { target: { value: "2023" } });

  await waitFor(() => expect(screen.getByText("British Grand Prix")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/track/i), { target: { value: "British Grand Prix" } });
  await waitFor(() => expect(screen.getByText("Race")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/session/i), { target: { value: "Race" } });

  fireEvent.click(screen.getByRole("button", { name: /start replay/i }));

  await waitFor(() => expect(onReplayStarted).toHaveBeenCalledWith({ year: 2023, event: "British Grand Prix", sessionType: "Race" }));
});

test("clicking go live calls onLiveStarted without requiring a session pick", async () => {
  mockFetchSequence([{ years: [2023] }, { status: "started" }]);
  const onLiveStarted = vi.fn();

  render(<LandingPage onReplayStarted={vi.fn()} onLiveStarted={onLiveStarted} />);

  await waitFor(() => expect(screen.getByRole("button", { name: /go live/i })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /go live/i }));

  await waitFor(() => expect(onLiveStarted).toHaveBeenCalled());
});

test("disables the start replay button and shows a loading message while the session loads", async () => {
  let resolveReplay: (value: unknown) => void = () => {};
  const replayPromise = new Promise((resolve) => {
    resolveReplay = resolve;
  });
  let call = 0;
  const responses = [{ years: [2023] }, { events: ["British Grand Prix"] }, { sessions: ["Race"] }];
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/session/replay")) return replayPromise.then(() => ({ ok: true, json: async () => ({ status: "started", states: 10 }) }));
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve({ ok: true, json: async () => response });
  });

  render(<LandingPage onReplayStarted={vi.fn()} onLiveStarted={vi.fn()} />);

  await waitFor(() => expect(screen.getByLabelText(/year/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/year/i), { target: { value: "2023" } });
  await waitFor(() => expect(screen.getByText("British Grand Prix")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/track/i), { target: { value: "British Grand Prix" } });
  await waitFor(() => expect(screen.getByText("Race")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/session/i), { target: { value: "Race" } });

  fireEvent.click(screen.getByRole("button", { name: /start replay/i }));

  await waitFor(() => expect(screen.getByRole("button", { name: /loading/i })).toBeDisabled());
  expect(screen.getByText(/first load of a session can take a minute or two/i)).toBeInTheDocument();

  resolveReplay(undefined);
  await waitFor(() => expect(screen.queryByText(/first load of a session can take a minute or two/i)).not.toBeInTheDocument());
});

test("disables the go live button and shows a loading message while it starts", async () => {
  let resolveLive: (value: unknown) => void = () => {};
  const livePromise = new Promise((resolve) => {
    resolveLive = resolve;
  });
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/session/live")) return livePromise.then(() => ({ ok: true, json: async () => ({ status: "started" }) }));
    return Promise.resolve({ ok: true, json: async () => ({ years: [2023] }) });
  });

  render(<LandingPage onReplayStarted={vi.fn()} onLiveStarted={vi.fn()} />);

  await waitFor(() => expect(screen.getByRole("button", { name: /go live/i })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /go live/i }));

  await waitFor(() => expect(screen.getByRole("button", { name: /loading/i })).toBeDisabled());
  expect(screen.getByText(/first load of a session can take a minute or two/i)).toBeInTheDocument();

  resolveLive(undefined);
});
