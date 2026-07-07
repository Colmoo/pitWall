# PitWall — Design Spec

## Purpose
A self-hosted, Dockerized F1 "pitwall" dashboard that looks like a real team's multi-monitor
timing setup. It works in two modes — live sessions and historical replay — and runs a local
Ollama model that continuously watches the data and calls out anomalies, plus answers
free-form questions about what it's seeing.

## Data sources
- **f1-dash** (Bun/Node service, run as-is via Docker Compose) — connects to F1's live timing
  SignalR feed during a real session weekend, serves it over WebSocket. Used for **live mode**.
- **FastF1** (Python library) — fetches historical session data on demand from the official
  F1/Ergast APIs, with FastF1's built-in on-disk caching (mounted as a volume) so repeat
  replays of the same session are instant and work offline. Used for **replay mode**.

## Architecture
```
Frontend (React/TS)  <--WS-->  Backend (FastAPI, Python)  <--WS/HTTP-->  f1-dash service
                                     |        |
                                     |        +--> FastF1 (in-process) --> cache volume
                                     +--> Ollama client --> Ollama (host/container, gemma model)
```

The backend is the single source of truth for the frontend. It normalizes both data sources
into one internal event schema — driver list, positions, lap times, gaps, tire compound/age,
track status, weather — so the frontend and AI layer are agnostic to which mode is active.
A "session controller" component owns switching between live and replay, and adapts each
source into that shared schema.

## Modes
- **Live**: backend opens a WebSocket client to f1-dash's server, translates its live-timing
  messages into the shared schema, and pushes them to the frontend as they arrive.
- **Replay**: backend uses FastF1 to load a chosen historical session (year/event/session),
  then replays its lap-by-lap/telemetry data to the frontend on a timer, at real-time or
  accelerated speed (user-selectable), reusing the same push mechanism as live mode.

## Frontend — pitwall UI
A full-screen shell styled like a physical multi-monitor pitwall, with switchable panels
("monitors") the user tabs between (click or number-key shortcuts):
1. **Timing tower** — position, driver, gap to leader/ahead, last/best lap, tire compound+age.
2. **Track map** — SVG track outline with live car position dots, colored by team.
3. **Tire strategy** — per-driver stint chart (compound + laps run per stint).
4. **Sector times** — heatmap of sector times per driver, purple/green/yellow highlighting.
5. **Race engineer notes** — live feed of AI-generated anomaly call-outs (see below).
6. **AI chat** — free-form Q&A box, answers using current session data as context.
A **mode/session control bar** (pick live vs. replay, pick historical session, play/pause/speed
for replay) is always visible regardless of which monitor panel is active.

## AI analysis layer
- Runs in the backend as a background task: every N seconds (configurable), it packages a
  compact summary of recent state changes (lap time deltas, gaps closing/opening, pit stops,
  tire age, track status changes) and sends it to a local Ollama model as a prompt asking it
  to flag anything notable in 1-2 sentences.
- New notes are pushed to the frontend and appended to the "Race engineer notes" panel.
- The same session context is available to the "AI chat" panel for on-demand questions,
  via a simple retrieval of current standings/recent laps as context, no vector DB needed for v1.
- Model is configurable via `OLLAMA_MODEL` env var (default the user's local tag, e.g. `gemma4`)
  and `OLLAMA_HOST` (default `http://host.docker.internal:11434` to reach a host-installed Ollama).

## Deployment
Single `docker-compose.yml`:
- `frontend` — React app served via a small static server (or Vite dev server for now).
- `backend` — FastAPI app; volumes for FastF1 cache persistence.
- `f1-dash` — upstream f1-dash service (its own sub-compose or image), only needed for live mode.
- Ollama itself is **not** containerized by default — the app talks to a host-installed Ollama
  via `host.docker.internal`. (Documented as an option to add an `ollama` service later if
  the user wants it fully self-contained.)

## Out of scope for v1
- Team radio audio, weather radar overlays, multi-user auth, historical AI-note persistence
  across restarts (notes are session-scoped, in-memory).
- Reimplementing SignalR — f1-dash is reused as-is for live timing.
