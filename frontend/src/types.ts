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
  status: "running" | "out";
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
  best_sector_1_time: number | null;
  best_sector_2_time: number | null;
  best_sector_3_time: number | null;
  speed_i1: number | null;
  speed_i2: number | null;
  speed_fl: number | null;
  speed_st: number | null;
  micro_sectors: string[][];
  flying_lap: boolean | null;
  speed: number | null;
  throttle: number | null;
  brake: boolean | null;
  gear: number | null;
  rpm: number | null;
  drs: boolean | null;
}

export interface TeamRadioClip {
  timestamp: string;
  driver_number: string;
  url: string;
}

export interface SessionState {
  timestamp: string;
  track_status: TrackStatus;
  session_type?: string | null;
  drivers: DriverState[];
  weather: WeatherSnapshot | null;
  race_control_messages: RaceControlMessage[];
  team_radio: TeamRadioClip[];
}

export interface AiNote {
  timestamp: string;
  text: string;
}

export interface AnalysisLap {
  lap: number;
  position: number;
  gap_to_leader: number | null;
  lap_time: number | null;
  sector_1_time: number | null;
  sector_2_time: number | null;
  sector_3_time: number | null;
  compound: string;
  pit: boolean;
}

export interface AnalysisDriver {
  driver_number: string;
  abbreviation: string;
  team: string;
  laps: AnalysisLap[];
}

export interface AnalysisWeather {
  lap: number;
  air_temp: number;
  track_temp: number;
  humidity: number;
  wind_speed: number;
  rainfall: boolean;
}

export interface LapAnalysis {
  total_laps: number;
  sc_vsc_laps: [number, number][];
  weather: AnalysisWeather[];
  drivers: AnalysisDriver[];
}
