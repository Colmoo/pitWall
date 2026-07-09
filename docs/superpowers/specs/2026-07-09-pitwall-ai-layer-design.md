# PitWall AI Analysis Layer Design (Plan 5)

Builds on the original spec's AI section (`docs/superpowers/specs/2026-07-07-pitwall-design.md`) and
the dense-dashboard redesign. Adds a local-Ollama-powered "race engineer" that calls out anomalies
in a live feed and answers free-form questions about the current session.

## Scope
Both pieces from the original spec, confirmed again here: a background anomaly-note feed, and an
on-demand chat. No vector DB, no persisted conversation history — both are session-scoped and
stateless beyond the current in-memory session.

## Architecture
Folded into the existing backend (no new service) via a new `backend/app/ai_adapter.py`, using
`httpx` (already a dependency) to call a local Ollama instance.

**Config (env-overridable):**
- `OLLAMA_HOST` — default `http://host.docker.internal:11434` (reaches the host machine's Ollama
  from inside the backend container on Docker Desktop for Mac/Windows).
- `OLLAMA_MODEL` — default `gemma3:4b`.

**Background anomaly loop:**
- Runs every 30 seconds, independent of replay/live session state (starts once the app starts, not
  gated on a session being active — it simply has nothing to compare/report if no session is
  running yet).
- Keeps the two most recent `SessionState` snapshots (previous, current) in memory. A pure,
  unit-testable function `summarize_changes(previous: SessionState | None, current: SessionState) -> str`
  builds a compact text digest: position changes since the last check, any driver whose best lap
  improved, and any driver whose tire compound changed (a pit stop) since the last check.
- That digest is sent to Ollama (`POST {OLLAMA_HOST}/api/generate`, `{"model": OLLAMA_MODEL,
  "prompt": ..., "stream": false}`) asking for a 1-2 sentence race-engineer-style call-out of
  anything notable. The response is broadcast as a note.
- If Ollama is unreachable or errors, the cycle is skipped and logged — this is a soft dependency;
  the rest of the app must keep working without it.

**Transport:** a **new, separate** `GET /ws/ai-notes` WebSocket streams notes (`{"timestamp":
..., "text": ...}` JSON) to connected clients, using the same `Broadcaster` pattern as
`/ws/session` but its own independent instance. This is deliberately decoupled from
`/ws/session`'s `SessionState` stream so none of the already-tested replay/live pipeline changes.

**Chat:** `POST /ai/chat` — body `{"question": str}`, returns `{"answer": str}`. Stateless: builds
a compact context string from the latest known `SessionState` (reusing the same "latest state"
tracking the anomaly loop already needs) plus the question, calls Ollama, returns the text
response directly (no streaming, no persisted history — the frontend keeps the conversation
client-side for the current page session only).

**Latest-state tracking:** a simple module-level "latest state" variable, updated every time
`main.py`'s `/ws/session` broadcaster publishes a state — both the anomaly loop and the chat
endpoint read from it. This avoids duplicating replay/live plumbing just to know "what's
happening right now."

## Frontend
Two new small components, both consuming plain REST/WebSocket (no changes to existing
`useSessionSocket`/panels):
- **RaceEngineerNotes** — a `useAiNotes(url)` hook connecting to `/ws/ai-notes`, accumulating the
  last ~20 notes; renders as a scrolling list with timestamps, styled consistently with the
  existing dense-dashboard panel look (`.pitwall-panel`).
- **AiChat** — a simple input + send button + answer display, POSTing to `/ai/chat`; keeps its own
  question/answer history in component state (not persisted).

**Layout:** both stacked below Track Map in the right sidebar (confirmed placement — that
sidebar currently has empty space below the circuit bezel in the dense grid), no changes to the
existing 3-column grid structure.

## Docker Compose
No new service. The `backend` service gains `OLLAMA_HOST`/`OLLAMA_MODEL` env vars (pointing at
`host.docker.internal` by default, which Docker Desktop resolves to the host machine — Ollama
itself is expected to already be running on the host, not containerized, per the original spec's
decision).

## Out of scope for this plan
Persisted chat/note history across restarts (both are in-memory/session-scoped). Streaming
token-by-token responses (single request/response is simpler and sufficient for 1-2 sentence
notes and short chat answers). Fine-tuning or prompt-engineering beyond a straightforward
race-engineer-style system prompt — can be iterated on after the plumbing works.
