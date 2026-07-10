import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WeatherPanel } from "./WeatherPanel";
import type { SessionState } from "../types";

const stateWithWeather: SessionState = {
  timestamp: "t1",
  track_status: "green",
  race_control_messages: [],
  weather: { air_temp: 22.1, track_temp: 36.2, humidity: 51.0, wind_speed: 2.7, rainfall: false },
  drivers: [],
};

test("shows air/track temp, humidity, and wind", () => {
  render(<WeatherPanel state={stateWithWeather} />);
  expect(screen.getByText("22.1°C")).toBeInTheDocument();
  expect(screen.getByText("36.2°C")).toBeInTheDocument();
  expect(screen.getByText("51%")).toBeInTheDocument();
  expect(screen.getByText("2.7 km/h")).toBeInTheDocument();
});

test("shows unavailable message when there is no weather data (live mode)", () => {
  render(<WeatherPanel state={{ ...stateWithWeather, weather: null }} />);
  expect(screen.getByText(/unavailable in live mode/i)).toBeInTheDocument();
});

test("shows unavailable message when there is no session state yet", () => {
  render(<WeatherPanel state={null} />);
  expect(screen.getByText(/unavailable in live mode/i)).toBeInTheDocument();
});
