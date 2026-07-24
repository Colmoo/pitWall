from datetime import datetime, timezone

from app.analysis import build_lap_analysis
from app.schema import DriverState, SessionState, Tire, TrackStatus


def _driver(num, abbr, pos, lap, gap, compound="SOFT", last=90.0):
    return DriverState(
        driver_number=num, abbreviation=abbr, team="T" + num, position=pos,
        gap_to_leader=gap, last_lap_time=last, lap_number=lap,
        tire=Tire(compound=compound, age_laps=lap),
    )


def _state(ts, drivers, status=TrackStatus.GREEN):
    return SessionState(timestamp=ts, track_status=status, drivers=drivers)


def test_build_lap_analysis_groups_per_driver_per_lap():
    ts = datetime(2026, 1, 1, tzinfo=timezone.utc)
    states = [
        _state(ts, [_driver("1", "VER", 1, 1, None), _driver("44", "HAM", 2, 1, 1.5)]),
        _state(ts, [_driver("1", "VER", 1, 2, None), _driver("44", "HAM", 2, 2, 2.0)]),
    ]
    result = build_lap_analysis(states)
    assert result["total_laps"] == 2
    ver = next(d for d in result["drivers"] if d["abbreviation"] == "VER")
    assert [lap["lap"] for lap in ver["laps"]] == [1, 2]
    ham = next(d for d in result["drivers"] if d["abbreviation"] == "HAM")
    assert ham["laps"][1]["gap_to_leader"] == 2.0


def test_build_lap_analysis_marks_pit_on_compound_change():
    ts = datetime(2026, 1, 1, tzinfo=timezone.utc)
    states = [
        _state(ts, [_driver("1", "VER", 1, 1, None, compound="MEDIUM")]),
        _state(ts, [_driver("1", "VER", 1, 2, None, compound="MEDIUM")]),
        _state(ts, [_driver("1", "VER", 1, 3, None, compound="HARD")]),
    ]
    ver = build_lap_analysis(states)["drivers"][0]
    assert [lap["pit"] for lap in ver["laps"]] == [False, False, True]


def test_build_lap_analysis_collapses_sc_vsc_into_ranges():
    ts = datetime(2026, 1, 1, tzinfo=timezone.utc)
    states = [
        _state(ts, [_driver("1", "VER", 1, 1, None)]),
        _state(ts, [_driver("1", "VER", 1, 3, None)], status=TrackStatus.SC),
        _state(ts, [_driver("1", "VER", 1, 4, None)], status=TrackStatus.VSC),
        _state(ts, [_driver("1", "VER", 1, 6, None)], status=TrackStatus.SC),
    ]
    result = build_lap_analysis(states)
    # laps 3-4 contiguous, lap 6 separate
    assert result["sc_vsc_laps"] == [[3, 4], [6, 6]]
