# PitWall: live fixes, performance, real-time times, and qualifying mode

Date: 2026-07-24

Four related workstreams, built in parallel by separate agents and shipped together. They
share a small set of touch-points (`SessionState.session_type`, `App.tsx` header, the tick
provider); to avoid parallel agents colliding, those shared edits are owned by the integrator
(the orchestrating session), and each agent owns a disjoint set of files.

## A. Live map & telemetry — decode the `.z` topics (backend)

**Root cause.** Live mode shows no map dots and no telemetry because the two feeds that drive
them — car positions and car channel data — arrive on the F1 live-timing feed as the
**compressed** topics `Position.z` and `CarData.z` (base64 + raw-DEFLATE), while
`live_adapter.py` reads uncompressed keys `tree.get("Position")` / `tree.get("CarData")`, which
never exist. So `x`, `y`, `speed`, `throttle`, `brake`, `gear`, `rpm`, `drs` are always `None`
in live mode. `TimingData` is uncompressed, which is why the timing tower works and these two
do not. This was deliberately deferred in the 2026-07-08 design doc, not a regression.

**Change.** In `live_adapter.py`, decode `Position.z` and `CarData.z` at read time:
`json.loads(zlib.decompress(base64.b64decode(s), -zlib.MAX_WBITS))` (raw DEFLATE, no header —
the same handling `fastf1.livetiming` uses). Route the decoded structures into the shapes
`_latest_position_entries` / `_latest_car_data_entries` already expect, so the existing
`x/y/speed/...` mapping lights up with no frontend change. The `.z` fields arrive as replacement
strings in the merge-patch (not mergeable objects) — decode on read, tolerate malformed/partial
base64 by falling back to `{}` (never crash the stream).

**Test.** Unit test with a hand-crafted compressed payload (compress a known JSON dict with raw
DEFLATE, base64-encode, assert the adapter surfaces the expected `x/y`/channels).

**Files:** `backend/app/live_adapter.py`, `backend/tests/test_live_adapter.py` (or the existing
live adapter test module). Owner: Agent 1.

## B. Performance / freeze (frontend + backend)

**Root cause** (obs 1164/1165/1167). The frontend `history` array grows unbounded, and ~6
panels re-scan the whole array every frame with no memoization; the backend replay inflates
states by inserting deep-copied 1-second ticks (each a full deep copy of all 20 drivers). Render
cost and memory grow linearly with session length → progressive slowdown and freeze.

**Change.**
- `useSessionSocket.ts`: cap history to a bounded rolling window (ring buffer, generous cap that
  covers a normal session but bounds pathological length). Keep the existing per-frame coalescing.
- Preserve the two features that genuinely need the whole session — **Gap Trend** and **Tire
  Strategy** — by maintaining **incremental append-only aggregates** (derive-on-append, not
  re-scan-from-raw). They must keep working across the full session even though raw `history` is
  now bounded.
- Memoize `TrackMap`'s traced-outline computation (recompute only when new points arrive), and
  memoize the per-driver scans in `GapTrendChart` / `TireStrategy`.
- Backend `fastf1_adapter.py`: lighten the 1-second tick expansion — copy/update only the driver
  position fields that change per tick instead of `model_copy(deep=True)` of the full state.

**Test.** One runnable check per side: a frontend test that history is bounded and Gap
Trend/Tire Strategy still reflect early-session data after the window has rolled; a backend test
that tick expansion no longer deep-copies unchanged driver data (or that output states remain
correct with the lighter path).

**Files:** `frontend/src/api/useSessionSocket.ts`, `frontend/src/panels/GapTrendChart.tsx`,
`frontend/src/panels/TireStrategy.tsx`, `frontend/src/panels/TrackMap.tsx`,
`backend/app/fastf1_adapter.py`, and their tests. Owner: Agent 2.

## C. Real-time times + running lap timer (integrator)

A single low-frequency tick (~10 Hz) advances continuously-updating readouts between backend
state messages:
- **Running lap time** for the selected driver in `SelectedDriverCard`: `now − lap_start`, where
  `lap_start` is captured when that driver's `lap_number` last changed (tracked with a ref/effect
  in the card). Shows the lap time "as it's happening."
- Smooth map-dot motion between backend updates (already partly handled by CSS transitions on the
  dots; keep/verify).

Existing per-state readouts already update in real time; this adds the continuously-ticking
*current* lap. Owner: integrator (small, central, touches shared files).

**Files:** `frontend/src/panels/SelectedDriverCard.tsx`, `frontend/src/App.tsx` (tick).

## D. Qualifying mode (backend + integrator + Agent 3)

**Schema.** Add `session_type: str | None = None` (and `session_name` if cheap) to `SessionState`.
Replay fills it from the replay request; live fills it from `resolve_fastf1_session_identity`.
Both set in `main.py` (integrator-owned), so Agent 1's live decode work stays isolated.

**View.** A "qualifying / timing" view that **hides gap-to-leader** and instead surfaces fastest
lap, sector times, and last/live lap time. It is a **stat/column swap on existing panels**, not a
separate layout.
- **Auto-on** in replay when `session_type` is Practice / Qualifying / Sprint-Quali.
- **Header toggle button** in live mode, and available as a manual override in replay.
- `TimingTower` takes a new `qualifyingMode: boolean` prop (owned by Agent 3) that swaps the
  gap-to-leader column for lap/sector-focused columns. The App header owns the toggle state and
  auto-detect, and passes the prop down (integrator).

**Files:** `backend/app/schema.py`, `frontend/src/types.ts`, `backend/app/main.py`,
`frontend/src/App.tsx` (integrator); `frontend/src/panels/TimingTower.tsx` (Agent 3).

## File ownership (no file written by two owners)

- **Agent 1:** `live_adapter.py` (+ live adapter test).
- **Agent 2:** `useSessionSocket.ts`, `GapTrendChart.tsx`, `TireStrategy.tsx`, `TrackMap.tsx`,
  `fastf1_adapter.py` (+ their tests).
- **Agent 3:** `TimingTower.tsx` (+ its test).
- **Integrator:** `schema.py`, `types.ts`, `main.py`, `App.tsx`, `SelectedDriverCard.tsx`.

## Acceptance

- Live mode (during a real session) renders car dots on the map and live telemetry traces.
  (Only fully verifiable against a live stream; unit-tested via crafted compressed payloads.)
- A long replay no longer degrades/freezes; memory and per-frame work stay bounded.
- Selected driver shows a continuously-ticking current lap time.
- Loading a Practice/Qualifying replay auto-shows the timing view (no gap-to-leader); live mode
  has a working header toggle for it.
- Full backend (`pytest`) and frontend (`vitest`) suites pass; frontend production build succeeds.
