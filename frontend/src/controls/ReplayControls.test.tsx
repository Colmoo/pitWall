import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ReplayControls } from "./ReplayControls";

test("submits replay params and calls onStarted on success", async () => {
  const onStarted = vi.fn();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });

  render(<ReplayControls onStarted={onStarted} />);

  fireEvent.change(screen.getByLabelText(/year/i), { target: { value: "2023" } });
  fireEvent.change(screen.getByLabelText(/event/i), { target: { value: "Silverstone" } });
  fireEvent.change(screen.getByLabelText(/session type/i), { target: { value: "R" } });
  fireEvent.click(screen.getByRole("button", { name: /start replay/i }));

  await waitFor(() => expect(onStarted).toHaveBeenCalledWith({
    year: 2023, event: "Silverstone", sessionType: "R",
  }));

  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/session/replay"),
    expect.objectContaining({ method: "POST" }),
  );
});

test("does not call onStarted when the request fails", async () => {
  const onStarted = vi.fn();
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

  render(<ReplayControls onStarted={onStarted} />);
  fireEvent.change(screen.getByLabelText(/year/i), { target: { value: "2023" } });
  fireEvent.change(screen.getByLabelText(/event/i), { target: { value: "Monza" } });
  fireEvent.change(screen.getByLabelText(/session type/i), { target: { value: "Q" } });
  fireEvent.click(screen.getByRole("button", { name: /start replay/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(onStarted).not.toHaveBeenCalled();
});

test("start live button POSTs to /session/live", async () => {
  const onStarted = vi.fn();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });

  render(<ReplayControls onStarted={onStarted} />);
  fireEvent.click(screen.getByRole("button", { name: /start live/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/session/live"),
    expect.objectContaining({ method: "POST" }),
  ));
  expect(onStarted).not.toHaveBeenCalled();
});
