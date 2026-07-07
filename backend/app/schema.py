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


class DriverState(BaseModel):
    driver_number: str
    abbreviation: str
    team: str
    position: int
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


class SessionState(BaseModel):
    timestamp: datetime
    track_status: TrackStatus
    drivers: list[DriverState]
