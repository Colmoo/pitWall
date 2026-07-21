import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TireStrategy } from "./TireStrategy";
import type { SessionState } from "../types";

function driverTick(lap: number, compound: string): SessionState {
  return {
    timestamp: `t${lap}`,
    track_status: "green",
    drivers: [
      {
        driver_number: "1", abbreviation: "VER", team: "Red Bull", position: 1,
        gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
        tire: { compound, age_laps: 1 }, x: null, y: null,
        lap_number: lap, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      micro_sectors: [], flying_lap: null, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
      },
    ],
    weather: null,
    race_control_messages: [],
  team_radio: [],
  };
}

test("collapses consecutive same-compound laps into one stint", () => {
  const history = [driverTick(1, "SOFT"), driverTick(2, "SOFT"), driverTick(3, "SOFT")];
  render(<TireStrategy history={history} />);
  expect(screen.getByTestId("stint-1-SOFT-1-3")).toBeInTheDocument();
});

test("splits into multiple stints on a compound change", () => {
  const history = [driverTick(1, "SOFT"), driverTick(2, "SOFT"), driverTick(3, "MEDIUM")];
  render(<TireStrategy history={history} />);
  expect(screen.getByTestId("stint-1-SOFT-1-2")).toBeInTheDocument();
  expect(screen.getByTestId("stint-1-MEDIUM-3-3")).toBeInTheDocument();
});

test("shows a placeholder when there is no history yet", () => {
  render(<TireStrategy history={[]} />);
  expect(screen.getByText(/waiting for session data/i)).toBeInTheDocument();
});

test("colors each stint segment by tire compound", () => {
  const history = [driverTick(1, "SOFT"), driverTick(2, "SOFT")];
  render(<TireStrategy history={history} />);
  const segment = screen.getByTestId("stint-1-SOFT-1-2");
  expect(segment).toHaveStyle({ background: "#e10600" });
});

test("shows the start and end lap on each stint", () => {
  const history = [driverTick(1, "SOFT"), driverTick(2, "SOFT"), driverTick(3, "MEDIUM")];
  render(<TireStrategy history={history} />);
  expect(screen.getByTestId("stint-1-SOFT-1-2")).toHaveTextContent("1-2");
  expect(screen.getByTestId("stint-1-MEDIUM-3-3")).toHaveTextContent("3");
});

test("shows a distinct background for laps not yet run by a driver", () => {
  const laggingDriver = { ...driverTick(1, "SOFT").drivers[0], driver_number: "44" };
  const history = [
    { ...driverTick(3, "SOFT"), drivers: [...driverTick(3, "SOFT").drivers, laggingDriver] },
  ];
  render(<TireStrategy history={history} />);
  expect(document.querySelector(".pitwall-tire-remaining")).toBeInTheDocument();
});
