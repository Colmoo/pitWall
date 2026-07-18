import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WidgetGrid } from "./WidgetGrid";
import { Panel } from "./Panel";

const layout = [
  { i: "a", x: 0, y: 0, w: 4, h: 4 },
  { i: "b", x: 4, y: 0, w: 4, h: 4 },
];

test("renders every child panel inside the grid", () => {
  render(
    <WidgetGrid storageKey="test-layout" defaultLayout={layout}>
      <Panel key="a" id="a" title="Panel A">
        <p>content a</p>
      </Panel>
      <Panel key="b" id="b" title="Panel B">
        <p>content b</p>
      </Panel>
    </WidgetGrid>,
  );
  expect(screen.getByText("content a")).toBeInTheDocument();
  expect(screen.getByText("content b")).toBeInTheDocument();
  expect(screen.getByText("Panel A")).toHaveClass("pitwall-drag-handle");
});

test("falls back to defaultLayout when localStorage has nothing saved", () => {
  localStorage.removeItem("test-layout-empty");
  render(
    <WidgetGrid storageKey="test-layout-empty" defaultLayout={layout}>
      <Panel key="a" id="a" title="Panel A">
        <p>content a</p>
      </Panel>
      <Panel key="b" id="b" title="Panel B">
        <p>content b</p>
      </Panel>
    </WidgetGrid>,
  );
  expect(screen.getByText("content a")).toBeInTheDocument();
});
