import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone

import httpx

from app.live_merge import merge_patch
from app.schema import DriverState, RaceControlMessage, SessionState, TeamRadioClip, Tire, TrackStatus, WeatherSnapshot
from app.sse_parser import parse_sse_events

TEAM_RADIO_BASE_URL = "https://livetiming.formula1.com/static/"

# ponytail: mini-sector "Segments[].Status" codes below are best-effort, based
# on the same publicly reverse-engineered live-timing schema as
# _TRACK_STATUS_CODES - not yet verified against a real live SSE stream.
# Unknown/未-seen codes fall back to "none" rather than guessing.
_SEGMENT_STATUS_CODES = {
    2048: "none",
    2049: "yellow",
    2051: "green",
    2052: "purple",
}

# ponytail: CarData channel numbers below follow the same publicly documented
# convention (0=RPM, 2=Speed, 3=nGear, 4=Throttle, 5=Brake, 45=DRS) used across
# other F1 live-timing tooling - not yet verified against a real live stream.
_CAR_CHANNEL_RPM = "0"
_CAR_CHANNEL_SPEED = "2"
_CAR_CHANNEL_GEAR = "3"
_CAR_CHANNEL_THROTTLE = "4"
_CAR_CHANNEL_BRAKE = "5"
_CAR_CHANNEL_DRS = "45"

# ponytail: these field names and status codes are best-effort, based on F1's
# publicly documented live-timing feed schema (the same one fastf1.livetiming
# parses) as forwarded near-verbatim by f1-dash's realtime service. Not yet
# verified against a real live SSE stream — confirm during the next live
# session and adjust here if a field name is wrong.
_TRACK_STATUS_CODES = {
    "1": TrackStatus.GREEN,
    "2": TrackStatus.YELLOW,
    "4": TrackStatus.SC,
    "5": TrackStatus.RED,
    "6": TrackStatus.VSC,
    "7": TrackStatus.VSC,
}


def _parse_lap_time(value) -> float | None:
    if not value:
        return None
    try:
        if ":" in value:
            minutes, rest = value.split(":", 1)
            return int(minutes) * 60 + float(rest)
        return float(value)
    except (ValueError, TypeError):
        return None


def _parse_gap(value) -> float | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return float(value.replace("+", ""))
    except ValueError:
        return None


def _parse_sector(sectors: list, index: int) -> float | None:
    if index >= len(sectors):
        return None
    value = sectors[index].get("Value")
    if not value:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


# ponytail: field names here follow the same publicly-documented live-timing
# schema assumed elsewhere in this file (see _TRACK_STATUS_CODES) - not yet
# verified against a real live SSE stream, adjust if a field name is wrong.
def _parse_race_control_messages(tree: dict) -> list[RaceControlMessage]:
    entries = tree.get("RaceControlMessages", {}).get("Messages", {})
    messages: list[RaceControlMessage] = []
    for entry in entries.values() if isinstance(entries, dict) else entries:
        utc = entry.get("Utc")
        if not utc:
            continue
        try:
            timestamp = datetime.fromisoformat(utc.replace("Z", "+00:00"))
        except ValueError:
            continue
        messages.append(
            RaceControlMessage(
                timestamp=timestamp,
                category=entry.get("Category", ""),
                message=entry.get("Message", ""),
                flag=entry.get("Flag"),
            )
        )
    messages.sort(key=lambda m: m.timestamp)
    return messages


def _parse_micro_sectors(sectors: list) -> list[str]:
    segments: list[str] = []
    for sector in sectors:
        for segment in sector.get("Segments", []) if isinstance(sector, dict) else []:
            code = segment.get("Status") if isinstance(segment, dict) else None
            segments.append(_SEGMENT_STATUS_CODES.get(code, "none"))
    return segments


def _parse_flying_lap(timing: dict) -> bool | None:
    # ponytail: TimingData doesn't expose out/in-lap directly; PitOut/InPit are
    # the closest signal the live feed gives us for "not currently pushing".
    if timing.get("PitOut") or timing.get("InPit"):
        return False
    if timing.get("Position"):
        return True
    return None


def _latest_position_entries(tree: dict) -> dict:
    snapshots = tree.get("Position")
    if not isinstance(snapshots, list) or not snapshots:
        return {}
    latest = snapshots[-1]
    return latest.get("Entries", {}) if isinstance(latest, dict) else {}


def _latest_car_data_entries(tree: dict) -> dict:
    snapshots = tree.get("CarData")
    if not isinstance(snapshots, list) or not snapshots:
        return {}
    latest = snapshots[-1]
    return latest.get("Entries", {}) if isinstance(latest, dict) else {}


def _parse_weather(tree: dict) -> WeatherSnapshot | None:
    weather = tree.get("WeatherData")
    if not isinstance(weather, dict) or not weather:
        return None
    try:
        return WeatherSnapshot(
            air_temp=float(weather.get("AirTemp", 0)),
            track_temp=float(weather.get("TrackTemp", 0)),
            humidity=float(weather.get("Humidity", 0)),
            wind_speed=float(weather.get("WindSpeed", 0)),
            rainfall=bool(int(weather.get("Rainfall", 0))),
        )
    except (TypeError, ValueError):
        return None


def _parse_team_radio(tree: dict) -> list[TeamRadioClip]:
    captures = tree.get("TeamRadio", {}).get("Captures", {})
    entries = captures.values() if isinstance(captures, dict) else captures
    session_path = tree.get("SessionInfo", {}).get("Path", "")
    clips: list[TeamRadioClip] = []
    for entry in entries:
        utc = entry.get("Utc")
        path = entry.get("Path")
        if not utc or not path:
            continue
        try:
            timestamp = datetime.fromisoformat(utc.replace("Z", "+00:00"))
        except ValueError:
            continue
        clips.append(
            TeamRadioClip(
                timestamp=timestamp,
                driver_number=str(entry.get("RacingNumber", "")),
                url=f"{TEAM_RADIO_BASE_URL}{session_path}{path}",
            )
        )
    clips.sort(key=lambda c: c.timestamp)
    return clips


def session_state_from_live_tree(tree: dict, timestamp: datetime) -> SessionState | None:
    # ponytail: only bail on a completely empty tree (nothing merged yet).
    # Driver/timing data lags behind weather, team radio, and race control in
    # the upstream feed - emit whatever's ready instead of holding everything
    # back until DriverList + TimingData both show up.
    if not tree:
        return None

    driver_list = tree.get("DriverList")
    timing_lines = tree.get("TimingData", {}).get("Lines")

    drivers: list[DriverState] = []
    if driver_list and timing_lines:
        app_data_lines = tree.get("TimingAppData", {}).get("Lines", {})
        position_entries = _latest_position_entries(tree)
        car_data_entries = _latest_car_data_entries(tree)

        for number, timing in timing_lines.items():
            driver_info = driver_list.get(number)
            if not isinstance(driver_info, dict):
                continue
            position = timing.get("Position")
            if not position:
                continue

            sectors = timing.get("Sectors", [])
            stints = app_data_lines.get(number, {}).get("Stints", [])
            latest_stint = stints[-1] if stints else {}

            pos_entry = position_entries.get(number, {})
            channels = car_data_entries.get(number, {}).get("Channels", {})
            drs_value = channels.get(_CAR_CHANNEL_DRS)

            drivers.append(
                DriverState(
                    driver_number=number,
                    abbreviation=driver_info.get("Tla", number),
                    team=driver_info.get("TeamName", ""),
                    position=int(position),
                    gap_to_leader=_parse_gap(timing.get("GapToLeader")),
                    gap_to_ahead=_parse_gap(timing.get("IntervalToPositionAhead", {}).get("Value")),
                    last_lap_time=_parse_lap_time(timing.get("LastLapTime", {}).get("Value")),
                    best_lap_time=_parse_lap_time(timing.get("BestLapTime", {}).get("Value")),
                    tire=Tire(
                        compound=latest_stint.get("Compound", "UNKNOWN"),
                        age_laps=int(latest_stint.get("TotalLaps", 0)),
                    ),
                    lap_number=timing.get("NumberOfLaps"),
                    sector_1_time=_parse_sector(sectors, 0),
                    sector_2_time=_parse_sector(sectors, 1),
                    sector_3_time=_parse_sector(sectors, 2),
                    micro_sectors=_parse_micro_sectors(sectors),
                    flying_lap=_parse_flying_lap(timing),
                    x=pos_entry.get("X"),
                    y=pos_entry.get("Y"),
                    speed=channels.get(_CAR_CHANNEL_SPEED),
                    throttle=channels.get(_CAR_CHANNEL_THROTTLE),
                    brake=bool(channels.get(_CAR_CHANNEL_BRAKE)) if _CAR_CHANNEL_BRAKE in channels else None,
                    gear=channels.get(_CAR_CHANNEL_GEAR),
                    rpm=channels.get(_CAR_CHANNEL_RPM),
                    drs=bool(drs_value) if drs_value is not None else None,
                )
            )

    status_code = tree.get("TrackStatus", {}).get("Status")
    track_status = _TRACK_STATUS_CODES.get(status_code, TrackStatus.GREEN)

    return SessionState(
        timestamp=timestamp,
        track_status=track_status,
        drivers=sorted(drivers, key=lambda d: d.position),
        weather=_parse_weather(tree),
        race_control_messages=_parse_race_control_messages(tree),
        team_radio=_parse_team_radio(tree),
    )


class LiveAdapter:
    def __init__(self, sse_url: str):
        self._sse_url = sse_url
        self._transport = None  # test seam: MockTransport in tests, real network otherwise

    async def stream(self) -> AsyncIterator[SessionState]:
        tree: dict = {}
        async with httpx.AsyncClient(transport=self._transport, timeout=None) as client:
            async with client.stream("GET", self._sse_url) as response:
                buffer = ""
                async for chunk in response.aiter_text():
                    buffer += chunk
                    while "\n\n" in buffer:
                        block, buffer = buffer.split("\n\n", 1)
                        for event_type, data in parse_sse_events(block + "\n\n"):
                            try:
                                payload = json.loads(data)
                            except json.JSONDecodeError:
                                continue

                            tree = payload if event_type == "initial" else merge_patch(tree, payload)

                            state = session_state_from_live_tree(tree, datetime.now(timezone.utc))
                            if state is not None:
                                yield state
