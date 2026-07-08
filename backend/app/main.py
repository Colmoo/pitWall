import asyncio
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.broadcaster import Broadcaster
from app.fastf1_adapter import load_session_states, load_track_layout
from app.replay import ReplayEngine

app = FastAPI(title="PitWall")
broadcaster = Broadcaster()
CACHE_DIR = os.environ.get("FASTF1_CACHE_DIR", "/tmp/fastf1_cache")


@app.get("/health")
def health():
    return {"status": "ok"}


class ReplayRequest(BaseModel):
    year: int
    event: str
    session_type: str
    speed: float = 1.0


async def _run_replay(states, speed: float) -> None:
    engine = ReplayEngine(states, speed=speed)
    async for state in engine.stream():
        await broadcaster.publish(state)


@app.post("/session/replay", status_code=202)
async def start_replay(req: ReplayRequest):
    states = load_session_states(
        year=req.year, event=req.event, session_type=req.session_type, cache_dir=CACHE_DIR,
    )
    asyncio.create_task(_run_replay(states, req.speed))
    return {"status": "started", "states": len(states)}


@app.get("/session/track-layout")
async def track_layout(year: int, event: str, session_type: str):
    points = load_track_layout(
        year=year, event=event, session_type=session_type, cache_dir=CACHE_DIR,
    )
    return {"points": points}


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
