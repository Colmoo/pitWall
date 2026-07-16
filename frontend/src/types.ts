export type TrackStatus = "green" | "yellow" | "safety_car" | "virtual_safety_car" | "red";

export interface Tire {
  compound: string;
  age_laps: number;
}

export interface WeatherSnapshot {
  air_temp: number;
  track_temp: number;
  humidity: number;
  wind_speed: number;
  rainfall: boolean;
}

export interface RaceControlMessage {
  timestamp: string;
  category: string;
  message: string;
  flag: string | null;
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
  lap_number: number | null;
  sector_1_time: number | null;
  sector_2_time: number | null;
  sector_3_time: number | null;
}

export interface SessionState {
  timestamp: string;
  track_status: TrackStatus;
  drivers: DriverState[];
  weather: WeatherSnapshot | null;
  race_control_messages: RaceControlMessage[];
}

export interface AiNote {
  timestamp: string;
  text: string;
}
