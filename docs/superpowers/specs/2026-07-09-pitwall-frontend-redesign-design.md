# Pit Wall Front-End Redesign

## Goal

Redesign the dashboard to look and feel like a real F1 pit wall operations screen: dark, dense, flat, technical. No gradients, no glossy cards, no marketing layout. Every panel shown must be backed by real data — nothing decorative that fakes information the backend doesn't have.

Scope was narrowed from an initial very broad spec through three explicit decisions:

1. **Redesign + extend backend** (not visual-only) — some new panels are worth wiring to real data.
2. Of the plausible new data sources, only **telemetry traces, weather, and race control messages** are real (FastF1/f1-dash actually expose them). ERS deployment, fuel delta, brake temps, PU status, and corner-by-corner analysis are not public data and are excluded entirely — not stubbed, not faked.
3. The spec's predictive "strategy panel" (undercut/overcut threat, pit-stop predictor, traffic forecast, finish-position projection) is replaced with the **existing AI race engineer widgets** (`RaceEngineerNotes` + `AiChat`), rather than building speculative heuristics.

A landing/home page with session selection was added as a fourth decision, described in its own section below.

## Visual system

Extend the existing dark theme in `App.css` rather than replacing it:

- Keep `--bg` (`#050607`) and `--panel` (`#0a0c10`).
- Add CSS vars for colors currently hardcoded inline: `--purple` (session-best sector, used ad hoc today in `SectorTimes`), `--orange` (alerts, pit windows).
- Sharp corners: drop panel border-radius from 6px to ~2px.
- Typography: no new font/webfont. Condensed/technical feel comes from tight letter-spacing, small-caps uppercase headers, and tabular-nums monospace on data cells — patterns already present in `App.css`, applied more consistently.
- Thin 1px dividers instead of card shadows (already the case; keep it).
- Team colors and tire-compound colors become small static lookup constants (team name → hex, compound → hex). Static data, not configuration — no need for a settings layer.

## Layout regions → panels

| Region | Panel | Data source | Status |
|---|---|---|---|
| Top status bar | Session/lap/flag, track+air temp, session clock, connection badges | `track_status` (existing) + new weather + ws connection state | extend existing header |
| Left column | Timing tower: existing table + team color stripe, tire-compound color, sector mini-colors per row (reuse `SectorTimes` best-sector logic), click-to-select | existing `DriverState` fields | restyle + extend |
| Center | Track map: existing SVG outline + car dots | existing `x`/`y` fields | restyle only (see Known Limitations) |
| Center | Gap trend chart: selected driver's gap-to-leader/-ahead over recent laps, hand-rolled SVG line chart | `gap_to_leader`/`gap_to_ahead` — **requires backend fix**, see below | new panel |
| Right | Selected driver card: position, tire, last/best lap, gap ahead/behind | existing `DriverState` fields | new panel, existing data |
| Right | Telemetry stack: speed/throttle/brake/gear as stacked SVG traces, shared cursor, for selected driver's current/latest lap | **new backend endpoint**, replay-only | new panel |
| Right | Weather panel: air/track temp, humidity, wind, rain trend | **new**, replay-only | new panel |
| Bottom strip | Race control ticker: flags, SC/VSC, investigations | **new**, both modes (best-effort for live) | new panel |
| Right (was "strategy") | AI race engineer: existing `RaceEngineerNotes` + `AiChat`, restyled into the pit-wall aesthetic | existing | restyle only |
| Right/bottom | Stint bars: existing `TireStrategy`, restyled as horizontal bars instead of pill list | existing | restyle only |

**Explicitly cut**, not built even as placeholders: ERS/fuel/brake-temp/PU-status panel, corner-analysis panel, video feed tiles, team radio transcript, a distinct qualifying/practice layout mode (session type stays a selector value, not a different panel arrangement), driver GPS trail on the track map.

## Backend changes

### Gap fix (bug fix, not a new feature)

`gap_to_leader` and `gap_to_ahead` are `None` in replay mode today — flagged by an existing `ponytail:` comment in `fastf1_adapter.py`. FastF1's `Time` column already carries each driver's cumulative session-relative time per lap row, so both gaps are computable from data already loaded: `gap_to_leader` = driver's `Time` minus the lap-leader's `Time`; `gap_to_ahead` = driver's `Time` minus the `Time` of whoever is one position ahead in that lap's classification. This is what makes the gap trend chart (and better timing-tower gaps) real in replay mode, which is the primary demo mode.

### New: `/session/telemetry` endpoint

Replay-only (FastF1 has no live per-lap telemetry equivalent via f1-dash). Given `year`, `event`, `session_type`, `driver`, `lap_number`, returns distance-indexed arrays: `speed`, `throttle`, `brake`, `gear`, `rpm`. Backs the telemetry trace stack. Live mode: panel shows "unavailable in live mode."

### New: weather

Pull `session.weather_data` (FastF1), expose the sample nearest the current session timestamp. Replay-only — f1-dash's live feed has no weather channel. Live mode: panel shows "unavailable in live mode."

### New: race control messages

Replay: FastF1 `session.race_control_messages`, filtered to messages at or before the current state's timestamp, accumulated into `SessionState`. Live: f1-dash's live tree plausibly carries the same `RaceControlMessages` key as the official live-timing feed (same schema `live_adapter.py` already assumes for `TrackStatus`) — parsed the same best-effort way, with the same "not yet verified against a real live stream" caveat already present on the existing live-adapter constants.

## Interactivity

- Click a timing-tower row or a car dot on the track map → sets selected driver → drives telemetry stack, selected-driver card, and gap trend chart.
- Arrow-up/down keys cycle the selected driver.
- No pause/replay-speed keyboard shortcut — there's no backend pause concept to hook into; out of scope.

## Known limitations carried forward (not fixed by this redesign)

- **Track map car dots are inert.** Neither `fastf1_adapter.py` nor `live_adapter.py` has ever populated per-driver `x`/`y` on `DriverState` — both omit it entirely today. Real live positioning needs a much higher-frequency sub-lap position stream, which is a separate feature. The redesign keeps the dots wired to the field (so they light up for free once that's built) but does not fabricate positions.
- **Live mode has no track-layout call.** The track map will show its "waiting" state throughout a live session. Not addressed here.

## Landing / home page

On first load (and on every refresh), the app shows a full-screen landing page instead of the dashboard, styled consistently with the pit-wall theme (not a separate "marketing" look).

**Session picker**: cascading dropdowns —
1. **Year** — from `GET /meta/years`.
2. **Track** — from `GET /meta/events?year=`, populated once a year is chosen.
3. **Session** — from `GET /meta/sessions?year=&event=`, populated once a track is chosen.

Each dropdown only ever shows combinations that actually exist, sourced from FastF1's event schedule rather than hardcoded. The sessions endpoint reads the `Session1..Session5` names directly off the schedule row for that event and returns them unchanged — `fastf1.get_session()` already accepts full session names, so no name→code mapping table is needed.

**Go live**: a separate button, no dropdowns — starts the live f1-dash feed directly, same as today's "Start live" action.

Submitting either path transitions into the dashboard.

### Backend

Three new read-only endpoints, cached in-memory the same way `get_or_load_session` already caches loaded sessions (a module-level dict keyed by the query):

- `GET /meta/years` — list of supported years.
- `GET /meta/events?year=` — event/track names for that year, via `fastf1.get_event_schedule(year)`.
- `GET /meta/sessions?year=&event=` — that event's non-null `Session1..Session5` names.

### Frontend

- `App.tsx`'s gating state changes from `sessionParams === null` to an explicit `mode: 'landing' | 'replay' | 'live'`.
- The landing page is a new top-level component, replacing `ReplayControls`' current always-visible placement in the header. `ReplayControls` itself is retired in favor of the landing page's own dropdown form (its live-start logic moves there too).
- No "return to home" control on the dashboard — refreshing the page is how you start a new session. This is the simplest option; add an explicit control later only if switching sessions mid-use turns out to matter.

## Testing

- Backend: unit tests for the gap-fix calculation (leader/ahead deltas across a small synthetic laps table), the telemetry/weather/race-control parsing functions, and the three new `/meta/*` endpoints (valid combos only, no fabricated ones).
- Frontend: component tests for the landing page's cascading dropdown behavior (track list waits for year, session list waits for track), for driver-selection wiring (click/arrow-key updates the right panels), and for each restyled/new panel's data-present and data-absent (e.g. "unavailable in live mode") states — following the existing per-panel `*.test.tsx` pattern already in the repo.
