import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RaceEngineerNotes } from "./RaceEngineerNotes";

test("shows a placeholder when there are no notes yet", () => {
  render(<RaceEngineerNotes notes={[]} />);
  expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
});

test("renders notes newest first", () => {
  render(
    <RaceEngineerNotes
      notes={[
        { timestamp: "t1", text: "First note" },
        { timestamp: "t2", text: "Second note" },
      ]}
    />
  );
  const items = screen.getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("Second note");
  expect(items[1]).toHaveTextContent("First note");
});
