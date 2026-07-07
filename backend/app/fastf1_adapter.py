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
                )
            )

        if not drivers:
            continue

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
