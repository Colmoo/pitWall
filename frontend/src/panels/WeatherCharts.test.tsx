import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WeatherHistoryChart, WeatherImpactChart } from "./WeatherCharts";
import type { LapAnalysis } from "../types";

function lap(l: number, lapTime: number | null) {
  return {
    lap: l, position: 1, gap_to_leader: null, lap_time: lapTime, pit: false,
    sector_1_time: null, sector_2_time: null, sector_3_time: null, compound: "SOFT",
  };
}

const analysis: LapAnalysis = {
  total_laps: 3,
  sc_vsc_laps: [],
  weather: [
    { lap: 1, air_temp: 22, track_temp: 40, humidity: 30, wind_speed: 2, rainfall: false },
    { lap: 2, air_temp: 23, track_temp: 42, humidity: 28, wind_speed: 3, rainfall: true },
    { lap: 3, air_temp: 23, track_temp: 43, humidity: 27, wind_speed: 3, rainfall: false },
  ],
  drivers: [
    { driver_number: "1", abbreviation: "VER", team: "Red Bull Racing", laps: [lap(1, 90.0), lap(2, 91.0), lap(3, 90.5)] },
    { driver_number: "44", abbreviation: "HAM", team: "Mercedes", laps: [lap(1, 90.4), lap(2, 91.4), lap(3, 90.9)] },
  ],
};

test("weather history draws track and air temp lines plus a rain band", () => {
  render(<WeatherHistoryChart analysis={analysis} selectedDriver={null} />);
  expect(screen.getByTestId("weather-history-chart")).toBeInTheDocument();
  expect(screen.getByTestId("track-temp-line")).toBeInTheDocument();
  expect(screen.getByTestId("air-temp-line")).toBeInTheDocument();
  expect(screen.getAllByTestId("rain-band").length).toBe(1);
});

test("weather impact plots one point per lap with median pace", () => {
  render(<WeatherImpactChart analysis={analysis} selectedDriver={null} />);
  expect(screen.getByTestId("weather-impact-chart")).toBeInTheDocument();
  expect(screen.getAllByTestId("impact-point").length).toBe(3);
});

test("weather views show a message when there is no weather data", () => {
  render(<WeatherHistoryChart analysis={{ ...analysis, weather: [] }} selectedDriver={null} />);
  expect(screen.getByText(/no weather data/i)).toBeInTheDocument();
});
