import asyncio
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


def test_cors_allows_frontend_origin():
    resp = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert resp.headers.get("access-control-allow-origin") == "*"


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
    layout = {
        "points": [[0.0, 0.0, 0.0], [1.0, 2.0, 5.0], [2.0, 4.0, 10.0]],
        "corners": [{"number": 1, "x": 1.0, "y": 2.0}],
        "sector_boundaries": [3.3, 6.6],
    }
    monkeypatch.setattr("app.main.load_track_layout", lambda **kwargs: layout)
    resp = client.get("/session/track-layout", params={
        "year": 2026, "event": "Silverstone", "session_type": "R",
    })
    assert resp.status_code == 200
    assert resp.json() == layout


def test_live_track_layout_endpoint_defaults_to_empty_before_resolved():
    app_module._live_circuit_info = None
    resp = client.get("/session/live/track-layout")
    assert resp.status_code == 200
    assert resp.json() == {"points": [], "corners": [], "sector_boundaries": [], "drs_zones": []}


def test_live_track_layout_endpoint_returns_resolved_circuit_info():
    layout = {"points": [[0.0, 0.0, 0.0]], "corners": [], "sector_boundaries": [], "drs_zones": []}
    app_module._live_circuit_info = layout
    try:
        resp = client.get("/session/live/track-layout")
        assert resp.status_code == 200
        assert resp.json() == layout
    finally:
        app_module._live_circuit_info = None


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


def test_run_ai_note_cycle_publishes_a_note(monkeypatch):
    from datetime import datetime, timezone
    from app.schema import DriverState, SessionState, Tire, TrackStatus

    state = SessionState(
        timestamp=datetime.now(timezone.utc), track_status=TrackStatus.GREEN,
        drivers=[
            DriverState(
                driver_number="1", abbreviation="VER", team="Red Bull", position=1,
                gap_to_leader=None, gap_to_ahead=None, last_lap_time=None, best_lap_time=90.0,
                tire=Tire(compound="SOFT", age_laps=1), lap_number=5,
                sector_1_time=None, sector_2_time=None, sector_3_time=None,
            )
        ],
    )
    monkeypatch.setattr(app_module, "_latest_state", state)
    monkeypatch.setattr(app_module, "_previous_state_for_ai", None)

    async def fake_call_ollama(prompt, host, model, transport=None):
        assert "Session start." in prompt
        return "Lights out, VER leads."

    monkeypatch.setattr(app_module, "call_ollama", fake_call_ollama)

    with client.websocket_connect("/ws/ai-notes") as ws:
        # ponytail: client.portal (populated by TestClient.__enter__, active since
        # module load) runs coroutines on the SAME event loop the websocket/queues
        # live on — asyncio.run() here would create a second, disconnected loop and
        # the websocket would never see the published note.
        client.portal.call(app_module._run_ai_note_cycle)
        note = ws.receive_json()
        assert note["text"] == "Lights out, VER leads."
        assert "timestamp" in note

    assert app_module._previous_state_for_ai is state


def test_run_ai_note_cycle_does_nothing_when_no_state_yet(monkeypatch):
    monkeypatch.setattr(app_module, "_latest_state", None)

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("call_ollama should not be called when there is no state yet")

    monkeypatch.setattr(app_module, "call_ollama", fail_if_called)

    client.portal.call(app_module._run_ai_note_cycle)


def test_ai_chat_returns_answer_from_ollama(monkeypatch):
    from datetime import datetime, timezone
    from app.schema import DriverState, SessionState, Tire, TrackStatus

    state = SessionState(
        timestamp=datetime.now(timezone.utc), track_status=TrackStatus.GREEN,
        drivers=[
            DriverState(
                driver_number="1", abbreviation="VER", team="Red Bull", position=1,
                gap_to_leader=None, gap_to_ahead=None, last_lap_time=None, best_lap_time=90.0,
                tire=Tire(compound="SOFT", age_laps=1), lap_number=5,
                sector_1_time=None, sector_2_time=None, sector_3_time=None,
            )
        ],
    )
    monkeypatch.setattr(app_module, "_latest_state", state)

    async def fake_call_ollama(prompt, host, model, transport=None):
        assert "VER (P1)" in prompt
        assert "Who is leading?" in prompt
        return "VER is currently leading."

    monkeypatch.setattr(app_module, "call_ollama", fake_call_ollama)

    resp = client.post("/ai/chat", json={"question": "Who is leading?"})
    assert resp.status_code == 200
    assert resp.json() == {"answer": "VER is currently leading."}


def test_ai_chat_returns_fallback_when_ollama_unavailable(monkeypatch):
    async def fake_call_ollama(prompt, host, model, transport=None):
        return None

    monkeypatch.setattr(app_module, "call_ollama", fake_call_ollama)

    resp = client.post("/ai/chat", json={"question": "Who is leading?"})
    assert resp.status_code == 200
    assert resp.json() == {"answer": "Unable to reach the AI assistant right now."}


def test_telemetry_endpoint_returns_traces(monkeypatch):
    monkeypatch.setattr(
        "app.main.load_driver_lap_telemetry",
        lambda **kwargs: {"distance": [0.0], "speed": [250], "throttle": [100], "brake": [False], "gear": [6], "rpm": [11000]},
    )
    resp = client.get("/session/telemetry", params={
        "year": 2023, "event": "British Grand Prix", "session_type": "R", "driver": "1", "lap_number": 5,
    })
    assert resp.status_code == 200
    assert resp.json() == {"distance": [0.0], "speed": [250], "throttle": [100], "brake": [False], "gear": [6], "rpm": [11000]}


def test_meta_years_endpoint(monkeypatch):
    monkeypatch.setattr("app.main.list_supported_years", lambda: [2018, 2019])
    resp = client.get("/meta/years")
    assert resp.status_code == 200
    assert resp.json() == {"years": [2018, 2019]}


def test_meta_events_endpoint(monkeypatch):
    monkeypatch.setattr("app.main.list_events_for_year", lambda **kwargs: ["Bahrain Grand Prix"])
    resp = client.get("/meta/events", params={"year": 2023})
    assert resp.status_code == 200
    assert resp.json() == {"events": ["Bahrain Grand Prix"]}


def test_meta_sessions_endpoint(monkeypatch):
    monkeypatch.setattr("app.main.list_sessions_for_event", lambda **kwargs: ["Practice 1", "Qualifying", "Race"])
    resp = client.get("/meta/sessions", params={"year": 2023, "event": "Bahrain Grand Prix"})
    assert resp.status_code == 200
    assert resp.json() == {"sessions": ["Practice 1", "Qualifying", "Race"]}


def _rc(text):
    from app.schema import RaceControlMessage
    return RaceControlMessage(
        timestamp=datetime(2026, 7, 9, 13, 5, tzinfo=timezone.utc),
        category="Flag", message=text, flag="YELLOW",
    )


def _state(messages):
    return SessionState(
        timestamp=datetime.now(timezone.utc), track_status=TrackStatus.GREEN,
        drivers=[], race_control_messages=messages,
    )


def test_broadcast_frames_carry_only_new_race_control_messages():
    app_module._sent_race_control = []
    app_module._sent_team_radio = []
    app_module._needs_prime = False  # mid-session: clients already hold the cursors
    with client.websocket_connect("/ws/session") as ws:
        if app_module._latest_state is not None:
            ws.receive_json()  # priming frame
        client.portal.call(app_module._publish_state, _state([_rc("YELLOW S1")]))
        client.portal.call(app_module._publish_state, _state([_rc("YELLOW S1"), _rc("YELLOW S2")]))
        first = ws.receive_json()
        second = ws.receive_json()
    assert [m["message"] for m in first["race_control_messages"]] == ["YELLOW S1"]
    assert [m["message"] for m in second["race_control_messages"]] == ["YELLOW S2"]
    assert not first["snapshot"]


def test_reordered_message_list_is_reprimed_instead_of_sent_as_a_delta():
    # The live feed can insert a message ahead of one already sent; that is not an
    # extension of what clients hold, so it must arrive as a full snapshot frame.
    app_module._sent_race_control = []
    app_module._sent_team_radio = []
    app_module._needs_prime = False  # mid-session: clients already hold the cursors
    with client.websocket_connect("/ws/session") as ws:
        if app_module._latest_state is not None:
            ws.receive_json()  # priming frame
        client.portal.call(app_module._publish_state, _state([_rc("YELLOW S1")]))
        client.portal.call(app_module._publish_state, _state([_rc("YELLOW S0"), _rc("YELLOW S1")]))
        ws.receive_json()
        second = ws.receive_json()
    assert second["snapshot"] is True
    assert [m["message"] for m in second["race_control_messages"]] == ["YELLOW S0", "YELLOW S1"]


def test_first_frame_of_a_new_session_is_a_snapshot_for_already_connected_clients():
    # A restart resets the server's delta cursors; clients that stayed connected
    # must be told to reset theirs too, or they append the new session's messages
    # onto the previous session's.
    app_module._sent_race_control = []
    app_module._sent_team_radio = []
    app_module._needs_prime = False  # mid-session: clients already hold the cursors
    with client.websocket_connect("/ws/session") as ws:
        if app_module._latest_state is not None:
            ws.receive_json()  # priming frame

        async def _restart():
            app_module._start_session_task(asyncio.sleep(0))

        client.portal.call(_restart)
        client.portal.call(app_module._publish_state, _state([_rc("NEW SESSION S1")]))
        client.portal.call(app_module._publish_state, _state([_rc("NEW SESSION S1"), _rc("S2")]))
        first = ws.receive_json()
        second = ws.receive_json()
    assert first["snapshot"] is True
    assert [m["message"] for m in first["race_control_messages"]] == ["NEW SESSION S1"]
    assert not second["snapshot"]  # and back to deltas afterwards
    assert [m["message"] for m in second["race_control_messages"]] == ["S2"]


def test_new_client_receives_priming_frame_with_full_message_list():
    app_module._sent_race_control = []
    app_module._sent_team_radio = []
    app_module._needs_prime = False  # mid-session: clients already hold the cursors
    client.portal.call(app_module._publish_state, _state([_rc("YELLOW S1"), _rc("YELLOW S2")]))
    with client.websocket_connect("/ws/session") as ws:
        priming = ws.receive_json()
    assert priming["snapshot"] is True
    assert [m["message"] for m in priming["race_control_messages"]] == ["YELLOW S1", "YELLOW S2"]
