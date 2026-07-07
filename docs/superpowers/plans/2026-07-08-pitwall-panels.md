# PitWall Panels (Track Map, Tire Strategy, Sector Times) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Track Map, Tire Strategy, and Sector Times panels to PitWall, replace the single-tab shell with a real tab switcher, and add a replay-start control form — all styled with a real dark theme instead of unstyled tables.

**Architecture:** Backend gains two additive schema fields (`lap_number`, sector times) populated from FastF1's laps table, plus a track-layout endpoint that computes a circuit outline from the session's fastest lap telemetry (cached per session, computed once). Frontend's WebSocket hook is upgraded to keep the full tick history (not just the latest), which the new panels use to build stint/sector history client-side; a tab-switcher shell replaces the single hardcoded panel.

**Tech Stack:** Same as Plan 1 — Python 3.11/FastAPI/fastf1/pandas backend, React/TypeScript/Vite frontend.

## Global Constraints
- All schema additions are additive/optional (`| None = None`) — no existing field is removed or retyped.
- `frontend/src/types.ts` must mirror `backend/app/schema.py` exactly, same discipline as Plan 1.
- Replay mode does not populate `DriverState.x`/`y` in this plan (see Task 3) — the Track Map panel renders the outline only in replay mode; live mode (a future plan) will populate driver dots.
- No new backend dependencies. Frontend may not add new dependencies beyond what's already in `frontend/package.json` (React, Vite, Vitest, Testing Library are sufficient for SVG rendering — no charting library needed for these panels).
- Dark theme CSS is real (actual colors/spacing/grid), not a placeholder — but pixel-perfect visual polish is explicitly out of scope (see the design spec).

---

### Task 1: Backend schema additions (lap_number, sector times)

**Files:**
- Modify: `backend/app/schema.py:20-31` (the `DriverState` class)
- Test: `backend/tests/test_schema.py`

**Interfaces:**
- Produces: `DriverState` gains `lap_number: int | None = None`, `sector_1_time: float | None = None`, `sector_2_time: float | None = None`, `sector_3_time: float | None = None`. All other fields unchanged. Later tasks (adapter, frontend types, Tire Strategy panel, Sector Times panel) rely on these exact names.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_schema.py`:

```python
def test_driver_state_carries_lap_number_and_sector_times():
    driver = DriverState(
        driver_number="1",
        abbreviation="VER",
        team="Red Bull",
        position=1,
        gap_to_leader=None,
        gap_to_ahead=None,
        last_lap_time=91.234,
        best_lap_time=90.5,
        tire=Tire(compound="SOFT", age_laps=3),
        lap_number=12,
        sector_1_time=28.1,
        sector_2_time=31.4,
        sector_3_time=31.734,
    )
    dumped = driver.model_dump(mode="json")
    assert dumped["lap_number"] == 12
    assert dumped["sector_1_time"] == 28.1
    assert dumped["sector_3_time"] == 31.734


def test_driver_state_lap_number_and_sectors_default_to_none():
    driver = DriverState(
        driver_number="1", abbreviation="VER", team="Red Bull", position=1,
        gap_to_leader=None, gap_to_ahead=None, last_lap_time=None, best_lap_time=None,
        tire=Tire(compound="SOFT", age_laps=0),
    )
    assert driver.lap_number is None
    assert driver.sector_1_time is None
    assert driver.sector_2_time is None
    assert driver.sector_3_time is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_schema.py -v`
Expected: FAIL — `TypeError: DriverState.__init__() got an unexpected keyword argument 'lap_number'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/schema.py`, change the `DriverState` class to:

```python
class DriverState(BaseModel):
    driver_number: str
    abbreviation: str
    team: str
    position: int
    gap_to_leader: float | None = None
    gap_to_ahead: float | None = None
    last_lap_time: float | None = None
    best_lap_time: float | None = None
    tire: Tire
    x: float | None = None
    y: float | None = None
    lap_number: int | None = None
    sector_1_time: float | None = None
    sector_2_time: float | None = None
    sector_3_time: float | None = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_schema.py -v`
Expected: PASS (all tests in file, 3 total)

- [ ] **Step 5: Commit**

```bash
git add backend/app/schema.py backend/tests/test_schema.py
git commit -m "feat(backend): add lap_number and sector times to DriverState schema"
```

---

### Task 2: FastF1 adapter populates lap_number and sector times

**Files:**
- Modify: `backend/app/fastf1_adapter.py:34-48` (the `DriverState(...)` construction inside `session_states_from_laps`)
- Test: `backend/tests/test_fastf1_adapter.py`

**Interfaces:**
- Consumes: `DriverState` from `app.schema` (now with `lap_number`/`sector_*_time`, Task 1).
- Produces: no signature change to `session_states_from_laps` or `load_session_states` — same as Plan 1, just populates more fields per `DriverState`.

FastF1's laps DataFrame carries `Sector1Time`, `Sector2Time`, `Sector3Time` as `Timedelta` (or `NaT` if missing, e.g. an out-lap) — the same dataframe this function already receives. `LapNumber` is already the groupby key.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_fastf1_adapter.py` (uses the existing `_laps_df` helper — extend its rows to include sector columns; the existing four rows plus their sector times):

```python
def _laps_df_with_sectors():
    laps, session_start = _laps_df()
    laps["Sector1Time"] = [
        timedelta(seconds=28.0), timedelta(seconds=27.5),
        timedelta(seconds=28.5), pd.NaT,
    ]
    laps["Sector2Time"] = [
        timedelta(seconds=32.0), timedelta(seconds=31.5),
        timedelta(seconds=32.5), timedelta(seconds=32.0),
    ]
    laps["Sector3Time"] = [
        timedelta(seconds=32.0), timedelta(seconds=31.0),
        timedelta(seconds=32.0), timedelta(seconds=31.5),
    ]
    return laps, session_start


def test_session_states_from_laps_includes_lap_number_and_sector_times():
    laps, session_start = _laps_df_with_sectors()
    states = session_states_from_laps(laps, session_start)
    ver_lap1 = next(d for d in states[0].drivers if d.abbreviation == "VER")
    assert ver_lap1.lap_number == 1
    assert ver_lap1.sector_1_time == 28.0
    assert ver_lap1.sector_2_time == 32.0
    assert ver_lap1.sector_3_time == 32.0


def test_session_states_from_laps_handles_missing_sector_time():
    laps, session_start = _laps_df_with_sectors()
    states = session_states_from_laps(laps, session_start)
    # HAM's lap 2 (index 3 in the fixture rows) has NaT Sector1Time
    ham_lap2 = next(d for d in states[1].drivers if d.abbreviation == "HAM")
    assert ham_lap2.sector_1_time is None
    assert ham_lap2.sector_2_time == 32.0
    assert ham_lap2.sector_3_time == 31.5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fastf1_adapter.py -v`
Expected: FAIL — `AttributeError` or assertion failure (`lap_number`/`sector_1_time` not populated, defaults to `None`/missing)

- [ ] **Step 3: Write minimal implementation**

In `backend/app/fastf1_adapter.py`, add a helper and update the `DriverState(...)` construction:

```python
def _sector_seconds(value) -> float | None:
    return None if pd.isna(value) else value.total_seconds()
```

Place this function above `session_states_from_laps`. Then change the `DriverState(...)` call inside the loop to:

```python
            drivers.append(
                DriverState(
                    driver_number=number,
                    abbreviation=row["Driver"],
                    team=row["Team"],
                    # ponytail: replay v1 has no live gap/interval data from FastF1 laps table;
                    # live mode (future plan) fills these from f1-dash.
                    position=int(row["Position"]),
                    gap_to_leader=None,
                    gap_to_ahead=None,
                    last_lap_time=last_lap_seconds,
                    best_lap_time=best_so_far,
                    tire=Tire(compound=row["Compound"], age_laps=age_laps),
                    lap_number=int(lap_number),
                    sector_1_time=_sector_seconds(row["Sector1Time"]),
                    sector_2_time=_sector_seconds(row["Sector2Time"]),
                    sector_3_time=_sector_seconds(row["Sector3Time"]),
                )
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fastf1_adapter.py -v`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add backend/app/fastf1_adapter.py backend/tests/test_fastf1_adapter.py
git commit -m "feat(backend): populate lap_number and sector times in FastF1 adapter"
```

---

### Task 3: Track layout computation + session cache

**Files:**
- Modify: `backend/app/fastf1_adapter.py` (add new functions, keep existing ones unchanged)
- Test: `backend/tests/test_fastf1_adapter.py`

**Interfaces:**
- Produces: `track_layout_from_telemetry(telemetry: pd.DataFrame, num_points: int = 150) -> list[list[float]]` (pure, testable — takes a DataFrame with `X`/`Y` columns, returns a downsampled list of `[x, y]` pairs). `get_or_load_session(year: int, event: str, session_type: str, cache_dir: str) -> fastf1.core.Session` (caches loaded sessions in a module-level dict keyed by `(year, event, session_type)`, so repeated calls for the same session don't reload). `load_track_layout(year: int, event: str, session_type: str, cache_dir: str) -> list[list[float]]` (uses `get_or_load_session`, picks the fastest lap, computes its telemetry, calls `track_layout_from_telemetry`). Task 4 (the endpoint) calls `load_track_layout`.
- Also: refactor `load_session_states` to use `get_or_load_session` internally instead of calling `fastf1.get_session(...).load()` directly, so a replay-then-track-layout sequence for the same session reuses the cached session object instead of reloading from FastF1/network twice.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_fastf1_adapter.py`:

```python
def test_track_layout_from_telemetry_downsamples_to_requested_points():
    telemetry = pd.DataFrame({
        "X": [float(i) for i in range(300)],
        "Y": [float(i) * 2 for i in range(300)],
    })
    layout = track_layout_from_telemetry(telemetry, num_points=50)
    assert len(layout) <= 50
    assert len(layout) > 0
    assert all(len(point) == 2 for point in layout)


def test_track_layout_from_telemetry_preserves_point_order():
    telemetry = pd.DataFrame({"X": [0.0, 1.0, 2.0, 3.0], "Y": [0.0, 1.0, 2.0, 3.0]})
    layout = track_layout_from_telemetry(telemetry, num_points=4)
    assert layout[0] == [0.0, 0.0]
    assert layout[-1][0] <= 3.0


def test_track_layout_from_telemetry_handles_fewer_points_than_requested():
    telemetry = pd.DataFrame({"X": [0.0, 1.0, 2.0], "Y": [0.0, 1.0, 2.0]})
    layout = track_layout_from_telemetry(telemetry, num_points=150)
    assert len(layout) == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fastf1_adapter.py -v`
Expected: FAIL — `ImportError`/`NameError: name 'track_layout_from_telemetry' is not defined`

- [ ] **Step 3: Write minimal implementation**

Add to `backend/app/fastf1_adapter.py` (below the existing `load_session_states` function):

```python
def track_layout_from_telemetry(telemetry: pd.DataFrame, num_points: int = 150) -> list[list[float]]:
    total = len(telemetry)
    if total == 0:
        return []
    step = max(1, total // num_points)
    sampled = telemetry.iloc[::step]
    return [[float(row["X"]), float(row["Y"])] for _, row in sampled.iterrows()]


_session_cache: dict[tuple[int, str, str], "fastf1.core.Session"] = {}


def get_or_load_session(year: int, event: str, session_type: str, cache_dir: str) -> "fastf1.core.Session":
    key = (year, event, session_type)
    if key not in _session_cache:
        fastf1.Cache.enable_cache(cache_dir)
        session = fastf1.get_session(year, event, session_type)
        session.load()
        _session_cache[key] = session
    return _session_cache[key]


def load_track_layout(year: int, event: str, session_type: str, cache_dir: str) -> list[list[float]]:
    session = get_or_load_session(year, event, session_type, cache_dir)
    fastest_lap = session.laps.pick_fastest()
    telemetry = fastest_lap.get_telemetry()
    return track_layout_from_telemetry(telemetry)
```

Then replace the body of the existing `load_session_states` function with:

```python
def load_session_states(year: int, event: str, session_type: str, cache_dir: str) -> list[SessionState]:
    session = get_or_load_session(year, event, session_type, cache_dir)
    session_start = session.session_start_time.to_pydatetime() if session.session_start_time is not None else session.date
    return session_states_from_laps(session.laps, session_start)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fastf1_adapter.py -v`
Expected: PASS (all tests in file — the new ones plus all pre-existing ones, confirming the `load_session_states` refactor didn't break anything)

- [ ] **Step 5: Commit**

```bash
git add backend/app/fastf1_adapter.py backend/tests/test_fastf1_adapter.py
git commit -m "feat(backend): add track layout computation and session cache"
```

---

### Task 4: `GET /session/track-layout` endpoint

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_main.py`

**Interfaces:**
- Consumes: `load_track_layout` from `app.fastf1_adapter` (Task 3).
- Produces: `GET /session/track-layout?year=&event=&session_type=` returning `{"points": [[x, y], ...]}` as JSON.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_main.py`:

```python
def test_track_layout_endpoint_returns_points(monkeypatch):
    monkeypatch.setattr(
        "app.main.load_track_layout",
        lambda **kwargs: [[0.0, 0.0], [1.0, 2.0], [2.0, 4.0]],
    )
    resp = client.get("/session/track-layout", params={
        "year": 2026, "event": "Silverstone", "session_type": "R",
    })
    assert resp.status_code == 200
    assert resp.json() == {"points": [[0.0, 0.0], [1.0, 2.0], [2.0, 4.0]]}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_main.py -v`
Expected: FAIL — 404 Not Found (route doesn't exist)

- [ ] **Step 3: Write minimal implementation**

In `backend/app/main.py`, change the import line:

```python
from app.fastf1_adapter import load_session_states, load_track_layout
```

Add the new endpoint (after the existing `start_replay` endpoint):

```python
@app.get("/session/track-layout")
async def track_layout(year: int, event: str, session_type: str):
    points = load_track_layout(
        year=year, event=event, session_type=session_type, cache_dir=CACHE_DIR,
    )
    return {"points": points}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_main.py -v`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_main.py
git commit -m "feat(backend): add GET /session/track-layout endpoint"
```

---

### Task 5: Frontend data layer — types sync, session history hook, replay controls

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/useSessionSocket.ts`
- Modify: `frontend/src/api/useSessionSocket.test.ts`
- Create: `frontend/src/controls/ReplayControls.tsx`
- Create: `frontend/src/controls/ReplayControls.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `DriverState` in `types.ts` gains `lap_number: number | null`, `sector_1_time: number | null`, `sector_2_time: number | null`, `sector_3_time: number | null` (matching `backend/app/schema.py` from Task 1 exactly). `useSessionSocket(url: string): SessionState[]` now returns the **full history** of received ticks (breaking change from Plan 1's `SessionState | null` — the only consumer, `App.tsx`, is updated in this same task; `TimingTower` itself is untouched, it still takes `state: SessionState | null`, which `App.tsx` now derives as `history[history.length - 1] ?? null`). `ReplayControls({ onStarted }: { onStarted: (params: { year: number; event: string; sessionType: string }) => void })` — a form with year/event/session_type/speed inputs that POSTs to `/session/replay` on submit and calls `onStarted` with the submitted params on success (HTTP 202).
- Consumes: existing `SessionState` shape.

- [ ] **Step 1: Update types.ts**

In `frontend/src/types.ts`, change the `DriverState` interface to:

```ts
export interface DriverState {
  driver_number: string;
  abbreviation: string;
  team: string;
  position: number;
  gap_to_leader: number | null;
  gap_to_ahead: number | null;
  last_lap_time: number | null;
  best_lap_time: number | null;
  tire: Tire;
  x: number | null;
  y: number | null;
  lap_number: number | null;
  sector_1_time: number | null;
  sector_2_time: number | null;
  sector_3_time: number | null;
}
```

- [ ] **Step 2: Write the failing test for useSessionSocket's history behavior**

Replace the contents of `frontend/src/api/useSessionSocket.test.ts` with:

```ts
import { renderHook, act } from "@testing-library/react";
import { useSessionSocket } from "./useSessionSocket";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {}
}

function sampleState(timestamp: string) {
  return { timestamp, track_status: "green", drivers: [] };
}

test("returns an empty history before any message arrives", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useSessionSocket("ws://test/ws/session"));
  expect(result.current).toEqual([]);
});

test("accumulates each received message into history, in order", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useSessionSocket("ws://test/ws/session"));
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

  act(() => {
    socket.onmessage?.({ data: JSON.stringify(sampleState("t1")) });
  });
  act(() => {
    socket.onmessage?.({ data: JSON.stringify(sampleState("t2")) });
  });

  expect(result.current).toHaveLength(2);
  expect(result.current[0].timestamp).toBe("t1");
  expect(result.current[1].timestamp).toBe("t2");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `expect(result.current).toEqual([])` fails because the current hook returns `null`

- [ ] **Step 4: Update useSessionSocket to accumulate history**

Replace `frontend/src/api/useSessionSocket.ts` with:

```ts
import { useEffect, useState } from "react";
import type { SessionState } from "../types";

export function useSessionSocket(url: string): SessionState[] {
  const [history, setHistory] = useState<SessionState[]>([]);

  useEffect(() => {
    setHistory([]);
    const socket = new WebSocket(url);
    socket.onmessage = (event: { data: string }) => {
      const state = JSON.parse(event.data) as SessionState;
      setHistory((prev) => [...prev, state]);
    };
    return () => socket.close();
  }, [url]);

  return history;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 6: Write the failing test for ReplayControls**

Create `frontend/src/controls/ReplayControls.test.tsx`:

```tsx
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
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — cannot find module `./ReplayControls`

- [ ] **Step 8: Implement ReplayControls**

Create `frontend/src/controls/ReplayControls.tsx`:

```tsx
import { useState } from "react";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

export function ReplayControls({
  onStarted,
}: {
  onStarted: (params: { year: number; event: string; sessionType: string }) => void;
}) {
  const [year, setYear] = useState("2023");
  const [event, setEvent] = useState("Silverstone");
  const [sessionType, setSessionType] = useState("R");
  const [speed, setSpeed] = useState("10");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedYear = Number(year);
    const response = await fetch(`${API_URL}/session/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: parsedYear,
        event,
        session_type: sessionType,
        speed: Number(speed),
      }),
    });
    if (response.ok) {
      onStarted({ year: parsedYear, event, sessionType });
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="replay-year">Year</label>
      <input id="replay-year" value={year} onChange={(e) => setYear(e.target.value)} />

      <label htmlFor="replay-event">Event</label>
      <input id="replay-event" value={event} onChange={(e) => setEvent(e.target.value)} />

      <label htmlFor="replay-session-type">Session type</label>
      <input id="replay-session-type" value={sessionType} onChange={(e) => setSessionType(e.target.value)} />

      <label htmlFor="replay-speed">Speed</label>
      <input id="replay-speed" value={speed} onChange={(e) => setSpeed(e.target.value)} />

      <button type="submit">Start replay</button>
    </form>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 10: Update App.tsx to use history + controls**

Replace `frontend/src/App.tsx` with:

```tsx
import { useState } from "react";
import { useSessionSocket } from "./api/useSessionSocket";
import { ReplayControls } from "./controls/ReplayControls";
import { TimingTower } from "./panels/TimingTower";

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8000/ws/session";

export default function App() {
  const history = useSessionSocket(WS_URL);
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const [sessionParams, setSessionParams] = useState<{ year: number; event: string; sessionType: string } | null>(null);

  return (
    <div>
      <header><h1>PitWall</h1></header>
      <ReplayControls onStarted={setSessionParams} />
      <nav>
        <button>Timing Tower</button>
      </nav>
      <main>
        <TimingTower state={latest} />
      </main>
    </div>
  );
}
```

(`sessionParams` is unused by name outside this assignment for now — Task 9 wires it into the Track Map tab. Leaving it here keeps `App.tsx`'s diff isolated to what this task needs.)

- [ ] **Step 11: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS (all files)

- [ ] **Step 12: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/useSessionSocket.ts frontend/src/api/useSessionSocket.test.ts frontend/src/controls/ReplayControls.tsx frontend/src/controls/ReplayControls.test.tsx frontend/src/App.tsx
git commit -m "feat(frontend): session history hook, replay controls, sync schema types"
```

---

### Task 6: Track Map panel

**Files:**
- Create: `frontend/src/panels/TrackMap.tsx`
- Create: `frontend/src/panels/TrackMap.test.tsx`

**Interfaces:**
- Consumes: `SessionState` type from `../types`. `API_URL` pattern matches `ReplayControls.tsx` (`import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000"`).
- Produces: `TrackMap({ state, sessionParams }: { state: SessionState | null; sessionParams: { year: number; event: string; sessionType: string } | null })` — fetches `/session/track-layout` once when `sessionParams` changes, renders an SVG path auto-scaled to the layout's bounding box, plus a colored dot per driver with non-null `x`/`y` in `state`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/panels/TrackMap.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TrackMap } from "./TrackMap";
import type { SessionState } from "../types";

test("fetches and renders the track outline for the given session params", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ points: [[0, 0], [10, 0], [10, 10], [0, 10]] }),
  });

  render(<TrackMap state={null} sessionParams={{ year: 2023, event: "Silverstone", sessionType: "R" }} />);

  await waitFor(() => expect(screen.getByTestId("track-outline")).toBeInTheDocument());
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/session/track-layout"));
});

test("shows a placeholder message when no session has been started", () => {
  render(<TrackMap state={null} sessionParams={null} />);
  expect(screen.getByText(/start a session/i)).toBeInTheDocument();
});

test("plots a dot for each driver with known x/y", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ points: [[0, 0], [10, 10]] }),
  });

  const state: SessionState = {
    timestamp: "t1",
    track_status: "green",
    drivers: [
      {
        driver_number: "1", abbreviation: "VER", team: "Red Bull", position: 1,
        gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
        tire: { compound: "SOFT", age_laps: 1 }, x: 5, y: 5,
        lap_number: 1, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      },
    ],
  };

  render(<TrackMap state={state} sessionParams={{ year: 2023, event: "Silverstone", sessionType: "R" }} />);
  await waitFor(() => expect(screen.getByTestId("driver-dot-1")).toBeInTheDocument());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — cannot find module `./TrackMap`

- [ ] **Step 3: Implement TrackMap**

Create `frontend/src/panels/TrackMap.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { SessionState } from "../types";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

type SessionParams = { year: number; event: string; sessionType: string } | null;

export function TrackMap({ state, sessionParams }: { state: SessionState | null; sessionParams: SessionParams }) {
  const [points, setPoints] = useState<[number, number][]>([]);

  useEffect(() => {
    if (!sessionParams) return;
    const url = `${API_URL}/session/track-layout?year=${sessionParams.year}&event=${encodeURIComponent(sessionParams.event)}&session_type=${sessionParams.sessionType}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: { points: [number, number][] }) => setPoints(data.points));
  }, [sessionParams]);

  if (!sessionParams) {
    return <p>Start a session to see the track map.</p>;
  }

  if (points.length === 0) {
    return <p>Loading track layout...</p>;
  }

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const padding = Math.max(width, height) * 0.05;

  const pathD = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ") + " Z";

  const driversWithPosition = state?.drivers.filter((d) => d.x !== null && d.y !== null) ?? [];

  return (
    <svg
      viewBox={`${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`}
      style={{ width: "100%", height: "auto" }}
    >
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
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/TrackMap.tsx frontend/src/panels/TrackMap.test.tsx
git commit -m "feat(frontend): add Track Map panel"
```

---

### Task 7: Tire Strategy panel

**Files:**
- Create: `frontend/src/panels/TireStrategy.tsx`
- Create: `frontend/src/panels/TireStrategy.test.tsx`

**Interfaces:**
- Consumes: `SessionState` type from `../types`.
- Produces: `TireStrategy({ history }: { history: SessionState[] })` — for each driver, collapses their `(lap_number, tire.compound)` history (read from every tick in `history`, deduplicated by `lap_number` per driver since multiple ticks can carry the same lap) into stints, and renders one horizontal bar per driver with one colored segment per stint labeled with its compound and lap range.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/panels/TireStrategy.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TireStrategy } from "./TireStrategy";
import type { SessionState } from "../types";

function driverTick(lap: number, compound: string): SessionState {
  return {
    timestamp: `t${lap}`,
    track_status: "green",
    drivers: [
      {
        driver_number: "1", abbreviation: "VER", team: "Red Bull", position: 1,
        gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
        tire: { compound, age_laps: 1 }, x: null, y: null,
        lap_number: lap, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      },
    ],
  };
}

test("collapses consecutive same-compound laps into one stint", () => {
  const history = [driverTick(1, "SOFT"), driverTick(2, "SOFT"), driverTick(3, "SOFT")];
  render(<TireStrategy history={history} />);
  expect(screen.getByTestId("stint-1-SOFT-1-3")).toBeInTheDocument();
});

test("splits into multiple stints on a compound change", () => {
  const history = [driverTick(1, "SOFT"), driverTick(2, "SOFT"), driverTick(3, "MEDIUM")];
  render(<TireStrategy history={history} />);
  expect(screen.getByTestId("stint-1-SOFT-1-2")).toBeInTheDocument();
  expect(screen.getByTestId("stint-1-MEDIUM-3-3")).toBeInTheDocument();
});

test("shows a placeholder when there is no history yet", () => {
  render(<TireStrategy history={[]} />);
  expect(screen.getByText(/waiting for session data/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — cannot find module `./TireStrategy`

- [ ] **Step 3: Implement TireStrategy**

Create `frontend/src/panels/TireStrategy.tsx`:

```tsx
import type { SessionState } from "../types";

type Stint = { compound: string; startLap: number; endLap: number };

function stintsForDriver(history: SessionState[], driverNumber: string): Stint[] {
  const lapEntries = new Map<number, string>();
  for (const tick of history) {
    const driver = tick.drivers.find((d) => d.driver_number === driverNumber);
    if (driver && driver.lap_number !== null) {
      lapEntries.set(driver.lap_number, driver.tire.compound);
    }
  }
  const laps = [...lapEntries.keys()].sort((a, b) => a - b);

  const stints: Stint[] = [];
  for (const lap of laps) {
    const compound = lapEntries.get(lap) as string;
    const current = stints[stints.length - 1];
    if (current && current.compound === compound && lap === current.endLap + 1) {
      current.endLap = lap;
    } else {
      stints.push({ compound, startLap: lap, endLap: lap });
    }
  }
  return stints;
}

export function TireStrategy({ history }: { history: SessionState[] }) {
  if (history.length === 0) {
    return <p>Waiting for session data...</p>;
  }

  const latestTick = history[history.length - 1];
  const driverNumbers = [...new Set(latestTick.drivers.map((d) => d.driver_number))];

  return (
    <div>
      {driverNumbers.map((driverNumber) => {
        const driver = latestTick.drivers.find((d) => d.driver_number === driverNumber);
        const stints = stintsForDriver(history, driverNumber);
        return (
          <div key={driverNumber} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ width: 40 }}>{driver?.abbreviation}</span>
            <div style={{ display: "flex", gap: 2 }}>
              {stints.map((stint) => (
                <div
                  key={`${stint.compound}-${stint.startLap}`}
                  data-testid={`stint-${driverNumber}-${stint.compound}-${stint.startLap}-${stint.endLap}`}
                  style={{ padding: "2px 8px", background: "#333", borderRadius: 4 }}
                >
                  {stint.compound} ({stint.startLap}-{stint.endLap})
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/TireStrategy.tsx frontend/src/panels/TireStrategy.test.tsx
git commit -m "feat(frontend): add Tire Strategy panel"
```

---

### Task 8: Sector Times panel

**Files:**
- Create: `frontend/src/panels/SectorTimes.tsx`
- Create: `frontend/src/panels/SectorTimes.test.tsx`

**Interfaces:**
- Consumes: `SessionState` type from `../types`.
- Produces: `SectorTimes({ state }: { state: SessionState | null })` — table of each driver's latest sector 1/2/3 times from `state`, with each cell colored purple if it's the session-wide best for that sector (computed from `state.drivers` at render time — only the latest tick's values, no history needed), otherwise default color.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/panels/SectorTimes.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SectorTimes } from "./SectorTimes";
import type { SessionState } from "../types";

function driver(num: string, abbr: string, s1: number, s2: number, s3: number): SessionState["drivers"][number] {
  return {
    driver_number: num, abbreviation: abbr, team: "Team", position: 1,
    gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
    tire: { compound: "SOFT", age_laps: 1 }, x: null, y: null,
    lap_number: 5, sector_1_time: s1, sector_2_time: s2, sector_3_time: s3,
  };
}

test("renders one row per driver with sector times", () => {
  const state: SessionState = {
    timestamp: "t1", track_status: "green",
    drivers: [driver("1", "VER", 28.0, 32.0, 31.0), driver("44", "HAM", 28.5, 31.5, 31.2)],
  };
  render(<SectorTimes state={state} />);
  expect(screen.getByText("VER")).toBeInTheDocument();
  expect(screen.getByText("28.000")).toBeInTheDocument();
});

test("marks the session-best sector time cell", () => {
  const state: SessionState = {
    timestamp: "t1", track_status: "green",
    drivers: [driver("1", "VER", 28.0, 32.0, 31.0), driver("44", "HAM", 27.5, 31.5, 31.2)],
  };
  render(<SectorTimes state={state} />);
  expect(screen.getByTestId("sector1-best-44")).toBeInTheDocument();
});

test("shows a placeholder when there is no state yet", () => {
  render(<SectorTimes state={null} />);
  expect(screen.getByText(/waiting for session data/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — cannot find module `./SectorTimes`

- [ ] **Step 3: Implement SectorTimes**

Create `frontend/src/panels/SectorTimes.tsx`:

```tsx
import type { SessionState } from "../types";

function bestDriverNumber(
  drivers: SessionState["drivers"],
  field: "sector_1_time" | "sector_2_time" | "sector_3_time",
): string | null {
  let best: { driverNumber: string; time: number } | null = null;
  for (const d of drivers) {
    const time = d[field];
    if (time !== null && (best === null || time < best.time)) {
      best = { driverNumber: d.driver_number, time };
    }
  }
  return best?.driverNumber ?? null;
}

export function SectorTimes({ state }: { state: SessionState | null }) {
  if (!state) {
    return <p>Waiting for session data...</p>;
  }

  const bestS1 = bestDriverNumber(state.drivers, "sector_1_time");
  const bestS2 = bestDriverNumber(state.drivers, "sector_2_time");
  const bestS3 = bestDriverNumber(state.drivers, "sector_3_time");

  return (
    <table>
      <thead>
        <tr><th>Driver</th><th>S1</th><th>S2</th><th>S3</th></tr>
      </thead>
      <tbody>
        {state.drivers.map((d) => (
          <tr key={d.driver_number}>
            <td>{d.abbreviation}</td>
            <td data-testid={d.driver_number === bestS1 ? `sector1-best-${d.driver_number}` : undefined}>
              {d.sector_1_time?.toFixed(3) ?? "-"}
            </td>
            <td data-testid={d.driver_number === bestS2 ? `sector2-best-${d.driver_number}` : undefined}>
              {d.sector_2_time?.toFixed(3) ?? "-"}
            </td>
            <td data-testid={d.driver_number === bestS3 ? `sector3-best-${d.driver_number}` : undefined}>
              {d.sector_3_time?.toFixed(3) ?? "-"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/SectorTimes.tsx frontend/src/panels/SectorTimes.test.tsx
git commit -m "feat(frontend): add Sector Times panel"
```

---

### Task 9: Tab-switcher shell + dark theme CSS

**Files:**
- Create: `frontend/src/App.css`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/App.test.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `TimingTower`, `TrackMap`, `TireStrategy`, `SectorTimes`, `ReplayControls`, `useSessionSocket` (all from Tasks 5-8).
- Produces: `App` renders a tab bar with 4 tabs (Timing Tower, Track Map, Tire Strategy, Sector Times), clicking a tab shows only that panel, number keys 1-4 also switch tabs.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/App.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — cannot find module `./App.test.tsx` counterparts / tab buttons with those accessible names don't exist yet

- [ ] **Step 3: Write the dark theme stylesheet**

Create `frontend/src/App.css`:

```css
:root {
  color-scheme: dark;
}

body {
  margin: 0;
  background: #050607;
  color: #e5e7eb;
  font-family: -apple-system, "SF Mono", "Helvetica Neue", Arial, sans-serif;
}

.pitwall-header {
  padding: 12px 16px;
  border-bottom: 1px solid #1a1d1f;
}

.pitwall-header h1 {
  margin: 0;
  font-size: 16px;
  letter-spacing: 2px;
  color: #6b7280;
  text-transform: uppercase;
}

.pitwall-tabs {
  display: flex;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid #1a1d1f;
}

.pitwall-tab {
  background: #14171a;
  color: #9ca3af;
  border: 1px solid #1a1d1f;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 12px;
  letter-spacing: 0.5px;
  cursor: pointer;
}

.pitwall-tab.active {
  background: #1e293b;
  color: #3ecbff;
  border-color: #3ecbff;
}

.pitwall-main {
  padding: 16px;
}

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}

th {
  text-align: left;
  color: #6b7280;
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 6px 8px;
}

td {
  padding: 6px 8px;
  border-top: 1px solid #1a1d1f;
}
```

- [ ] **Step 4: Rewrite App.tsx with tab switching**

Replace `frontend/src/App.tsx` with:

```tsx
import { useEffect, useState } from "react";
import "./App.css";
import { useSessionSocket } from "./api/useSessionSocket";
import { ReplayControls } from "./controls/ReplayControls";
import { TimingTower } from "./panels/TimingTower";
import { TrackMap } from "./panels/TrackMap";
import { TireStrategy } from "./panels/TireStrategy";
import { SectorTimes } from "./panels/SectorTimes";

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8000/ws/session";

const TABS = ["Timing Tower", "Track Map", "Tire Strategy", "Sector Times"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const history = useSessionSocket(WS_URL);
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const [sessionParams, setSessionParams] = useState<{ year: number; event: string; sessionType: string } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Timing Tower");

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const index = Number(e.key) - 1;
      if (index >= 0 && index < TABS.length) {
        setActiveTab(TABS[index]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div>
      <header className="pitwall-header"><h1>PitWall</h1></header>
      <ReplayControls onStarted={setSessionParams} />
      <nav className="pitwall-tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`pitwall-tab${tab === activeTab ? " active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
      <main className="pitwall-main">
        {activeTab === "Timing Tower" && <TimingTower state={latest} />}
        {activeTab === "Track Map" && <TrackMap state={latest} sessionParams={sessionParams} />}
        {activeTab === "Tire Strategy" && <TireStrategy history={history} />}
        {activeTab === "Sector Times" && <SectorTimes state={latest} />}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Import the stylesheet in main.tsx**

In `frontend/src/main.tsx`, no change needed if `App.tsx` imports `./App.css` directly (Vite bundles CSS imports found anywhere) — verify `frontend/src/main.tsx` still just renders `<App />` with no changes required. If it does need touching, keep the diff to nothing beyond confirming the existing render call is unchanged.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all files)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.css frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat(frontend): add tab-switcher shell with dark theme CSS"
```

---

## Self-Review Notes
- Spec coverage: schema additions (Task 1), adapter population (Task 2), track layout + session cache (Task 3), track-layout endpoint (Task 4), session history + replay controls (Task 5), Track Map/Tire Strategy/Sector Times panels (Tasks 6-8), tab-switcher shell + dark theme (Task 9) — all spec sections covered. Live mode and AI layer remain out of scope per the spec.
- Placeholder scan: none — every step has runnable code and exact commands.
- Type consistency: `DriverState`'s new fields (`lap_number`, `sector_1_time/2/3_time`) match verbatim between `backend/app/schema.py` (Task 1), `backend/app/fastf1_adapter.py` (Task 2), and `frontend/src/types.ts` (Task 5). `useSessionSocket`'s new `SessionState[]` return type is consumed consistently by `App.tsx` (Task 5, then Task 9) and `TireStrategy` (Task 7). `TrackMap`'s `sessionParams` shape (`{ year, event, sessionType }`) matches what `ReplayControls`'s `onStarted` callback produces (Task 5) and what `App.tsx` threads through (Task 9).
