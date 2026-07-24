import asyncio
import logging
import os
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.ai_adapter import call_ollama, describe_state, summarize_changes
from app.broadcaster import Broadcaster
from app.fastf1_adapter import (
    list_events_for_year,
    list_sessions_for_event,
    list_supported_years,
    load_driver_lap_telemetry,
    load_session_states,
    load_track_layout,
)
from app.live_adapter import LiveAdapter, resolve_fastf1_session_identity
from app.replay import ReplayEngine
from app.schema import SessionState

app = FastAPI(title="PitWall")
# ponytail: wide-open CORS for a local dev slice with no auth/cookies involved;
# tighten to explicit origins if this is ever deployed beyond localhost/dev compose.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
broadcaster = Broadcaster()
CACHE_DIR = os.environ.get("FASTF1_CACHE_DIR", "/tmp/fastf1_cache")
logger = logging.getLogger(__name__)

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma3:4b")
AI_NOTE_INTERVAL_SECONDS = 30

ai_broadcaster = Broadcaster()
_latest_state: SessionState | None = None
_previous_state_for_ai: SessionState | None = None

_current_task: asyncio.Task | None = None


def _log_task_exception(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("Session task failed: %s", exc, exc_info=exc)


def _start_session_task(coro) -> None:
    global _current_task
    if _current_task is not None and not _current_task.done():
        _current_task.cancel()
    _current_task = asyncio.create_task(coro)
    _current_task.add_done_callback(_log_task_exception)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/meta/years")
def meta_years():
    return {"years": list_supported_years()}


@app.get("/meta/events")
def meta_events(year: int):
    return {"events": list_events_for_year(year=year, cache_dir=CACHE_DIR)}


@app.get("/meta/sessions")
def meta_sessions(year: int, event: str):
    return {"sessions": list_sessions_for_event(year=year, event=event, cache_dir=CACHE_DIR)}


class ReplayRequest(BaseModel):
    year: int
    event: str
    session_type: str
    speed: float = 1.0


async def _publish_state(state: SessionState) -> None:
    global _latest_state
    _latest_state = state
    await broadcaster.publish(state)


async def _run_ai_note_cycle() -> None:
    global _previous_state_for_ai
    if _latest_state is None:
        return
    digest = summarize_changes(_previous_state_for_ai, _latest_state)
    # ponytail: baseline advances even if the Ollama call below fails/times out,
    # so a downtime window's deltas are dropped rather than accumulating into an
    # ever-growing digest once Ollama comes back.
    _previous_state_for_ai = _latest_state
    if digest == "No significant changes since last check.":
        return
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


async def _run_replay(states, speed: float, session_type: str | None = None) -> None:
    engine = ReplayEngine(states, speed=speed)
    async for state in engine.stream():
        state.session_type = session_type
        await _publish_state(state)


@app.post("/session/replay", status_code=202)
async def start_replay(req: ReplayRequest):
    states = load_session_states(
        year=req.year, event=req.event, session_type=req.session_type, cache_dir=CACHE_DIR,
    )
    _start_session_task(_run_replay(states, req.speed, req.session_type))
    return {"status": "started", "states": len(states)}


class LiveRequest(BaseModel):
    sse_url: str = "http://f1-dash-realtime/api/realtime"


_EMPTY_TRACK_LAYOUT = {"points": [], "corners": [], "sector_boundaries": [], "drs_zones": []}
_live_circuit_info: dict | None = None
_live_circuit_info_key: tuple | None = None
_live_circuit_info_task: asyncio.Task | None = None


async def _load_live_circuit_info(identity: tuple[int, str, str]) -> None:
    global _live_circuit_info
    year, event, _ = identity
    # A live/in-progress session has no FastF1 telemetry yet (DataNotLoadedError),
    # but the circuit geometry is stable year to year - so fall back to recent
    # past races of the same event, which are fully loaded, to draw the outline.
    for y, st in [(year - 1, "R"), (year - 2, "R"), (year - 3, "R")]:
        try:
            layout = await asyncio.to_thread(
                load_track_layout, year=y, event=event, session_type=st, cache_dir=CACHE_DIR,
            )
        except Exception:
            logger.info("Live circuit info: %s %s %s not available, trying older", y, event, st)
            continue
        if layout.get("points"):
            _live_circuit_info = layout
            return
    logger.warning("No FastF1 circuit outline available for live session %s", identity)


def _maybe_start_live_circuit_info_lookup(tree: dict) -> None:
    global _live_circuit_info_key, _live_circuit_info_task
    identity = resolve_fastf1_session_identity(tree)
    if identity is None or identity == _live_circuit_info_key:
        return
    if _live_circuit_info_task is not None and not _live_circuit_info_task.done():
        return
    _live_circuit_info_key = identity
    _live_circuit_info_task = asyncio.create_task(_load_live_circuit_info(identity))


async def _run_live(sse_url: str) -> None:
    global _live_circuit_info, _live_circuit_info_key
    _live_circuit_info = None
    _live_circuit_info_key = None
    adapter = LiveAdapter(sse_url)
    async for state in adapter.stream():
        tree = getattr(adapter, "last_tree", {})
        _maybe_start_live_circuit_info_lookup(tree)
        identity = resolve_fastf1_session_identity(tree)
        if identity is not None:
            state.session_type = identity[2]
        await _publish_state(state)


@app.post("/session/live", status_code=202)
async def start_live(req: LiveRequest):
    _start_session_task(_run_live(req.sse_url))
    return {"status": "started"}


@app.get("/session/track-layout")
async def track_layout(year: int, event: str, session_type: str):
    return load_track_layout(
        year=year, event=event, session_type=session_type, cache_dir=CACHE_DIR,
    )


@app.get("/session/live/track-layout")
async def live_track_layout():
    # Best-effort circuit info (corners/sectors/DRS zones) matched from the live
    # feed's own session identity - empty until resolved, or if it never resolves.
    return _live_circuit_info or _EMPTY_TRACK_LAYOUT


@app.get("/session/telemetry")
async def session_telemetry(year: int, event: str, session_type: str, driver: str, lap_number: int):
    return load_driver_lap_telemetry(
        year=year, event=event, session_type=session_type, driver=driver, lap_number=lap_number, cache_dir=CACHE_DIR,
    )


@app.websocket("/ws/session")
async def session_socket(websocket: WebSocket):
    await websocket.accept()
    queue = broadcaster.subscribe()
    try:
        while True:
            state = await queue.get()
            await websocket.send_json(state.model_dump(mode="json"))
    except (WebSocketDisconnect, RuntimeError):
        # Starlette's WebSocket.send() only converts OSError to WebSocketDisconnect;
        # other close-related failures (e.g. sending after the connection already
        # transitioned to DISCONNECTED) surface as a plain RuntimeError, so catch
        # both to avoid an unhandled exception on client disconnect.
        pass
    finally:
        broadcaster.unsubscribe(queue)


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
    # ponytail: minimal endpoint so this task's own test can observe published
    # notes; Task 4 owns any richer wiring for this route.
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
