# PitWall — Panels & Live Mode Design (Plans 2 & 3)

Builds on `docs/superpowers/specs/2026-07-07-pitwall-design.md`. Covers the remaining
static-replay panels (track map, tire strategy, sector times) and live f1-dash mode.

## Visual direction (locked, detailed polish deferred)
Target look: dense engineering-telemetry dashboards (reference: real F1 pitwall/steering-wheel
software) — black background, small uppercase gray labels over bright cyan/yellow/green/red
values, thin hairline dividers, tabular numerals. This plan implements real dark-theme CSS
(not unstyled tables) consistent with that direction, but does not chase pixel-perfect polish —
a dedicated design pass can refine spacing/typography/animation later without changing any
component's data contract.

## Track map correctness (the user's core requirement)
No circuit database, no per-track image assets. The track outline and every car's position
come from **real telemetry for that specific session** — FastF1's car position telemetry in
replay mode, f1-dash's live position feed in live mode. Since the shape is drawn from actual
GPS-derived telemetry of that race, it is automatically correct for whichever circuit is
running — there is nothing to look up and nothing that can point at the wrong track.

**Replay mode implementation:**
- The backend computes a **track layout** once per loaded session: take the driver with the
  most complete telemetry for that session, pull their fastest lap's car position trace
  (`lap.get_telemetry()` → X/Z columns from FastF1, which are lateral/longitudinal meters on
  track), downsample to ~150 points, and serve it via a new `GET /session/track-layout`
  endpoint (cached in memory after `/session/replay` loads a session).
- `DriverState.x` / `DriverState.y` (already present, nullable, in the schema) are populated
  in replay mode by finding the telemetry sample nearest each driver's lap-end timestamp.
  This gives one position update per lap (matching the existing lap-granularity replay), not
  smooth sub-lap movement — a documented v1 simplification (`ponytail:` comment), upgradeable
  by sampling telemetry at sub-lap ticks later without changing the schema or frontend.
- The frontend fetches the layout once when a replay starts, computes a bounding box, and
  renders an SVG path auto-scaled to fit; driver dots plot from `x`/`y` on each tick.

**Live mode:** f1-dash's `Position.z` live-timing topic already carries each car's live X/Y
telemetry sampled continuously — the live adapter (below) maps it directly into
`DriverState.x`/`y` per update, and the frontend's track map component needs no changes to
support it (same fields, just updating faster and more often).

## New panels (frontend, all consume the existing WebSocket stream)
- **Track Map** — SVG track outline (see above) + colored dot per driver at their `x`/`y`,
  team-colored, with driver abbreviation label.
- **Tire Strategy** — per-driver horizontal stint bar chart (compound color + lap range per
  stint). Built client-side: the panel keeps a rolling history of `(lap_number, compound)` per
  driver from the ticks it has already received (no backend history storage needed) and
  collapses consecutive same-compound laps into stints for rendering.
- **Sector Times** — table/heatmap of each driver's last lap's three sector times, colored
  purple (session best), green (personal best), yellow (neither). Requires the schema to carry
  sector times.

## Schema additions (backend/app/schema.py, additive/optional — no breaking changes)
`DriverState` gains:
- `lap_number: int | None = None` — needed by the Tire Strategy panel to build stint history.
- `sector_1_time: float | None = None`, `sector_2_time: float | None = None`,
  `sector_3_time: float | None = None` — needed by the Sector Times panel.
These are populated in replay mode directly from FastF1's laps table (`LapNumber`,
`Sector1Time`/`2`/`3`, already present in the same dataframe Task 3 already consumes) and,
in live mode, from f1-dash's `TimingData` topic.

`frontend/src/types.ts` must be updated to mirror these additions exactly, same as Plan 1's
contract discipline.

## Multi-panel shell
Plan 1 shipped a single hardcoded panel. This plan replaces `App.tsx`'s shell with a real tab
switcher (click or number-key 1-4) holding: Timing Tower, Track Map, Tire Strategy,
Sector Times. Session/mode controls (existing replay-start form) stay visible above the tabs
regardless of which panel is active.

## Live mode (f1-dash integration)
- The backend adds a **live adapter** that connects as a WebSocket client to a running f1-dash
  server instance and translates its messages into `SessionState` broadcasts, reusing the
  existing `Broadcaster` — the frontend and every panel are unaware of which mode is feeding
  them, per the original design's "session controller" principle.
- f1-dash is added to `docker-compose.yml` as its own service (its published image), so
  `docker compose up` brings up all three services; live mode only does anything useful during
  a real F1 session weekend, which is expected and fine for a dev slice.
- A new `POST /session/live` endpoint starts the live adapter (mirroring `/session/replay`'s
  shape); starting one mode while the other is active stops the previous one first (only one
  active session/broadcast source at a time — this matches the original spec's "session
  controller owns switching between live and replay").
- Exact f1-dash message topic names/shapes are confirmed against f1-dash's own source/docs at
  implementation time (recorded in the plan once confirmed) rather than assumed here.

## Out of scope for these two plans (unchanged from original spec)
AI/Ollama analysis layer (separate future plan). Pixel-perfect visual polish (separate future
design pass, once the user is ready to lock exact typography/spacing/motion).
