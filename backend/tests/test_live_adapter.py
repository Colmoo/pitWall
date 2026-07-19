from datetime import datetime, timezone

import httpx
import pytest

from app.live_adapter import LiveAdapter, session_state_from_live_tree
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
        "RaceControlMessages": {"Messages": {}},
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


def test_session_state_from_live_tree_parses_race_control_messages_as_list():
    tree = _tree(RaceControlMessages={
        "Messages": [
            {"Utc": "2026-07-09T13:05:09", "Category": "Other", "Message": "PIT EXIT OPEN"},
        ]
    })
    state = session_state_from_live_tree(tree, datetime.now(timezone.utc))
    assert len(state.race_control_messages) == 1
    assert state.race_control_messages[0].message == "PIT EXIT OPEN"


def test_session_state_from_live_tree_defaults_race_control_messages_to_empty():
    state = session_state_from_live_tree(_tree(), datetime.now(timezone.utc))
    assert state.race_control_messages == []


def test_session_state_from_live_tree_parses_weather():
    tree = _tree(WeatherData={
        "AirTemp": "22.5", "TrackTemp": "35.0", "Humidity": "50.0", "WindSpeed": "2.1", "Rainfall": "0",
    })
    state = session_state_from_live_tree(tree, datetime.now(timezone.utc))
    assert state.weather is not None
    assert state.weather.air_temp == 22.5
    assert state.weather.rainfall is False


def test_session_state_from_live_tree_defaults_weather_to_none_when_missing():
    state = session_state_from_live_tree(_tree(), datetime.now(timezone.utc))
    assert state.weather is None


def test_session_state_from_live_tree_parses_latest_position_entry():
    tree = _tree(Position=[
        {"Entries": {"1": {"X": 100.0, "Y": 200.0}, "44": {"X": 300.0, "Y": 400.0}}},
        {"Entries": {"1": {"X": 110.0, "Y": 210.0}, "44": {"X": 310.0, "Y": 410.0}}},
    ])
    state = session_state_from_live_tree(tree, datetime.now(timezone.utc))
    ver = next(d for d in state.drivers if d.abbreviation == "VER")
    assert ver.x == 110.0
    assert ver.y == 210.0


def test_session_state_from_live_tree_parses_latest_car_data_channels():
    tree = _tree(CarData=[
        {"Entries": {"1": {"Channels": {"0": 11000, "2": 310, "3": 7, "4": 100, "5": 0, "45": 12}}}},
    ])
    state = session_state_from_live_tree(tree, datetime.now(timezone.utc))
    ver = next(d for d in state.drivers if d.abbreviation == "VER")
    assert ver.rpm == 11000
    assert ver.speed == 310
    assert ver.gear == 7
    assert ver.throttle == 100
    assert ver.brake is False
    assert ver.drs is True


def test_session_state_from_live_tree_parses_micro_sectors():
    tree = _tree()
    tree["TimingData"]["Lines"]["1"]["Sectors"] = [
        {"Value": "28.1", "Segments": [{"Status": 2051}, {"Status": 2049}]},
        {"Value": "32.0", "Segments": [{"Status": 2052}]},
        {"Value": "32.356", "Segments": [{"Status": 2048}]},
    ]
    state = session_state_from_live_tree(tree, datetime.now(timezone.utc))
    ver = next(d for d in state.drivers if d.abbreviation == "VER")
    assert ver.micro_sectors == ["green", "yellow", "purple", "none"]


def test_session_state_from_live_tree_flying_lap_false_when_in_pit():
    tree = _tree()
    tree["TimingData"]["Lines"]["1"]["InPit"] = True
    state = session_state_from_live_tree(tree, datetime.now(timezone.utc))
    ver = next(d for d in state.drivers if d.abbreviation == "VER")
    assert ver.flying_lap is False


def test_session_state_from_live_tree_flying_lap_true_when_on_track_with_position():
    state = session_state_from_live_tree(_tree(), datetime.now(timezone.utc))
    ver = next(d for d in state.drivers if d.abbreviation == "VER")
    assert ver.flying_lap is True


def test_session_state_from_live_tree_parses_team_radio():
    tree = _tree(
        SessionInfo={"Path": "2026/2026-07-09_Silverstone/2026-07-09_Race/"},
        TeamRadio={"Captures": {
            "0": {"Utc": "2026-07-09T13:05:09", "RacingNumber": "1", "Path": "TeamRadio/VERMax01_1_20260709_130509.mp3"},
        }},
    )
    state = session_state_from_live_tree(tree, datetime.now(timezone.utc))
    assert len(state.team_radio) == 1
    clip = state.team_radio[0]
    assert clip.driver_number == "1"
    assert clip.url == (
        "https://livetiming.formula1.com/static/2026/2026-07-09_Silverstone/2026-07-09_Race/"
        "TeamRadio/VERMax01_1_20260709_130509.mp3"
    )


def test_session_state_from_live_tree_defaults_team_radio_to_empty():
    state = session_state_from_live_tree(_tree(), datetime.now(timezone.utc))
    assert state.team_radio == []


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
