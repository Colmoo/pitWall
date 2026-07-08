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
