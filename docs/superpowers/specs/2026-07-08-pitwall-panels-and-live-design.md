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
- The backend computes a **track layout** once per loaded session: take the session's fastest
  lap's car position trace (`lap.get_telemetry()` → X/Y columns from FastF1, meters on the
  track plane), downsample to ~150 points, and serve it via a new `GET /session/track-layout`
  endpoint (backed by an in-memory session cache keyed by year/event/session_type, populated
  when `/session/replay` first loads that session).
- `DriverState.x` / `DriverState.y` (already present, nullable, in the schema) stay `None` in
  replay mode for this plan — computing a live per-driver dot position at each lap-granularity
  tick would require passing FastF1's stateful `Lap`/`Session` objects into what is otherwise a
  pure, unit-testable conversion function, which isn't worth the coupling for a v1 slice.
  The Track Map panel renders the correct-shaped outline (satisfying "right map for the right
  circuit") without animated car dots in replay mode; a `ponytail:` comment in the adapter
  notes sub-lap telemetry sampling as the upgrade path if per-driver replay dots are wanted
  later. Live mode (below) populates `x`/`y` continuously from day one, since f1-dash's feed
  already carries live position telemetry per update — no equivalent coupling problem there.
- The frontend fetches the layout once when a replay starts, computes a bounding box, and
  renders an SVG path auto-scaled to fit. It plots driver dots from `x`/`y` whenever they're
  present (i.e. always in live mode, never in replay mode for this plan) and shows the bare
  outline otherwise.

**Live mode:** F1's live-timing feed carries a `Position.z` topic with continuous car X/Y, but
it (like `CarData.z`) is gzip-compressed and base64-encoded in the raw feed — decompressing and
parsing it correctly is real, unverified-until-tested work (see below). Live mode v1 ships
**without** animated car dots for the same reason replay mode does — `DriverState.x`/`y` stay
`None` in both modes for this plan. This removes an asymmetry that would otherwise exist (live
having dots, replay not) and defers the compressed-topic work to a fast-follow once it can be
verified against a real live session. The Track Map panel and its frontend code need no changes
either way — it already renders "outline only" gracefully when `x`/`y` are null.

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

**Correction from the original design (researched, not assumed):** f1-dash does not expose a
WebSocket. Its actual server (`realtime/src/http_server.rs` in the f1-dash repo) exposes
**Server-Sent Events** at `GET /api/realtime` — two event types, `"initial"` (a full JSON state
snapshot) and `"update"` (a JSON merge-patch fragment to apply on top of the running state).
f1-dash's own typed Rust schema (`shared/src/models.rs`/`events.rs`) is dead code — commented
out of the build — so it does **not** define the real wire format. What's actually live
(`realtime/src/services/state_service.rs`) stores state as an untyped `serde_json::Value` built
by recursively deep-merging whatever arrives; the real topic names come straight from F1's own
official live-timing SignalR feed, which f1-dash subscribes to directly
(`realtime/src/f1.rs`) and forwards close to verbatim: `Heartbeat`, `CarData.z`, `Position.z`,
`ExtrapolatedClock`, `TimingStats`, `TimingAppData`, `WeatherData`, `TrackStatus`,
`SessionStatus`, `DriverList`, `RaceControlMessages`, `SessionInfo`, `SessionData`, `LapCount`,
`TimingData`, `TeamRadio`, `ChampionshipPrediction`.

- The backend adds a **live adapter** that connects as an SSE client (not a WebSocket client) to
  a running f1-dash server's `GET /api/realtime`, applies `"update"` merge-patches on top of the
  `"initial"` snapshot using the same recursive merge-patch algorithm f1-dash itself uses
  (deep-merge objects, index-merge arrays), and translates the resulting merged JSON tree into
  `SessionState` broadcasts on every meaningful change, reusing the existing `Broadcaster` — the
  frontend and every panel stay unaware of which mode is feeding them.
- v1 reads only the `DriverList`, `TimingData`, and `TrackStatus` topics from the merged tree —
  the ones needed for the Timing Tower and track-status data, using field names from F1's
  well-documented live-timing schema (the same schema FastF1's own bundled live-timing client
  parses — see `fastf1.livetiming`). These field names are **best-effort, not verified against a
  real live feed** (there is no live F1 session to test against outside a race weekend); the
  plan's tests use representative sample payloads shaped like the documented schema, and a
  manual verification pass against a real live session is called out as a follow-up acceptance
  step, not something this plan can automate.
- `CarData.z` and `Position.z` are gzip-compressed, base64-encoded in F1's raw feed — decoding
  them correctly is real, separately-verifiable work. v1 does not attempt it (see the Track Map
  section above: replay mode already ships without animated dots, so live mode matching that for
  now is not a regression); a `ponytail:` comment marks decompressing these topics as the
  upgrade path for live car-position dots.
- f1-dash is added to `docker-compose.yml` as its own service (its published image), so
  `docker compose up` brings up all three services; live mode only does anything useful during
  a real F1 session weekend, which is expected and fine for a dev slice.
- A new `POST /session/live` endpoint starts the live adapter (mirroring `/session/replay`'s
  shape); starting one mode while the other is active stops the previous one first (only one
  active session/broadcast source at a time — matches the original spec's "session controller
  owns switching between live and replay").

## UI redesign: dense single-screen dashboard (added 2026-07-09)
Following user feedback that the tab-switcher shell felt "ugly" and a reference photo of the
APXGP engineering-telemetry display (from the Apple F1 film) plus a mockup screenshot in the
same style, the frontend shell is redesigned as one always-visible dense dashboard — no tab
switching, every panel on screen at once, matching how a real pitwall's wall of monitors reads
at a glance.

**Design tokens** (derived directly from the reference, not freelanced):
- Color: background `#050607`, panel `#0a0c10`, hairline border `#1a1d1f`, primary text
  `#e5e7eb`, label gray `#6b7280`, accents cyan `#3ecbff` (primary/speed), yellow `#facc15`
  (tires/caution), green `#4ade80` (good/green flag), red `#f87171` (danger/slow).
- Type: labels are small uppercase system sans with letter-spacing; data values are monospace
  with tabular numerals (matching the reference's technical-readout feel).
- Layout: CSS grid, three columns (fixed-width left sidebar, fluid center, fixed-width right
  sidebar), header strip across the top. Left column: session overview stats + Tire Strategy
  stint bars. Center: Timing Tower (large, dominant, like the reference's big data table) above
  Sector Times. Right column: Track Map inside a circular bezel — this is the signature element,
  directly echoing the reference's most distinctive piece (the round GPS-trace odometer-style
  circuit view).
- The reference mockup shows single-car engineering telemetry (RPM, throttle, ERS, tire
  pressures) that PitWall's data model doesn't have (PitWall shows multi-driver timing data, not
  one car's live sensor telemetry) — the redesign adopts the reference's *visual language* (dense
  grid, black background, uppercase micro-labels, colored values, circular track bezel) applied
  to PitWall's actual panels, not a literal recreation of telemetry channels that don't exist.

## Out of scope for these two plans (unchanged from original spec)
AI/Ollama analysis layer (separate future plan). Pixel-perfect visual polish (separate future
design pass, once the user is ready to lock exact typography/spacing/motion).
