# Live fix, resizable grid dashboard, and Telemetry comparison tab

## Background

Three complaints, one design:

1. "App is not live, takes a lot of time to load." Two separate root causes:
   - `Go Live` crashed immediately: `_parse_race_control_messages` assumed the live feed's
     `Messages` field is always a dict, but the real f1-dash-realtime feed sends a list.
     **Already fixed and tested** (`backend/app/live_adapter.py`, `backend/tests/test_live_adapter.py`).
   - `Start Replay` gives no loading feedback. On an uncached session FastF1 fetches from
     the internet (30s-2min, one-time per session, then cached), but the button shows nothing
     while this happens, so it looks broken/stuck.
2. Dragging a dashboard widget (`Panel.tsx`) just overlaps it with neighbors — no collision
   handling, no resize. Want widgets to reflow around each other automatically and be
   resizable.
3. No way to see one driver's telemetry big, or compare telemetry across drivers/laps
   side by side.

## Approach

### 1. Replay loading feedback

`LandingPage.handleSubmit` (and `handleGoLive`) get a `loading` state: disable the
submit button and show "Loading session — first load of a session can take a minute or
two" while the `fetch` is in flight. No backend change; this is purely UX feedback for
a network call that's already correct, just silent.

### 2. Grid-based dashboard (react-grid-layout)

Replace `Panel.tsx`'s custom `useDraggablePosition` (free-pixel transform, no collision
detection, called out in its own `ponytail:` comment as a stopgap) with
[`react-grid-layout`](https://github.com/react-grid-layout/react-grid-layout): a
widely-used, actively maintained library that gives us drag, resize-from-any-edge, and
collision-based reflow for free, instead of hand-rolling collision/reflow logic.

- One `<GridLayout>` per tab (Dashboard, Telemetry — see below), each widget wrapped
  in the same `Panel` component (title bar becomes the drag handle,
  `react-grid-layout` handles the resize handles itself).
- Layout (x/y/w/h per widget) persists to `localStorage` per tab, replacing the current
  per-panel position storage.
- Default layout ships as sane starting positions/sizes matching today's visual layout
  (left/center/right columns), so first-run doesn't look broken.

### 3. Telemetry tab

New top-level tab, switched via a tab bar in the header (`Dashboard` / `Telemetry`),
alongside the existing Home button. Both tabs share the same `history`/`latest`
session state and `sessionParams` from `App.tsx` — no duplicate data fetching for
session state.

Telemetry tab is its own `react-grid-layout` grid (same drag/resize/reflow behavior as
the dashboard) containing:

- **Driver picker panel** (left): reuses the driver list styling from `TimingTower`.
  Clicking a driver adds a **comparison selection**: `{ driver, lapNumber }`, with
  `lapNumber` defaulting to that driver's current lap from `latest` state and editable
  via a number input, so the same driver can be added again with a different lap.
- **Active selections list**: each selection shown with a color swatch (assigned from
  a fixed palette, cycling), driver abbreviation, lap number, and a remove button.
- **Big telemetry charts panel** (main area): the same five traces as today's
  `TelemetryStack` (speed/throttle/brake/gear/RPM), one chart per metric, each chart
  overlaying one polyline per active selection in its assigned color, with a legend.

`TelemetryStack`'s fetch-by-driver-and-lap logic is extracted into a shared hook
(`useDriverLapTelemetry(sessionParams, driver, lapNumber)`) used both by the existing
sidebar `TelemetryStack` panel (single selection, unchanged behavior) and by the new
Telemetry tab (one hook call per active selection).

No backend changes needed for this — `/session/telemetry` already takes
`driver` and `lap_number` independently.

## Out of scope

- Live mode still requires an actual live F1 session broadcasting through
  f1-dash-realtime to show cars; nothing to build there beyond the crash fix.
- No new backend endpoints or schema changes.
- No touch/mobile drag support (react-grid-layout's default mouse+touch handling is
  used as-is, not hardened further).

## Testing

- `test_live_adapter.py`: list-shaped `Messages` case (done).
- `LandingPage.test.tsx`: loading state disables button / shows message during fetch.
- Grid dashboard: smoke test that widgets render inside the grid and drag handle exists.
- Telemetry tab: test adding/removing comparison selections and that charts render one
  polyline per selection.
