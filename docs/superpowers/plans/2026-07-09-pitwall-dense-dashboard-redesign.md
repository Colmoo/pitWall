# PitWall Dense Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tab-switcher frontend shell with one always-visible dense dashboard, styled after the reference APXGP-style engineering-telemetry photo/mockup, using PitWall's real data (no fabricated telemetry channels).

**Architecture:** A new CSS grid layout (three columns: fixed left sidebar, fluid center, fixed right sidebar) replaces the tab bar. All four existing panels (TimingTower, TrackMap, TireStrategy, SectorTimes) render simultaneously instead of one-at-a-time, wrapped in generic `.pitwall-panel` card divs directly in `App.tsx` — none of those four components need internal changes except `TrackMap`, which gets a circular-bezel treatment (the redesign's signature element). A new `OverviewPanel` component fills the top-left slot with session-status stats.

**Tech Stack:** Same as prior plans — React/TypeScript/Vite, Vitest + Testing Library. No new dependencies.

## Global Constraints
- Design tokens (from `docs/superpowers/specs/2026-07-08-pitwall-panels-and-live-design.md`'s UI redesign section): background `#050607`, panel `#0a0c10`, hairline border `#1a1d1f`, text `#e5e7eb`, label gray `#6b7280`, accents cyan `#3ecbff` / yellow `#facc15` / green `#4ade80` / red `#f87171`. Labels are small uppercase system sans with letter-spacing; data values are monospace with tabular numerals.
- No fabricated data — every value shown must come from the existing `SessionState`/`DriverState` schema. Do not invent telemetry fields (RPM, throttle, tire pressure, etc.) that PitWall doesn't have.
- `TimingTower.tsx`, `TireStrategy.tsx`, `SectorTimes.tsx` keep their existing props, DOM structure, and `data-testid` values unchanged — their existing test files must keep passing without modification. Only `App.tsx` changes how they're wrapped/arranged.
- `TrackMap.tsx` keeps its existing `data-testid="track-outline"` and `data-testid="driver-dot-{number}"` values — its existing tests must keep passing.
- No new frontend dependencies.

---

### Task 1: Dense-dashboard CSS (grid, cards, tokens)

**Files:**
- Modify: `frontend/src/App.css` (full rewrite)

**Interfaces:**
- Produces: CSS classes consumed by Task 2 (`OverviewPanel`) and Task 4 (`App.tsx`): `.pitwall-header`, `.pitwall-grid`, `.pitwall-sidebar-left`, `.pitwall-center`, `.pitwall-sidebar-right`, `.pitwall-panel`, `.pitwall-panel-title`, `.pitwall-stat`, `.pitwall-stat-label`, `.pitwall-stat-value` (plus modifiers `.cyan`/`.yellow`/`.green`/`.red`), `.pitwall-circuit-bezel`, `.pitwall-circuit-name` (used by Task 3's `TrackMap` changes). Existing bare `table`/`th`/`td` styles are kept (still used by `TimingTower`/`SectorTimes`) with the same visual tokens.

This is presentation-only (no new logic, no branches/loops to test) — no test step, per project convention of not testing pure CSS.

- [ ] **Step 1: Replace App.css**

Replace the full contents of `frontend/src/App.css` with:

```css
:root {
  color-scheme: dark;
  --bg: #050607;
  --panel: #0a0c10;
  --border: #1a1d1f;
  --text: #e5e7eb;
  --label: #6b7280;
  --cyan: #3ecbff;
  --yellow: #facc15;
  --green: #4ade80;
  --red: #f87171;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
}

.pitwall-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.pitwall-header h1 {
  margin: 0;
  font-size: 14px;
  letter-spacing: 3px;
  color: var(--label);
  text-transform: uppercase;
}

.pitwall-grid {
  display: grid;
  grid-template-columns: 240px 1fr 340px;
  grid-template-rows: auto auto;
  gap: 10px;
  padding: 10px;
}

.pitwall-sidebar-left {
  grid-column: 1;
  grid-row: 1 / 3;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pitwall-center {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pitwall-sidebar-right {
  grid-column: 3;
  grid-row: 1 / 3;
}

.pitwall-panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
}

.pitwall-panel-title {
  color: var(--label);
  font-size: 9px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.pitwall-circuit-bezel {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.pitwall-circuit-bezel svg {
  width: 100%;
  height: auto;
}

.pitwall-circuit-name {
  margin-top: 8px;
  color: var(--label);
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.pitwall-stat {
  margin-bottom: 10px;
}

.pitwall-stat:last-child {
  margin-bottom: 0;
}

.pitwall-stat-label {
  color: var(--label);
  font-size: 9px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.pitwall-stat-value {
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

.pitwall-stat-value.cyan {
  color: var(--cyan);
}

.pitwall-stat-value.yellow {
  color: var(--yellow);
}

.pitwall-stat-value.green {
  color: var(--green);
}

.pitwall-stat-value.red {
  color: var(--red);
}

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

th {
  text-align: left;
  color: var(--label);
  font-size: 9px;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 4px 6px;
  font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
}

td {
  padding: 4px 6px;
  border-top: 1px solid var(--border);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/App.css
git commit -m "feat(frontend): rewrite App.css for dense single-screen dashboard tokens"
```

---

### Task 2: OverviewPanel component

**Files:**
- Create: `frontend/src/panels/OverviewPanel.tsx`
- Create: `frontend/src/panels/OverviewPanel.test.tsx`

**Interfaces:**
- Consumes: `SessionState` type from `../types`; CSS classes from Task 1 (`.pitwall-panel`, `.pitwall-panel-title`, `.pitwall-stat`, `.pitwall-stat-label`, `.pitwall-stat-value`).
- Produces: `OverviewPanel({ state }: { state: SessionState | null })` — shows track status, current leader's abbreviation, and current lap number, all derived from `state.drivers[0]` (already sorted by position by the backend) and `state.track_status`. Shows `"—"` placeholders when `state` is `null`. Used by Task 4's `App.tsx`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/panels/OverviewPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OverviewPanel } from "./OverviewPanel";
import type { SessionState } from "../types";

test("shows placeholder dashes when no state yet", () => {
  render(<OverviewPanel state={null} />);
  expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
});

test("shows track status, leader, and lap from the latest state", () => {
  const state: SessionState = {
    timestamp: "t1",
    track_status: "yellow",
    drivers: [
      {
        driver_number: "1", abbreviation: "VER", team: "Red Bull", position: 1,
        gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
        tire: { compound: "SOFT", age_laps: 1 }, x: null, y: null,
        lap_number: 12, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      },
    ],
  };
  render(<OverviewPanel state={state} />);
  expect(screen.getByText("YELLOW")).toBeInTheDocument();
  expect(screen.getByText("VER")).toBeInTheDocument();
  expect(screen.getByText("12")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — cannot find module `./OverviewPanel`

- [ ] **Step 3: Implement OverviewPanel**

Create `frontend/src/panels/OverviewPanel.tsx`:

```tsx
import type { SessionState } from "../types";

function statusColorClass(status: SessionState["track_status"] | undefined): string {
  if (status === "green") return "green";
  if (status === "yellow") return "yellow";
  if (status === undefined) return "";
  return "red";
}

export function OverviewPanel({ state }: { state: SessionState | null }) {
  const leader = state && state.drivers.length > 0 ? state.drivers[0] : null;

  return (
    <div className="pitwall-panel">
      <div className="pitwall-panel-title">Overview</div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Track Status</div>
        <div className={`pitwall-stat-value ${statusColorClass(state?.track_status)}`}>
          {state ? state.track_status.replace("_", " ").toUpperCase() : "—"}
        </div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Leader</div>
        <div className="pitwall-stat-value cyan">{leader ? leader.abbreviation : "—"}</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Lap</div>
        <div className="pitwall-stat-value">{leader?.lap_number ?? "—"}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/OverviewPanel.tsx frontend/src/panels/OverviewPanel.test.tsx
git commit -m "feat(frontend): add OverviewPanel with track status, leader, and lap"
```

---

### Task 3: Circular bezel treatment for Track Map (signature element)

**Files:**
- Modify: `frontend/src/panels/TrackMap.tsx`
- Modify: `frontend/src/panels/TrackMap.test.tsx`

**Interfaces:**
- No signature change to `TrackMap({ state, sessionParams })` — same props, same `data-testid="track-outline"`/`data-testid="driver-dot-{number}"` values (existing tests for those must keep passing unmodified). Adds a decorative bezel ring behind the track outline and a circuit-name label (from `sessionParams.event`, real data — not fabricated) below the SVG.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/panels/TrackMap.test.tsx`:

```tsx
test("shows the circuit name from sessionParams below the map", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ points: [[0, 0], [10, 0], [10, 10], [0, 10]] }),
  });

  render(<TrackMap state={null} sessionParams={{ year: 2023, event: "Silverstone", sessionType: "R" }} />);

  await waitFor(() => expect(screen.getByText("Silverstone")).toBeInTheDocument());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Unable to find an element with the text: Silverstone`

- [ ] **Step 3: Add the bezel ring and circuit name label**

In `frontend/src/panels/TrackMap.tsx`, replace the final `return` statement (the one rendering the `<svg>`) with:

```tsx
  return (
    <>
      <svg
        viewBox={`${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`}
        style={{ width: "100%", height: "auto" }}
      >
        <circle
          cx={minX + width / 2}
          cy={minY + height / 2}
          r={Math.max(width, height) / 2 + padding * 0.6}
          fill="none"
          stroke="#1a1d1f"
          strokeWidth={width * 0.003}
        />
        <path data-testid="track-outline" d={pathD} fill="none" stroke="#3ecbff" strokeWidth={width * 0.004} />
        {driversWithPosition.map((d) => (
          <circle
            key={d.driver_number}
            data-testid={`driver-dot-${d.driver_number}`}
            cx={d.x as number}
            cy={d.y as number}
            r={width * 0.01}
            fill="#facc15"
          />
        ))}
      </svg>
      {sessionParams && <div className="pitwall-circuit-name">{sessionParams.event}</div>}
    </>
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all files, including the pre-existing `TrackMap.test.tsx` tests unmodified by this task)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/TrackMap.tsx frontend/src/panels/TrackMap.test.tsx
git commit -m "feat(frontend): add circular bezel ring and circuit name to Track Map"
```

---

### Task 4: Dense grid App shell (remove tabs, render all panels at once)

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `OverviewPanel` (Task 2), the updated `TrackMap` (Task 3), and the unchanged `TimingTower`/`TireStrategy`/`SectorTimes`, all wrapped in `.pitwall-panel`/`.pitwall-panel-title` divs using Task 1's CSS grid classes.
- Removes: the `TABS` array, `activeTab` state, and the `keydown` tab-switching `useEffect` — all dead code once every panel is always visible.

- [ ] **Step 1: Write the failing test**

Replace the contents of `frontend/src/App.test.tsx` with:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — the current `App.tsx` only renders the active tab's panel, so `getAllByText(/waiting for session data/i)` finds only 1 match, not >= 3

- [ ] **Step 3: Rewrite App.tsx**

Replace the full contents of `frontend/src/App.tsx` with:

```tsx
import { useState } from "react";
import "./App.css";
import { useSessionSocket } from "./api/useSessionSocket";
import { ReplayControls } from "./controls/ReplayControls";
import { TimingTower } from "./panels/TimingTower";
import { TrackMap } from "./panels/TrackMap";
import { TireStrategy } from "./panels/TireStrategy";
import { SectorTimes } from "./panels/SectorTimes";
import { OverviewPanel } from "./panels/OverviewPanel";

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8000/ws/session";

export default function App() {
  const [sessionParams, setSessionParams] = useState<{ year: number; event: string; sessionType: string } | null>(null);
  const history = useSessionSocket(WS_URL, sessionParams);
  const latest = history.length > 0 ? history[history.length - 1] : null;

  return (
    <div>
      <header className="pitwall-header">
        <h1>PitWall</h1>
        <ReplayControls onStarted={setSessionParams} />
      </header>
      <div className="pitwall-grid">
        <div className="pitwall-sidebar-left">
          <OverviewPanel state={latest} />
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Tire Strategy</div>
            <TireStrategy history={history} />
          </div>
        </div>
        <div className="pitwall-center">
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Timing Tower</div>
            <TimingTower state={latest} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Sector Times</div>
            <SectorTimes state={latest} />
          </div>
        </div>
        <div className="pitwall-sidebar-right">
          <div className="pitwall-panel pitwall-circuit-bezel">
            <div className="pitwall-panel-title">Circuit</div>
            <TrackMap state={latest} sessionParams={sessionParams} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all files)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat(frontend): replace tab shell with dense always-visible grid dashboard"
```

---

## Self-Review Notes
- Spec coverage: design tokens (Task 1), Overview stats panel (Task 2), signature circular-bezel Track Map (Task 3), grid shell replacing tabs (Task 4) — all sections of the UI redesign spec addendum are covered.
- Placeholder scan: none — every step has runnable code and exact commands.
- Type consistency: `OverviewPanel`'s `state: SessionState | null` prop matches every other panel's existing convention. `TrackMap`'s props are unchanged (`state`, `sessionParams`) — Task 4's `App.tsx` passes them identically to before. No `data-testid` values changed on any pre-existing component, so their existing test files require no edits (verified: `TimingTower.test.tsx`, `TireStrategy.test.tsx`, `SectorTimes.test.tsx` are not in this plan's file list).
