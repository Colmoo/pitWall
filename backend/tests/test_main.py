from fastapi.testclient import TestClient
from app.main import app

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
