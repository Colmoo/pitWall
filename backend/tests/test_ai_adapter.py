from datetime import datetime, timezone

from app.ai_adapter import summarize_changes, describe_state
from app.schema import DriverState, SessionState, Tire, TrackStatus


def _driver(number, abbr, position, best_lap, compound):
    return DriverState(
        driver_number=number, abbreviation=abbr, team="Team", position=position,
        gap_to_leader=None, gap_to_ahead=None, last_lap_time=None, best_lap_time=best_lap,
        tire=Tire(compound=compound, age_laps=1), lap_number=5,
        sector_1_time=None, sector_2_time=None, sector_3_time=None,
    )


def _state(drivers, track_status=TrackStatus.GREEN):
    return SessionState(timestamp=datetime.now(timezone.utc), track_status=track_status, drivers=drivers)


def test_summarize_changes_reports_session_start_when_no_previous():
    current = _state([_driver("1", "VER", 1, 90.0, "SOFT")])
    assert summarize_changes(None, current) == "Session start."


def test_summarize_changes_reports_position_change():
    previous = _state([_driver("1", "VER", 1, 90.0, "SOFT"), _driver("44", "HAM", 2, 91.0, "SOFT")])
    current = _state([_driver("44", "HAM", 1, 91.0, "SOFT"), _driver("1", "VER", 2, 90.0, "SOFT")])
    result = summarize_changes(previous, current)
    assert "HAM moved from P2 to P1" in result
    assert "VER moved from P1 to P2" in result


def test_summarize_changes_reports_best_lap_improvement():
    previous = _state([_driver("1", "VER", 1, 90.0, "SOFT")])
    current = _state([_driver("1", "VER", 1, 89.5, "SOFT")])
    assert "VER set a new best lap: 89.500s" in summarize_changes(previous, current)


def test_summarize_changes_reports_tire_change_as_pit_stop():
    previous = _state([_driver("1", "VER", 1, 90.0, "SOFT")])
    current = _state([_driver("1", "VER", 1, 90.0, "MEDIUM")])
    assert "VER pitted for MEDIUM tires" in summarize_changes(previous, current)


def test_summarize_changes_reports_non_green_track_status():
    previous = _state([_driver("1", "VER", 1, 90.0, "SOFT")])
    current = _state([_driver("1", "VER", 1, 90.0, "SOFT")], track_status=TrackStatus.YELLOW)
    assert "Track status: yellow" in summarize_changes(previous, current)


def test_summarize_changes_reports_no_changes_when_nothing_changed():
    previous = _state([_driver("1", "VER", 1, 90.0, "SOFT")])
    current = _state([_driver("1", "VER", 1, 90.0, "SOFT")])
    assert summarize_changes(previous, current) == "No significant changes since last check."


def test_describe_state_summarizes_top_3_and_track_status():
    state = _state([
        _driver("1", "VER", 1, 90.0, "SOFT"),
        _driver("44", "HAM", 2, 91.0, "SOFT"),
        _driver("16", "LEC", 3, 91.5, "SOFT"),
        _driver("55", "SAI", 4, 92.0, "SOFT"),
    ])
    result = describe_state(state)
    assert "VER (P1)" in result
    assert "HAM (P2)" in result
    assert "LEC (P3)" in result
    assert "SAI" not in result
    assert "green" in result


def test_describe_state_handles_no_drivers():
    assert describe_state(_state([])) == "No drivers on track."
