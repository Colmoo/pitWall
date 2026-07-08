from fastapi.testclient import TestClient
from app.main import app
from app import main as app_module

client = TestClient(app)
# ponytail: without an active portal, each call gets its own event loop, so the
# websocket and the background replay task can't see each other's asyncio.Queue.
# Entering the context once shares one portal/loop across all calls in this module.
client.__enter__()

def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


from unittest.mock import patch
from datetime import datetime, timezone
from app.schema import SessionState, TrackStatus


def test_replay_and_websocket_stream(monkeypatch):
    fixed_states = [
        SessionState(timestamp=datetime(2026, 7, 7, tzinfo=timezone.utc), track_status=TrackStatus.GREEN, drivers=[]),
        SessionState(timestamp=datetime(2026, 7, 7, 0, 0, 1, tzinfo=timezone.utc), track_status=TrackStatus.GREEN, drivers=[]),
    ]
    monkeypatch.setattr("app.main.load_session_states", lambda **kwargs: fixed_states)

    with client.websocket_connect("/ws/session") as ws:
        resp = client.post("/session/replay", json={
            "year": 2026, "event": "Silverstone", "session_type": "R", "speed": 10000.0,
        })
        assert resp.status_code == 202
        first = ws.receive_json()
        second = ws.receive_json()
        assert first["track_status"] == "green"
        assert second["timestamp"] != first["timestamp"]


def test_track_layout_endpoint_returns_points(monkeypatch):
    monkeypatch.setattr(
        "app.main.load_track_layout",
        lambda **kwargs: [[0.0, 0.0], [1.0, 2.0], [2.0, 4.0]],
    )
    resp = client.get("/session/track-layout", params={
        "year": 2026, "event": "Silverstone", "session_type": "R",
    })
    assert resp.status_code == 200
    assert resp.json() == {"points": [[0.0, 0.0], [1.0, 2.0], [2.0, 4.0]]}


def test_live_endpoint_streams_states_over_websocket(monkeypatch):
    from app.schema import SessionState, TrackStatus
    from datetime import datetime, timezone

    fixed_states = [
        SessionState(timestamp=datetime(2026, 7, 8, tzinfo=timezone.utc), track_status=TrackStatus.GREEN, drivers=[]),
    ]

    class FakeLiveAdapter:
        def __init__(self, sse_url):
            self.sse_url = sse_url

        async def stream(self):
            for state in fixed_states:
                yield state

    monkeypatch.setattr("app.main.LiveAdapter", FakeLiveAdapter)

    with client.websocket_connect("/ws/session") as ws:
        resp = client.post("/session/live", json={})
        assert resp.status_code == 202
        received = ws.receive_json()
        assert received["track_status"] == "green"


def test_starting_a_new_session_cancels_the_previous_one(monkeypatch):
    import asyncio
    import time

    monkeypatch.setattr("app.main.load_session_states", lambda **kwargs: [])

    class NeverEndingAdapter:
        def __init__(self, sse_url):
            pass

        async def stream(self):
            while True:
                await asyncio.sleep(3600)
                yield None  # pragma: no cover

    monkeypatch.setattr("app.main.LiveAdapter", NeverEndingAdapter)

    with client.websocket_connect("/ws/session"):
        first_resp = client.post("/session/live", json={})
        assert first_resp.status_code == 202
        first_task = app_module._current_task

        second_resp = client.post("/session/replay", json={"year": 2026, "event": "Silverstone", "session_type": "R", "speed": 1000.0})
        assert second_resp.status_code == 202

        # ponytail: cancellation is requested synchronously by _start_session_task,
        # but the target task's event loop (running in the TestClient's portal
        # thread) needs a tick to actually process it and flip to done/cancelled.
        time.sleep(0.05)
        assert first_task.cancelled() or first_task.done()


def test_session_task_exception_is_logged_not_swallowed(monkeypatch, caplog):
    import time

    class BoomLiveAdapter:
        def __init__(self, sse_url):
            pass

        async def stream(self):
            raise ValueError("boom")
            yield  # pragma: no cover

    monkeypatch.setattr("app.main.LiveAdapter", BoomLiveAdapter)

    with caplog.at_level("ERROR", logger="app.main"):
        resp = client.post("/session/live", json={})
        assert resp.status_code == 202
        task = app_module._current_task

        # ponytail: same portal-thread tick issue as the cancellation test above.
        time.sleep(0.05)

    assert task.done()
    # The done-callback already called task.exception(), so it is no longer
    # "unretrieved" - calling it again here just confirms what was raised.
    assert isinstance(task.exception(), ValueError)
    assert "Session task failed" in caplog.text
