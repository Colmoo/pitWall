# Pit Wall Front-End Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the dashboard into a dense, technical F1 pit-wall UI and add a landing page with validated year/track/session dropdowns, backed only by data the backend genuinely has (extending it for weather, race control, and per-lap telemetry where FastF1 actually provides it).

**Architecture:** Backend tasks extend `SessionState` (weather + race control messages, both attached server-side before broadcast) and add three read-only `/meta/*` endpoints plus one on-demand `/session/telemetry` endpoint. Frontend tasks restyle existing panels in place, add new panels that read straight off the already-streamed `SessionState` (no new fetch machinery needed for weather/race-control), and add a landing page that gates the dashboard behind a validated session picker.

**Tech Stack:** FastAPI + FastF1 (backend, Python 3.11, pytest), React + Vite + TypeScript (frontend, Vitest + Testing Library). No new dependencies on either side — charts are hand-rolled SVG, matching the existing `TrackMap` pattern.

## Global Constraints

- No new npm or pip dependencies. Charts are raw SVG, not a charting library.
- No fabricated/placeholder data. If a data source doesn't exist (ERS, fuel, PU status, video feeds, live weather, live telemetry), the panel says so — it does not render fake numbers.
- Dark theme only: extend `--bg`/`--panel`/`--border` already in `App.css`; sharp corners (≤2px radius); tabular-nums monospace for all numeric data cells.
- Backend: FastF1's `Session.load()` already loads laps/weather/messages/telemetry by default (verified against installed fastf1 3.4.2) — no new `session.load()` flags needed.
- Follow existing test conventions exactly: pytest fixtures build raw `pd.DataFrame`/dict trees by hand (see `test_fastf1_adapter.py`, `test_live_adapter.py`); frontend tests use `@testing-library/react` with `globals: true` (no explicit `vi` import needed, per `vite.config.ts`).

---

## Task 1: Fix replay gap_to_leader / gap_to_ahead

Replay mode has never populated `gap_to_leader`/`gap_to_ahead` (flagged by an existing `ponytail:` comment) even though FastF1's `Time` column already has each driver's cumulative session time per lap, which is enough to compute both.

**Files:**
- Modify: `backend/app/fastf1_adapter.py` (`session_states_from_laps`)
- Test: `backend/tests/test_fastf1_adapter.py`

**Interfaces:**
- Produces: `session_states_from_laps(laps, session_start)` now returns `DriverState`s with real `gap_to_leader`/`gap_to_ahead` (was always `None`). Signature unchanged.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_fastf1_adapter.py`:

```python
def test_session_states_from_laps_computes_gap_to_leader_and_ahead():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)

    ver_lap1 = next(d for d in states[0].drivers if d.abbreviation == "VER")
    ham_lap1 = next(d for d in states[0].drivers if d.abbreviation == "HAM")
    assert ver_lap1.gap_to_leader is None  # leader has no gap
    assert ver_lap1.gap_to_ahead is None
    assert ham_lap1.gap_to_leader == pytest.approx(1.0)  # HAM Time 1:33 - VER Time 1:32
    assert ham_lap1.gap_to_ahead == pytest.approx(1.0)   # only VER ahead

    ver_lap2 = next(d for d in states[1].drivers if d.abbreviation == "VER")
    ham_lap2 = next(d for d in states[1].drivers if d.abbreviation == "HAM")
    assert ver_lap2.gap_to_leader is None
    assert ham_lap2.gap_to_leader == pytest.approx(2.5)  # HAM Time 3:04.5 - VER Time 3:02
```

Add `import pytest` at the top of the file if not already present (it isn't — check the current imports and add it alongside the existing `numpy`/`pandas` imports).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_fastf1_adapter.py::test_session_states_from_laps_computes_gap_to_leader_and_ahead -v`
Expected: FAIL — `assert 1.0 == None` (or similar), since gaps are currently always `None`.

- [ ] **Step 3: Implement the gap calculation**

Replace the body of `session_states_from_laps` in `backend/app/fastf1_adapter.py` (the loop that builds `drivers` and appends to `states`) with:

```python
def session_states_from_laps(laps: pd.DataFrame, session_start: datetime) -> list[SessionState]:
    states: list[SessionState] = []
    best_lap_by_driver: dict[str, float] = {}

    for lap_number, group in laps.groupby("LapNumber"):
        lap_time_at_end = group["Time"].max()
        timestamp = session_start + lap_time_at_end

        # entries pairs each built DriverState with its raw cumulative session
        # Time, so gaps can be computed after sorting by classification order.
        entries: list[tuple[DriverState, "pd.Timedelta"]] = []
        for _, row in group.iterrows():
            # Real FastF1 data has NaN/NaT for out-laps, in-laps, red-flag laps,
            # and unclassified/retired drivers. Skip rows we can't build a usable
            # snapshot entry from, rather than crashing or fabricating values.
            if pd.isna(row["LapTime"]) or pd.isna(row["Position"]):
                continue

            last_lap_seconds = row["LapTime"].total_seconds()
            number = str(row["DriverNumber"])
            best_so_far = best_lap_by_driver.get(number)
            if best_so_far is None or last_lap_seconds < best_so_far:
                best_so_far = last_lap_seconds
            best_lap_by_driver[number] = best_so_far

            age_laps = 0 if pd.isna(row["TyreLife"]) else int(row["TyreLife"])

            driver_state = DriverState(
                driver_number=number,
                abbreviation=row["Driver"],
                team=row["Team"],
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
            entries.append((driver_state, row["Time"]))

        if not entries:
            continue

        entries.sort(key=lambda pair: pair[0].position)
        leader_time = entries[0][1]
        previous_time = None
        for driver_state, row_time in entries:
            is_leader = driver_state is entries[0][0]
            driver_state.gap_to_leader = None if is_leader else (row_time - leader_time).total_seconds()
            driver_state.gap_to_ahead = None if previous_time is None else (row_time - previous_time).total_seconds()
            previous_time = row_time

        states.append(
            SessionState(
                timestamp=timestamp,
                # ponytail: track status omitted in replay v1, defaults to green.
                track_status=TrackStatus.GREEN,
                drivers=[pair[0] for pair in entries],
            )
        )

    return states
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_fastf1_adapter.py -v`
Expected: PASS (all tests, including the new one and the pre-existing ones — `entries` is already sorted by position so the drivers list stays in classification order like before).

- [ ] **Step 5: Commit**

```bash
git add backend/app/fastf1_adapter.py backend/tests/test_fastf1_adapter.py
git commit -m "fix(backend): compute real gap_to_leader/gap_to_ahead in replay mode"
```

---

## Task 2: Weather and race control data on SessionState (replay)

**Files:**
- Modify: `backend/app/schema.py`
- Modify: `backend/app/fastf1_adapter.py` (add `attach_weather`, `attach_race_control_messages`, wire into `load_session_states`)
- Test: `backend/tests/test_schema.py`, `backend/tests/test_fastf1_adapter.py`

**Interfaces:**
- Consumes: `SessionState` from Task 1 (unchanged shape besides new fields).
- Produces: `WeatherSnapshot`, `RaceControlMessage` models; `SessionState.weather: WeatherSnapshot | None = None`; `SessionState.race_control_messages: list[RaceControlMessage] = []`; `nearest_weather_sample(weather_data: pd.DataFrame, elapsed: pd.Timedelta) -> WeatherSnapshot | None`; `attach_weather(states: list[SessionState], weather_data: pd.DataFrame, session_start: datetime) -> None`; `race_control_messages_up_to(rcm: pd.DataFrame, timestamp: datetime) -> list[RaceControlMessage]`; `attach_race_control_messages(states: list[SessionState], rcm: pd.DataFrame) -> None`.

- [ ] **Step 1: Write the failing schema test**

Read `backend/tests/test_schema.py` first to match its style, then add:

```python
def test_session_state_defaults_weather_and_race_control_to_empty():
    state = SessionState(
        timestamp=datetime(2026, 7, 9, tzinfo=timezone.utc),
        track_status=TrackStatus.GREEN,
        drivers=[],
    )
    assert state.weather is None
    assert state.race_control_messages == []


def test_weather_snapshot_round_trips():
    weather = WeatherSnapshot(air_temp=22.1, track_temp=36.2, humidity=51.0, wind_speed=2.7, rainfall=False)
    assert weather.air_temp == 22.1
    assert weather.rainfall is False


def test_race_control_message_round_trips():
    message = RaceControlMessage(
        timestamp=datetime(2026, 7, 9, 13, 5, tzinfo=timezone.utc),
        category="Flag",
        message="GREEN LIGHT - PIT EXIT OPEN",
        flag="GREEN",
    )
    assert message.category == "Flag"
    assert message.flag == "GREEN"
```

Add the necessary imports (`WeatherSnapshot`, `RaceControlMessage`, `datetime`, `timezone`) at the top of `backend/tests/test_schema.py`, matching whatever import style the existing tests in that file already use.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_schema.py -v`
Expected: FAIL — `ImportError: cannot import name 'WeatherSnapshot'`.

- [ ] **Step 3: Add the schema fields**

In `backend/app/schema.py`, add after the `Tire` class and before `DriverState`:

```python
class WeatherSnapshot(BaseModel):
    air_temp: float
    track_temp: float
    humidity: float
    wind_speed: float
    rainfall: bool


class RaceControlMessage(BaseModel):
    timestamp: datetime
    category: str
    message: str
    flag: str | None = None
```

Then update `SessionState`:

```python
class SessionState(BaseModel):
    timestamp: datetime
    track_status: TrackStatus
    drivers: list[DriverState]
    weather: WeatherSnapshot | None = None
    race_control_messages: list[RaceControlMessage] = []
```

- [ ] **Step 4: Run schema tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_schema.py -v`
Expected: PASS.

- [ ] **Step 5: Write the failing fastf1_adapter tests for weather/race-control attachment**

Add to `backend/tests/test_fastf1_adapter.py`:

```python
def test_attach_weather_picks_nearest_sample_by_elapsed_time():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    weather_data = pd.DataFrame([
        dict(Time=timedelta(seconds=0), AirTemp=22.0, TrackTemp=35.0, Humidity=50.0, WindSpeed=2.0, Rainfall=False),
        dict(Time=timedelta(minutes=3), AirTemp=23.0, TrackTemp=37.0, Humidity=48.0, WindSpeed=3.0, Rainfall=False),
    ])

    attach_weather(states, weather_data, session_start)

    # lap 1 ends at session Time 1:32 -> closer to the Time=0 sample
    assert states[0].weather.air_temp == 22.0
    # lap 2 ends at session Time 3:04.5 -> closer to the Time=3:00 sample
    assert states[1].weather.air_temp == 23.0
    assert states[1].weather.rainfall is False


def test_attach_weather_handles_empty_weather_data():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    attach_weather(states, pd.DataFrame(columns=["Time", "AirTemp", "TrackTemp", "Humidity", "WindSpeed", "Rainfall"]), session_start)
    assert states[0].weather is None


def test_attach_race_control_messages_only_includes_messages_up_to_timestamp():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    # states[0].timestamp = session_start + 1:32, states[1].timestamp = session_start + 3:04.5
    rcm = pd.DataFrame([
        dict(Time=session_start + timedelta(seconds=30), Category="Other", Message="PIT EXIT OPEN", Flag=None),
        dict(Time=session_start + timedelta(minutes=3), Category="Flag", Message="YELLOW FLAG", Flag="YELLOW"),
    ])

    attach_race_control_messages(states, rcm)

    assert len(states[0].race_control_messages) == 1
    assert states[0].race_control_messages[0].message == "PIT EXIT OPEN"
    assert len(states[1].race_control_messages) == 2
    assert states[1].race_control_messages[1].flag == "YELLOW"
```

Add `from app.fastf1_adapter import attach_race_control_messages, attach_weather, session_states_from_laps, track_layout_from_telemetry` (extending the existing import line) to `backend/tests/test_fastf1_adapter.py`.

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_fastf1_adapter.py -k attach -v`
Expected: FAIL — `ImportError: cannot import name 'attach_weather'`.

- [ ] **Step 7: Implement weather and race-control attachment**

In `backend/app/fastf1_adapter.py`, update the import line to include the new schema types:

```python
from app.schema import DriverState, RaceControlMessage, SessionState, Tire, TrackStatus, WeatherSnapshot
```

Add these functions after `track_layout_from_telemetry` and before `_session_cache`:

```python
def nearest_weather_sample(weather_data: pd.DataFrame, elapsed) -> WeatherSnapshot | None:
    if weather_data.empty:
        return None
    idx = (weather_data["Time"] - elapsed).abs().idxmin()
    row = weather_data.loc[idx]
    return WeatherSnapshot(
        air_temp=float(row["AirTemp"]),
        track_temp=float(row["TrackTemp"]),
        humidity=float(row["Humidity"]),
        wind_speed=float(row["WindSpeed"]),
        rainfall=bool(row["Rainfall"]),
    )


def attach_weather(states: list[SessionState], weather_data: pd.DataFrame, session_start: datetime) -> None:
    for state in states:
        elapsed = state.timestamp - session_start
        state.weather = nearest_weather_sample(weather_data, elapsed)


def race_control_messages_up_to(rcm: pd.DataFrame, timestamp: datetime) -> list[RaceControlMessage]:
    subset = rcm[rcm["Time"] <= timestamp]
    return [
        RaceControlMessage(
            timestamp=row["Time"].to_pydatetime() if hasattr(row["Time"], "to_pydatetime") else row["Time"],
            category=row["Category"],
            message=row["Message"],
            flag=None if pd.isna(row["Flag"]) else row["Flag"],
        )
        for _, row in subset.iterrows()
    ]


def attach_race_control_messages(states: list[SessionState], rcm: pd.DataFrame) -> None:
    for state in states:
        state.race_control_messages = race_control_messages_up_to(rcm, state.timestamp)
```

Then wire both into `load_session_states`:

```python
def load_session_states(year: int, event: str, session_type: str, cache_dir: str) -> list[SessionState]:
    session = get_or_load_session(year, event, session_type, cache_dir)
    # ponytail: session.session_start_time is a Timedelta (session-relative), not
    # an absolute datetime like session.date - use session.date as the anchor for
    # lap "Time" deltas, which is accurate enough for display purposes.
    session_start = session.date.to_pydatetime()
    states = session_states_from_laps(session.laps, session_start)
    attach_weather(states, session.weather_data, session_start)
    attach_race_control_messages(states, session.race_control_messages)
    return states
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_fastf1_adapter.py tests/test_schema.py -v`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schema.py backend/app/fastf1_adapter.py backend/tests/test_schema.py backend/tests/test_fastf1_adapter.py
git commit -m "feat(backend): attach weather and race control messages to replay session states"
```

---

## Task 3: Best-effort race control parsing for live mode

**Files:**
- Modify: `backend/app/live_adapter.py`
- Test: `backend/tests/test_live_adapter.py`

**Interfaces:**
- Consumes: `RaceControlMessage` from Task 2.
- Produces: `session_state_from_live_tree(...)` now populates `race_control_messages` on the returned `SessionState` (was always empty). `weather` stays `None` in live mode — f1-dash has no weather channel, not addressed here.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_live_adapter.py`, extending the `_tree()` helper's `base` dict with a `RaceControlMessages` key (add it as a new key in `base`, not as a default `overrides` entry, so existing tests calling `_tree()` with no overrides still get it):

```python
def test_session_state_from_live_tree_parses_race_control_messages():
    tree = _tree(RaceControlMessages={
        "Messages": {
            "0": {"Utc": "2026-07-09T13:05:09", "Category": "Other", "Message": "PIT EXIT OPEN"},
            "1": {"Utc": "2026-07-09T13:10:01", "Category": "Flag", "Message": "GREEN LIGHT", "Flag": "GREEN"},
        }
    })
    state = session_state_from_live_tree(tree, datetime.now(timezone.utc))
    assert len(state.race_control_messages) == 2
    assert state.race_control_messages[0].message == "PIT EXIT OPEN"
    assert state.race_control_messages[1].flag == "GREEN"


def test_session_state_from_live_tree_defaults_race_control_messages_to_empty():
    state = session_state_from_live_tree(_tree(), datetime.now(timezone.utc))
    assert state.race_control_messages == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_live_adapter.py -k race_control -v`
Expected: FAIL — first test fails on `len(state.race_control_messages) == 2` (currently always `[]`); second test should already pass since the default is `[]` from Task 2's schema change, confirming baseline behavior before the parser exists.

- [ ] **Step 3: Implement the parser**

In `backend/app/live_adapter.py`, add the import and a parsing function, and wire it into `session_state_from_live_tree`:

```python
from app.schema import DriverState, RaceControlMessage, SessionState, Tire, TrackStatus
```

Add after `_parse_sector` and before `session_state_from_live_tree`:

```python
# ponytail: field names here follow the same publicly-documented live-timing
# schema assumed elsewhere in this file (see _TRACK_STATUS_CODES) - not yet
# verified against a real live SSE stream, adjust if a field name is wrong.
def _parse_race_control_messages(tree: dict) -> list[RaceControlMessage]:
    entries = tree.get("RaceControlMessages", {}).get("Messages", {})
    messages: list[RaceControlMessage] = []
    for entry in entries.values():
        utc = entry.get("Utc")
        if not utc:
            continue
        try:
            timestamp = datetime.fromisoformat(utc.replace("Z", "+00:00"))
        except ValueError:
            continue
        messages.append(
            RaceControlMessage(
                timestamp=timestamp,
                category=entry.get("Category", ""),
                message=entry.get("Message", ""),
                flag=entry.get("Flag"),
            )
        )
    messages.sort(key=lambda m: m.timestamp)
    return messages
```

Update the `return SessionState(...)` at the end of `session_state_from_live_tree` to include it:

```python
    return SessionState(
        timestamp=timestamp,
        track_status=track_status,
        drivers=sorted(drivers, key=lambda d: d.position),
        race_control_messages=_parse_race_control_messages(tree),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_live_adapter.py -v`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/live_adapter.py backend/tests/test_live_adapter.py
git commit -m "feat(backend): best-effort race control message parsing for live mode"
```

---

## Task 4: `/session/telemetry` endpoint

**Files:**
- Modify: `backend/app/fastf1_adapter.py` (add `load_driver_lap_telemetry`)
- Modify: `backend/app/main.py` (add endpoint)
- Test: `backend/tests/test_fastf1_adapter.py`, `backend/tests/test_main.py`

**Interfaces:**
- Produces: `load_driver_lap_telemetry(year: int, event: str, session_type: str, driver: str, lap_number: int, cache_dir: str) -> dict` returning `{"distance": [...], "speed": [...], "throttle": [...], "brake": [...], "gear": [...], "rpm": [...]}` (empty lists if the lap isn't found). `GET /session/telemetry?year=&event=&session_type=&driver=&lap_number=` returns that same JSON shape.

- [ ] **Step 1: Write the failing adapter test**

Add to `backend/tests/test_fastf1_adapter.py`:

```python
def test_load_driver_lap_telemetry_returns_traces(monkeypatch):
    car_data = pd.DataFrame({
        "Distance": [0.0, 10.0, 20.0],
        "Speed": [250, 260, 270],
        "Throttle": [100, 100, 80],
        "Brake": [False, False, True],
        "nGear": [6, 6, 5],
        "RPM": [11000, 11200, 10800],
    })

    class FakeLapRow:
        def get_car_data(self):
            class Result:
                def add_distance(self_inner):
                    return car_data
            return Result()

    class FakeDriverLaps:
        empty = False
        iloc = [FakeLapRow()]

    class FakeLaps:
        def pick_drivers(self, driver):
            assert driver == "1"
            return self

        def pick_laps(self, lap_number):
            assert lap_number == 5
            return FakeDriverLaps()

    class FakeSession:
        laps = FakeLaps()

    monkeypatch.setattr("app.fastf1_adapter.get_or_load_session", lambda **kwargs: FakeSession())

    result = load_driver_lap_telemetry(
        year=2023, event="British Grand Prix", session_type="R", driver="1", lap_number=5, cache_dir="/tmp/x",
    )
    assert result["distance"] == [0.0, 10.0, 20.0]
    assert result["speed"] == [250, 260, 270]
    assert result["brake"] == [False, False, True]
    assert result["gear"] == [6, 6, 5]


def test_load_driver_lap_telemetry_returns_empty_when_lap_not_found(monkeypatch):
    class FakeDriverLaps:
        empty = True

    class FakeLaps:
        def pick_drivers(self, driver):
            return self

        def pick_laps(self, lap_number):
            return FakeDriverLaps()

    class FakeSession:
        laps = FakeLaps()

    monkeypatch.setattr("app.fastf1_adapter.get_or_load_session", lambda **kwargs: FakeSession())

    result = load_driver_lap_telemetry(
        year=2023, event="British Grand Prix", session_type="R", driver="99", lap_number=1, cache_dir="/tmp/x",
    )
    assert result == {"distance": [], "speed": [], "throttle": [], "brake": [], "gear": [], "rpm": []}
```

Add `load_driver_lap_telemetry` to the import line in the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_fastf1_adapter.py -k telemetry -v`
Expected: FAIL — `ImportError: cannot import name 'load_driver_lap_telemetry'`.

- [ ] **Step 3: Implement `load_driver_lap_telemetry`**

Add to `backend/app/fastf1_adapter.py`, after `load_track_layout` and before `load_session_states`:

```python
def load_driver_lap_telemetry(
    year: int, event: str, session_type: str, driver: str, lap_number: int, cache_dir: str,
) -> dict:
    session = get_or_load_session(year, event, session_type, cache_dir)
    driver_laps = session.laps.pick_drivers(driver).pick_laps(lap_number)
    if driver_laps.empty:
        return {"distance": [], "speed": [], "throttle": [], "brake": [], "gear": [], "rpm": []}

    car_data = driver_laps.iloc[0].get_car_data().add_distance()
    return {
        "distance": car_data["Distance"].tolist(),
        "speed": car_data["Speed"].tolist(),
        "throttle": car_data["Throttle"].tolist(),
        "brake": car_data["Brake"].tolist(),
        "gear": car_data["nGear"].tolist(),
        "rpm": car_data["RPM"].tolist(),
    }
```

- [ ] **Step 4: Run adapter tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_fastf1_adapter.py -v`
Expected: PASS.

- [ ] **Step 5: Write the failing endpoint test**

Add to `backend/tests/test_main.py`:

```python
def test_telemetry_endpoint_returns_traces(monkeypatch):
    monkeypatch.setattr(
        "app.main.load_driver_lap_telemetry",
        lambda **kwargs: {"distance": [0.0], "speed": [250], "throttle": [100], "brake": [False], "gear": [6], "rpm": [11000]},
    )
    resp = client.get("/session/telemetry", params={
        "year": 2023, "event": "British Grand Prix", "session_type": "R", "driver": "1", "lap_number": 5,
    })
    assert resp.status_code == 200
    assert resp.json() == {"distance": [0.0], "speed": [250], "throttle": [100], "brake": [False], "gear": [6], "rpm": [11000]}
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_main.py -k telemetry -v`
Expected: FAIL — 404 Not Found (endpoint doesn't exist yet).

- [ ] **Step 7: Implement the endpoint**

In `backend/app/main.py`, update the import line:

```python
from app.fastf1_adapter import load_driver_lap_telemetry, load_session_states, load_track_layout
```

Add after the `track_layout` endpoint:

```python
@app.get("/session/telemetry")
async def session_telemetry(year: int, event: str, session_type: str, driver: str, lap_number: int):
    return load_driver_lap_telemetry(
        year=year, event=event, session_type=session_type, driver=driver, lap_number=lap_number, cache_dir=CACHE_DIR,
    )
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_main.py -v`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/app/fastf1_adapter.py backend/app/main.py backend/tests/test_fastf1_adapter.py backend/tests/test_main.py
git commit -m "feat(backend): add /session/telemetry endpoint for per-lap speed/throttle/brake/gear/rpm traces"
```

---

## Task 5: `/meta/years`, `/meta/events`, `/meta/sessions` endpoints

**Files:**
- Modify: `backend/app/fastf1_adapter.py` (add `list_supported_years`, `list_events_for_year`, `list_sessions_for_event`)
- Modify: `backend/app/main.py` (add three endpoints)
- Test: `backend/tests/test_fastf1_adapter.py`, `backend/tests/test_main.py`

**Interfaces:**
- Produces: `list_supported_years() -> list[int]`; `list_events_for_year(year: int, cache_dir: str) -> list[str]` (event names, most-recent round last... actually chronological by round); `list_sessions_for_event(year: int, event: str, cache_dir: str) -> list[str]` (session names in weekend order, e.g. `["Practice 1", "Qualifying", "Sprint Shootout", "Sprint", "Race"]`). `GET /meta/years`, `GET /meta/events?year=`, `GET /meta/sessions?year=&event=` return `{"years": [...]}`, `{"events": [...]}`, `{"sessions": [...]}` respectively.

- [ ] **Step 1: Write the failing adapter tests**

Add to `backend/tests/test_fastf1_adapter.py`:

```python
def test_list_supported_years_starts_at_2018_and_ends_at_current_year():
    years = list_supported_years()
    assert years[0] == 2018
    assert years[-1] == datetime.now().year


def test_list_events_for_year_returns_event_names_in_round_order(monkeypatch):
    schedule = pd.DataFrame([
        dict(RoundNumber=2, EventName="Saudi Arabian Grand Prix"),
        dict(RoundNumber=1, EventName="Bahrain Grand Prix"),
    ])
    monkeypatch.setattr("app.fastf1_adapter.fastf1.get_event_schedule", lambda year, include_testing: schedule)
    events = list_events_for_year(year=2023, cache_dir="/tmp/x")
    assert events == ["Bahrain Grand Prix", "Saudi Arabian Grand Prix"]


def test_list_sessions_for_event_returns_non_null_session_names_in_order(monkeypatch):
    schedule = pd.DataFrame([
        dict(
            RoundNumber=1, EventName="Bahrain Grand Prix",
            Session1="Practice 1", Session2="Practice 2", Session3="Practice 3",
            Session4="Qualifying", Session5="Race",
        ),
        dict(
            RoundNumber=4, EventName="Azerbaijan Grand Prix",
            Session1="Practice 1", Session2="Qualifying", Session3="Sprint Shootout",
            Session4="Sprint", Session5="Race",
        ),
    ])
    monkeypatch.setattr("app.fastf1_adapter.fastf1.get_event_schedule", lambda year, include_testing: schedule)

    bahrain_sessions = list_sessions_for_event(year=2023, event="Bahrain Grand Prix", cache_dir="/tmp/x")
    assert bahrain_sessions == ["Practice 1", "Practice 2", "Practice 3", "Qualifying", "Race"]

    baku_sessions = list_sessions_for_event(year=2023, event="Azerbaijan Grand Prix", cache_dir="/tmp/x")
    assert baku_sessions == ["Practice 1", "Qualifying", "Sprint Shootout", "Sprint", "Race"]


def test_list_sessions_for_event_returns_empty_for_unknown_event(monkeypatch):
    schedule = pd.DataFrame([dict(RoundNumber=1, EventName="Bahrain Grand Prix", Session1="Race", Session2=None, Session3=None, Session4=None, Session5=None)])
    monkeypatch.setattr("app.fastf1_adapter.fastf1.get_event_schedule", lambda year, include_testing: schedule)
    assert list_sessions_for_event(year=2023, event="Nonexistent Grand Prix", cache_dir="/tmp/x") == []
```

Add `list_events_for_year, list_sessions_for_event, list_supported_years` to the import line, and add `from datetime import datetime` if not already imported at module scope in the test file (it already is, per `_laps_df`'s `datetime(...)` usage).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_fastf1_adapter.py -k "supported_years or events_for_year or sessions_for_event" -v`
Expected: FAIL — `ImportError`.

- [ ] **Step 3: Implement the three functions**

Add to `backend/app/fastf1_adapter.py`, after `get_or_load_session` and before `load_track_layout`:

```python
# ponytail: 2018 is the earliest season FastF1's lap-by-lap timing data is
# considered reliable; earlier seasons exist in the schedule API but aren't
# useful for this app's per-lap replay.
def list_supported_years() -> list[int]:
    return list(range(2018, datetime.now().year + 1))


_schedule_cache: dict[int, "pd.DataFrame"] = {}


def _get_schedule(year: int, cache_dir: str) -> "pd.DataFrame":
    if year not in _schedule_cache:
        fastf1.Cache.enable_cache(cache_dir)
        _schedule_cache[year] = fastf1.get_event_schedule(year, include_testing=False)
    return _schedule_cache[year]


def list_events_for_year(year: int, cache_dir: str) -> list[str]:
    schedule = _get_schedule(year, cache_dir).sort_values("RoundNumber")
    return schedule["EventName"].tolist()


def list_sessions_for_event(year: int, event: str, cache_dir: str) -> list[str]:
    schedule = _get_schedule(year, cache_dir)
    matches = schedule[schedule["EventName"] == event]
    if matches.empty:
        return []
    row = matches.iloc[0]
    return [row[col] for col in ("Session1", "Session2", "Session3", "Session4", "Session5") if pd.notna(row[col])]
```

- [ ] **Step 4: Run adapter tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_fastf1_adapter.py -v`
Expected: PASS.

- [ ] **Step 5: Write the failing endpoint tests**

Add to `backend/tests/test_main.py`:

```python
def test_meta_years_endpoint(monkeypatch):
    monkeypatch.setattr("app.main.list_supported_years", lambda: [2018, 2019])
    resp = client.get("/meta/years")
    assert resp.status_code == 200
    assert resp.json() == {"years": [2018, 2019]}


def test_meta_events_endpoint(monkeypatch):
    monkeypatch.setattr("app.main.list_events_for_year", lambda **kwargs: ["Bahrain Grand Prix"])
    resp = client.get("/meta/events", params={"year": 2023})
    assert resp.status_code == 200
    assert resp.json() == {"events": ["Bahrain Grand Prix"]}


def test_meta_sessions_endpoint(monkeypatch):
    monkeypatch.setattr("app.main.list_sessions_for_event", lambda **kwargs: ["Practice 1", "Qualifying", "Race"])
    resp = client.get("/meta/sessions", params={"year": 2023, "event": "Bahrain Grand Prix"})
    assert resp.status_code == 200
    assert resp.json() == {"sessions": ["Practice 1", "Qualifying", "Race"]}
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_main.py -k meta -v`
Expected: FAIL — 404 Not Found for each.

- [ ] **Step 7: Implement the endpoints**

In `backend/app/main.py`, update the import line:

```python
from app.fastf1_adapter import (
    list_events_for_year,
    list_sessions_for_event,
    list_supported_years,
    load_driver_lap_telemetry,
    load_session_states,
    load_track_layout,
)
```

Add after the `health` endpoint:

```python
@app.get("/meta/years")
def meta_years():
    return {"years": list_supported_years()}


@app.get("/meta/events")
def meta_events(year: int):
    return {"events": list_events_for_year(year=year, cache_dir=CACHE_DIR)}


@app.get("/meta/sessions")
def meta_sessions(year: int, event: str):
    return {"sessions": list_sessions_for_event(year=year, event=event, cache_dir=CACHE_DIR)}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_main.py -v`
Expected: PASS.

- [ ] **Step 9: Run the full backend suite**

Run: `cd backend && .venv/bin/pytest -v`
Expected: PASS (all tests across all files).

- [ ] **Step 10: Commit**

```bash
git add backend/app/fastf1_adapter.py backend/app/main.py backend/tests/test_fastf1_adapter.py backend/tests/test_main.py
git commit -m "feat(backend): add /meta/years, /meta/events, /meta/sessions endpoints for the landing page"
```

---

## Task 6: Frontend types and color constants

**Files:**
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/constants.ts`
- Test: `frontend/src/constants.test.ts`

**Interfaces:**
- Produces: `WeatherSnapshot`, `RaceControlMessage` types; `SessionState.weather: WeatherSnapshot | null`; `SessionState.race_control_messages: RaceControlMessage[]`; `teamColor(team: string): string`; `tireColor(compound: string): string`.

- [ ] **Step 1: Update types.ts**

Add to `frontend/src/types.ts`, after `Tire` and before `DriverState`:

```typescript
export interface WeatherSnapshot {
  air_temp: number;
  track_temp: number;
  humidity: number;
  wind_speed: number;
  rainfall: boolean;
}

export interface RaceControlMessage {
  timestamp: string;
  category: string;
  message: string;
  flag: string | null;
}
```

Update `SessionState`:

```typescript
export interface SessionState {
  timestamp: string;
  track_status: TrackStatus;
  drivers: DriverState[];
  weather: WeatherSnapshot | null;
  race_control_messages: RaceControlMessage[];
}
```

- [ ] **Step 2: Write the failing constants test**

Create `frontend/src/constants.test.ts`:

```typescript
import { teamColor, tireColor } from "./constants";

test("returns known team colors", () => {
  expect(teamColor("Ferrari")).toBe("#E8002D");
  expect(teamColor("Mercedes")).toBe("#27F4D2");
});

test("falls back to a neutral gray for unknown teams", () => {
  expect(teamColor("Some New Team")).toBe("#4b5563");
});

test("returns known tire compound colors", () => {
  expect(tireColor("SOFT")).toBe("#e10600");
  expect(tireColor("medium")).toBe("#f7d417"); // case-insensitive
});

test("falls back to a neutral gray for unknown compounds", () => {
  expect(tireColor("UNKNOWN")).toBe("#6b7280");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- constants.test.ts`
Expected: FAIL — cannot find module `./constants`.

- [ ] **Step 4: Implement constants.ts**

Create `frontend/src/constants.ts`:

```typescript
const TEAM_COLORS: Record<string, string> = {
  "Red Bull Racing": "#3671C6",
  "Red Bull": "#3671C6",
  Mercedes: "#27F4D2",
  Ferrari: "#E8002D",
  McLaren: "#FF8000",
  "Aston Martin": "#229971",
  Alpine: "#FF87BC",
  "Alpine F1 Team": "#FF87BC",
  Williams: "#64C4FF",
  RB: "#6692FF",
  AlphaTauri: "#6692FF",
  "RB F1 Team": "#6692FF",
  "Kick Sauber": "#52E252",
  "Alfa Romeo": "#52E252",
  Sauber: "#52E252",
  "Haas F1 Team": "#B6BABD",
  Haas: "#B6BABD",
};

export function teamColor(team: string): string {
  return TEAM_COLORS[team] ?? "#4b5563";
}

const TIRE_COLORS: Record<string, string> = {
  SOFT: "#e10600",
  MEDIUM: "#f7d417",
  HARD: "#f0f0f0",
  INTERMEDIATE: "#43b02a",
  WET: "#0067ad",
};

export function tireColor(compound: string): string {
  return TIRE_COLORS[compound.toUpperCase()] ?? "#6b7280";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- constants.test.ts`
Expected: PASS.

- [ ] **Step 6: Update existing panel test fixtures for the new SessionState fields**

`TimingTower.test.tsx`, `TrackMap.test.tsx`, `SectorTimes.test.tsx`, `TireStrategy.test.tsx`, `OverviewPanel.test.tsx` (and any other file constructing a literal `SessionState`) now fail TypeScript's structural check because `weather` and `race_control_messages` are required fields. In each of those files, add `weather: null, race_control_messages: [],` to every inline `SessionState` object literal.

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS (all existing tests, now with the two new fields present in every fixture).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types.ts frontend/src/constants.ts frontend/src/constants.test.ts frontend/src/panels/*.test.tsx
git commit -m "feat(frontend): add weather/race-control types and team/tire color constants"
```

---

## Task 7: Landing page with cascading session picker

Replaces `ReplayControls`' always-visible header placement with a full-screen landing page shown before any session starts.

**Files:**
- Create: `frontend/src/panels/LandingPage.tsx`
- Create: `frontend/src/panels/LandingPage.test.tsx`
- Delete: `frontend/src/controls/ReplayControls.tsx`, `frontend/src/controls/ReplayControls.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `LandingPage({ onReplayStarted, onLiveStarted }: { onReplayStarted: (params: { year: number; event: string; sessionType: string }) => void; onLiveStarted: () => void })`.
- Consumes: `GET /meta/years`, `GET /meta/events?year=`, `GET /meta/sessions?year=&event=`, `POST /session/replay`, `POST /session/live` (same request/response shapes `ReplayControls` already used for the last two).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/panels/LandingPage.test.tsx`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- LandingPage.test.tsx`
Expected: FAIL — cannot find module `./LandingPage`.

- [ ] **Step 3: Implement LandingPage.tsx**

Create `frontend/src/panels/LandingPage.tsx`:

```typescript
import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

export function LandingPage({
  onReplayStarted,
  onLiveStarted,
}: {
  onReplayStarted: (params: { year: number; event: string; sessionType: string }) => void;
  onLiveStarted: () => void;
}) {
  const [years, setYears] = useState<number[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [sessions, setSessions] = useState<string[]>([]);
  const [year, setYear] = useState("");
  const [event, setEvent] = useState("");
  const [sessionType, setSessionType] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/meta/years`)
      .then((res) => res.json())
      .then((data: { years: number[] }) => setYears(data.years));
  }, []);

  useEffect(() => {
    setEvents([]);
    setEvent("");
    if (!year) return;
    fetch(`${API_URL}/meta/events?year=${year}`)
      .then((res) => res.json())
      .then((data: { events: string[] }) => setEvents(data.events));
  }, [year]);

  useEffect(() => {
    setSessions([]);
    setSessionType("");
    if (!year || !event) return;
    fetch(`${API_URL}/meta/events?year=${year}`); // no-op guard removed below
  }, [year, event]);

  useEffect(() => {
    setSessions([]);
    setSessionType("");
    if (!year || !event) return;
    fetch(`${API_URL}/meta/sessions?year=${year}&event=${encodeURIComponent(event)}`)
      .then((res) => res.json())
      .then((data: { sessions: string[] }) => setSessions(data.sessions));
  }, [year, event]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedYear = Number(year);
    const response = await fetch(`${API_URL}/session/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: parsedYear, event, session_type: sessionType, speed: 10 }),
    });
    if (response.ok) {
      onReplayStarted({ year: parsedYear, event, sessionType });
    }
  }

  async function handleGoLive() {
    const response = await fetch(`${API_URL}/session/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (response.ok) {
      onLiveStarted();
    }
  }

  return (
    <div className="pitwall-landing">
      <h1>PitWall</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="landing-year">Year</label>
        <select id="landing-year" value={year} onChange={(e) => setYear(e.target.value)}>
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
        <select id="landing-track" value={event} onChange={(e) => setEvent(e.target.value)} disabled={!year}>
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
        <select id="landing-session" value={sessionType} onChange={(e) => setSessionType(e.target.value)} disabled={!event}>
          <option value="" disabled>
            Select session
          </option>
          {sessions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <button type="submit" disabled={!year || !event || !sessionType}>
          Start replay
        </button>
      </form>
      <button type="button" onClick={handleGoLive}>
        Go live
      </button>
    </div>
  );
}
```

Remove the stray no-op `useEffect` (the second one duplicating the sessions fetch guard) — it was left in by mistake above; the final file should have exactly one `useEffect` per dependency set: years (mount), events (on `year` change), sessions (on `year`/`event` change). Delete the block that only calls `fetch(.../meta/events...)` without using its result.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- LandingPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into App.tsx and remove ReplayControls**

Delete `frontend/src/controls/ReplayControls.tsx` and `frontend/src/controls/ReplayControls.test.tsx`.

Update `frontend/src/App.tsx`: replace the `ReplayControls` import with `LandingPage`, add a `sessionStarted` gate, and render `<LandingPage />` full-screen until a session starts:

```typescript
import { useState } from "react";
import "./App.css";
import { useSessionSocket } from "./api/useSessionSocket";
import { LandingPage } from "./panels/LandingPage";
import { TimingTower } from "./panels/TimingTower";
import { TrackMap } from "./panels/TrackMap";
import { TireStrategy } from "./panels/TireStrategy";
import { SectorTimes } from "./panels/SectorTimes";
import { OverviewPanel } from "./panels/OverviewPanel";
import { useAiNotes } from "./api/useAiNotes";
import { RaceEngineerNotes } from "./panels/RaceEngineerNotes";
import { AiChat } from "./panels/AiChat";

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8000/ws/session";
const AI_NOTES_WS_URL = import.meta.env.VITE_BACKEND_AI_NOTES_WS_URL ?? "ws://localhost:8000/ws/ai-notes";

export default function App() {
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionParams, setSessionParams] = useState<{ year: number; event: string; sessionType: string } | null>(null);
  const history = useSessionSocket(WS_URL, sessionParams);
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const notes = useAiNotes(AI_NOTES_WS_URL);

  if (!sessionStarted) {
    return (
      <LandingPage
        onReplayStarted={(params) => {
          setSessionParams(params);
          setSessionStarted(true);
        }}
        onLiveStarted={() => setSessionStarted(true)}
      />
    );
  }

  return (
    <div>
      <header className="pitwall-header">
        <h1>PitWall</h1>
      </header>
      <main className="pitwall-grid">
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
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Race Engineer Notes</div>
            <RaceEngineerNotes notes={notes} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Ask The Engineer</div>
            <AiChat />
          </div>
        </div>
      </main>
    </div>
  );
}
```

This keeps the dashboard body exactly as it was for this task (later tasks restyle it) — the only change is the landing gate replacing the header form.

- [ ] **Step 6: Rewrite App.test.tsx for the landing gate**

The existing `frontend/src/App.test.tsx` renders `<App />` and expects dashboard content immediately, and asserts on `ReplayControls`' old "start live" button text. Both assumptions are now wrong: the dashboard is gated behind the landing page, and the live button is now labeled "Go live". Replace the file in full:

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/meta/years")) return Promise.resolve({ ok: true, json: async () => ({ years: [2023] }) });
    if (url.includes("/meta/events")) return Promise.resolve({ ok: true, json: async () => ({ events: ["British Grand Prix"] }) });
    if (url.includes("/meta/sessions")) return Promise.resolve({ ok: true, json: async () => ({ sessions: ["Race"] }) });
    if (url.includes("/session/replay")) return Promise.resolve({ ok: true, json: async () => ({ status: "started", states: 0 }) });
    if (url.includes("/session/live")) return Promise.resolve({ ok: true, json: async () => ({ status: "started" }) });
    if (url.includes("/session/track-layout")) return Promise.resolve({ ok: true, json: async () => ({ points: [] }) });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
});

async function startReplay() {
  render(<App />);
  await waitFor(() => expect(screen.getByLabelText(/year/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/year/i), { target: { value: "2023" } });
  await waitFor(() => expect(screen.getByText("British Grand Prix")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/track/i), { target: { value: "British Grand Prix" } });
  await waitFor(() => expect(screen.getByText("Race")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/session/i), { target: { value: "Race" } });
  fireEvent.click(screen.getByRole("button", { name: /start replay/i }));
  await waitFor(() => expect(screen.queryByLabelText(/year/i)).not.toBeInTheDocument());
}

test("shows the landing page before a session starts", () => {
  render(<App />);
  expect(screen.getByText(/select year/i)).toBeInTheDocument();
});

test("renders all panels simultaneously after starting a replay session", async () => {
  await startReplay();
  // TimingTower, TireStrategy, and SectorTimes each show their own "waiting" message at once
  expect(screen.getAllByText(/waiting for session data/i).length).toBeGreaterThanOrEqual(3);
  expect(screen.getByText(/overview/i)).toBeInTheDocument();
});

test("renders Race Engineer Notes and AI Chat panels alongside everything else", async () => {
  await startReplay();
  expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/ask a question/i)).toBeInTheDocument();
});
```

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/panels/LandingPage.tsx frontend/src/panels/LandingPage.test.tsx frontend/src/App.tsx frontend/src/App.test.tsx
git rm frontend/src/controls/ReplayControls.tsx frontend/src/controls/ReplayControls.test.tsx
git commit -m "feat(frontend): add landing page with validated year/track/session picker, retire ReplayControls"
```

---

## Task 8: Visual system overhaul (App.css)

**Files:**
- Modify: `frontend/src/App.css`

**Interfaces:**
- Produces: CSS vars `--purple`, `--orange` (new); sharp corners on `.pitwall-panel`; `.pitwall-landing` styles; unchanged class names elsewhere (`.pitwall-grid`, `.pitwall-sidebar-left/center/right`, `.pitwall-stat*`, `table`/`th`/`td`) so existing panels keep working without markup changes.

- [ ] **Step 1: Update the CSS**

Replace `frontend/src/App.css` in full:

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
  --purple: #a78bfa;
  --orange: #fb923c;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
  letter-spacing: 0.1px;
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
  font-size: 13px;
  letter-spacing: 3px;
  color: var(--label);
  text-transform: uppercase;
}

.pitwall-grid {
  display: grid;
  grid-template-columns: minmax(280px, 320px) minmax(0, 1fr) minmax(320px, 380px);
  grid-template-rows: auto auto;
  gap: 8px;
  padding: 8px;
}

@media (max-width: 1400px) {
  .pitwall-grid {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
  }
  .pitwall-sidebar-left,
  .pitwall-sidebar-right,
  .pitwall-center {
    grid-column: 1;
    grid-row: auto;
  }
}

.pitwall-sidebar-left {
  grid-column: 1;
  grid-row: 1 / 3;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pitwall-center {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pitwall-sidebar-right {
  grid-column: 3;
  grid-row: 1 / 3;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pitwall-panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 8px 10px;
}

.pitwall-panel-title {
  color: var(--label);
  font-size: 9px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-bottom: 6px;
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
  margin-bottom: 8px;
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

.pitwall-stat-value.cyan { color: var(--cyan); }
.pitwall-stat-value.yellow { color: var(--yellow); }
.pitwall-stat-value.green { color: var(--green); }
.pitwall-stat-value.red { color: var(--red); }
.pitwall-stat-value.purple { color: var(--purple); }
.pitwall-stat-value.orange { color: var(--orange); }

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

tr.pitwall-row-selected td {
  background: #14181f;
}

tr.pitwall-row-selectable {
  cursor: pointer;
}

.pitwall-team-stripe {
  display: inline-block;
  width: 3px;
  height: 12px;
  margin-right: 6px;
  vertical-align: middle;
}

.pitwall-landing {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: var(--bg);
  color: var(--text);
}

.pitwall-landing h1 {
  font-size: 14px;
  letter-spacing: 4px;
  color: var(--label);
  text-transform: uppercase;
  margin: 0 0 8px;
}

.pitwall-landing form {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.pitwall-landing label {
  display: block;
  color: var(--label);
  font-size: 9px;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.pitwall-landing select,
.pitwall-landing button {
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 6px 10px;
  font-size: 12px;
}

.pitwall-landing button {
  cursor: pointer;
}

.pitwall-landing button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS (CSS-only change, no component test should be affected).

- [ ] **Step 3: Visual check**

Run: `cd frontend && npm run dev`, open the app in a browser, confirm the landing page and dashboard both render with sharp corners and the extended dark palette, then stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.css
git commit -m "style(frontend): dark technical pit-wall visual system, sharp corners, landing page styles"
```

---

## Task 9: Timing tower restyle — team stripe, tire color, sector mini-colors, selection

**Files:**
- Modify: `frontend/src/panels/TimingTower.tsx`
- Modify: `frontend/src/panels/TimingTower.test.tsx`

**Interfaces:**
- Consumes: `teamColor`, `tireColor` from Task 6.
- Produces: `TimingTower({ state, selectedDriver, onSelectDriver }: { state: SessionState | null; selectedDriver: string | null; onSelectDriver: (driverNumber: string) => void })` — signature change from `{ state }` only, so App.tsx (Task 10) must pass the two new props.

- [ ] **Step 1: Write the failing test**

Update `frontend/src/panels/TimingTower.test.tsx`: add `weather: null, race_control_messages: [],` to `sampleState` (per Task 6 Step 6, may already be done), then add:

```typescript
test("highlights the selected driver's row", () => {
  render(<TimingTower state={sampleState} selectedDriver="1" onSelectDriver={vi.fn()} />);
  const row = screen.getByText("VER").closest("tr");
  expect(row).toHaveClass("pitwall-row-selected");
});

test("clicking a row calls onSelectDriver with that driver's number", () => {
  const onSelectDriver = vi.fn();
  render(<TimingTower state={sampleState} selectedDriver={null} onSelectDriver={onSelectDriver} />);
  fireEvent.click(screen.getByText("HAM").closest("tr")!);
  expect(onSelectDriver).toHaveBeenCalledWith("44");
});
```

Add `fireEvent` to the `@testing-library/react` import. Update the two existing tests' render calls to pass `selectedDriver={null} onSelectDriver={vi.fn()}` as well, since the props are now required.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- TimingTower.test.tsx`
Expected: FAIL — TypeScript error / `onSelectDriver` not called.

- [ ] **Step 3: Implement the restyle**

Replace `frontend/src/panels/TimingTower.tsx`:

```typescript
import type { SessionState } from "../types";
import { teamColor, tireColor } from "../constants";

function bestSectorDriver(
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

export function TimingTower({
  state,
  selectedDriver,
  onSelectDriver,
}: {
  state: SessionState | null;
  selectedDriver: string | null;
  onSelectDriver: (driverNumber: string) => void;
}) {
  if (!state) {
    return <p>Waiting for session data...</p>;
  }
  const drivers = [...state.drivers].sort((a, b) => a.position - b.position);
  // ponytail: sector cells only mark session-best (purple), matching the
  // existing SectorTimes convention. Per-driver personal-best tracking needs
  // history threaded into this panel; add if that distinction is requested.
  const bestS1 = bestSectorDriver(state.drivers, "sector_1_time");
  const bestS2 = bestSectorDriver(state.drivers, "sector_2_time");
  const bestS3 = bestSectorDriver(state.drivers, "sector_3_time");

  return (
    <table>
      <thead>
        <tr>
          <th>Pos</th><th>Driver</th><th>Tire</th><th>Last Lap</th><th>Best Lap</th>
          <th>Gap</th><th>Int</th><th>S1</th><th>S2</th><th>S3</th>
        </tr>
      </thead>
      <tbody>
        {drivers.map((d) => (
          <tr
            key={d.driver_number}
            className={
              "pitwall-row-selectable" + (d.driver_number === selectedDriver ? " pitwall-row-selected" : "")
            }
            onClick={() => onSelectDriver(d.driver_number)}
          >
            <td>{d.position}</td>
            <td>
              <span className="pitwall-team-stripe" style={{ background: teamColor(d.team) }} />
              {d.abbreviation}
            </td>
            <td style={{ color: tireColor(d.tire.compound) }}>
              {d.tire.compound} ({d.tire.age_laps})
            </td>
            <td>{d.last_lap_time?.toFixed(3) ?? "-"}</td>
            <td>{d.best_lap_time?.toFixed(3) ?? "-"}</td>
            <td>{d.gap_to_leader !== null ? `+${d.gap_to_leader.toFixed(3)}` : "-"}</td>
            <td>{d.gap_to_ahead !== null ? `+${d.gap_to_ahead.toFixed(3)}` : "-"}</td>
            <td style={d.driver_number === bestS1 ? { color: "var(--purple)" } : undefined}>
              {d.sector_1_time?.toFixed(3) ?? "-"}
            </td>
            <td style={d.driver_number === bestS2 ? { color: "var(--purple)" } : undefined}>
              {d.sector_2_time?.toFixed(3) ?? "-"}
            </td>
            <td style={d.driver_number === bestS3 ? { color: "var(--purple)" } : undefined}>
              {d.sector_3_time?.toFixed(3) ?? "-"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- TimingTower.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/TimingTower.tsx frontend/src/panels/TimingTower.test.tsx
git commit -m "feat(frontend): timing tower team/tire colors, sector mini-colors, click-to-select"
```

---

## Task 10: Driver selection + keyboard navigation in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Produces: `App` now holds `selectedDriver: string | null` state, auto-selects the leader once `latest` first arrives, and cycles selection with ArrowUp/ArrowDown; passes `selectedDriver`/`onSelectDriver` into `TimingTower`.

- [ ] **Step 1: Write the failing test**

`FakeWebSocket` in `frontend/src/App.test.tsx` (from Task 7) doesn't expose a way to reach the instance `useSessionSocket` creates internally, which is needed to fire a message from the test. Update the class to track its instances, then add the test.

Replace the `FakeWebSocket` class:

```typescript
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    FakeWebSocket.instances.push(this);
  }
  close() {}
}
```

Add `FakeWebSocket.instances = [];` as the first line of `beforeEach`.

Add the test:

```typescript
function driverState(position: number, driverNumber: string, abbreviation: string) {
  return {
    driver_number: driverNumber, abbreviation, team: "Red Bull Racing", position,
    gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
    tire: { compound: "SOFT", age_laps: 1 }, x: null, y: null,
    lap_number: 1, sector_1_time: null, sector_2_time: null, sector_3_time: null,
  };
}

test("auto-selects the race leader once session data arrives and highlights their timing tower row", async () => {
  await startReplay();
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  socket.onmessage?.({
    data: JSON.stringify({
      timestamp: "t1",
      track_status: "green",
      weather: null,
      race_control_messages: [],
      drivers: [driverState(1, "1", "VER"), driverState(2, "44", "HAM")],
    }),
  });

  await waitFor(() => expect(screen.getByText("VER").closest("tr")).toHaveClass("pitwall-row-selected"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- App.test.tsx`
Expected: FAIL — no row has `pitwall-row-selected` yet, since `App` doesn't pass `selectedDriver`/`onSelectDriver` to `TimingTower` (Task 9 made them required props, so this currently fails to compile/render correctly).

- [ ] **Step 3: Implement selection state and keyboard nav**

In `frontend/src/App.tsx`, add state and effects, and pass the new props to `TimingTower`:

```typescript
import { useEffect, useState } from "react";
```

Inside `App()`, after the existing `notes` line:

```typescript
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);

  useEffect(() => {
    if (selectedDriver === null && latest && latest.drivers.length > 0) {
      setSelectedDriver(latest.drivers[0].driver_number);
    }
  }, [latest, selectedDriver]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!latest || latest.drivers.length === 0) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const sorted = [...latest.drivers].sort((a, b) => a.position - b.position);
      const currentIndex = sorted.findIndex((d) => d.driver_number === selectedDriver);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const nextIndex = Math.min(Math.max(currentIndex + delta, 0), sorted.length - 1);
      setSelectedDriver(sorted[nextIndex].driver_number);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [latest, selectedDriver]);
```

Update the `TimingTower` usage:

```typescript
            <TimingTower state={latest} selectedDriver={selectedDriver} onSelectDriver={setSelectedDriver} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat(frontend): auto-select race leader, arrow-key driver navigation"
```

---

## Task 11: Selected driver card panel

**Files:**
- Create: `frontend/src/panels/SelectedDriverCard.tsx`
- Create: `frontend/src/panels/SelectedDriverCard.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `SelectedDriverCard({ state, selectedDriver }: { state: SessionState | null; selectedDriver: string | null })`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/panels/SelectedDriverCard.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SelectedDriverCard } from "./SelectedDriverCard";
import type { SessionState } from "../types";

const sampleState: SessionState = {
  timestamp: "t1",
  track_status: "green",
  weather: null,
  race_control_messages: [],
  drivers: [
    {
      driver_number: "1", abbreviation: "VER", team: "Red Bull Racing", position: 1,
      gap_to_leader: null, gap_to_ahead: null, last_lap_time: 90.5, best_lap_time: 90.1,
      tire: { compound: "SOFT", age_laps: 3 }, x: null, y: null,
      lap_number: 12, sector_1_time: null, sector_2_time: null, sector_3_time: null,
    },
    {
      driver_number: "44", abbreviation: "HAM", team: "Mercedes", position: 2,
      gap_to_leader: 5.2, gap_to_ahead: 5.2, last_lap_time: 91.2, best_lap_time: 90.8,
      tire: { compound: "MEDIUM", age_laps: 5 }, x: null, y: null,
      lap_number: 12, sector_1_time: null, sector_2_time: null, sector_3_time: null,
    },
  ],
};

test("shows the selected driver's stats", () => {
  render(<SelectedDriverCard state={sampleState} selectedDriver="44" />);
  expect(screen.getByText("HAM")).toBeInTheDocument();
  expect(screen.getByText("MEDIUM (5)")).toBeInTheDocument();
  expect(screen.getByText("+5.200")).toBeInTheDocument();
});

test("shows a placeholder when no driver is selected", () => {
  render(<SelectedDriverCard state={sampleState} selectedDriver={null} />);
  expect(screen.getByText(/select a driver/i)).toBeInTheDocument();
});

test("shows a placeholder when there is no session state yet", () => {
  render(<SelectedDriverCard state={null} selectedDriver="1" />);
  expect(screen.getByText(/select a driver/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- SelectedDriverCard.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement SelectedDriverCard.tsx**

Create `frontend/src/panels/SelectedDriverCard.tsx`:

```typescript
import type { SessionState } from "../types";
import { tireColor } from "../constants";

export function SelectedDriverCard({
  state,
  selectedDriver,
}: {
  state: SessionState | null;
  selectedDriver: string | null;
}) {
  const driver = state?.drivers.find((d) => d.driver_number === selectedDriver) ?? null;

  if (!driver) {
    return <p>Select a driver to see details.</p>;
  }

  return (
    <div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Driver</div>
        <div className="pitwall-stat-value cyan">
          {driver.abbreviation} · P{driver.position}
        </div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Tire</div>
        <div className="pitwall-stat-value" style={{ color: tireColor(driver.tire.compound) }}>
          {driver.tire.compound} ({driver.tire.age_laps})
        </div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Last Lap</div>
        <div className="pitwall-stat-value">{driver.last_lap_time?.toFixed(3) ?? "-"}</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Best Lap</div>
        <div className="pitwall-stat-value">{driver.best_lap_time?.toFixed(3) ?? "-"}</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Gap to Leader</div>
        <div className="pitwall-stat-value">
          {driver.gap_to_leader !== null ? `+${driver.gap_to_leader.toFixed(3)}` : "-"}
        </div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Gap Ahead</div>
        <div className="pitwall-stat-value">
          {driver.gap_to_ahead !== null ? `+${driver.gap_to_ahead.toFixed(3)}` : "-"}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- SelectedDriverCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add to App.tsx**

In `frontend/src/App.tsx`, import and render it in `pitwall-sidebar-right`, before the circuit panel:

```typescript
import { SelectedDriverCard } from "./panels/SelectedDriverCard";
```

```typescript
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Selected Driver</div>
            <SelectedDriverCard state={latest} selectedDriver={selectedDriver} />
          </div>
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/panels/SelectedDriverCard.tsx frontend/src/panels/SelectedDriverCard.test.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add selected driver card panel"
```

---

## Task 12: Gap trend chart panel

**Files:**
- Create: `frontend/src/panels/GapTrendChart.tsx`
- Create: `frontend/src/panels/GapTrendChart.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `GapTrendChart({ history, selectedDriver }: { history: SessionState[]; selectedDriver: string | null })` — hand-rolled SVG line chart of the selected driver's `gap_to_leader` across `history`, same raw-SVG approach as `TrackMap`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/panels/GapTrendChart.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { GapTrendChart } from "./GapTrendChart";
import type { SessionState } from "../types";

function stateWithGap(lap: number, gap: number | null): SessionState {
  return {
    timestamp: `t${lap}`,
    track_status: "green",
    weather: null,
    race_control_messages: [],
    drivers: [
      {
        driver_number: "44", abbreviation: "HAM", team: "Mercedes", position: 2,
        gap_to_leader: gap, gap_to_ahead: gap, last_lap_time: 90, best_lap_time: 90,
        tire: { compound: "MEDIUM", age_laps: lap }, x: null, y: null,
        lap_number: lap, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      },
    ],
  };
}

test("draws a line for the selected driver's gap history", () => {
  const history = [stateWithGap(1, 2.0), stateWithGap(2, 2.5), stateWithGap(3, 1.8)];
  render(<GapTrendChart history={history} selectedDriver="44" />);
  expect(screen.getByTestId("gap-trend-line")).toBeInTheDocument();
});

test("shows a placeholder when no driver is selected", () => {
  render(<GapTrendChart history={[]} selectedDriver={null} />);
  expect(screen.getByText(/select a driver/i)).toBeInTheDocument();
});

test("skips ticks where the gap is unknown", () => {
  const history = [stateWithGap(1, 2.0), stateWithGap(2, null), stateWithGap(3, 1.8)];
  render(<GapTrendChart history={history} selectedDriver="44" />);
  const line = screen.getByTestId("gap-trend-line");
  // 2 known points -> polyline has exactly 2 coordinate pairs
  expect(line.getAttribute("points")?.trim().split(" ")).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- GapTrendChart.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement GapTrendChart.tsx**

Create `frontend/src/panels/GapTrendChart.tsx`:

```typescript
import type { SessionState } from "../types";

export function GapTrendChart({
  history,
  selectedDriver,
}: {
  history: SessionState[];
  selectedDriver: string | null;
}) {
  if (!selectedDriver) {
    return <p>Select a driver to see their gap trend.</p>;
  }

  const points = history
    .map((state) => state.drivers.find((d) => d.driver_number === selectedDriver)?.gap_to_leader ?? null)
    .filter((gap): gap is number => gap !== null);

  if (points.length === 0) {
    return <p>No gap data yet.</p>;
  }

  const width = 100;
  const height = 30;
  const maxGap = Math.max(...points, 0.1);
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;

  const coords = points
    .map((gap, i) => `${(i * stepX).toFixed(2)},${(height - (gap / maxGap) * height).toFixed(2)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 80 }}>
      <polyline
        data-testid="gap-trend-line"
        points={coords}
        fill="none"
        stroke="#3ecbff"
        strokeWidth={0.6}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- GapTrendChart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add to App.tsx**

Import and render in `pitwall-center`, after the sector times panel:

```typescript
import { GapTrendChart } from "./panels/GapTrendChart";
```

```typescript
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Gap Trend (to Leader)</div>
            <GapTrendChart history={history} selectedDriver={selectedDriver} />
          </div>
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/panels/GapTrendChart.tsx frontend/src/panels/GapTrendChart.test.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add gap trend chart panel for the selected driver"
```

---

## Task 13: Telemetry trace stack panel

**Files:**
- Create: `frontend/src/panels/TelemetryStack.tsx`
- Create: `frontend/src/panels/TelemetryStack.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `GET /session/telemetry?year=&event=&session_type=&driver=&lap_number=` from Task 4.
- Produces: `TelemetryStack({ sessionParams, state, selectedDriver }: { sessionParams: { year: number; event: string; sessionType: string } | null; state: SessionState | null; selectedDriver: string | null })` — replay-only; shows "unavailable in live mode" when `sessionParams` is `null`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/panels/TelemetryStack.test.tsx`:

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TelemetryStack } from "./TelemetryStack";
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
  ],
};

test("fetches and renders traces for the selected driver's current lap", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ distance: [0, 10], speed: [250, 260], throttle: [100, 100], brake: [false, false], gear: [6, 6], rpm: [11000, 11200] }),
  });

  render(
    <TelemetryStack
      sessionParams={{ year: 2023, event: "British Grand Prix", sessionType: "R" }}
      state={sampleState}
      selectedDriver="1"
    />,
  );

  await waitFor(() => expect(screen.getByTestId("telemetry-trace-speed")).toBeInTheDocument());
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/session/telemetry"));
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("driver=1"));
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("lap_number=5"));
});

test("shows unavailable message in live mode", () => {
  render(<TelemetryStack sessionParams={null} state={sampleState} selectedDriver="1" />);
  expect(screen.getByText(/unavailable in live mode/i)).toBeInTheDocument();
});

test("shows placeholder when no driver is selected", () => {
  render(
    <TelemetryStack
      sessionParams={{ year: 2023, event: "British Grand Prix", sessionType: "R" }}
      state={sampleState}
      selectedDriver={null}
    />,
  );
  expect(screen.getByText(/select a driver/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- TelemetryStack.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement TelemetryStack.tsx**

Create `frontend/src/panels/TelemetryStack.tsx`:

```typescript
import { useEffect, useState } from "react";
import type { SessionState } from "../types";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

type Traces = { distance: number[]; speed: number[]; throttle: number[]; brake: boolean[]; gear: number[]; rpm: number[] };

type SessionParams = { year: number; event: string; sessionType: string } | null;

function Trace({ testId, values, max, color }: { testId: string; values: number[]; max: number; color: string }) {
  const width = 100;
  const height = 16;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 28 }}>
      <polyline data-testid={testId} points={points} fill="none" stroke={color} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function TelemetryStack({
  sessionParams,
  state,
  selectedDriver,
}: {
  sessionParams: SessionParams;
  state: SessionState | null;
  selectedDriver: string | null;
}) {
  const [traces, setTraces] = useState<Traces | null>(null);
  const driver = state?.drivers.find((d) => d.driver_number === selectedDriver) ?? null;
  const lapNumber = driver?.lap_number ?? null;

  useEffect(() => {
    setTraces(null);
    if (!sessionParams || !selectedDriver || !lapNumber) return;
    const url =
      `${API_URL}/session/telemetry?year=${sessionParams.year}&event=${encodeURIComponent(sessionParams.event)}` +
      `&session_type=${sessionParams.sessionType}&driver=${selectedDriver}&lap_number=${lapNumber}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: Traces) => setTraces(data));
  }, [sessionParams, selectedDriver, lapNumber]);

  if (!sessionParams) {
    return <p>Telemetry unavailable in live mode.</p>;
  }
  if (!selectedDriver) {
    return <p>Select a driver to see telemetry.</p>;
  }
  if (!traces || traces.speed.length === 0) {
    return <p>Loading telemetry...</p>;
  }

  return (
    <div>
      <div className="pitwall-stat-label">Speed</div>
      <Trace testId="telemetry-trace-speed" values={traces.speed} max={Math.max(...traces.speed, 1)} color="#3ecbff" />
      <div className="pitwall-stat-label">Throttle</div>
      <Trace testId="telemetry-trace-throttle" values={traces.throttle} max={100} color="#4ade80" />
      <div className="pitwall-stat-label">Brake</div>
      <Trace testId="telemetry-trace-brake" values={traces.brake.map((b) => (b ? 1 : 0))} max={1} color="#f87171" />
      <div className="pitwall-stat-label">Gear</div>
      <Trace testId="telemetry-trace-gear" values={traces.gear} max={Math.max(...traces.gear, 1)} color="#facc15" />
      <div className="pitwall-stat-label">RPM</div>
      <Trace testId="telemetry-trace-rpm" values={traces.rpm} max={Math.max(...traces.rpm, 1)} color="#a78bfa" />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- TelemetryStack.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add to App.tsx**

```typescript
import { TelemetryStack } from "./panels/TelemetryStack";
```

```typescript
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Telemetry</div>
            <TelemetryStack sessionParams={sessionParams} state={latest} selectedDriver={selectedDriver} />
          </div>
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/panels/TelemetryStack.tsx frontend/src/panels/TelemetryStack.test.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add telemetry trace stack panel (speed/throttle/brake/gear/rpm)"
```

---

## Task 14: Weather panel

**Files:**
- Create: `frontend/src/panels/WeatherPanel.tsx`
- Create: `frontend/src/panels/WeatherPanel.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `WeatherPanel({ state }: { state: SessionState | null })` — reads `state.weather` directly, no fetch (already streamed on `SessionState`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/panels/WeatherPanel.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WeatherPanel } from "./WeatherPanel";
import type { SessionState } from "../types";

const stateWithWeather: SessionState = {
  timestamp: "t1",
  track_status: "green",
  race_control_messages: [],
  weather: { air_temp: 22.1, track_temp: 36.2, humidity: 51.0, wind_speed: 2.7, rainfall: false },
  drivers: [],
};

test("shows air/track temp, humidity, and wind", () => {
  render(<WeatherPanel state={stateWithWeather} />);
  expect(screen.getByText("22.1°C")).toBeInTheDocument();
  expect(screen.getByText("36.2°C")).toBeInTheDocument();
  expect(screen.getByText("51%")).toBeInTheDocument();
  expect(screen.getByText("2.7 km/h")).toBeInTheDocument();
});

test("shows unavailable message when there is no weather data (live mode)", () => {
  render(<WeatherPanel state={{ ...stateWithWeather, weather: null }} />);
  expect(screen.getByText(/unavailable in live mode/i)).toBeInTheDocument();
});

test("shows unavailable message when there is no session state yet", () => {
  render(<WeatherPanel state={null} />);
  expect(screen.getByText(/unavailable in live mode/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- WeatherPanel.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement WeatherPanel.tsx**

Create `frontend/src/panels/WeatherPanel.tsx`:

```typescript
import type { SessionState } from "../types";

export function WeatherPanel({ state }: { state: SessionState | null }) {
  const weather = state?.weather ?? null;

  if (!weather) {
    return <p>Weather unavailable in live mode.</p>;
  }

  return (
    <div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Air Temp</div>
        <div className="pitwall-stat-value">{weather.air_temp}°C</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Track Temp</div>
        <div className="pitwall-stat-value">{weather.track_temp}°C</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Humidity</div>
        <div className="pitwall-stat-value">{weather.humidity}%</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Wind</div>
        <div className="pitwall-stat-value">{weather.wind_speed} km/h</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Rain</div>
        <div className={`pitwall-stat-value ${weather.rainfall ? "cyan" : ""}`}>
          {weather.rainfall ? "YES" : "NO"}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- WeatherPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add to App.tsx**

```typescript
import { WeatherPanel } from "./panels/WeatherPanel";
```

Add to `pitwall-sidebar-right`:

```typescript
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Weather</div>
            <WeatherPanel state={latest} />
          </div>
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/panels/WeatherPanel.tsx frontend/src/panels/WeatherPanel.test.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add weather panel"
```

---

## Task 15: Race control ticker

**Files:**
- Create: `frontend/src/panels/RaceControlTicker.tsx`
- Create: `frontend/src/panels/RaceControlTicker.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `RaceControlTicker({ state }: { state: SessionState | null })` — reads `state.race_control_messages`, newest first, matching `RaceEngineerNotes`' existing list pattern.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/panels/RaceControlTicker.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RaceControlTicker } from "./RaceControlTicker";
import type { SessionState } from "../types";

const stateWithMessages: SessionState = {
  timestamp: "t1",
  track_status: "yellow",
  weather: null,
  drivers: [],
  race_control_messages: [
    { timestamp: "2026-07-09T13:05:00Z", category: "Other", message: "PIT EXIT OPEN", flag: null },
    { timestamp: "2026-07-09T13:10:00Z", category: "Flag", message: "YELLOW FLAG SECTOR 3", flag: "YELLOW" },
  ],
};

test("renders messages newest first", () => {
  render(<RaceControlTicker state={stateWithMessages} />);
  const items = screen.getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("YELLOW FLAG SECTOR 3");
  expect(items[1]).toHaveTextContent("PIT EXIT OPEN");
});

test("highlights flagged messages", () => {
  render(<RaceControlTicker state={stateWithMessages} />);
  const flagged = screen.getByText(/YELLOW FLAG SECTOR 3/);
  expect(flagged).toHaveStyle({ color: "var(--yellow)" });
});

test("shows a placeholder when there are no messages yet", () => {
  render(<RaceControlTicker state={{ ...stateWithMessages, race_control_messages: [] }} />);
  expect(screen.getByText(/no race control messages/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- RaceControlTicker.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement RaceControlTicker.tsx**

Create `frontend/src/panels/RaceControlTicker.tsx`:

```typescript
import type { RaceControlMessage, SessionState } from "../types";

function flagColor(flag: string | null): string | undefined {
  if (!flag) return undefined;
  const upper = flag.toUpperCase();
  if (upper.includes("YELLOW")) return "var(--yellow)";
  if (upper.includes("RED")) return "var(--red)";
  if (upper.includes("GREEN")) return "var(--green)";
  return undefined;
}

export function RaceControlTicker({ state }: { state: SessionState | null }) {
  const messages: RaceControlMessage[] = state?.race_control_messages ?? [];

  if (messages.length === 0) {
    return <p>No race control messages yet.</p>;
  }

  const newestFirst = [...messages].reverse();

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {newestFirst.map((m, i) => (
        <li key={`${m.timestamp}-${i}`} style={{ marginBottom: 4, fontSize: 12, color: flagColor(m.flag) }}>
          {m.message}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- RaceControlTicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add to App.tsx**

Add as the bottom strip, below `pitwall-grid` (a new full-width region):

```typescript
import { RaceControlTicker } from "./panels/RaceControlTicker";
```

```typescript
      </main>
      <footer className="pitwall-panel" style={{ margin: "0 8px 8px" }}>
        <div className="pitwall-panel-title">Race Control</div>
        <RaceControlTicker state={latest} />
      </footer>
    </div>
  );
}
```

(Replace the existing closing `</main>\n    </div>\n  );\n}` at the end of the component with this block — it adds the footer after `main` closes.)

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/panels/RaceControlTicker.tsx frontend/src/panels/RaceControlTicker.test.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add race control message ticker as a bottom strip"
```

---

## Task 16: Tire strategy restyle to horizontal bars

**Files:**
- Modify: `frontend/src/panels/TireStrategy.tsx`
- Modify: `frontend/src/panels/TireStrategy.test.tsx`

**Interfaces:**
- Produces: same `TireStrategy({ history }: { history: SessionState[] })` signature; stint pills become proportionally-widthed horizontal bar segments colored by `tireColor`.

- [ ] **Step 1: Write the failing test**

`frontend/src/panels/TireStrategy.test.tsx` already has a `driverTick(lap, compound)` helper that builds a `SessionState` for driver `"1"`. Add, reusing it:

```typescript
test("colors each stint segment by tire compound", () => {
  const history = [driverTick(1, "SOFT"), driverTick(2, "SOFT")];
  render(<TireStrategy history={history} />);
  const segment = screen.getByTestId("stint-1-SOFT-1-2");
  expect(segment).toHaveStyle({ background: "#e10600" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- TireStrategy.test.tsx`
Expected: FAIL — current segments use a flat `#333` background regardless of compound.

- [ ] **Step 3: Implement the restyle**

In `frontend/src/panels/TireStrategy.tsx`, add the import:

```typescript
import { tireColor } from "../constants";
```

Replace the stint segment's `style` (inside the `.map((stint) => ...)` block):

```typescript
                <div
                  key={`${stint.compound}-${stint.startLap}`}
                  data-testid={`stint-${driverNumber}-${stint.compound}-${stint.startLap}-${stint.endLap}`}
                  style={{
                    padding: "2px 8px",
                    background: tireColor(stint.compound),
                    color: "#050607",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- TireStrategy.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/TireStrategy.tsx frontend/src/panels/TireStrategy.test.tsx
git commit -m "style(frontend): color tire strategy stint bars by compound"
```

---

## Task 17: Restyle AI panels into the "strategy" slot, final layout pass

Consolidates the AI race-engineer widgets (which replace the predictive strategy panel per design decision) visually, and does a final pass ensuring every panel from Tasks 9–16 sits in the region described in the spec.

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- No new component interfaces — this task only rearranges existing JSX/CSS.

- [ ] **Step 1: Rearrange App.tsx into the final region layout**

Replace the `return (...)` dashboard block in `frontend/src/App.tsx` (everything after the landing-page early return) with:

```typescript
  return (
    <div>
      <header className="pitwall-header">
        <h1>PitWall</h1>
        <div className="pitwall-stat-value" style={{ fontSize: 11 }}>
          {latest ? latest.track_status.replaceAll("_", " ").toUpperCase() : "—"}
        </div>
      </header>
      <main className="pitwall-grid">
        <div className="pitwall-sidebar-left">
          <OverviewPanel state={latest} />
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Timing Tower</div>
            <TimingTower state={latest} selectedDriver={selectedDriver} onSelectDriver={setSelectedDriver} />
          </div>
        </div>
        <div className="pitwall-center">
          <div className="pitwall-panel pitwall-circuit-bezel">
            <div className="pitwall-panel-title">Circuit</div>
            <TrackMap state={latest} sessionParams={sessionParams} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Sector Times</div>
            <SectorTimes state={latest} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Gap Trend (to Leader)</div>
            <GapTrendChart history={history} selectedDriver={selectedDriver} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Tire Strategy</div>
            <TireStrategy history={history} />
          </div>
        </div>
        <div className="pitwall-sidebar-right">
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Selected Driver</div>
            <SelectedDriverCard state={latest} selectedDriver={selectedDriver} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Telemetry</div>
            <TelemetryStack sessionParams={sessionParams} state={latest} selectedDriver={selectedDriver} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Weather</div>
            <WeatherPanel state={latest} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Race Engineer Notes</div>
            <RaceEngineerNotes notes={notes} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Ask The Engineer</div>
            <AiChat />
          </div>
        </div>
      </main>
      <footer className="pitwall-panel" style={{ margin: "0 8px 8px" }}>
        <div className="pitwall-panel-title">Race Control</div>
        <RaceControlTicker state={latest} />
      </footer>
    </div>
  );
}
```

This moves Timing Tower into the left column (matching the spec's "left column: timing tower" region — it had been left in center in earlier tasks for incremental testability), keeps the track map + sector times + gap trend + tire strategy in the center, and groups selected-driver/telemetry/weather/AI-engineer in the right column.

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS — no component logic changed, only JSX placement, so no test files need edits unless one of them queries DOM structure/order (check for any test asserting sibling order across panels; none of the panel test files render `<App />` directly except `App.test.tsx`, so this is the only file at risk).

- [ ] **Step 3: Visual check**

Run: `cd frontend && npm run dev`, open the app, start a replay session, confirm: timing tower on the left with team/tire colors and click-to-select working, track map + sector times + gap trend + tire strategy bars in the center, selected-driver/telemetry/weather/AI panels on the right, race control ticker as a full-width footer. Click a few timing-tower rows and confirm the right-column panels update. Then stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.css
git commit -m "style(frontend): final panel layout pass matching the pit-wall region spec"
```

---

## Task 18: Full-stack verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && .venv/bin/pytest -v`
Expected: PASS, all files.

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS, all files.

- [ ] **Step 3: End-to-end manual check**

Run: `docker compose up` (or `cd backend && .venv/bin/uvicorn app.main:app --reload` plus `cd frontend && npm run dev` if compose isn't set up for this workflow — check `docker-compose.yml` first to see which applies).

In the browser:
1. Confirm the landing page loads with a populated Year dropdown.
2. Pick a year, confirm Track populates; pick a track, confirm Session populates with real session names (e.g. "Practice 1", "Qualifying", "Race").
3. Start a replay, confirm the dashboard loads: timing tower with team colors, gaps now showing real numbers (not `-`), track map outline, gap trend chart drawing a line once a driver is selected, tire strategy bars colored by compound, weather panel showing real numbers, race control ticker populating as laps advance, telemetry traces rendering for the selected driver.
4. Click a different timing-tower row, confirm selected-driver card/telemetry/gap-trend update.
5. Press ArrowUp/ArrowDown, confirm selection cycles.
6. Go back to the landing page (refresh), click "Go live" (if a live f1-dash source is reachable in this environment — otherwise confirm the request fires and the dashboard loads showing its waiting state, since there's likely no live session running at the time of this check), confirm track map shows its empty state and weather/telemetry panels show their "unavailable in live mode" messages as designed.

- [ ] **Step 4: Report results**

No commit for this task — it's a verification checkpoint. If any check fails, fix it as a follow-up task before considering the plan complete.
