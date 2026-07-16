import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone

import httpx

from app.live_merge import merge_patch
from app.schema import DriverState, RaceControlMessage, SessionState, Tire, TrackStatus
from app.sse_parser import parse_sse_events

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
    for entry in entries.values():
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


def session_state_from_live_tree(tree: dict, timestamp: datetime) -> SessionState | None:
    driver_list = tree.get("DriverList")
    timing_lines = tree.get("TimingData", {}).get("Lines")
    if not driver_list or not timing_lines:
        return None

    app_data_lines = tree.get("TimingAppData", {}).get("Lines", {})

    drivers: list[DriverState] = []
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
            )
        )

    if not drivers:
        return None

    status_code = tree.get("TrackStatus", {}).get("Status")
    track_status = _TRACK_STATUS_CODES.get(status_code, TrackStatus.GREEN)

    return SessionState(
        timestamp=timestamp,
        track_status=track_status,
        drivers=sorted(drivers, key=lambda d: d.position),
        race_control_messages=_parse_race_control_messages(tree),
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
