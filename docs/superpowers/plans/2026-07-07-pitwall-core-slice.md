# PitWall Core Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working, Dockerized end-to-end slice of PitWall: FastF1 historical replay streamed over WebSocket from a FastAPI backend, rendered as a Timing Tower panel in a React frontend.

**Architecture:** FastAPI backend loads a FastF1 session, converts it to a shared `SessionState` schema (lap-granularity), replays it at a configurable speed over an in-memory pub/sub broadcaster, and pushes each state to connected WebSocket clients. React frontend connects via a WS hook and renders the Timing Tower panel. Both services run via Docker Compose.

**Tech Stack:** Python 3.11, FastAPI, fastf1, pytest; React 18, TypeScript, Vite, Vitest + Testing Library; Docker Compose.

## Global Constraints
- Backend lives under `backend/`, frontend under `frontend/`, both at repo root alongside `docker-compose.yml`.
- Shared data contract is the `SessionState` schema defined in Task 2 — every later task (frontend types, live-mode adapter in a future plan) must match its field names exactly.
- Replay v1 deliberately omits precise gap-to-leader/ahead and live track status (FastF1's laps table doesn't carry these cleanly) — fields exist in the schema as `Optional`/nullable and are `None` in replay mode. Live mode (future plan) will populate them from f1-dash.
- No new dependencies beyond what's listed per task.

---

### Task 1: Backend scaffold + health check

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Test: `backend/tests/test_main.py`

**Interfaces:**
- Produces: FastAPI `app` instance in `backend/app/main.py`, `GET /health` returning `{"status": "ok"}`.

- [ ] **Step 1: Create requirements file**

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
fastf1==3.4.2
pydantic==2.9.2
httpx==0.27.2
pytest==8.3.3
pytest-asyncio==0.24.0
websockets==13.1
```

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_main.py
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `backend/`): `python -m pytest tests/test_main.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app'` or connection error (app doesn't exist yet).

- [ ] **Step 4: Write minimal implementation**

```python
# backend/app/__init__.py
```
(empty file, makes `app` a package)

```python
# backend/app/main.py
from fastapi import FastAPI

app = FastAPI(title="PitWall")


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_main.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/app/__init__.py backend/app/main.py backend/tests/test_main.py
git commit -m "feat(backend): scaffold FastAPI app with health check"
```

---

### Task 2: Shared SessionState schema

**Files:**
- Create: `backend/app/schema.py`
- Test: `backend/tests/test_schema.py`

**Interfaces:**
- Produces: `TrackStatus` (str Enum: `green`, `yellow`, `safety_car`, `virtual_safety_car`, `red`), `Tire(compound: str, age_laps: int)`, `DriverState(driver_number: str, abbreviation: str, team: str, position: int, gap_to_leader: float | None, gap_to_ahead: float | None, last_lap_time: float | None, best_lap_time: float | None, tire: Tire, x: float | None = None, y: float | None = None)`, `SessionState(timestamp: datetime, track_status: TrackStatus, drivers: list[DriverState])`. All in `backend/app/schema.py`. Every later task imports from here — do not redefine.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_schema.py
from datetime import datetime, timezone
from app.schema import SessionState, DriverState, Tire, TrackStatus


def test_session_state_roundtrip():
    state = SessionState(
        timestamp=datetime(2026, 7, 7, tzinfo=timezone.utc),
        track_status=TrackStatus.GREEN,
        drivers=[
            DriverState(
                driver_number="1",
                abbreviation="VER",
                team="Red Bull",
                position=1,
                gap_to_leader=None,
                gap_to_ahead=None,
                last_lap_time=91.234,
                best_lap_time=90.5,
                tire=Tire(compound="SOFT", age_laps=3),
            )
        ],
    )
    dumped = state.model_dump(mode="json")
    assert dumped["track_status"] == "green"
    assert dumped["drivers"][0]["tire"]["compound"] == "SOFT"
    restored = SessionState.model_validate(dumped)
    assert restored.drivers[0].abbreviation == "VER"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_schema.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.schema'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/schema.py
from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class TrackStatus(str, Enum):
    GREEN = "green"
    YELLOW = "yellow"
    SC = "safety_car"
    VSC = "virtual_safety_car"
    RED = "red"


class Tire(BaseModel):
    compound: str
    age_laps: int


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


class SessionState(BaseModel):
    timestamp: datetime
    track_status: TrackStatus
    drivers: list[DriverState]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_schema.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/schema.py backend/tests/test_schema.py
git commit -m "feat(backend): add shared SessionState schema"
```

---

### Task 3: FastF1 adapter (lap-granularity replay data)

**Files:**
- Create: `backend/app/fastf1_adapter.py`
- Test: `backend/tests/test_fastf1_adapter.py`

**Interfaces:**
- Consumes: `SessionState`, `DriverState`, `Tire`, `TrackStatus` from `app.schema`.
- Produces: `session_states_from_laps(laps: "pandas.DataFrame", session_start: datetime) -> list[SessionState]` (pure function, testable without network) and `load_session_states(year: int, event: str, session_type: str, cache_dir: str) -> list[SessionState]` (thin wrapper that calls FastF1, used only at runtime — not unit tested directly, covered by the pure function's tests).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_fastf1_adapter.py
from datetime import datetime, timedelta, timezone

import pandas as pd

from app.fastf1_adapter import session_states_from_laps


def _laps_df():
    session_start = datetime(2026, 7, 7, 13, 0, tzinfo=timezone.utc)
    rows = [
        # Driver VER: lap 1 then lap 2 (improves best lap)
        dict(Driver="VER", DriverNumber="1", Team="Red Bull", LapNumber=1,
             Position=1.0, LapTime=timedelta(seconds=92.0),
             Time=timedelta(minutes=1, seconds=32), Compound="SOFT", TyreLife=1.0),
        dict(Driver="VER", DriverNumber="1", Team="Red Bull", LapNumber=2,
             Position=1.0, LapTime=timedelta(seconds=90.0),
             Time=timedelta(minutes=3, seconds=2), Compound="SOFT", TyreLife=2.0),
        # Driver HAM: lap 1 then lap 2
        dict(Driver="HAM", DriverNumber="44", Team="Mercedes", LapNumber=1,
             Position=2.0, LapTime=timedelta(seconds=93.0),
             Time=timedelta(minutes=1, seconds=33), Compound="MEDIUM", TyreLife=1.0),
        dict(Driver="HAM", DriverNumber="44", Team="Mercedes", LapNumber=2,
             Position=2.0, LapTime=timedelta(seconds=91.5),
             Time=timedelta(minutes=3, seconds=4, milliseconds=500), Compound="MEDIUM", TyreLife=2.0),
    ]
    return pd.DataFrame(rows), session_start


def test_session_states_from_laps_groups_by_lap_number():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    assert len(states) == 2
    assert all(len(s.drivers) == 2 for s in states)


def test_session_states_from_laps_computes_running_best_lap():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    ver_lap1 = next(d for d in states[0].drivers if d.abbreviation == "VER")
    ver_lap2 = next(d for d in states[1].drivers if d.abbreviation == "VER")
    assert ver_lap1.last_lap_time == 92.0
    assert ver_lap1.best_lap_time == 92.0
    assert ver_lap2.last_lap_time == 90.0
    assert ver_lap2.best_lap_time == 90.0  # improved


def test_session_states_from_laps_maps_tire_and_position():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    ham_lap1 = next(d for d in states[0].drivers if d.abbreviation == "HAM")
    assert ham_lap1.tire.compound == "MEDIUM"
    assert ham_lap1.tire.age_laps == 1
    assert ham_lap1.position == 2
    assert ham_lap1.driver_number == "44"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_fastf1_adapter.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.fastf1_adapter'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/fastf1_adapter.py
from datetime import datetime

import fastf1
import pandas as pd

from app.schema import DriverState, SessionState, Tire, TrackStatus


def session_states_from_laps(laps: pd.DataFrame, session_start: datetime) -> list[SessionState]:
    states: list[SessionState] = []
    best_lap_by_driver: dict[str, float] = {}

    for lap_number, group in laps.groupby("LapNumber"):
        lap_time_at_end = group["Time"].max()
        timestamp = session_start + lap_time_at_end

        drivers: list[DriverState] = []
        for _, row in group.iterrows():
            last_lap_seconds = row["LapTime"].total_seconds()
            number = str(row["DriverNumber"])
            best_so_far = best_lap_by_driver.get(number)
            if best_so_far is None or last_lap_seconds < best_so_far:
                best_so_far = last_lap_seconds
            best_lap_by_driver[number] = best_so_far

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
                    tire=Tire(compound=row["Compound"], age_laps=int(row["TyreLife"])),
                )
            )

        states.append(
            SessionState(
                timestamp=timestamp,
                # ponytail: track status omitted in replay v1, defaults to green.
                track_status=TrackStatus.GREEN,
                drivers=sorted(drivers, key=lambda d: d.position),
            )
        )

    return states


def load_session_states(year: int, event: str, session_type: str, cache_dir: str) -> list[SessionState]:
    fastf1.Cache.enable_cache(cache_dir)
    session = fastf1.get_session(year, event, session_type)
    session.load()
    session_start = session.session_start_time.to_pydatetime() if session.session_start_time is not None else session.date
    return session_states_from_laps(session.laps, session_start)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_fastf1_adapter.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/fastf1_adapter.py backend/tests/test_fastf1_adapter.py
git commit -m "feat(backend): add FastF1 lap-granularity adapter"
```

---

### Task 4: Replay engine

**Files:**
- Create: `backend/app/replay.py`
- Test: `backend/tests/test_replay.py`

**Interfaces:**
- Consumes: `SessionState` from `app.schema`.
- Produces: `class ReplayEngine` with `__init__(self, states: list[SessionState], speed: float = 1.0)` and `async def stream(self) -> AsyncIterator[SessionState]`. Used by Task 5's session controller.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_replay.py
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.replay import ReplayEngine
from app.schema import SessionState, TrackStatus


def _states():
    t0 = datetime(2026, 7, 7, tzinfo=timezone.utc)
    return [
        SessionState(timestamp=t0, track_status=TrackStatus.GREEN, drivers=[]),
        SessionState(timestamp=t0 + timedelta(seconds=10), track_status=TrackStatus.GREEN, drivers=[]),
        SessionState(timestamp=t0 + timedelta(seconds=30), track_status=TrackStatus.GREEN, drivers=[]),
    ]


@pytest.mark.asyncio
async def test_replay_engine_yields_all_states_in_order():
    engine = ReplayEngine(_states(), speed=1000.0)
    with patch("app.replay.asyncio.sleep", new=AsyncMock()):
        yielded = [s async for s in engine.stream()]
    assert [s.timestamp for s in yielded] == [s.timestamp for s in _states()]


@pytest.mark.asyncio
async def test_replay_engine_sleeps_scaled_by_speed():
    engine = ReplayEngine(_states(), speed=2.0)
    with patch("app.replay.asyncio.sleep", new=AsyncMock()) as sleep_mock:
        _ = [s async for s in engine.stream()]
    # gaps are 10s and 20s real-time; at speed=2.0 -> 5s and 10s sleeps (first state has no prior sleep)
    slept = [call.args[0] for call in sleep_mock.call_args_list]
    assert slept == [5.0, 10.0]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_replay.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.replay'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/replay.py
import asyncio
from collections.abc import AsyncIterator

from app.schema import SessionState


class ReplayEngine:
    def __init__(self, states: list[SessionState], speed: float = 1.0):
        self._states = states
        self._speed = speed

    async def stream(self) -> AsyncIterator[SessionState]:
        previous_timestamp = None
        for state in self._states:
            if previous_timestamp is not None:
                real_gap = (state.timestamp - previous_timestamp).total_seconds()
                await asyncio.sleep(real_gap / self._speed)
            previous_timestamp = state.timestamp
            yield state
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_replay.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/replay.py backend/tests/test_replay.py
git commit -m "feat(backend): add replay engine with speed control"
```

---

### Task 5: Session broadcaster + WebSocket + replay-start endpoint

**Files:**
- Modify: `backend/app/main.py`
- Create: `backend/app/broadcaster.py`
- Test: `backend/tests/test_main.py` (extend)

**Interfaces:**
- Consumes: `SessionState` from `app.schema`, `ReplayEngine` from `app.replay`, `load_session_states` from `app.fastf1_adapter`.
- Produces: `class Broadcaster` with `subscribe(self) -> asyncio.Queue`, `unsubscribe(self, q: asyncio.Queue) -> None`, `async def publish(self, state: SessionState) -> None`. `POST /session/replay` (body: `{year, event, session_type, speed}`) starts a background replay task. `WS /ws/session` streams published states as JSON to the client.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_main.py (append to existing file)
from unittest.mock import patch
from datetime import datetime, timezone
from app.schema import SessionState, TrackStatus


def test_replay_and_websocket_stream(monkeypatch):
    fixed_states = [
        SessionState(timestamp=datetime(2026, 7, 7, tzinfo=timezone.utc), track_status=TrackStatus.GREEN, drivers=[]),
        SessionState(timestamp=datetime(2026, 7, 7, 0, 0, 1, tzinfo=timezone.utc), track_status=TrackStatus.GREEN, drivers=[]),
    ]
    monkeypatch.setattr("app.main.load_session_states", lambda **kwargs: fixed_states)

    with client.websocket_connect("/ws/session") as ws:
        resp = client.post("/session/replay", json={
            "year": 2026, "event": "Silverstone", "session_type": "R", "speed": 10000.0,
        })
        assert resp.status_code == 202
        first = ws.receive_json()
        second = ws.receive_json()
        assert first["track_status"] == "green"
        assert second["timestamp"] != first["timestamp"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_main.py -v`
Expected: FAIL — `AttributeError`/404 (endpoints don't exist yet).

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/broadcaster.py
import asyncio

from app.schema import SessionState


class Broadcaster:
    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    async def publish(self, state: SessionState) -> None:
        for queue in list(self._subscribers):
            await queue.put(state)
```

```python
# backend/app/main.py
import asyncio
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.broadcaster import Broadcaster
from app.fastf1_adapter import load_session_states
from app.replay import ReplayEngine

app = FastAPI(title="PitWall")
broadcaster = Broadcaster()
CACHE_DIR = os.environ.get("FASTF1_CACHE_DIR", "/tmp/fastf1_cache")


@app.get("/health")
def health():
    return {"status": "ok"}


class ReplayRequest(BaseModel):
    year: int
    event: str
    session_type: str
    speed: float = 1.0


async def _run_replay(states, speed: float) -> None:
    engine = ReplayEngine(states, speed=speed)
    async for state in engine.stream():
        await broadcaster.publish(state)


@app.post("/session/replay", status_code=202)
async def start_replay(req: ReplayRequest):
    states = load_session_states(
        year=req.year, event=req.event, session_type=req.session_type, cache_dir=CACHE_DIR,
    )
    asyncio.create_task(_run_replay(states, req.speed))
    return {"status": "started", "states": len(states)}


@app.websocket("/ws/session")
async def session_socket(websocket: WebSocket):
    await websocket.accept()
    queue = broadcaster.subscribe()
    try:
        while True:
            state = await queue.get()
            await websocket.send_json(state.model_dump(mode="json"))
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.unsubscribe(queue)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_main.py -v`
Expected: PASS (all tests in file, including Task 1's health test)

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/app/broadcaster.py backend/tests/test_main.py
git commit -m "feat(backend): add broadcaster, replay endpoint, and session websocket"
```

---

### Task 6: Frontend scaffold + Timing Tower panel

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/types.ts`
- Create: `frontend/src/api/useSessionSocket.ts`
- Create: `frontend/src/panels/TimingTower.tsx`
- Create: `frontend/src/App.tsx`
- Test: `frontend/src/panels/TimingTower.test.tsx`
- Test: `frontend/src/api/useSessionSocket.test.ts`

**Interfaces:**
- Produces: TypeScript types `Tire`, `DriverState`, `TrackStatus`, `SessionState` in `src/types.ts` mirroring `backend/app/schema.py` exactly (field names/casing). `useSessionSocket(url: string): SessionState | null` hook. `TimingTower({ state }: { state: SessionState | null })` component. `App` renders a single-tab shell hosting `TimingTower`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "pitwall-frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --host --port 5173",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.2",
    "vite": "^5.4.6",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Create Vite/TS config and entry point**

```ts
// frontend/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

```json
// frontend/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

```html
<!-- frontend/index.html -->
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>PitWall</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// frontend/src/main.tsx
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 3: Create shared types (mirrors backend/app/schema.py)**

```ts
// frontend/src/types.ts
export type TrackStatus = "green" | "yellow" | "safety_car" | "virtual_safety_car" | "red";

export interface Tire {
  compound: string;
  age_laps: number;
}

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
}

export interface SessionState {
  timestamp: string;
  track_status: TrackStatus;
  drivers: DriverState[];
}
```

- [ ] **Step 4: Write the failing test for TimingTower**

```tsx
// frontend/src/panels/TimingTower.test.tsx
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TimingTower } from "./TimingTower";
import type { SessionState } from "../types";

const sampleState: SessionState = {
  timestamp: "2026-07-07T13:00:00Z",
  track_status: "green",
  drivers: [
    {
      driver_number: "1", abbreviation: "VER", team: "Red Bull", position: 1,
      gap_to_leader: null, gap_to_ahead: null, last_lap_time: 90.5, best_lap_time: 90.1,
      tire: { compound: "SOFT", age_laps: 3 }, x: null, y: null,
    },
    {
      driver_number: "44", abbreviation: "HAM", team: "Mercedes", position: 2,
      gap_to_leader: null, gap_to_ahead: null, last_lap_time: 91.2, best_lap_time: 90.8,
      tire: { compound: "MEDIUM", age_laps: 5 }, x: null, y: null,
    },
  ],
};

test("renders drivers sorted by position with tire and lap info", () => {
  render(<TimingTower state={sampleState} />);
  const rows = screen.getAllByRole("row");
  expect(rows).toHaveLength(3); // header + 2 drivers
  expect(screen.getByText("VER")).toBeInTheDocument();
  expect(screen.getByText("SOFT (3)")).toBeInTheDocument();
});

test("renders empty message when state is null", () => {
  render(<TimingTower state={null} />);
  expect(screen.getByText(/waiting for session data/i)).toBeInTheDocument();
});
```

- [ ] **Step 5: Run test to verify it fails**

Run (from `frontend/`): `npm install && npm test`
Expected: FAIL — cannot find module `./TimingTower`

- [ ] **Step 6: Implement TimingTower**

```tsx
// frontend/src/panels/TimingTower.tsx
import type { SessionState } from "../types";

export function TimingTower({ state }: { state: SessionState | null }) {
  if (!state) {
    return <p>Waiting for session data...</p>;
  }
  const drivers = [...state.drivers].sort((a, b) => a.position - b.position);
  return (
    <table>
      <thead>
        <tr>
          <th>Pos</th><th>Driver</th><th>Team</th><th>Last Lap</th><th>Best Lap</th><th>Tire</th>
        </tr>
      </thead>
      <tbody>
        {drivers.map((d) => (
          <tr key={d.driver_number}>
            <td>{d.position}</td>
            <td>{d.abbreviation}</td>
            <td>{d.team}</td>
            <td>{d.last_lap_time?.toFixed(3) ?? "-"}</td>
            <td>{d.best_lap_time?.toFixed(3) ?? "-"}</td>
            <td>{d.tire.compound} ({d.tire.age_laps})</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test`
Expected: PASS (both TimingTower tests)

- [ ] **Step 8: Write the failing test for useSessionSocket**

```ts
// frontend/src/api/useSessionSocket.test.ts
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

test("updates state when a message arrives", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useSessionSocket("ws://test/ws/session"));
  expect(result.current).toBeNull();

  const socket = FakeWebSocket.instances[0];
  const payload = JSON.stringify({ timestamp: "t", track_status: "green", drivers: [] });
  act(() => {
    socket.onmessage?.({ data: payload });
  });

  expect(result.current).toEqual({ timestamp: "t", track_status: "green", drivers: [] });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./useSessionSocket`

- [ ] **Step 10: Implement useSessionSocket**

```ts
// frontend/src/api/useSessionSocket.ts
import { useEffect, useState } from "react";
import type { SessionState } from "../types";

export function useSessionSocket(url: string): SessionState | null {
  const [state, setState] = useState<SessionState | null>(null);

  useEffect(() => {
    const socket = new WebSocket(url);
    socket.onmessage = (event: { data: string }) => {
      setState(JSON.parse(event.data) as SessionState);
    };
    return () => socket.close();
  }, [url]);

  return state;
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 12: Wire up App shell**

```tsx
// frontend/src/App.tsx
import { useSessionSocket } from "./api/useSessionSocket";
import { TimingTower } from "./panels/TimingTower";

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8000/ws/session";

export default function App() {
  const state = useSessionSocket(WS_URL);
  return (
    <div>
      <header><h1>PitWall</h1></header>
      <nav>
        <button>Timing Tower</button>
      </nav>
      <main>
        <TimingTower state={state} />
      </main>
    </div>
  );
}
```

- [ ] **Step 13: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): scaffold Vite/React app with Timing Tower panel"
```

---

### Task 7: Docker Compose wiring

**Files:**
- Create: `backend/Dockerfile`
- Create: `frontend/Dockerfile`
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: everything built in Tasks 1-6.
- Produces: a runnable `docker compose up` bringing up backend on `:8000` and frontend on `:5173`.

- [ ] **Step 1: Write backend Dockerfile**

```dockerfile
# backend/Dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Write frontend Dockerfile**

```dockerfile
# frontend/Dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "run", "preview"]
```

- [ ] **Step 3: Write docker-compose.yml**

```yaml
# docker-compose.yml
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - FASTF1_CACHE_DIR=/data/fastf1_cache
    volumes:
      - fastf1_cache:/data/fastf1_cache

  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    environment:
      - VITE_BACKEND_WS_URL=ws://localhost:8000/ws/session
    depends_on:
      - backend

volumes:
  fastf1_cache:
```

- [ ] **Step 4: Verify it builds and runs**

Run: `docker compose up --build`
Expected: both containers start; `curl http://localhost:8000/health` returns `{"status":"ok"}`; `http://localhost:5173` loads the PitWall page showing "Waiting for session data...".

- [ ] **Step 5: Commit**

```bash
git add backend/Dockerfile frontend/Dockerfile docker-compose.yml
git commit -m "feat: add Docker Compose setup for backend and frontend"
```

---

## Self-Review Notes
- Spec coverage: replay mode (Tasks 3-5), shared schema (Task 2), timing tower panel (Task 6), Docker deployment (Task 7) — all covered. Live mode, remaining panels, and AI layer are explicitly deferred to their own plans per the spec's phased scope.
- Placeholder scan: none found — every step has runnable code and exact commands.
- Type consistency: `SessionState`/`DriverState`/`Tire`/`TrackStatus` field names match verbatim between `backend/app/schema.py` and `frontend/src/types.ts`; `ReplayEngine`, `Broadcaster`, `load_session_states` signatures match between defining and consuming tasks.
