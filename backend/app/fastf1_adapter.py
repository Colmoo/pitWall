from datetime import datetime

import fastf1
import pandas as pd

from app.schema import DriverState, RaceControlMessage, SessionState, Tire, TrackStatus, WeatherSnapshot


def _sector_seconds(value) -> float | None:
    return None if pd.isna(value) else value.total_seconds()


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


def track_layout_from_telemetry(telemetry: pd.DataFrame, num_points: int = 150) -> list[list[float]]:
    total = len(telemetry)
    if total == 0:
        return []
    step = max(1, total // num_points)
    sampled = telemetry.iloc[::step]
    return [[float(row["X"]), float(row["Y"])] for _, row in sampled.iterrows()]


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


def attach_car_positions(
    states: list[SessionState], pos_data: dict[str, "pd.DataFrame"], session_start: datetime
) -> None:
    for state in states:
        elapsed = state.timestamp - session_start
        for driver in state.drivers:
            driver_pos = pos_data.get(driver.driver_number)
            if driver_pos is None or driver_pos.empty:
                continue
            idx = (driver_pos["Time"] - elapsed).abs().idxmin()
            row = driver_pos.loc[idx]
            driver.x = float(row["X"])
            driver.y = float(row["Y"])


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
    try:
        telemetry = fastest_lap.get_telemetry()
    except KeyError:
        # Some older/incomplete sessions (e.g. 2018 Australian GP) have no car
        # position telemetry at all - degrade to an empty layout rather than 500.
        return []
    return track_layout_from_telemetry(telemetry)


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

    car_data = driver_laps.iloc[0].get_car_data().add_distance()
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
    states = session_states_from_laps(session.laps, session_start)
    attach_weather(states, session.weather_data, session_start)
    attach_race_control_messages(states, session.race_control_messages)
    attach_car_positions(states, session.pos_data, session_start)
    return states
