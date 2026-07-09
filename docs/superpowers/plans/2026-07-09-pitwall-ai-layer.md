# PitWall AI Analysis Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-Ollama-powered race engineer to PitWall: a background anomaly-note feed and an on-demand chat, both using real session data, both degrading gracefully if Ollama isn't reachable.

**Architecture:** A new `backend/app/ai_adapter.py` holds two pure, testable functions (`summarize_changes` for tick-to-tick deltas, `describe_state` for a point-in-time summary) plus a thin `call_ollama` I/O wrapper. `main.py` tracks the latest published `SessionState`, runs a 30-second background loop that calls Ollama and broadcasts notes over a new, independent `/ws/ai-notes` WebSocket, and exposes a stateless `POST /ai/chat` endpoint. The existing `Broadcaster` class is generalized (it already only does generic pub/sub internally) to carry either `SessionState` or AI notes. Two new frontend components render the notes feed and chat, stacked below Track Map — no existing panel or hook changes.

**Tech Stack:** Same backend stack (Python 3.11/FastAPI/httpx) and frontend stack (React/TS/Vite) as prior plans. No new dependencies (httpx is already present).

## Global Constraints
- `OLLAMA_HOST` env var, default `http://host.docker.internal:11434`. `OLLAMA_MODEL` env var, default `gemma3:4b`. Both read once at module load in `backend/app/main.py`, same pattern as `CACHE_DIR`.
- Ollama being unreachable must never crash the background loop or the chat endpoint — both must degrade gracefully (skip a cycle / return a fallback message).
- `/ws/ai-notes` is a **separate** WebSocket from `/ws/session` — no changes to `SessionState`, the replay/live pipeline, or any existing panel's props/tests.
- No persisted history (notes or chat) across restarts — both are in-memory/session-scoped, per the design spec.
- No new dependencies (backend or frontend).

---

### Task 1: `summarize_changes` and `describe_state` pure functions

**Files:**
- Create: `backend/app/ai_adapter.py`
- Test: `backend/tests/test_ai_adapter.py`

**Interfaces:**
- Consumes: `SessionState`, `DriverState`, `TrackStatus` from `app.schema`.
- Produces: `summarize_changes(previous: SessionState | None, current: SessionState) -> str` and `describe_state(state: SessionState) -> str`. Both pure. Used by Task 3 (background loop) and Task 4 (chat endpoint) respectively.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_ai_adapter.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ai_adapter.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.ai_adapter'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/ai_adapter.py
from app.schema import SessionState, TrackStatus


def summarize_changes(previous: SessionState | None, current: SessionState) -> str:
    if previous is None:
        return "Session start."

    lines: list[str] = []
    previous_by_number = {d.driver_number: d for d in previous.drivers}

    for driver in current.drivers:
        prev = previous_by_number.get(driver.driver_number)
        if prev is None:
            continue
        if driver.position != prev.position:
            lines.append(f"{driver.abbreviation} moved from P{prev.position} to P{driver.position}.")
        if driver.best_lap_time is not None and (
            prev.best_lap_time is None or driver.best_lap_time < prev.best_lap_time
        ):
            lines.append(f"{driver.abbreviation} set a new best lap: {driver.best_lap_time:.3f}s.")
        if driver.tire.compound != prev.tire.compound:
            lines.append(f"{driver.abbreviation} pitted for {driver.tire.compound} tires.")

    if current.track_status != TrackStatus.GREEN:
        lines.append(f"Track status: {current.track_status.value}.")

    if not lines:
        return "No significant changes since last check."
    return " ".join(lines)


def describe_state(state: SessionState) -> str:
    if not state.drivers:
        return "No drivers on track."
    top3 = ", ".join(f"{d.abbreviation} (P{d.position})" for d in state.drivers[:3])
    return f"Track status: {state.track_status.value}. Top 3: {top3}."
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ai_adapter.py -v`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add backend/app/ai_adapter.py backend/tests/test_ai_adapter.py
git commit -m "feat(backend): add pure summarize_changes and describe_state functions"
```

---

### Task 2: `call_ollama` I/O wrapper

**Files:**
- Modify: `backend/app/ai_adapter.py` (add to the file created in Task 1)
- Test: `backend/tests/test_ai_adapter.py`

**Interfaces:**
- Produces: `async def call_ollama(prompt: str, host: str, model: str, transport: httpx.AsyncBaseTransport | None = None) -> str | None`. Returns the model's response text, or `None` on any failure (unreachable host, non-2xx, malformed JSON) — never raises. The `transport` parameter is a test seam, same pattern as `LiveAdapter` from the live-mode plan. Used by Task 3 (background loop) and Task 4 (chat endpoint).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_ai_adapter.py`:

```python
import httpx
import pytest

from app.ai_adapter import call_ollama


@pytest.mark.asyncio
async def test_call_ollama_returns_response_text_on_success():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/generate"
        return httpx.Response(200, json={"response": "VER is pulling away in the lead."})

    transport = httpx.MockTransport(handler)
    result = await call_ollama("some prompt", "http://fake-ollama", "gemma3:4b", transport=transport)
    assert result == "VER is pulling away in the lead."


@pytest.mark.asyncio
async def test_call_ollama_returns_none_on_http_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="internal error")

    transport = httpx.MockTransport(handler)
    result = await call_ollama("some prompt", "http://fake-ollama", "gemma3:4b", transport=transport)
    assert result is None


@pytest.mark.asyncio
async def test_call_ollama_returns_none_on_connection_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    transport = httpx.MockTransport(handler)
    result = await call_ollama("some prompt", "http://fake-ollama", "gemma3:4b", transport=transport)
    assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ai_adapter.py -v`
Expected: FAIL — `ImportError: cannot import name 'call_ollama'`

- [ ] **Step 3: Write minimal implementation**

Append to `backend/app/ai_adapter.py`:

```python
import httpx


async def call_ollama(
    prompt: str, host: str, model: str, transport: httpx.AsyncBaseTransport | None = None
) -> str | None:
    try:
        async with httpx.AsyncClient(transport=transport, timeout=30.0) as client:
            response = await client.post(
                f"{host}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            response.raise_for_status()
            return response.json().get("response")
    except (httpx.HTTPError, ValueError):
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ai_adapter.py -v`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add backend/app/ai_adapter.py backend/tests/test_ai_adapter.py
git commit -m "feat(backend): add call_ollama I/O wrapper with graceful failure handling"
```

---

### Task 3: Generic Broadcaster + background anomaly loop wiring

**Files:**
- Modify: `backend/app/broadcaster.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_main.py`

**Interfaces:**
- Consumes: `summarize_changes`, `call_ollama` from `app.ai_adapter`.
- Produces: `Broadcaster.publish(self, message) -> None` (generalized from `SessionState` to any message type — `/ws/session` behavior is unchanged since the JSON-encoding still happens in `session_socket`, not in `Broadcaster` itself). `main.py` gains: `ai_broadcaster = Broadcaster()`, a module-level `_latest_state: SessionState | None` (updated whenever a state is published), a testable `async def _run_ai_note_cycle() -> None` (one iteration of the loop's logic), and an `_ai_notes_loop()` wrapper that calls it every `AI_NOTE_INTERVAL_SECONDS` (30), started via a FastAPI startup event. Used by Task 4's `/ws/ai-notes` endpoint.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_main.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_main.py -v`
Expected: FAIL — `AttributeError: module 'app.main' has no attribute '_latest_state'` (or similar — the wiring doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

Replace `backend/app/broadcaster.py` with:

```python
import asyncio
from typing import Any


class Broadcaster:
    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    async def publish(self, message: Any) -> None:
        for queue in list(self._subscribers):
            await queue.put(message)
```

In `backend/app/main.py`, change the import line:

```python
from app.ai_adapter import call_ollama, summarize_changes
from app.broadcaster import Broadcaster
from app.fastf1_adapter import load_session_states, load_track_layout
from app.live_adapter import LiveAdapter
from app.replay import ReplayEngine
from app.schema import SessionState
```

Add module-level state and config (after `CACHE_DIR = ...`):

```python
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma3:4b")
AI_NOTE_INTERVAL_SECONDS = 30

ai_broadcaster = Broadcaster()
_latest_state: SessionState | None = None
_previous_state_for_ai: SessionState | None = None
```

Change `_run_replay` and `_run_live` to track the latest state (replace `await broadcaster.publish(state)` in both with `await _publish_state(state)`), and add the tracking helper and note cycle above them:

```python
async def _publish_state(state: SessionState) -> None:
    global _latest_state
    _latest_state = state
    await broadcaster.publish(state)


async def _run_ai_note_cycle() -> None:
    global _previous_state_for_ai
    if _latest_state is None:
        return
    digest = summarize_changes(_previous_state_for_ai, _latest_state)
    _previous_state_for_ai = _latest_state
    prompt = (
        "You are a Formula 1 race engineer giving a brief radio call-out. "
        f"Recent changes: {digest} In 1-2 sentences, call out anything notable, "
        "or say nothing significant happened if nothing did."
    )
    note_text = await call_ollama(prompt, OLLAMA_HOST, OLLAMA_MODEL)
    if note_text:
        await ai_broadcaster.publish({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "text": note_text,
        })


async def _ai_notes_loop() -> None:
    while True:
        await asyncio.sleep(AI_NOTE_INTERVAL_SECONDS)
        await _run_ai_note_cycle()


@app.on_event("startup")
async def _start_ai_notes_loop() -> None:
    asyncio.create_task(_ai_notes_loop())
```

Add the `datetime`/`timezone` import at the top of `main.py` alongside the existing imports:

```python
from datetime import datetime, timezone
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_main.py -v`
Expected: PASS (all tests in file)

- [ ] **Step 5: Run the full backend suite to confirm the Broadcaster generalization didn't break replay/live**

Run: `cd backend && .venv/bin/python -m pytest tests/ -v`
Expected: PASS (all tests, including pre-existing `test_replay_and_websocket_stream`, `test_live_endpoint_streams_states_over_websocket`)

- [ ] **Step 6: Commit**

```bash
git add backend/app/broadcaster.py backend/app/main.py backend/tests/test_main.py
git commit -m "feat(backend): generalize Broadcaster and wire background AI note cycle"
```

---

### Task 4: `POST /ai/chat` and `GET /ws/ai-notes` endpoints

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_main.py`

**Interfaces:**
- Consumes: `describe_state` from `app.ai_adapter`, `ai_broadcaster` and `_latest_state` from Task 3.
- Produces: `POST /ai/chat` (body `{"question": str}`, returns `{"answer": str}`). `GET /ws/ai-notes` (streams `{"timestamp": str, "text": str}` JSON messages published by the note cycle).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_main.py`:

```python
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


def test_ai_notes_websocket_streams_published_notes():
    with client.websocket_connect("/ws/ai-notes") as ws:
        async def publish_one():
            await app_module.ai_broadcaster.publish({"timestamp": "t1", "text": "hello"})

        client.portal.call(publish_one)
        note = ws.receive_json()
        assert note == {"timestamp": "t1", "text": "hello"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_main.py -v`
Expected: FAIL — 404 on `/ai/chat` and `/ws/ai-notes` (routes don't exist yet)

- [ ] **Step 3: Write minimal implementation**

In `backend/app/main.py`, change the import line to also bring in `describe_state`:

```python
from app.ai_adapter import call_ollama, describe_state, summarize_changes
```

Add the chat endpoint and notes websocket (after the existing `session_socket` websocket handler):

```python
class ChatRequest(BaseModel):
    question: str


@app.post("/ai/chat")
async def ai_chat(req: ChatRequest):
    context = "No session data yet." if _latest_state is None else describe_state(_latest_state)
    prompt = (
        "You are a Formula 1 race engineer. Current session context: "
        f"{context} Question: {req.question} Answer concisely."
    )
    answer = await call_ollama(prompt, OLLAMA_HOST, OLLAMA_MODEL)
    return {"answer": answer or "Unable to reach the AI assistant right now."}


@app.websocket("/ws/ai-notes")
async def ai_notes_socket(websocket: WebSocket):
    await websocket.accept()
    queue = ai_broadcaster.subscribe()
    try:
        while True:
            note = await queue.get()
            await websocket.send_json(note)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        ai_broadcaster.unsubscribe(queue)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_main.py -v`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_main.py
git commit -m "feat(backend): add POST /ai/chat and GET /ws/ai-notes endpoints"
```

---

### Task 5: Docker Compose env vars for Ollama

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: nothing new — wires the config `main.py` already reads via `os.environ.get`.

- [ ] **Step 1: Add OLLAMA_HOST/OLLAMA_MODEL to the backend service**

Read the current `docker-compose.yml` first. Add these two lines to the `backend` service's existing `environment:` list (alongside `FASTF1_CACHE_DIR`):

```yaml
      - OLLAMA_HOST=http://host.docker.internal:11434
      - OLLAMA_MODEL=gemma3:4b
```

- [ ] **Step 2: Verify the compose file is valid**

Run: `docker compose config --quiet`
Expected: no output, exit code 0 (confirms valid YAML/schema — this does not require Ollama or any container to actually be running)

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add OLLAMA_HOST/OLLAMA_MODEL env vars to backend service"
```

---

### Task 6: Frontend — AI notes type, hook, and RaceEngineerNotes panel

**Files:**
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/api/useAiNotes.ts`
- Create: `frontend/src/api/useAiNotes.test.ts`
- Create: `frontend/src/panels/RaceEngineerNotes.tsx`
- Create: `frontend/src/panels/RaceEngineerNotes.test.tsx`

**Interfaces:**
- Produces: `AiNote` type (`{ timestamp: string; text: string }`) added to `types.ts`. `useAiNotes(url: string): AiNote[]` — connects via WebSocket, accumulates up to the last 20 notes (oldest dropped when exceeded). `RaceEngineerNotes({ notes }: { notes: AiNote[] })` — renders the list newest-first, or a placeholder when empty. Used by Task 8's `App.tsx`.

- [ ] **Step 1: Add AiNote type**

Append to `frontend/src/types.ts`:

```ts
export interface AiNote {
  timestamp: string;
  text: string;
}
```

- [ ] **Step 2: Write the failing test for useAiNotes**

Create `frontend/src/api/useAiNotes.test.ts`:

```ts
import { renderHook, act } from "@testing-library/react";
import { useAiNotes } from "./useAiNotes";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {}
}

test("accumulates notes as they arrive", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useAiNotes("ws://test/ws/ai-notes"));
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

  act(() => {
    socket.onmessage?.({ data: JSON.stringify({ timestamp: "t1", text: "note one" }) });
  });
  act(() => {
    socket.onmessage?.({ data: JSON.stringify({ timestamp: "t2", text: "note two" }) });
  });

  expect(result.current).toHaveLength(2);
  expect(result.current[1].text).toBe("note two");
});

test("keeps only the most recent 20 notes", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useAiNotes("ws://test/ws/ai-notes"));
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

  for (let i = 0; i < 25; i++) {
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ timestamp: `t${i}`, text: `note ${i}` }) });
    });
  }

  expect(result.current).toHaveLength(20);
  expect(result.current[0].text).toBe("note 5");
  expect(result.current[19].text).toBe("note 24");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — cannot find module `./useAiNotes`

- [ ] **Step 4: Implement useAiNotes**

Create `frontend/src/api/useAiNotes.ts`:

```ts
import { useEffect, useState } from "react";
import type { AiNote } from "../types";

const MAX_NOTES = 20;

export function useAiNotes(url: string): AiNote[] {
  const [notes, setNotes] = useState<AiNote[]>([]);

  useEffect(() => {
    const socket = new WebSocket(url);
    socket.onmessage = (event: { data: string }) => {
      const note = JSON.parse(event.data) as AiNote;
      setNotes((prev) => [...prev, note].slice(-MAX_NOTES));
    };
    return () => socket.close();
  }, [url]);

  return notes;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 6: Write the failing test for RaceEngineerNotes**

Create `frontend/src/panels/RaceEngineerNotes.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RaceEngineerNotes } from "./RaceEngineerNotes";

test("shows a placeholder when there are no notes yet", () => {
  render(<RaceEngineerNotes notes={[]} />);
  expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
});

test("renders notes newest first", () => {
  render(
    <RaceEngineerNotes
      notes={[
        { timestamp: "t1", text: "First note" },
        { timestamp: "t2", text: "Second note" },
      ]}
    />
  );
  const items = screen.getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("Second note");
  expect(items[1]).toHaveTextContent("First note");
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — cannot find module `./RaceEngineerNotes`

- [ ] **Step 8: Implement RaceEngineerNotes**

Create `frontend/src/panels/RaceEngineerNotes.tsx`:

```tsx
import type { AiNote } from "../types";

export function RaceEngineerNotes({ notes }: { notes: AiNote[] }) {
  if (notes.length === 0) {
    return <p>No notes yet.</p>;
  }
  const newestFirst = [...notes].reverse();
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {newestFirst.map((note) => (
        <li key={note.timestamp} style={{ marginBottom: 6, fontSize: 12 }}>
          {note.text}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all files)

- [ ] **Step 10: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/useAiNotes.ts frontend/src/api/useAiNotes.test.ts frontend/src/panels/RaceEngineerNotes.tsx frontend/src/panels/RaceEngineerNotes.test.tsx
git commit -m "feat(frontend): add AI notes hook and Race Engineer Notes panel"
```

---

### Task 7: Frontend — AiChat panel

**Files:**
- Create: `frontend/src/panels/AiChat.tsx`
- Create: `frontend/src/panels/AiChat.test.tsx`

**Interfaces:**
- Produces: `AiChat()` — a self-contained component (no props) with a text input, a send button, and a scrolling list of question/answer pairs kept in local component state. POSTs to `${API_URL}/ai/chat` on submit (same `API_URL` pattern as `ReplayControls`/`TrackMap`: `import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000"`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/panels/AiChat.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AiChat } from "./AiChat";

test("submits a question and displays the answer", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ answer: "VER is leading." }),
  });

  render(<AiChat />);
  fireEvent.change(screen.getByLabelText(/ask a question/i), { target: { value: "Who is leading?" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(screen.getByText("VER is leading.")).toBeInTheDocument());
  expect(screen.getByText("Who is leading?")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/ai/chat"),
    expect.objectContaining({ method: "POST" }),
  );
});

test("clears the input after sending", async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: "Answer." }) });

  render(<AiChat />);
  const input = screen.getByLabelText(/ask a question/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "A question" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(screen.getByText("Answer.")).toBeInTheDocument());
  expect(input.value).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — cannot find module `./AiChat`

- [ ] **Step 3: Implement AiChat**

Create `frontend/src/panels/AiChat.tsx`:

```tsx
import { useState } from "react";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

type Exchange = { question: string; answer: string };

export function AiChat() {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);

  async function handleSend() {
    if (!question.trim()) return;
    const askedQuestion = question;
    setQuestion("");
    const response = await fetch(`${API_URL}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: askedQuestion }),
    });
    const data = await response.json();
    setExchanges((prev) => [...prev, { question: askedQuestion, answer: data.answer }]);
  }

  return (
    <div>
      <div>
        {exchanges.map((exchange, i) => (
          <div key={i} style={{ marginBottom: 8, fontSize: 12 }}>
            <div style={{ color: "#6b7280" }}>{exchange.question}</div>
            <div>{exchange.answer}</div>
          </div>
        ))}
      </div>
      <label htmlFor="ai-chat-question">Ask a question</label>
      <input
        id="ai-chat-question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <button type="button" onClick={handleSend}>Send</button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all files)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/AiChat.tsx frontend/src/panels/AiChat.test.tsx
git commit -m "feat(frontend): add AiChat panel"
```

---

### Task 8: Wire AI panels into App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `useAiNotes` (Task 6), `RaceEngineerNotes` (Task 6), `AiChat` (Task 7).

- [ ] **Step 1: Write the failing test**

Update `frontend/src/App.test.tsx`'s `beforeEach` and add a new test. Read the current file first (it has a `FakeWebSocket` class and a `beforeEach` mocking `global.WebSocket`/`global.fetch`). Add this test to the file:

```tsx
test("renders Race Engineer Notes and AI Chat panels alongside everything else", () => {
  render(<App />);
  expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/ask a question/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — cannot find text "no notes yet" or label "ask a question" (not rendered yet)

- [ ] **Step 3: Wire into App.tsx**

In `frontend/src/App.tsx`, add the imports:

```tsx
import { useAiNotes } from "./api/useAiNotes";
import { RaceEngineerNotes } from "./panels/RaceEngineerNotes";
import { AiChat } from "./panels/AiChat";
```

Add the WS URL constant near the existing `WS_URL`:

```tsx
const AI_NOTES_WS_URL = import.meta.env.VITE_BACKEND_AI_NOTES_WS_URL ?? "ws://localhost:8000/ws/ai-notes";
```

Inside the `App` function body, add the hook call alongside the existing `useSessionSocket` call:

```tsx
  const notes = useAiNotes(AI_NOTES_WS_URL);
```

In the JSX, add two new panels inside the existing `<div className="pitwall-sidebar-right">`, after the Track Map panel div:

```tsx
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Race Engineer Notes</div>
            <RaceEngineerNotes notes={notes} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Ask The Engineer</div>
            <AiChat />
          </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all files)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat(frontend): wire Race Engineer Notes and AI Chat into the dashboard"
```

---

## Self-Review Notes
- Spec coverage: pure digest/description functions (Task 1), Ollama I/O wrapper (Task 2), background loop + generalized Broadcaster (Task 3), chat + notes WebSocket endpoints (Task 4), Docker Compose config (Task 5), notes hook/panel (Task 6), chat panel (Task 7), App wiring (Task 8) — every section of the AI layer design spec is covered.
- Placeholder scan: none — every step has runnable code and exact commands.
- Type consistency: `AiNote` (`{timestamp, text}`) matches the backend's `/ws/ai-notes` JSON payload shape (`{"timestamp": ..., "text": ...}`) exactly. `call_ollama`'s signature (`prompt, host, model, transport=None`) is used identically in Task 3's note cycle and Task 4's chat endpoint. `Broadcaster.publish`'s generalized `message: Any` parameter is consumed correctly by both `_publish_state` (passes a `SessionState`) and the note cycle (passes a `dict`).
