from datetime import datetime

import fastf1
import numpy as np
import pandas as pd

from app.live_adapter import _TRACK_STATUS_CODES
from app.schema import DriverState, RaceControlMessage, SessionState, Tire, TrackStatus, WeatherSnapshot


def _sector_seconds(value) -> float | None:
    return None if pd.isna(value) else value.total_seconds()


def _synthesize_positions(laps: pd.DataFrame) -> pd.Series:
    # Practice and Qualifying laps carry no official per-lap Position from
    # FastF1 (it's Race-only) - rank each driver by their best lap time so
    # far instead, mirroring what an FP/Q timing screen shows, so those
    # session types aren't entirely filtered out below.
    positions = pd.Series(index=laps.index, dtype="float64")
    best_by_driver: dict[str, float] = {}
    for idx, row in laps.sort_values("Time").iterrows():
        if pd.isna(row["LapTime"]):
            continue
        number = row["DriverNumber"]
        seconds = row["LapTime"].total_seconds()
        best = best_by_driver.get(number)
        if best is None or seconds < best:
            best = seconds
        best_by_driver[number] = best
        ranking = sorted(best_by_driver, key=best_by_driver.get)
        positions[idx] = ranking.index(number) + 1
    return positions


def session_states_from_laps(laps: pd.DataFrame, session_start: datetime) -> list[SessionState]:
    states: list[SessionState] = []
    best_lap_by_driver: dict[str, float] = {}

    # running: driver_number -> (latest DriverState, its row Time). Rebuilt into
    # a fresh snapshot on every lap-completion event so state doesn't drift once
    # emitted - see model_copy() below.
    running: dict[str, tuple[DriverState, "pd.Timedelta"]] = {}

    # Sort by Time (session-relative cumulative clock), not LapNumber - LapNumber
    # is a per-driver counter and bundling rows that share a count across drivers
    # mixes up unrelated, non-simultaneous timing events (see bug report).
    for _, row in laps.sort_values("Time").iterrows():
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
        flying_lap = pd.isna(row["PitOutTime"]) and pd.isna(row["PitInTime"])

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
            lap_number=int(row["LapNumber"]),
            sector_1_time=_sector_seconds(row["Sector1Time"]),
            sector_2_time=_sector_seconds(row["Sector2Time"]),
            sector_3_time=_sector_seconds(row["Sector3Time"]),
            flying_lap=bool(flying_lap),
        )
        running[number] = (driver_state, row["Time"])

        # entries pairs a *copy* of each currently-known driver's state with its
        # raw cumulative session Time, so gaps can be computed for this snapshot
        # without mutating objects already emitted into earlier states.
        entries: list[tuple[DriverState, "pd.Timedelta"]] = [
            (state.model_copy(), row_time) for state, row_time in running.values()
        ]
        entries.sort(key=lambda pair: pair[0].position)
        leader_time = entries[0][1]
        previous_time = None
        for entry_state, row_time in entries:
            is_leader = entry_state is entries[0][0]
            entry_state.gap_to_leader = None if is_leader else (row_time - leader_time).total_seconds()
            entry_state.gap_to_ahead = None if previous_time is None else (row_time - previous_time).total_seconds()
            previous_time = row_time

        states.append(
            SessionState(
                timestamp=session_start + row["Time"],
                # overwritten by attach_track_status once real flag data is available.
                track_status=TrackStatus.GREEN,
                drivers=[pair[0] for pair in entries],
            )
        )

    return states


def track_layout_from_telemetry(
    telemetry: pd.DataFrame, num_points: int = 150, extra_columns: list[str] | None = None
) -> list[list[float]]:
    total = len(telemetry)
    if total == 0:
        return []
    step = max(1, total // num_points)
    sampled = telemetry.iloc[::step]
    columns = ["X", "Y"] + (extra_columns or [])
    return [[float(row[c]) for c in columns] for _, row in sampled.iterrows()]


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


def attach_track_status(states: list[SessionState], track_status_data: "pd.DataFrame", session_start: datetime) -> None:
    if track_status_data is None or track_status_data.empty:
        return
    events = track_status_data.sort_values("Time")
    times = events["Time"].values
    codes = events["Status"].tolist()
    for state in states:
        elapsed = pd.Timestamp(state.timestamp) - pd.Timestamp(session_start)
        # last flag event at or before this state's time, not the nearest one -
        # a flag stays in effect until the next event changes it.
        idx = int(np.searchsorted(times, pd.Timedelta(elapsed).to_timedelta64(), side="right")) - 1
        if idx >= 0:
            state.track_status = _TRACK_STATUS_CODES.get(str(codes[idx]), TrackStatus.GREEN)


def _nearest_position(driver_pos: "pd.DataFrame", elapsed: "pd.Timedelta") -> tuple[float, float] | None:
    # driver_pos must already be sorted by Time. searchsorted is O(log n), so this
    # stays cheap even called per-driver per-tick across a full session.
    times = driver_pos["Time"].values
    idx = int(np.searchsorted(times, pd.Timedelta(elapsed).to_timedelta64()))
    if idx <= 0:
        row = driver_pos.iloc[0]
    elif idx >= len(driver_pos):
        row = driver_pos.iloc[-1]
    else:
        before, after = driver_pos.iloc[idx - 1], driver_pos.iloc[idx]
        row = before if (elapsed - before["Time"]) <= (after["Time"] - elapsed) else after
    return float(row["X"]), float(row["Y"])


def _attach_positions_at(state: SessionState, sorted_positions: dict[str, "pd.DataFrame"], elapsed: "pd.Timedelta") -> None:
    for driver in state.drivers:
        driver_pos = sorted_positions.get(driver.driver_number)
        if driver_pos is None:
            continue
        driver.x, driver.y = _nearest_position(driver_pos, elapsed)


# Lap-completion events (session_states_from_laps) only fire every ~90s per
# driver, which made the map's dots visibly teleport/freeze between laps
# instead of moving smoothly. This inserts intermediate ticks between each
# pair of lap-completion states, carrying the last-known timing/gap/tire
# snapshot forward but refreshing x/y from the much higher-frequency FastF1
# position telemetry - so the dots glide instead of jumping once a lap.
def attach_car_positions(
    states: list[SessionState],
    pos_data: dict[str, "pd.DataFrame"],
    session_start: datetime,
    tick_seconds: float = 5.0,
) -> list[SessionState]:
    sorted_positions = {number: df.sort_values("Time") for number, df in pos_data.items() if not df.empty}
    if not states or not sorted_positions:
        return states

    step = pd.Timedelta(seconds=tick_seconds)
    expanded: list[SessionState] = []
    for i, state in enumerate(states):
        elapsed = pd.Timestamp(state.timestamp) - pd.Timestamp(session_start)
        _attach_positions_at(state, sorted_positions, elapsed)
        expanded.append(state)
        if i + 1 >= len(states):
            break
        next_elapsed = pd.Timestamp(states[i + 1].timestamp) - pd.Timestamp(session_start)
        tick = elapsed + step
        while tick < next_elapsed:
            # ponytail: only x/y change per tick, so shallow-copy the state and
            # its drivers (sharing tire/weather/telemetry by reference) instead
            # of a deep copy of all 20 drivers' full data. Fresh driver objects
            # are needed because _attach_positions_at mutates x/y in place - the
            # originals (already emitted) must stay untouched.
            # Ceiling: the whole expanded list is resident in RAM - a 2h race is
            # ~1400 states x 20 driver copies at the 5s default (3s was ~40%
            # heavier, for smoothness no one could see). Upgrade path: drop the
            # pre-expansion and generate tick positions lazily as the replay
            # loop emits each state.
            tick_drivers = [driver.model_copy() for driver in state.drivers]
            snapshot = state.model_copy(update={"drivers": tick_drivers, "timestamp": session_start + tick})
            _attach_positions_at(snapshot, sorted_positions, tick)
            expanded.append(snapshot)
            tick += step
    return expanded


# Statuses FastF1's session.results uses for classified finishers - anything
# else (Retired, Accident, Disqualified, Did not start, ...) means the driver
# is out of the race for the remainder of the replay.
_FINISHED_STATUS_PREFIXES = ("Finished", "+")


def attach_retirements(states: list[SessionState], laps: pd.DataFrame, results: "pd.DataFrame", session_start: datetime) -> None:
    if results is None or results.empty or "Status" not in results.columns:
        return
    last_lap_time = laps.groupby("DriverNumber")["Time"].max()
    retired_cutoff: dict[str, datetime] = {}
    for _, row in results.iterrows():
        status = str(row.get("Status", ""))
        if status.startswith(_FINISHED_STATUS_PREFIXES):
            continue
        number = str(row["DriverNumber"])
        cutoff = last_lap_time.get(number)
        if cutoff is not None and not pd.isna(cutoff):
            retired_cutoff[number] = session_start + cutoff

    if not retired_cutoff:
        return
    for state in states:
        for driver in state.drivers:
            cutoff = retired_cutoff.get(driver.driver_number)
            if cutoff is not None and state.timestamp > cutoff:
                driver.status = "out"


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
    if rcm is None or rcm.empty:
        for state in states:
            state.race_control_messages = []
        return
    ordered = rcm.sort_values("Time")
    times = [t.to_pydatetime() if hasattr(t, "to_pydatetime") else t for t in ordered["Time"]]
    messages = [
        RaceControlMessage(
            timestamp=timestamp,
            category=category,
            message=message,
            flag=None if pd.isna(flag) else flag,
        )
        for timestamp, category, message, flag in zip(times, ordered["Category"], ordered["Message"], ordered["Flag"])
    ]
    # ponytail: each message object is built once and every state gets a prefix
    # SLICE of the same list, so a 2h race holds ~150 messages instead of
    # ~360k copies. sorted() only guards against unordered input - states are
    # already time-ordered in practice, so this stays O(states + messages).
    cursor = 0
    for state in sorted(states, key=lambda s: s.timestamp):
        while cursor < len(times) and times[cursor] <= state.timestamp:
            cursor += 1
        state.race_control_messages = messages[:cursor]


_session_cache: dict[tuple[int, str, str], "fastf1.core.Session"] = {}


def get_or_load_session(year: int, event: str, session_type: str, cache_dir: str) -> "fastf1.core.Session":
    key = (year, event, session_type)
    if key not in _session_cache:
        fastf1.Cache.enable_cache(cache_dir)
        session = fastf1.get_session(year, event, session_type)
        session.load()
        _session_cache[key] = session
    return _session_cache[key]


# FastF1's DRS channel: 0/1 closed, 8 detected-but-not-open, 10/12/14 open.
# >=10 is the documented "open" threshold used across other F1 live-timing tooling.
_DRS_OPEN_MIN_VALUE = 10
# Ignore DRS blips shorter than this - a real zone spans hundreds of metres;
# anything shorter is channel noise around the open/close edge.
_DRS_ZONE_MIN_METERS = 50


def _drs_zones_from_telemetry(telemetry: pd.DataFrame) -> list[dict]:
    if "DRS" not in telemetry.columns or telemetry.empty:
        return []
    is_open = (telemetry["DRS"] >= _DRS_OPEN_MIN_VALUE).tolist()
    index_spans: list[tuple[int, int]] = []
    start: int | None = None
    for i, open_now in enumerate(is_open):
        if open_now and start is None:
            start = i
        elif not open_now and start is not None:
            index_spans.append((start, i - 1))
            start = None
    if start is not None:
        index_spans.append((start, len(telemetry) - 1))

    zones = []
    for start_idx, end_idx in index_spans:
        start_row, end_row = telemetry.iloc[start_idx], telemetry.iloc[end_idx]
        if "Distance" in telemetry.columns and (end_row["Distance"] - start_row["Distance"]) < _DRS_ZONE_MIN_METERS:
            continue
        zones.append({
            "start_x": float(start_row["X"]), "start_y": float(start_row["Y"]),
            "end_x": float(end_row["X"]), "end_y": float(end_row["Y"]),
        })
    return zones


def load_track_layout(year: int, event: str, session_type: str, cache_dir: str) -> dict:
    session = get_or_load_session(year, event, session_type, cache_dir)
    fastest_lap = session.laps.pick_fastest()
    try:
        telemetry = fastest_lap.get_telemetry()
    except KeyError:
        # Some older/incomplete sessions (e.g. 2018 Australian GP) have no car
        # position telemetry at all - degrade to an empty layout rather than 500.
        return {"points": [], "corners": [], "sector_boundaries": [], "micro_sector_boundaries": [], "drs_zones": []}

    # points carry Distance-along-lap as a 3rd value so the frontend can color
    # each segment by timing sector, like an official circuit poster.
    points = track_layout_from_telemetry(telemetry, extra_columns=["Distance"])

    corners: list[dict] = []
    # FastF1's marshal_sectors are a much finer-grained division than the 3
    # timing sectors (flag/marshalling posts, often 15-20 per circuit) - kept
    # as their own "micro sectors" map layer rather than folded into the real
    # sector split below.
    micro_sector_boundaries: list[float] = []
    circuit_info = session.get_circuit_info()
    if circuit_info is not None:
        corners = [
            # Angle points in the direction FastF1 itself recommends offsetting
            # a corner's label toward, so the number sits outside the turn
            # instead of directly on the racing line.
            {"number": int(row["Number"]), "x": float(row["X"]), "y": float(row["Y"]), "angle": float(row["Angle"])}
            for _, row in circuit_info.corners.iterrows()
        ]
        micro_sector_boundaries = sorted(float(d) for d in circuit_info.marshal_sectors["Distance"].tolist())

    # The real S1/S2/S3 timing-sector boundaries aren't published as geometry -
    # FastF1's marshal_sectors are a different, much finer-grained thing (used
    # for flags/marshalling posts, not the 3 timing sectors on a poster). Split
    # the lap into exactly 3 timing sectors instead, using each sector's share
    # of the fastest lap's total time as a stand-in for its share of distance.
    sector_boundaries: list[float] = []
    try:
        lap_seconds = fastest_lap["LapTime"].total_seconds()
        sector_1_seconds = fastest_lap["Sector1Time"].total_seconds()
        sector_2_seconds = fastest_lap["Sector2Time"].total_seconds()
        total_distance = float(telemetry["Distance"].max())
        if lap_seconds > 0 and total_distance > 0:
            sector_boundaries = [
                (sector_1_seconds / lap_seconds) * total_distance,
                ((sector_1_seconds + sector_2_seconds) / lap_seconds) * total_distance,
            ]
    except (KeyError, AttributeError, TypeError):
        # Sector times can be NaT for an incomplete/red-flagged fastest lap -
        # fall back to an undivided (single-color) outline rather than 500.
        sector_boundaries = []

    # DRS zone geometry isn't published by FastF1 - approximate it from where the
    # fastest lap's DRS channel was actually open, rather than fabricating zones.
    drs_zones = _drs_zones_from_telemetry(telemetry)

    return {
        "points": points,
        "corners": corners,
        "sector_boundaries": sector_boundaries,
        "micro_sector_boundaries": micro_sector_boundaries,
        "drs_zones": drs_zones,
    }


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


def load_driver_lap_telemetry(
    year: int, event: str, session_type: str, driver: str, lap_number: int, cache_dir: str,
) -> dict:
    session = get_or_load_session(year=year, event=event, session_type=session_type, cache_dir=cache_dir)
    driver_laps = session.laps.pick_drivers(driver).pick_laps(lap_number)
    if driver_laps.empty:
        return {"distance": [], "speed": [], "throttle": [], "brake": [], "gear": [], "rpm": []}

    try:
        car_data = driver_laps.iloc[0].get_car_data().add_distance()
    except fastf1.core.DataNotLoadedError:
        # Very recent/in-progress sessions can have lap data published before
        # car telemetry is - degrade to empty rather than 500.
        return {"distance": [], "speed": [], "throttle": [], "brake": [], "gear": [], "rpm": []}
    return {
        "distance": car_data["Distance"].tolist(),
        "speed": car_data["Speed"].tolist(),
        "throttle": car_data["Throttle"].tolist(),
        "brake": car_data["Brake"].tolist(),
        "gear": car_data["nGear"].tolist(),
        "rpm": car_data["RPM"].tolist(),
    }


def load_session_states(year: int, event: str, session_type: str, cache_dir: str) -> list[SessionState]:
    session = get_or_load_session(year, event, session_type, cache_dir)
    # ponytail: session.session_start_time is a Timedelta (session-relative), not
    # an absolute datetime like session.date - use session.date as the anchor for
    # lap "Time" deltas, which is accurate enough for display purposes.
    session_start = session.date.to_pydatetime()
    laps = session.laps
    if laps["Position"].isna().any():
        # Real races can leave Position NaN for just the opening lap(s) while
        # FastF1's timing system settles after the start, not only the
        # all-NaN FP/Q case - fill gaps instead of dropping those laps
        # entirely (see session_states_from_laps' NaN-Position skip).
        laps = laps.copy()
        laps["Position"] = laps["Position"].fillna(_synthesize_positions(laps))
    states = session_states_from_laps(laps, session_start)
    attach_weather(states, session.weather_data, session_start)
    attach_race_control_messages(states, session.race_control_messages)
    try:
        track_status_data = session.track_status
    except (fastf1.core.DataNotLoadedError, AttributeError):
        track_status_data = None
    attach_track_status(states, track_status_data, session_start)
    try:
        results = session.results
    except (fastf1.core.DataNotLoadedError, AttributeError):
        results = None
    attach_retirements(states, laps, results, session_start)
    try:
        pos_data = session.pos_data
    except fastf1.core.DataNotLoadedError:
        # Some sessions (e.g. older/incomplete ones) have no car position
        # telemetry at all - degrade to no positions rather than 500.
        pos_data = {}
    states = attach_car_positions(states, pos_data, session_start)
    return states
