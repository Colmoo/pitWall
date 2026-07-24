from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class TrackStatus(str, Enum):
    GREEN = "green"
    YELLOW = "yellow"
    SC = "safety_car"
    VSC = "virtual_safety_car"
    RED = "red"


class Tire(BaseModel):
    compound: str
    age_laps: int


class WeatherSnapshot(BaseModel):
    air_temp: float
    track_temp: float
    humidity: float
    wind_speed: float
    rainfall: bool


class RaceControlMessage(BaseModel):
    timestamp: datetime
    category: str
    message: str
    flag: str | None = None


class TeamRadioClip(BaseModel):
    timestamp: datetime
    driver_number: str
    url: str


class DriverState(BaseModel):
    driver_number: str
    abbreviation: str
    team: str
    position: int
    # "running" or "out" (retired/DNF/DNS/DSQ) - drives the "OUT" display in the
    # timing tower instead of a stale position number.
    status: str = "running"
    gap_to_leader: float | None = None
    gap_to_ahead: float | None = None
    last_lap_time: float | None = None
    best_lap_time: float | None = None
    tire: Tire
    x: float | None = None
    y: float | None = None
    lap_number: int | None = None
    sector_1_time: float | None = None
    sector_2_time: float | None = None
    sector_3_time: float | None = None
    # per-segment mini-sector status ("purple"/"green"/"yellow"/"none"), grouped by
    # macro sector: micro_sectors[0] = S1's segments, [1] = S2's, [2] = S3's
    micro_sectors: list[list[str]] = []
    # True = on a push/flying lap, False = out-lap or in-lap (box), None = unknown
    flying_lap: bool | None = None
    # live car-data channel readout - only populated in live mode (no historical
    # per-tick channel replay in v1, see fastf1_adapter's per-lap telemetry endpoint instead)
    speed: float | None = None
    throttle: float | None = None
    brake: bool | None = None
    gear: int | None = None
    rpm: float | None = None
    drs: bool | None = None


class SessionState(BaseModel):
    timestamp: datetime
    track_status: TrackStatus
    # FastF1/live session identifier ("FP1"/"FP2"/"FP3"/"Q"/"SQ"/"S"/"R"); drives
    # the frontend's auto qualifying-view detection. None until resolved.
    session_type: str | None = None
    drivers: list[DriverState]
    weather: WeatherSnapshot | None = None
    race_control_messages: list[RaceControlMessage] = []
    team_radio: list[TeamRadioClip] = []
