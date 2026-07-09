from datetime import datetime, timezone
from app.schema import SessionState, DriverState, Tire, TrackStatus, WeatherSnapshot, RaceControlMessage


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


def test_driver_state_carries_lap_number_and_sector_times():
    driver = DriverState(
        driver_number="1",
        abbreviation="VER",
        team="Red Bull",
        position=1,
        gap_to_leader=None,
        gap_to_ahead=None,
        last_lap_time=91.234,
        best_lap_time=90.5,
        tire=Tire(compound="SOFT", age_laps=3),
        lap_number=12,
        sector_1_time=28.1,
        sector_2_time=31.4,
        sector_3_time=31.734,
    )
    dumped = driver.model_dump(mode="json")
    assert dumped["lap_number"] == 12
    assert dumped["sector_1_time"] == 28.1
    assert dumped["sector_3_time"] == 31.734


def test_driver_state_lap_number_and_sectors_default_to_none():
    driver = DriverState(
        driver_number="1", abbreviation="VER", team="Red Bull", position=1,
        gap_to_leader=None, gap_to_ahead=None, last_lap_time=None, best_lap_time=None,
        tire=Tire(compound="SOFT", age_laps=0),
    )
    assert driver.lap_number is None
    assert driver.sector_1_time is None
    assert driver.sector_2_time is None
    assert driver.sector_3_time is None


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
