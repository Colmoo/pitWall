from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.replay import ReplayEngine
from app.schema import SessionState, TrackStatus


def _states():
    t0 = datetime(2026, 7, 7, tzinfo=timezone.utc)
    return [
        SessionState(timestamp=t0, track_status=TrackStatus.GREEN, drivers=[]),
        SessionState(timestamp=t0 + timedelta(seconds=10), track_status=TrackStatus.GREEN, drivers=[]),
        SessionState(timestamp=t0 + timedelta(seconds=30), track_status=TrackStatus.GREEN, drivers=[]),
    ]


@pytest.mark.asyncio
async def test_replay_engine_yields_all_states_in_order():
    engine = ReplayEngine(_states(), speed=1000.0)
    with patch("app.replay.asyncio.sleep", new=AsyncMock()):
        yielded = [s async for s in engine.stream()]
    assert [s.timestamp for s in yielded] == [s.timestamp for s in _states()]


@pytest.mark.asyncio
async def test_replay_engine_sleeps_scaled_by_speed():
    engine = ReplayEngine(_states(), speed=2.0)
    with patch("app.replay.asyncio.sleep", new=AsyncMock()) as sleep_mock:
        _ = [s async for s in engine.stream()]
    # gaps are 10s and 20s real-time; at speed=2.0 -> 5s and 10s sleeps (first state has no prior sleep)
    slept = [call.args[0] for call in sleep_mock.call_args_list]
    assert slept == [5.0, 10.0]
