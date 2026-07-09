import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AiChat } from "./AiChat";

test("submits a question and displays the answer", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ answer: "VER is leading." }),
  });

  render(<AiChat />);
  fireEvent.change(screen.getByLabelText(/ask a question/i), { target: { value: "Who is leading?" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(screen.getByText("VER is leading.")).toBeInTheDocument());
  expect(screen.getByText("Who is leading?")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/ai/chat"),
    expect.objectContaining({ method: "POST" }),
  );
});

test("clears the input after sending", async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: "Answer." }) });

  render(<AiChat />);
  const input = screen.getByLabelText(/ask a question/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "A question" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(screen.getByText("Answer.")).toBeInTheDocument());
  expect(input.value).toBe("");
});
