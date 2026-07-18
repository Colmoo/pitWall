# Live Fix, Resizable Grid Dashboard, and Telemetry Comparison Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the dashboard a real resizable/reflowing widget grid (replacing today's overlap-prone free drag), add loading feedback so "Start Replay" doesn't look broken on a slow first fetch, and add a new Telemetry tab where multiple driver+lap telemetry traces can be overlaid for comparison.

**Architecture:** Frontend-only except for the already-shipped `live_adapter.py` fix. `react-grid-layout` replaces `Panel.tsx`'s hand-rolled drag code and powers two independent grids (Dashboard tab, Telemetry tab), each persisting its layout to its own localStorage key. A new `useDriverLapTelemetry` hook is extracted from `TelemetryStack` and reused by a new `TelemetryTab` that lets you add/remove `{driver, lap}` comparison selections, each fetched independently and overlaid on shared charts.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + Testing Library, `react-grid-layout` (new dependency).

## Global Constraints

- Only new dependency: `react-grid-layout` (pulls in `react-resizable` transitively) — no other new packages.
- Follow existing code style: function components, no CSS-in-JS, plain `App.css` classes prefixed `pitwall-`.
- Backend has no changes in this plan (the live-adapter crash fix already landed in a prior commit).
- Keep `RaceControlTicker`'s footer strip outside the draggable grid — it's a ticker bar, not a widget.

---

## File Structure

- `frontend/package.json` — add `react-grid-layout` dependency.
- `frontend/src/panels/LandingPage.tsx` — add loading state around both fetch flows.
- `frontend/src/panels/LandingPage.test.tsx` — loading-state tests.
- `frontend/src/api/useDriverLapTelemetry.ts` — **new**, extracted fetch-by-driver-and-lap hook + `Traces`/`TelemetrySessionParams` types.
- `frontend/src/panels/TelemetryStack.tsx` — refactor to use the new hook (behavior unchanged).
- `frontend/src/panels/WidgetGrid.tsx` — **new**, thin wrapper around `react-grid-layout` with localStorage-backed layout persistence.
- `frontend/src/panels/WidgetGrid.test.tsx` — **new**.
- `frontend/src/panels/Panel.tsx` — refactor to a `forwardRef` component that forwards grid-injected props (style/className/handlers) instead of managing its own drag position.
- `frontend/src/App.css` — remove now-unused 3-column grid CSS, add widget-grid container CSS, tab-bar CSS, panel-body overflow CSS.
- `frontend/src/App.tsx` — wrap dashboard panels in `WidgetGrid`, add Dashboard/Telemetry tab switcher.
- `frontend/src/App.test.tsx` — update for tab switcher, verify dashboard still renders inside the grid.
- `frontend/src/constants.ts` — add `COMPARISON_COLORS` palette + `comparisonColor(index)`.
- `frontend/src/panels/TelemetryTab.tsx` — **new**, driver picker + active selections + overlay charts.
- `frontend/src/panels/TelemetryTab.test.tsx` — **new**.

---

### Task 1: Replay loading feedback

**Files:**
- Modify: `frontend/src/panels/LandingPage.tsx`
- Test: `frontend/src/panels/LandingPage.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks (fully self-contained).

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/panels/LandingPage.test.tsx`:

```tsx
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

  resolveLive(undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/panels/LandingPage.test.tsx`
Expected: FAIL — no "loading" button/text exists yet.

- [ ] **Step 3: Implement the loading state**

Replace the body of `frontend/src/panels/LandingPage.tsx` from the `handleSubmit`/`handleGoLive` functions through the return statement with:

```tsx
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const parsedYear = Number(year);
    const response = await fetch(`${API_URL}/session/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: parsedYear, event, session_type: sessionType, speed: 10 }),
    });
    if (response.ok) {
      onReplayStarted({ year: parsedYear, event, sessionType });
      return;
    }
    setLoading(false);
  }

  async function handleGoLive() {
    setLoading(true);
    const response = await fetch(`${API_URL}/session/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (response.ok) {
      onLiveStarted();
      return;
    }
    setLoading(false);
  }

  return (
    <div className="pitwall-landing">
      <h1>PitWall</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="landing-year">Year</label>
        <select id="landing-year" value={year} onChange={(e) => setYear(e.target.value)} disabled={loading}>
          <option value="" disabled>
            Select year
          </option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <label htmlFor="landing-track">Track</label>
        <select id="landing-track" value={event} onChange={(e) => setEvent(e.target.value)} disabled={!year || loading}>
          <option value="" disabled>
            Select track
          </option>
          {events.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>

        <label htmlFor="landing-session">Session</label>
        <select id="landing-session" value={sessionType} onChange={(e) => setSessionType(e.target.value)} disabled={!event || loading}>
          <option value="" disabled>
            Select session
          </option>
          {sessions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <button type="submit" disabled={!year || !event || !sessionType || loading}>
          {loading ? "Loading..." : "Start replay"}
        </button>
      </form>
      <button type="button" onClick={handleGoLive} disabled={loading}>
        {loading ? "Loading..." : "Go live"}
      </button>
      {loading && <p>First load of a session can take a minute or two while race data downloads.</p>}
    </div>
  );
```

Add `useState` to the existing `import { useEffect, useState } from "react";` line (already imports `useState`, no change needed there).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/panels/LandingPage.test.tsx`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/LandingPage.tsx frontend/src/panels/LandingPage.test.tsx
git commit -m "feat: show loading feedback while a session starts"
```

---

### Task 2: Extract `useDriverLapTelemetry` hook

**Files:**
- Create: `frontend/src/api/useDriverLapTelemetry.ts`
- Modify: `frontend/src/panels/TelemetryStack.tsx`
- Test: `frontend/src/panels/TelemetryStack.test.tsx` (existing tests must still pass unchanged — this is a pure refactor)

**Interfaces:**
- Produces: `useDriverLapTelemetry(sessionParams: TelemetrySessionParams, driver: string | null, lapNumber: number | null): Traces | null`, and exported types `Traces` and `TelemetrySessionParams`, both from `frontend/src/api/useDriverLapTelemetry.ts`. Task 7 (`TelemetryTab`) imports both.

- [ ] **Step 1: Confirm the baseline passes**

Run: `cd frontend && npx vitest run src/panels/TelemetryStack.test.tsx`
Expected: PASS (3 tests) — this is the regression guard for the refactor below.

- [ ] **Step 2: Create the hook**

Create `frontend/src/api/useDriverLapTelemetry.ts`:

```tsx
import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

export type Traces = { distance: number[]; speed: number[]; throttle: number[]; brake: boolean[]; gear: number[]; rpm: number[] };

export type TelemetrySessionParams = { year: number; event: string; sessionType: string } | null;

export function useDriverLapTelemetry(
  sessionParams: TelemetrySessionParams,
  driver: string | null,
  lapNumber: number | null,
): Traces | null {
  const [traces, setTraces] = useState<Traces | null>(null);

  useEffect(() => {
    setTraces(null);
    if (!sessionParams || !driver || !lapNumber) return;
    const url =
      `${API_URL}/session/telemetry?year=${sessionParams.year}&event=${encodeURIComponent(sessionParams.event)}` +
      `&session_type=${sessionParams.sessionType}&driver=${driver}&lap_number=${lapNumber}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: Traces) => setTraces(data));
  }, [sessionParams, driver, lapNumber]);

  return traces;
}
```

- [ ] **Step 3: Refactor `TelemetryStack` to use it**

Replace `frontend/src/panels/TelemetryStack.tsx` in full with:

```tsx
import type { SessionState } from "../types";
import { useDriverLapTelemetry } from "../api/useDriverLapTelemetry";
import type { TelemetrySessionParams } from "../api/useDriverLapTelemetry";

function Trace({ testId, values, max, color }: { testId: string; values: number[]; max: number; color: string }) {
  const width = 100;
  const height = 16;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 34 }}>
      <polyline data-testid={testId} points={points} fill="none" stroke={color} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function TelemetryStack({
  sessionParams,
  state,
  selectedDriver,
}: {
  sessionParams: TelemetrySessionParams;
  state: SessionState | null;
  selectedDriver: string | null;
}) {
  const driver = state?.drivers.find((d) => d.driver_number === selectedDriver) ?? null;
  const lapNumber = driver?.lap_number ?? null;
  const traces = useDriverLapTelemetry(sessionParams, selectedDriver, lapNumber);

  if (!sessionParams) {
    return <p>Telemetry unavailable in live mode.</p>;
  }
  if (!selectedDriver) {
    return <p>Select a driver to see telemetry.</p>;
  }
  if (!traces || !traces.speed || traces.speed.length === 0) {
    return <p>Loading telemetry...</p>;
  }

  const speedMax = Math.max(...traces.speed, 1);
  const gearMax = Math.max(...traces.gear, 1);
  const rpmMax = Math.max(...traces.rpm, 1);

  return (
    <div>
      <div className="pitwall-stat-label">Speed (km/h) — max {speedMax}</div>
      <Trace testId="telemetry-trace-speed" values={traces.speed} max={speedMax} color="#3ecbff" />
      <div className="pitwall-stat-label">Throttle (%)</div>
      <Trace testId="telemetry-trace-throttle" values={traces.throttle} max={100} color="#4ade80" />
      <div className="pitwall-stat-label">Brake (on/off)</div>
      <Trace testId="telemetry-trace-brake" values={traces.brake.map((b) => (b ? 1 : 0))} max={1} color="#f87171" />
      <div className="pitwall-stat-label">Gear (1-8) — max {gearMax}</div>
      <Trace testId="telemetry-trace-gear" values={traces.gear} max={gearMax} color="#facc15" />
      <div className="pitwall-stat-label">RPM — max {rpmMax}</div>
      <Trace testId="telemetry-trace-rpm" values={traces.rpm} max={rpmMax} color="#a78bfa" />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify no regression**

Run: `cd frontend && npx vitest run src/panels/TelemetryStack.test.tsx`
Expected: PASS (same 3 tests, unchanged).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/useDriverLapTelemetry.ts frontend/src/panels/TelemetryStack.tsx
git commit -m "refactor: extract useDriverLapTelemetry hook from TelemetryStack"
```

---

### Task 3: Add `react-grid-layout` and build `WidgetGrid`

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/panels/WidgetGrid.tsx`
- Test: `frontend/src/panels/WidgetGrid.test.tsx`

**Interfaces:**
- Produces: `WidgetGrid({ storageKey, defaultLayout, children })` and exported type `WidgetLayoutItem = { i: string; x: number; y: number; w: number; h: number }`, both from `frontend/src/panels/WidgetGrid.tsx`. Tasks 5 and 8 both render their panels inside `<WidgetGrid>`.

- [ ] **Step 1: Install the dependency**

```bash
cd frontend && npm install react-grid-layout@^2.2.3
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/panels/WidgetGrid.test.tsx`:

```tsx
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/panels/WidgetGrid.test.tsx`
Expected: FAIL — `WidgetGrid` module doesn't exist yet.

- [ ] **Step 4: Implement `WidgetGrid`**

Create `frontend/src/panels/WidgetGrid.tsx`:

`WidgetGrid` uses `GridLayout` directly with a fixed `width` rather than wrapping it in
`WidthProvider` — `WidthProvider` measures the container via `ResizeObserver`, which
jsdom (the test environment) doesn't implement, so it would make every render in tests
report zero width. A fixed `width={1200}` sidesteps that and is still correct in the
browser, since `react-grid-layout` recalculates each column's pixel width from
`width`/`cols` on every render regardless of how `width` is supplied. If some real
screen width later makes 1200 feel wrong, swap in `WidthProvider(GridLayout)` and mock
`ResizeObserver` in `frontend/src/setupTests` (or wherever Vitest's test setup lives) —
not needed for this plan.

```tsx
import { useState } from "react";
import type { ReactNode } from "react";
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export type WidgetLayoutItem = { i: string; x: number; y: number; w: number; h: number };

export function WidgetGrid({
  storageKey,
  defaultLayout,
  children,
}: {
  storageKey: string;
  defaultLayout: WidgetLayoutItem[];
  children: ReactNode;
}) {
  const [layout, setLayout] = useState<WidgetLayoutItem[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? (JSON.parse(saved) as WidgetLayoutItem[]) : defaultLayout;
    } catch {
      return defaultLayout;
    }
  });

  function handleLayoutChange(next: WidgetLayoutItem[]) {
    setLayout(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  return (
    <GridLayout
      className="pitwall-widget-grid"
      layout={layout}
      cols={12}
      rowHeight={30}
      margin={[8, 8]}
      draggableHandle=".pitwall-drag-handle"
      resizeHandles={["s", "w", "e", "n", "sw", "se", "nw", "ne"]}
      onLayoutChange={handleLayoutChange}
      width={1200}
    >
      {children}
    </GridLayout>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/panels/WidgetGrid.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/panels/WidgetGrid.tsx frontend/src/panels/WidgetGrid.test.tsx
git commit -m "feat: add WidgetGrid wrapper around react-grid-layout"
```

---

### Task 4: Make `Panel` grid-compatible

**Files:**
- Modify: `frontend/src/panels/Panel.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Panel` now `forwardRef<HTMLDivElement, ...>`, forwards all extra props (style/className/mouse & touch handlers) it's given — this is what lets `WidgetGrid` (via `react-grid-layout`) position, drag, and resize it. Signature (`id`, `title`, `className?`, `children`) is unchanged for callers.

- [ ] **Step 1: Replace the implementation**

Replace `frontend/src/panels/Panel.tsx` in full with:

```tsx
import { forwardRef } from "react";
import type { ReactNode, HTMLAttributes } from "react";

type PanelProps = {
  id: string;
  title: string;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>;

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { id, title, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      id={id}
      className={className ? `pitwall-panel ${className}` : "pitwall-panel"}
      {...rest}
    >
      <div className="pitwall-panel-title pitwall-drag-handle">{title}</div>
      <div className="pitwall-panel-body">{children}</div>
    </div>
  );
});
```

This drops the old `useDraggablePosition`/`localStorage.getItem("pitwall-widget-pos:...")` logic entirely — `WidgetGrid` now owns position/size persistence. Old `pitwall-widget-pos:*` keys left in users' `localStorage` are simply unused going forward; no migration needed.

- [ ] **Step 2: Run existing tests to check nothing else broke**

Run: `cd frontend && npx vitest run`
Expected: `App.test.tsx` will FAIL at this point — it still renders `Panel` directly inside the old `.pitwall-grid` markup, which is fine and expected until Task 5 rewires `App.tsx`. Confirm the *only* failures are in `App.test.tsx`, and that `WidgetGrid.test.tsx` and `Panel`'s indirect usage there still pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/panels/Panel.tsx
git commit -m "refactor: make Panel forward grid-injected props instead of self-managing drag"
```

---

### Task 5: Wire the dashboard into `WidgetGrid`

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `WidgetGrid`/`WidgetLayoutItem` from Task 3, updated `Panel` from Task 4.
- Produces: `DASHBOARD_DEFAULT_LAYOUT` constant in `App.tsx` (local, not exported — Task 6 doesn't need it since Telemetry gets its own layout constant in Task 8).

- [ ] **Step 1: Update `App.css`**

Remove these now-unused rules from `frontend/src/App.css` (the 3-column grid is replaced by `WidgetGrid`):

```css
.pitwall-grid { ... }
@media (max-width: 1400px) { ... }
.pitwall-sidebar-left { ... }
.pitwall-center { ... }
.pitwall-sidebar-right { ... }
.pitwall-sidebar-left, .pitwall-sidebar-right { max-height: ...; overflow-y: auto; }
```

Add in their place:

```css
.pitwall-widget-grid {
  position: relative;
  margin: 8px;
}

.pitwall-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.pitwall-panel-body {
  flex: 1;
  overflow: auto;
}
```

(`.pitwall-panel { background: ...; border: ...; padding: ...; }` declaration already above stays as-is — only add the `height`/`display`/`flex-direction` lines to it, don't duplicate the selector.)

- [ ] **Step 2: Rewrite `App.tsx`'s dashboard markup**

In `frontend/src/App.tsx`, add the import and default layout near the top (after the existing imports):

```tsx
import { WidgetGrid } from "./panels/WidgetGrid";
import type { WidgetLayoutItem } from "./panels/WidgetGrid";

const DASHBOARD_DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  { i: "overview", x: 0, y: 0, w: 3, h: 6 },
  { i: "timing-tower", x: 0, y: 6, w: 3, h: 10 },
  { i: "circuit", x: 3, y: 0, w: 6, h: 10 },
  { i: "sector-times", x: 3, y: 10, w: 6, h: 6 },
  { i: "gap-trend", x: 3, y: 16, w: 6, h: 8 },
  { i: "tire-strategy", x: 3, y: 24, w: 6, h: 8 },
  { i: "selected-driver", x: 9, y: 0, w: 3, h: 6 },
  { i: "telemetry", x: 9, y: 6, w: 3, h: 10 },
  { i: "weather", x: 9, y: 16, w: 3, h: 6 },
  { i: "race-engineer-notes", x: 9, y: 22, w: 3, h: 6 },
  { i: "ai-chat", x: 9, y: 28, w: 3, h: 8 },
];
```

Replace the `<main className="pitwall-grid">...</main>` block with:

```tsx
      <main>
        <WidgetGrid storageKey="pitwall-dashboard-layout" defaultLayout={DASHBOARD_DEFAULT_LAYOUT}>
          <Panel key="overview" id="overview" title="Overview">
            <OverviewPanel state={latest} />
          </Panel>
          <Panel key="timing-tower" id="timing-tower" title="Timing Tower">
            <TimingTower state={latest} selectedDriver={selectedDriver} onSelectDriver={setSelectedDriver} />
          </Panel>
          <Panel key="circuit" id="circuit" title="Circuit" className="pitwall-circuit-bezel">
            <TrackMap state={latest} sessionParams={sessionParams} />
          </Panel>
          <Panel key="sector-times" id="sector-times" title="Sector Times">
            <SectorTimes state={latest} />
          </Panel>
          <Panel key="gap-trend" id="gap-trend" title="Gap Trend (to Leader)">
            <GapTrendChart history={history} selectedDriver={selectedDriver} />
          </Panel>
          <Panel key="tire-strategy" id="tire-strategy" title="Tire Strategy">
            <TireStrategy history={history} />
          </Panel>
          <Panel key="selected-driver" id="selected-driver" title="Selected Driver">
            <SelectedDriverCard state={latest} selectedDriver={selectedDriver} />
          </Panel>
          <Panel key="telemetry" id="telemetry" title="Telemetry">
            <TelemetryStack sessionParams={sessionParams} state={latest} selectedDriver={selectedDriver} />
          </Panel>
          <Panel key="weather" id="weather" title="Weather">
            <WeatherPanel state={latest} />
          </Panel>
          <Panel key="race-engineer-notes" id="race-engineer-notes" title="Race Engineer Notes">
            <RaceEngineerNotes notes={notes} />
          </Panel>
          <Panel key="ai-chat" id="ai-chat" title="Ask The Engineer">
            <AiChat />
          </Panel>
        </WidgetGrid>
      </main>
```

`OverviewPanel` moves inside a `Panel` wrapper for the first time (it was previously rendered bare) so it's a first-class draggable/resizable grid widget like everything else.

- [ ] **Step 3: Update `App.test.tsx`**

The existing assertions (`getAllByText(/waiting for session data/i)`, `getByText(/overview/i)`, etc.) don't reference the removed `.pitwall-grid`/`.pitwall-sidebar-*` classes, so they keep working unchanged. Confirm this by running the tests (next step) rather than editing blind.

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run`
Expected: PASS across all files (App.test.tsx, WidgetGrid.test.tsx, TelemetryStack.test.tsx, LandingPage.test.tsx, and all untouched panel tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.css frontend/src/App.test.tsx
git commit -m "feat: replace static dashboard layout with resizable WidgetGrid"
```

---

### Task 6: Header tab switcher

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Produces: `activeTab` state (`"dashboard" | "telemetry"`) in `App.tsx`, gating which grid renders. Task 8 renders `TelemetryTab` in the `"telemetry"` branch.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/App.test.tsx`:

```tsx
test("switches to the telemetry tab and back without losing dashboard state", async () => {
  await startReplay();
  expect(screen.getByText(/overview/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /^telemetry$/i }));
  expect(screen.queryByText(/overview/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /^dashboard$/i }));
  expect(screen.getByText(/overview/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/App.test.tsx`
Expected: FAIL — no tab buttons exist yet.

- [ ] **Step 3: Add the tab switcher**

In `frontend/src/App.tsx`, add state near the other `useState` calls:

```tsx
  const [activeTab, setActiveTab] = useState<"dashboard" | "telemetry">("dashboard");
```

Update the `<header>` block to add tab buttons after the home button:

```tsx
      <header className="pitwall-header">
        <h1>PitWall</h1>
        <button type="button" className="pitwall-home-button" onClick={goHome}>
          ← Home
        </button>
        <nav className="pitwall-tab-bar">
          <button
            type="button"
            className={activeTab === "dashboard" ? "pitwall-tab pitwall-tab-active" : "pitwall-tab"}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={activeTab === "telemetry" ? "pitwall-tab pitwall-tab-active" : "pitwall-tab"}
            onClick={() => setActiveTab("telemetry")}
          >
            Telemetry
          </button>
        </nav>
        <div className="pitwall-stat-value" style={{ fontSize: 11 }}>
          {latest ? latest.track_status.replaceAll("_", " ").toUpperCase() : "—"}
        </div>
      </header>
```

Wrap the existing `<main>...</main>` (dashboard grid from Task 5) in a conditional, and leave the `<footer>` ticker rendering in both cases (it's session-wide, not dashboard-specific):

```tsx
      {activeTab === "dashboard" && (
        <main>
          <WidgetGrid storageKey="pitwall-dashboard-layout" defaultLayout={DASHBOARD_DEFAULT_LAYOUT}>
            {/* ...unchanged Panel children from Task 5... */}
          </WidgetGrid>
        </main>
      )}
      {activeTab === "telemetry" && (
        <main>
          <p>Telemetry tab placeholder — replaced in Task 8.</p>
        </main>
      )}
```

- [ ] **Step 4: Add tab-bar CSS**

Add to `frontend/src/App.css`:

```css
.pitwall-tab-bar {
  display: flex;
  gap: 4px;
}

.pitwall-tab {
  background: transparent;
  color: var(--label);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 5px 10px;
  font-size: 11px;
  cursor: pointer;
}

.pitwall-tab-active {
  color: var(--cyan);
  border-color: var(--cyan);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/App.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.css frontend/src/App.test.tsx
git commit -m "feat: add Dashboard/Telemetry tab switcher to the header"
```

---

### Task 7: Build `TelemetryTab`

**Files:**
- Modify: `frontend/src/constants.ts`
- Create: `frontend/src/panels/TelemetryTab.tsx`
- Test: `frontend/src/panels/TelemetryTab.test.tsx`

**Interfaces:**
- Consumes: `useDriverLapTelemetry`/`Traces`/`TelemetrySessionParams` from Task 2, `WidgetGrid`/`WidgetLayoutItem` from Task 3, `Panel` from Task 4.
- Produces: `TelemetryTab({ sessionParams, state })` from `frontend/src/panels/TelemetryTab.tsx`. Task 8 renders it in `App.tsx`'s telemetry branch, passing the same `sessionParams`/`latest` values already used by the dashboard's `TelemetryStack`.

- [ ] **Step 1: Add the comparison color palette**

Add to `frontend/src/constants.ts`:

```ts
const COMPARISON_COLORS = ["#3ecbff", "#facc15", "#4ade80", "#f87171", "#a78bfa", "#fb923c"];

export function comparisonColor(index: number): string {
  return COMPARISON_COLORS[index % COMPARISON_COLORS.length];
}
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/panels/TelemetryTab.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TelemetryTab } from "./TelemetryTab";
import type { SessionState } from "../types";

const sampleState: SessionState = {
  timestamp: "t1",
  track_status: "green",
  weather: null,
  race_control_messages: [],
  drivers: [
    {
      driver_number: "1", abbreviation: "VER", team: "Red Bull Racing", position: 1,
      gap_to_leader: null, gap_to_ahead: null, last_lap_time: 90, best_lap_time: 90,
      tire: { compound: "SOFT", age_laps: 3 }, x: null, y: null,
      lap_number: 5, sector_1_time: null, sector_2_time: null, sector_3_time: null,
    },
    {
      driver_number: "44", abbreviation: "HAM", team: "Mercedes", position: 2,
      gap_to_leader: 2, gap_to_ahead: 2, last_lap_time: 91, best_lap_time: 91,
      tire: { compound: "MEDIUM", age_laps: 5 }, x: null, y: null,
      lap_number: 5, sector_1_time: null, sector_2_time: null, sector_3_time: null,
    },
  ],
};

const sessionParams = { year: 2023, event: "British Grand Prix", sessionType: "R" };

function mockTelemetryFetch() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ distance: [0, 10], speed: [250, 260], throttle: [100, 100], brake: [false, false], gear: [6, 6], rpm: [11000, 11200] }),
  });
}

test("adds a driver as a comparison selection and fetches their current-lap telemetry", async () => {
  mockTelemetryFetch();
  render(<TelemetryTab sessionParams={sessionParams} state={sampleState} />);

  fireEvent.click(screen.getByText("VER"));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("driver=1")));
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("lap_number=5"));
  expect(screen.getByText(/VER.*lap 5/i)).toBeInTheDocument();
});

test("overlays two selections' speed traces and removes one on request", async () => {
  mockTelemetryFetch();
  render(<TelemetryTab sessionParams={sessionParams} state={sampleState} />);

  fireEvent.click(screen.getByText("VER"));
  fireEvent.click(screen.getByText("HAM"));

  await waitFor(() => expect(screen.getByTestId("telemetry-overlay-speed").querySelectorAll("polyline")).toHaveLength(2));

  fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);

  await waitFor(() => expect(screen.getByTestId("telemetry-overlay-speed").querySelectorAll("polyline")).toHaveLength(1));
});

test("editing a selection's lap number refetches that selection's telemetry", async () => {
  mockTelemetryFetch();
  render(<TelemetryTab sessionParams={sessionParams} state={sampleState} />);

  fireEvent.click(screen.getByText("VER"));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("lap_number=5")));

  fireEvent.change(screen.getByLabelText(/lap number/i), { target: { value: "3" } });

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("lap_number=3")));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/panels/TelemetryTab.test.tsx`
Expected: FAIL — `TelemetryTab` module doesn't exist yet.

- [ ] **Step 4: Implement `TelemetryTab`**

Create `frontend/src/panels/TelemetryTab.tsx`:

```tsx
import { useCallback, useState } from "react";
import type { SessionState } from "../types";
import { comparisonColor } from "../constants";
import { useDriverLapTelemetry } from "../api/useDriverLapTelemetry";
import type { Traces, TelemetrySessionParams } from "../api/useDriverLapTelemetry";
import { WidgetGrid } from "./WidgetGrid";
import type { WidgetLayoutItem } from "./WidgetGrid";
import { Panel } from "./Panel";

type ComparisonSelection = { id: string; driver: string; abbreviation: string; lapNumber: number; color: string };

const TELEMETRY_DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  { i: "driver-picker", x: 0, y: 0, w: 3, h: 14 },
  { i: "active-selections", x: 0, y: 14, w: 3, h: 10 },
  { i: "telemetry-charts", x: 3, y: 0, w: 9, h: 24 },
];

function TelemetryFetcher({
  sessionParams,
  selection,
  onData,
}: {
  sessionParams: TelemetrySessionParams;
  selection: ComparisonSelection;
  onData: (id: string, traces: Traces | null) => void;
}) {
  const traces = useDriverLapTelemetry(sessionParams, selection.driver, selection.lapNumber);
  onData(selection.id, traces);
  return null;
}

function OverlayTrace({
  testId,
  selections,
  tracesById,
  metric,
  max,
}: {
  testId: string;
  selections: ComparisonSelection[];
  tracesById: Record<string, Traces | null>;
  metric: (traces: Traces) => number[];
  max: number;
}) {
  const width = 100;
  const height = 40;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 80 }} data-testid={testId}>
      {selections.map((s) => {
        const traces = tracesById[s.id];
        if (!traces) return null;
        const values = metric(traces);
        const stepX = values.length > 1 ? width / (values.length - 1) : 0;
        const points = values
          .map((v, i) => `${(i * stepX).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`)
          .join(" ");
        return <polyline key={s.id} points={points} fill="none" stroke={s.color} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}

export function TelemetryTab({
  sessionParams,
  state,
}: {
  sessionParams: TelemetrySessionParams;
  state: SessionState | null;
}) {
  const [selections, setSelections] = useState<ComparisonSelection[]>([]);
  const [tracesById, setTracesById] = useState<Record<string, Traces | null>>({});

  const handleData = useCallback((id: string, traces: Traces | null) => {
    setTracesById((prev) => (prev[id] === traces ? prev : { ...prev, [id]: traces }));
  }, []);

  function addSelection(driverNumber: string, abbreviation: string) {
    const driver = state?.drivers.find((d) => d.driver_number === driverNumber);
    const id = `${driverNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setSelections((prev) => [
      ...prev,
      { id, driver: driverNumber, abbreviation, lapNumber: driver?.lap_number ?? 1, color: comparisonColor(prev.length) },
    ]);
  }

  function removeSelection(id: string) {
    setSelections((prev) => prev.filter((s) => s.id !== id));
    setTracesById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function updateLap(id: string, lapNumber: number) {
    setSelections((prev) => prev.map((s) => (s.id === id ? { ...s, lapNumber } : s)));
  }

  if (!sessionParams) {
    return <p>Telemetry unavailable in live mode.</p>;
  }

  const speedMax = Math.max(1, ...selections.flatMap((s) => tracesById[s.id]?.speed ?? []));
  const gearMax = Math.max(1, ...selections.flatMap((s) => tracesById[s.id]?.gear ?? []));
  const rpmMax = Math.max(1, ...selections.flatMap((s) => tracesById[s.id]?.rpm ?? []));

  return (
    <WidgetGrid storageKey="pitwall-telemetry-layout" defaultLayout={TELEMETRY_DEFAULT_LAYOUT}>
      <Panel key="driver-picker" id="driver-picker" title="Drivers">
        <ul className="pitwall-driver-picker">
          {(state?.drivers ?? []).map((d) => (
            <li key={d.driver_number}>
              <button type="button" onClick={() => addSelection(d.driver_number, d.abbreviation)}>
                {d.abbreviation}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel key="active-selections" id="active-selections" title="Comparing">
        {selections.map((s) => (
          <div key={s.id} className="pitwall-comparison-row">
            <span className="pitwall-team-stripe" style={{ background: s.color }} />
            <span>{s.abbreviation} — lap {s.lapNumber}</span>
            <label htmlFor={`lap-number-${s.id}`}>Lap number</label>
            <input
              id={`lap-number-${s.id}`}
              type="number"
              value={s.lapNumber}
              onChange={(e) => updateLap(s.id, Number(e.target.value))}
            />
            <button type="button" onClick={() => removeSelection(s.id)}>
              Remove
            </button>
          </div>
        ))}
        {selections.map((s) => (
          <TelemetryFetcher key={s.id} sessionParams={sessionParams} selection={s} onData={handleData} />
        ))}
      </Panel>
      <Panel key="telemetry-charts" id="telemetry-charts" title="Telemetry Comparison">
        <div className="pitwall-stat-label">Speed (km/h)</div>
        <OverlayTrace testId="telemetry-overlay-speed" selections={selections} tracesById={tracesById} metric={(t) => t.speed} max={speedMax} />
        <div className="pitwall-stat-label">Throttle (%)</div>
        <OverlayTrace testId="telemetry-overlay-throttle" selections={selections} tracesById={tracesById} metric={(t) => t.throttle} max={100} />
        <div className="pitwall-stat-label">Brake (on/off)</div>
        <OverlayTrace testId="telemetry-overlay-brake" selections={selections} tracesById={tracesById} metric={(t) => t.brake.map((b) => (b ? 1 : 0))} max={1} />
        <div className="pitwall-stat-label">Gear (1-8)</div>
        <OverlayTrace testId="telemetry-overlay-gear" selections={selections} tracesById={tracesById} metric={(t) => t.gear} max={gearMax} />
        <div className="pitwall-stat-label">RPM</div>
        <OverlayTrace testId="telemetry-overlay-rpm" selections={selections} tracesById={tracesById} metric={(t) => t.rpm} max={rpmMax} />
      </Panel>
    </WidgetGrid>
  );
}
```

Note on `TelemetryFetcher`: it calls `onData` directly during render rather than in a `useEffect`, because `onData` itself only calls `setTracesById` when the traces object reference actually changed (the `prev[id] === traces` guard), matching the reference-stable value `useDriverLapTelemetry` already returns from its own state. This avoids an extra render-then-effect round trip. If this pattern is unfamiliar, an equivalent `useEffect(() => onData(selection.id, traces), [selection.id, traces, onData])` inside `TelemetryFetcher` works identically and can be swapped in if the direct-call version ever causes lint complaints about side effects during render.

- [ ] **Step 5: Add supporting CSS**

Add to `frontend/src/App.css`:

```css
.pitwall-driver-picker {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pitwall-driver-picker button {
  width: 100%;
  text-align: left;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 4px 8px;
  cursor: pointer;
}

.pitwall-comparison-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
}

.pitwall-comparison-row label {
  display: none;
}

.pitwall-comparison-row input[type="number"] {
  width: 48px;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 2px 4px;
}
```

(The `label` is visually hidden but stays in the DOM with `htmlFor` wired to the input, so `screen.getByLabelText(/lap number/i)` in the test resolves correctly — `display: none` still keeps it accessible-name-linked for Testing Library's label queries, though a screen reader would skip it too; that's an acceptable trade for now since there's already a visible "lap {n}" text next to it. Swap to a visually-hidden-but-not-`display:none` technique later if real screen-reader support for this control matters.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/panels/TelemetryTab.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/constants.ts frontend/src/panels/TelemetryTab.tsx frontend/src/panels/TelemetryTab.test.tsx frontend/src/App.css
git commit -m "feat: add TelemetryTab with multi-driver/lap comparison overlay"
```

---

### Task 8: Wire `TelemetryTab` into `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `TelemetryTab` from Task 7.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/App.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/App.test.tsx`
Expected: FAIL — telemetry tab still shows the Task 6 placeholder text, no driver buttons exist there.

- [ ] **Step 3: Replace the placeholder**

In `frontend/src/App.tsx`, add the import:

```tsx
import { TelemetryTab } from "./panels/TelemetryTab";
```

Replace the Task 6 placeholder block:

```tsx
      {activeTab === "telemetry" && (
        <main>
          <p>Telemetry tab placeholder — replaced in Task 8.</p>
        </main>
      )}
```

with:

```tsx
      {activeTab === "telemetry" && (
        <main>
          <TelemetryTab sessionParams={sessionParams} state={latest} />
        </main>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run`
Expected: PASS across the full suite.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat: wire TelemetryTab into the Telemetry tab"
```

---

## Manual Verification (after Task 8)

- [ ] `docker compose up --build` (or `npm run dev` in `frontend/` against the existing backend), start a replay, confirm the "Loading..." message appears then clears.
- [ ] On the Dashboard tab, drag a widget by its title bar onto another — confirm neighbors reflow instead of overlapping; resize a widget from a corner and an edge; reload the page and confirm the layout persisted.
- [ ] Switch to the Telemetry tab, add two drivers, confirm two overlaid polylines per chart in different colors; edit one selection's lap number and confirm its trace updates; remove a selection and confirm its trace disappears.
- [ ] Switch back to Dashboard, confirm its layout is exactly as left (independent from the Telemetry tab's grid/localStorage key).
