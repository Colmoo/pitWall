export type TrackStatus = "green" | "yellow" | "safety_car" | "virtual_safety_car" | "red";

export interface Tire {
  compound: string;
  age_laps: number;
}

export interface DriverState {
  driver_number: string;
  abbreviation: string;
  team: string;
  position: number;
  gap_to_leader: number | null;
  gap_to_ahead: number | null;
  last_lap_time: number | null;
  best_lap_time: number | null;
  tire: Tire;
  x: number | null;
  y: number | null;
}

export interface SessionState {
  timestamp: string;
  track_status: TrackStatus;
  drivers: DriverState[];
}
