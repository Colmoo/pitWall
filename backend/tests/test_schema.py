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
