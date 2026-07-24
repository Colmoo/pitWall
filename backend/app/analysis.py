"""Per-lap race analysis aggregation.

Reduces the full per-tick SessionState list (from load_session_states) into a
compact per-driver, per-lap dataset that the frontend analysis charts consume in
a single request - gap-to-leader, position, lap/sector times, tyre and pit laps,
plus session-wide SC/VSC lap ranges for shading. One endpoint, many charts.
"""
from collections import defaultdict

from app.schema import SessionState, TrackStatus


def build_lap_analysis(states: list[SessionState]) -> dict:
    meta: dict[str, dict] = {}
    laps_by_driver: dict[str, dict[int, dict]] = defaultdict(dict)
    sc_vsc_laps: set[int] = set()
    weather_by_lap: dict[int, dict] = {}
    max_lap = 0

    for state in states:
        # Race lap ~ the leader's lap count (drivers are position-sorted, [0] leads).
        race_lap = max((d.lap_number or 0 for d in state.drivers), default=0)
        if state.track_status in (TrackStatus.SC, TrackStatus.VSC):
            sc_vsc_laps.add(race_lap)
        if race_lap >= 1 and state.weather is not None:
            weather_by_lap[race_lap] = {
                "lap": race_lap,
                "air_temp": state.weather.air_temp,
                "track_temp": state.weather.track_temp,
                "humidity": state.weather.humidity,
                "wind_speed": state.weather.wind_speed,
                "rainfall": state.weather.rainfall,
            }
        for d in state.drivers:
            if d.lap_number is None:
                continue
            max_lap = max(max_lap, d.lap_number)
            meta.setdefault(
                d.driver_number,
                {"driver_number": d.driver_number, "abbreviation": d.abbreviation, "team": d.team},
            )
            # last write per lap wins - the freshest snapshot for that lap.
            laps_by_driver[d.driver_number][d.lap_number] = {
                "lap": d.lap_number,
                "position": d.position,
                "gap_to_leader": d.gap_to_leader,
                "lap_time": d.last_lap_time,
                "sector_1_time": d.sector_1_time,
                "sector_2_time": d.sector_2_time,
                "sector_3_time": d.sector_3_time,
                "compound": d.tire.compound,
            }

    drivers = []
    for number, info in meta.items():
        records = [laps_by_driver[number][lap] for lap in sorted(laps_by_driver[number])]
        # ponytail: mark a pit lap by tyre-compound change vs the previous lap.
        # Misses same-compound stops (no pit in/out on DriverState); upgrade to
        # real pit timing if that distinction is needed.
        prev_compound = None
        for rec in records:
            rec["pit"] = prev_compound is not None and rec["compound"] != prev_compound
            prev_compound = rec["compound"]
        drivers.append({**info, "laps": records})

    return {
        "total_laps": max_lap,
        "sc_vsc_laps": _contiguous_ranges(sorted(sc_vsc_laps)),
        "weather": [weather_by_lap[lap] for lap in sorted(weather_by_lap)],
        "drivers": drivers,
    }


def _contiguous_ranges(laps: list[int]) -> list[list[int]]:
    ranges: list[list[int]] = []
    for lap in laps:
        if ranges and lap == ranges[-1][1] + 1:
            ranges[-1][1] = lap
        else:
            ranges.append([lap, lap])
    return ranges
