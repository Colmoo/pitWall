# PitWall Live Mode (f1-dash Integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live-timing mode to PitWall that connects to a running f1-dash `realtime` service and streams the same `SessionState` schema replay mode already produces, so the frontend and every panel need zero changes to support it.

**Architecture:** f1-dash's `realtime` service exposes Server-Sent Events at `GET /api/realtime` (two event types: `"initial"` full snapshot, `"update"` merge-patch fragments) carrying F1's own live-timing feed topics as an untyped, deep-merged JSON tree. The backend adds a pure merge-patch function, a pure SSE-text parser, and a pure tree→`SessionState` translator (all unit-testable without any network access), plus a thin `LiveAdapter` I/O class that wires them together against a real SSE stream — following the same "pure core, thin I/O wrapper" split already used for the FastF1 replay adapter. A session-task-cancellation helper lets starting either mode stop whichever was previously running.

**Tech Stack:** Same backend stack as prior plans (Python 3.11/FastAPI/httpx), same frontend stack (React/TS/Vite). Adds f1-dash's published `realtime` image to Docker Compose.

## Global Constraints
- **Field names for `TimingData`/`DriverList`/`TrackStatus`/`TimingAppData` are best-effort**, based on F1's publicly documented live-timing feed schema (the same schema FastF1's own bundled `fastf1.livetiming` client parses) — confirmed from f1-dash's actual source code that it forwards these topics close to verbatim from F1's feed, but the exact field shapes have **not** been verified against a real live SSE stream (there is no way to test that outside an actual F1 session weekend). Every task touching these field names carries a `ponytail:` comment saying so. Task 6 adds an explicit manual verification step for the next live session — this is a real, callable-out limitation, not a plan gap.
- `CarData.z` and `Position.z` (gzip+base64-compressed car telemetry/position topics) are **out of scope** for this plan — `DriverState.x`/`y` stay `None` in live mode too, matching replay mode's existing limitation (see `docs/superpowers/specs/2026-07-08-pitwall-panels-and-live-design.md`). No task in this plan touches car position.
- No breaking changes to `SessionState`/`DriverState` (`backend/app/schema.py`) — live mode populates the same schema replay mode does, just with real gaps/track-status instead of `None`/`green`.
- f1-dash's `realtime` service is reached at `http://f1-dash-realtime/api/realtime` inside the Docker Compose network (service name `f1-dash-realtime`, listening on container port 80 per its own `ADDRESS` default) — this exact URL is the default `sse_url` value used throughout.
- No new backend dependencies beyond `httpx` (already present). No new frontend dependencies.

---

### Task 1: Merge-patch pure function

**Files:**
- Create: `backend/app/live_merge.py`
- Test: `backend/tests/test_live_merge.py`

**Interfaces:**
- Produces: `merge_patch(base: dict, patch: dict) -> dict` — pure, recursive: dict keys merge recursively, list items merge by index (patch extends base if longer), any other patch value (including `None`, scalars) replaces the corresponding base value outright. Used by Task 4's `LiveAdapter` to apply f1-dash's `"update"` SSE events onto the running state tree.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_live_merge.py
from app.live_merge import merge_patch


def test_merge_patch_recursively_merges_nested_dicts():
    base = {"DriverList": {"1": {"Tla": "VER", "TeamName": "Red Bull"}}}
    patch = {"DriverList": {"1": {"Tla": "VER"}, "44": {"Tla": "HAM"}}}
    result = merge_patch(base, patch)
    assert result == {
        "DriverList": {
            "1": {"Tla": "VER", "TeamName": "Red Bull"},
            "44": {"Tla": "HAM"},
        }
    }


def test_merge_patch_replaces_scalar_values():
    base = {"TrackStatus": {"Status": "1", "Message": "AllClear"}}
    patch = {"TrackStatus": {"Status": "2"}}
    result = merge_patch(base, patch)
    assert result == {"TrackStatus": {"Status": "2", "Message": "AllClear"}}


def test_merge_patch_merges_lists_by_index_and_extends():
    base = {"Sectors": [{"Value": "28.1"}, {"Value": "31.0"}]}
    patch = {"Sectors": [{"Value": "27.9"}, {}, {"Value": "32.0"}]}
    result = merge_patch(base, patch)
    assert result == {
        "Sectors": [{"Value": "27.9"}, {"Value": "31.0"}, {"Value": "32.0"}]
    }


def test_merge_patch_does_not_mutate_inputs():
    base = {"a": {"b": 1}}
    patch = {"a": {"c": 2}}
    merge_patch(base, patch)
    assert base == {"a": {"b": 1}}
    assert patch == {"a": {"c": 2}}


def test_merge_patch_on_empty_base_returns_patch_shape():
    result = merge_patch({}, {"DriverList": {"1": {"Tla": "VER"}}})
    assert result == {"DriverList": {"1": {"Tla": "VER"}}}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_live_merge.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.live_merge'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/live_merge.py
def merge_patch(base, patch):
    if isinstance(base, dict) and isinstance(patch, dict):
        result = dict(base)
        for key, value in patch.items():
            result[key] = merge_patch(result.get(key), value)
        return result

    if isinstance(base, list) and isinstance(patch, list):
        result = list(base)
        for index, value in enumerate(patch):
            if index < len(result):
                result[index] = merge_patch(result[index], value)
            else:
                result.append(value)
        return result

    return patch
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_live_merge.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/live_merge.py backend/tests/test_live_merge.py
git commit -m "feat(backend): add pure merge-patch function for live state updates"
```

---

### Task 2: SSE text parser

**Files:**
- Create: `backend/app/sse_parser.py`
- Test: `backend/tests/test_sse_parser.py`

**Interfaces:**
- Produces: `parse_sse_events(text: str) -> list[tuple[str, str]]` — pure, parses a raw SSE text block (one or more `\n\n`-separated events, each with `event:`/`data:` lines) into a list of `(event_type, data)` pairs. Multi-line `data:` fields within one event are joined with `\n`. An event with no `event:` line defaults to `"message"`. Used by Task 4's `LiveAdapter`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_sse_parser.py
from app.sse_parser import parse_sse_events


def test_parse_sse_events_extracts_event_type_and_data():
    text = 'event: initial\ndata: {"a": 1}\n\n'
    events = parse_sse_events(text)
    assert events == [("initial", '{"a": 1}')]


def test_parse_sse_events_defaults_to_message_when_no_event_line():
    text = 'data: {"a": 1}\n\n'
    events = parse_sse_events(text)
    assert events == [("message", '{"a": 1}')]


def test_parse_sse_events_handles_multiple_events():
    text = 'event: initial\ndata: {"a": 1}\n\nevent: update\ndata: {"b": 2}\n\n'
    events = parse_sse_events(text)
    assert events == [("initial", '{"a": 1}'), ("update", '{"b": 2}')]


def test_parse_sse_events_joins_multiline_data():
    text = 'event: update\ndata: line1\ndata: line2\n\n'
    events = parse_sse_events(text)
    assert events == [("update", "line1\nline2")]


def test_parse_sse_events_ignores_blocks_with_no_data():
    text = 'event: initial\n\nevent: update\ndata: {"b": 2}\n\n'
    events = parse_sse_events(text)
    assert events == [("update", '{"b": 2}')]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_sse_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.sse_parser'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/sse_parser.py
def parse_sse_events(text: str) -> list[tuple[str, str]]:
    events: list[tuple[str, str]] = []
    for block in text.strip("\n").split("\n\n"):
        if not block.strip():
            continue

        event_type = "message"
        data_lines: list[str] = []
        for line in block.split("\n"):
            if line.startswith("event:"):
                event_type = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:"):].strip())

        if data_lines:
            events.append((event_type, "\n".join(data_lines)))

    return events
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_sse_parser.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/sse_parser.py backend/tests/test_sse_parser.py
git commit -m "feat(backend): add pure SSE text parser"
```

---

### Task 3: Live tree → SessionState translator

**Files:**
- Create: `backend/app/live_adapter.py`
- Test: `backend/tests/test_live_adapter.py`

**Interfaces:**
- Consumes: `SessionState`, `DriverState`, `Tire`, `TrackStatus` from `app.schema`.
- Produces: `session_state_from_live_tree(tree: dict, timestamp: datetime) -> SessionState | None` — pure. Returns `None` if the tree doesn't yet have both `DriverList` and `TimingData.Lines` (i.e. not enough data has arrived yet to build a snapshot — this happens right after connecting, before the `"initial"` event's full topics have all been merged in real usage, or in a test with a partial tree). Used by Task 4's `LiveAdapter`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_live_adapter.py
from datetime import datetime, timezone

from app.live_adapter import session_state_from_live_tree
from app.schema import TrackStatus


def _tree(**overrides):
    base = {
        "DriverList": {
            "1": {"Tla": "VER", "TeamName": "Red Bull Racing"},
            "44": {"Tla": "HAM", "TeamName": "Mercedes"},
            "_kf": True,
        },
        "TimingData": {
            "Lines": {
                "1": {
                    "Position": "1",
                    "GapToLeader": "",
                    "LastLapTime": {"Value": "1:32.456"},
                    "BestLapTime": {"Value": "1:32.101"},
                    "NumberOfLaps": 12,
                    "Sectors": [{"Value": "28.1"}, {"Value": "32.0"}, {"Value": "32.356"}],
                },
                "44": {
                    "Position": "2",
                    "GapToLeader": "+1.204",
                    "LastLapTime": {"Value": "1:32.901"},
                    "BestLapTime": {"Value": "1:32.500"},
                    "NumberOfLaps": 12,
                    "Sectors": [{"Value": "28.3"}, {"Value": "32.1"}, {"Value": "32.501"}],
                },
            }
        },
        "TimingAppData": {
            "Lines": {
                "1": {"Stints": [{"Compound": "MEDIUM", "TotalLaps": 8}, {"Compound": "SOFT", "TotalLaps": 4}]},
                "44": {"Stints": [{"Compound": "MEDIUM", "TotalLaps": 12}]},
            }
        },
        "TrackStatus": {"Status": "1", "Message": "AllClear"},
    }
    base.update(overrides)
    return base


def test_session_state_from_live_tree_builds_drivers_sorted_by_position():
    ts = datetime(2026, 7, 8, tzinfo=timezone.utc)
    state = session_state_from_live_tree(_tree(), ts)
    assert state is not None
    assert [d.abbreviation for d in state.drivers] == ["VER", "HAM"]
    assert state.timestamp == ts


def test_session_state_from_live_tree_parses_lap_times_and_gap():
    state = session_state_from_live_tree(_tree(), datetime.now(timezone.utc))
    ver = next(d for d in state.drivers if d.abbreviation == "VER")
    ham = next(d for d in state.drivers if d.abbreviation == "HAM")
    assert ver.last_lap_time == 92.456
    assert ver.best_lap_time == 92.101
    assert ver.gap_to_leader is None  # empty string, leader has no gap
    assert ham.gap_to_leader == 1.204


def test_session_state_from_live_tree_parses_sectors_and_lap_number():
    state = session_state_from_live_tree(_tree(), datetime.now(timezone.utc))
    ver = next(d for d in state.drivers if d.abbreviation == "VER")
    assert ver.sector_1_time == 28.1
    assert ver.sector_2_time == 32.0
    assert ver.sector_3_time == 32.356
    assert ver.lap_number == 12


def test_session_state_from_live_tree_uses_latest_stint_for_tire():
    state = session_state_from_live_tree(_tree(), datetime.now(timezone.utc))
    ver = next(d for d in state.drivers if d.abbreviation == "VER")
    assert ver.tire.compound == "SOFT"
    assert ver.tire.age_laps == 4


def test_session_state_from_live_tree_maps_track_status_code():
    state = session_state_from_live_tree(_tree(TrackStatus={"Status": "2", "Message": "Yellow"}), datetime.now(timezone.utc))
    assert state.track_status == TrackStatus.YELLOW


def test_session_state_from_live_tree_defaults_unknown_track_status_to_green():
    state = session_state_from_live_tree(_tree(TrackStatus={"Status": "99", "Message": "?"}), datetime.now(timezone.utc))
    assert state.track_status == TrackStatus.GREEN


def test_session_state_from_live_tree_returns_none_when_data_incomplete():
    assert session_state_from_live_tree({"Heartbeat": {"Utc": "now"}}, datetime.now(timezone.utc)) is None
    assert session_state_from_live_tree({"DriverList": {"1": {"Tla": "VER"}}}, datetime.now(timezone.utc)) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_live_adapter.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.live_adapter'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/live_adapter.py
from datetime import datetime

from app.schema import DriverState, SessionState, Tire, TrackStatus

# ponytail: these field names and status codes are best-effort, based on F1's
# publicly documented live-timing feed schema (the same one fastf1.livetiming
# parses) as forwarded near-verbatim by f1-dash's realtime service. Not yet
# verified against a real live SSE stream — confirm during the next live
# session and adjust here if a field name is wrong.
_TRACK_STATUS_CODES = {
    "1": TrackStatus.GREEN,
    "2": TrackStatus.YELLOW,
    "4": TrackStatus.SC,
    "5": TrackStatus.RED,
    "6": TrackStatus.VSC,
    "7": TrackStatus.VSC,
}


def _parse_lap_time(value) -> float | None:
    if not value:
        return None
    try:
        if ":" in value:
            minutes, rest = value.split(":", 1)
            return int(minutes) * 60 + float(rest)
        return float(value)
    except (ValueError, TypeError):
        return None


def _parse_gap(value) -> float | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return float(value.replace("+", ""))
    except ValueError:
        return None


def _parse_sector(sectors: list, index: int) -> float | None:
    if index >= len(sectors):
        return None
    value = sectors[index].get("Value")
    if not value:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def session_state_from_live_tree(tree: dict, timestamp: datetime) -> SessionState | None:
    driver_list = tree.get("DriverList")
    timing_lines = tree.get("TimingData", {}).get("Lines")
    if not driver_list or not timing_lines:
        return None

    app_data_lines = tree.get("TimingAppData", {}).get("Lines", {})

    drivers: list[DriverState] = []
    for number, timing in timing_lines.items():
        driver_info = driver_list.get(number)
        if not isinstance(driver_info, dict):
            continue
        position = timing.get("Position")
        if not position:
            continue

        sectors = timing.get("Sectors", [])
        stints = app_data_lines.get(number, {}).get("Stints", [])
        latest_stint = stints[-1] if stints else {}

        drivers.append(
            DriverState(
                driver_number=number,
                abbreviation=driver_info.get("Tla", number),
                team=driver_info.get("TeamName", ""),
                position=int(position),
                gap_to_leader=_parse_gap(timing.get("GapToLeader")),
                gap_to_ahead=_parse_gap(timing.get("IntervalToPositionAhead", {}).get("Value")),
                last_lap_time=_parse_lap_time(timing.get("LastLapTime", {}).get("Value")),
                best_lap_time=_parse_lap_time(timing.get("BestLapTime", {}).get("Value")),
                tire=Tire(
                    compound=latest_stint.get("Compound", "UNKNOWN"),
                    age_laps=int(latest_stint.get("TotalLaps", 0)),
                ),
                lap_number=timing.get("NumberOfLaps"),
                sector_1_time=_parse_sector(sectors, 0),
                sector_2_time=_parse_sector(sectors, 1),
                sector_3_time=_parse_sector(sectors, 2),
            )
        )

    if not drivers:
        return None

    status_code = tree.get("TrackStatus", {}).get("Status")
    track_status = _TRACK_STATUS_CODES.get(status_code, TrackStatus.GREEN)

    return SessionState(
        timestamp=timestamp,
        track_status=track_status,
        drivers=sorted(drivers, key=lambda d: d.position),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_live_adapter.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/live_adapter.py backend/tests/test_live_adapter.py
git commit -m "feat(backend): add live tree to SessionState translator (best-effort field mapping)"
```

---

### Task 4: LiveAdapter SSE client

**Files:**
- Modify: `backend/app/live_adapter.py` (add to the file created in Task 3)
- Test: `backend/tests/test_live_adapter.py` (one integration-style test using a fake httpx transport — no real network)

**Interfaces:**
- Consumes: `merge_patch` from `app.live_merge`, `parse_sse_events` from `app.sse_parser`, `session_state_from_live_tree` from this file (Task 3).
- Produces: `class LiveAdapter` with `__init__(self, sse_url: str)` and `async def stream(self) -> AsyncIterator[SessionState]`. Used by Task 5's session controller — same shape as `ReplayEngine.stream()` from the core-slice plan, so `main.py` can treat both uniformly.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_live_adapter.py`:

```python
import httpx
import pytest

from app.live_adapter import LiveAdapter


@pytest.mark.asyncio
async def test_live_adapter_stream_yields_states_from_sse_events():
    sse_body = (
        'event: initial\n'
        'data: {"DriverList": {"1": {"Tla": "VER", "TeamName": "Red Bull"}}, '
        '"TimingData": {"Lines": {"1": {"Position": "1", "LastLapTime": {"Value": "1:30.000"}}}}, '
        '"TrackStatus": {"Status": "1"}}\n\n'
        'event: update\n'
        'data: {"TimingData": {"Lines": {"1": {"Position": "1", "LastLapTime": {"Value": "1:29.500"}}}}}\n\n'
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=sse_body)

    transport = httpx.MockTransport(handler)
    adapter = LiveAdapter("http://fake/api/realtime")
    adapter._transport = transport  # test seam, see Step 3

    states = [state async for state in adapter.stream()]

    assert len(states) == 2
    assert states[0].drivers[0].last_lap_time == 90.0
    assert states[1].drivers[0].last_lap_time == 89.5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_live_adapter.py -v`
Expected: FAIL — `AttributeError: 'LiveAdapter' object has no attribute 'stream'` (or `NameError` if `LiveAdapter` doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

Append to `backend/app/live_adapter.py`:

```python
import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone

import httpx

from app.live_merge import merge_patch
from app.sse_parser import parse_sse_events


class LiveAdapter:
    def __init__(self, sse_url: str):
        self._sse_url = sse_url
        self._transport = None  # test seam: MockTransport in tests, real network otherwise

    async def stream(self) -> AsyncIterator[SessionState]:
        tree: dict = {}
        async with httpx.AsyncClient(transport=self._transport, timeout=None) as client:
            async with client.stream("GET", self._sse_url) as response:
                buffer = ""
                async for chunk in response.aiter_text():
                    buffer += chunk
                    while "\n\n" in buffer:
                        block, buffer = buffer.split("\n\n", 1)
                        for event_type, data in parse_sse_events(block + "\n\n"):
                            try:
                                payload = json.loads(data)
                            except json.JSONDecodeError:
                                continue

                            tree = payload if event_type == "initial" else merge_patch(tree, payload)

                            state = session_state_from_live_tree(tree, datetime.now(timezone.utc))
                            if state is not None:
                                yield state
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_live_adapter.py -v`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add backend/app/live_adapter.py backend/tests/test_live_adapter.py
git commit -m "feat(backend): add LiveAdapter SSE client wiring merge/parse/translate together"
```

---

### Task 5: Session-task cancellation + `POST /session/live` endpoint

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_main.py`

**Interfaces:**
- Consumes: `LiveAdapter` from `app.live_adapter`.
- Produces: `POST /session/live` (body: `{"sse_url": "http://f1-dash-realtime/api/realtime"}`, `sse_url` optional with that default) starts the live adapter, publishing to the existing `broadcaster`. Starting a new session (replay or live) while one is already running cancels the previous one first.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_main.py`:

```python
def test_live_endpoint_streams_states_over_websocket(monkeypatch):
    from app.schema import SessionState, TrackStatus
    from datetime import datetime, timezone

    fixed_states = [
        SessionState(timestamp=datetime(2026, 7, 8, tzinfo=timezone.utc), track_status=TrackStatus.GREEN, drivers=[]),
    ]

    class FakeLiveAdapter:
        def __init__(self, sse_url):
            self.sse_url = sse_url

        async def stream(self):
            for state in fixed_states:
                yield state

    monkeypatch.setattr("app.main.LiveAdapter", FakeLiveAdapter)

    with client.websocket_connect("/ws/session") as ws:
        resp = client.post("/session/live", json={})
        assert resp.status_code == 202
        received = ws.receive_json()
        assert received["track_status"] == "green"


def test_starting_a_new_session_cancels_the_previous_one(monkeypatch):
    import asyncio

    monkeypatch.setattr("app.main.load_session_states", lambda **kwargs: [])

    class NeverEndingAdapter:
        def __init__(self, sse_url):
            pass

        async def stream(self):
            while True:
                await asyncio.sleep(3600)
                yield None  # pragma: no cover

    monkeypatch.setattr("app.main.LiveAdapter", NeverEndingAdapter)

    with client.websocket_connect("/ws/session"):
        first_resp = client.post("/session/live", json={})
        assert first_resp.status_code == 202
        first_task = app_module._current_task

        second_resp = client.post("/session/replay", json={"year": 2026, "event": "Silverstone", "session_type": "R", "speed": 1000.0})
        assert second_resp.status_code == 202

        assert first_task.cancelled() or first_task.done()
```

Add this import near the top of `backend/tests/test_main.py` (alongside the existing `from app.main import app`):

```python
from app import main as app_module
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_main.py -v`
Expected: FAIL — 404 on `/session/live` (route doesn't exist), and `AttributeError: module 'app.main' has no attribute '_current_task'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/main.py`, change the import line:

```python
from app.fastf1_adapter import load_session_states, load_track_layout
from app.live_adapter import LiveAdapter
```

Add a module-level task tracker and helper (place after `CACHE_DIR = ...`):

```python
_current_task: asyncio.Task | None = None


def _start_session_task(coro) -> None:
    global _current_task
    if _current_task is not None and not _current_task.done():
        _current_task.cancel()
    _current_task = asyncio.create_task(coro)
```

Change `start_replay` to use it:

```python
@app.post("/session/replay", status_code=202)
async def start_replay(req: ReplayRequest):
    states = load_session_states(
        year=req.year, event=req.event, session_type=req.session_type, cache_dir=CACHE_DIR,
    )
    _start_session_task(_run_replay(states, req.speed))
    return {"status": "started", "states": len(states)}
```

Add the live request model and endpoint (after `start_replay`):

```python
class LiveRequest(BaseModel):
    sse_url: str = "http://f1-dash-realtime/api/realtime"


async def _run_live(sse_url: str) -> None:
    adapter = LiveAdapter(sse_url)
    async for state in adapter.stream():
        await broadcaster.publish(state)


@app.post("/session/live", status_code=202)
async def start_live(req: LiveRequest):
    _start_session_task(_run_live(req.sse_url))
    return {"status": "started"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_main.py -v`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_main.py
git commit -m "feat(backend): add POST /session/live endpoint with session-task cancellation"
```

---

### Task 6: Docker Compose — add f1-dash `realtime` service

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: nothing from earlier tasks directly — wires the container network so `http://f1-dash-realtime/api/realtime` (Task 5's default `sse_url`) resolves.

- [ ] **Step 1: Add the f1-dash-realtime service**

Add this service to `docker-compose.yml` (alongside the existing `backend`/`frontend` services):

```yaml
  f1-dash-realtime:
    image: ghcr.io/slowlydev/f1-dash-realtime:dev
    environment:
      - ADDRESS=0.0.0.0:80
      - RUST_LOG=info
    ports:
      - "4000:80"
```

Read the current `docker-compose.yml` first and insert this as a new top-level entry under `services:`, preserving the existing `backend`/`frontend`/`volumes` blocks exactly as they are — only add this new service.

- [ ] **Step 2: Verify it builds and connects**

Run: `docker compose up --build -d`
Expected: three containers start (`backend`, `frontend`, `f1-dash-realtime`).

Run: `curl -s http://localhost:4000/api/health`
Expected: a 200-series response (exact body not asserted — this only confirms the service is reachable; f1-dash's `/api/health` route was confirmed to exist during research, its response shape wasn't).

Run: `curl -s -X POST http://localhost:8000/session/live -H "Content-Type: application/json" -d '{"sse_url": "http://f1-dash-realtime/api/realtime"}'`
Expected: `{"status":"started"}` — confirms the backend container can resolve and reach the `f1-dash-realtime` service by its Compose service name over the internal network. (This does not confirm real F1 data flows — that's only observable during an actual live session, per this plan's Global Constraints.)

Run: `docker compose down`

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add f1-dash realtime service to Docker Compose"
```

---

### Task 7: Frontend — "Start Live" control

**Files:**
- Modify: `frontend/src/controls/ReplayControls.tsx`
- Modify: `frontend/src/controls/ReplayControls.test.tsx`

**Interfaces:**
- Modifies: `ReplayControls`'s existing `onStarted` prop is unchanged in shape for the replay path; a live session doesn't have `{ year, event, sessionType }` (there's no historical session being replayed), so `onStarted` is simply not called for the live path — `App.tsx`'s `sessionParams` stays `null` when live mode starts, which the Track Map panel already handles by showing "Start a session to see the track map" (accurate, since live mode doesn't have track-layout data without a year/event/session_type to fetch it from — this is a known, acceptable v1 gap, not a bug to fix here).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/controls/ReplayControls.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name /start live/i`

- [ ] **Step 3: Add the button and handler**

In `frontend/src/controls/ReplayControls.tsx`, add a new handler function (alongside `handleSubmit`) and a new button in the returned JSX:

```tsx
  async function handleStartLive() {
    await fetch(`${API_URL}/session/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }
```

Add `<button type="button" onClick={handleStartLive}>Start live</button>` immediately after the existing `<button type="submit">Start replay</button>` line, still inside the `<form>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all files)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/controls/ReplayControls.tsx frontend/src/controls/ReplayControls.test.tsx
git commit -m "feat(frontend): add Start Live button to session controls"
```

---

## Self-Review Notes
- Spec coverage: SSE (not WebSocket) client (Tasks 2, 4), merge-patch state tree (Task 1), best-effort field translation with documented uncertainty (Task 3), session-task cancellation + live endpoint (Task 5), Docker Compose wiring with the real published image (Task 6), frontend control (Task 7) — all covered. Car position (`x`/`y`) is explicitly out of scope per Global Constraints, matching the design spec's correction.
- Placeholder scan: none — every step has runnable code and exact commands. The "best-effort, unverified against a live feed" caveat is a named, real limitation (with a concrete follow-up: manual verification next live session), not a placeholder standing in for undone work.
- Type consistency: `LiveAdapter.stream()` returns the same `AsyncIterator[SessionState]` shape as `ReplayEngine.stream()`, so `main.py`'s `_run_live`/`_run_replay` are symmetric. `session_state_from_live_tree`'s return type (`SessionState | None`) is consumed correctly by `LiveAdapter.stream()` (skips yielding on `None`). `merge_patch`, `parse_sse_events`, and `session_state_from_live_tree` signatures used in Task 4 match exactly what Tasks 1-3 defined.
