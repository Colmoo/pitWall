import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TrackMap } from "./TrackMap";
import type { SessionState } from "../types";

test("fetches and renders the track outline for the given session params", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ points: [[0, 0], [10, 0], [10, 10], [0, 10]] }),
  });

  render(<TrackMap state={null} sessionParams={{ year: 2023, event: "Silverstone", sessionType: "R" }} />);

  await waitFor(() => expect(screen.getByTestId("track-outline")).toBeInTheDocument());
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/session/track-layout"));
});

test("shows a tracing placeholder in live mode until enough position samples arrive", () => {
  render(<TrackMap state={null} sessionParams={null} history={[]} />);
  expect(screen.getByText(/tracing track/i)).toBeInTheDocument();
});

test("traces the track outline from leader positions in live mode without waiting on a fetch", async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ points: [], corners: [], sector_boundaries: [], drs_zones: [] }) });
  const makeState = (x: number, y: number): SessionState => ({
    timestamp: "t",
    track_status: "green",
    drivers: [
      {
        driver_number: "1", abbreviation: "VER", team: "Red Bull", position: 1,
        gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
        tire: { compound: "SOFT", age_laps: 1 }, x, y,
        lap_number: 1, sector_1_time: null, sector_2_time: null, sector_3_time: null,
        micro_sectors: [], flying_lap: null, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
      },
    ],
    weather: null,
    race_control_messages: [],
    team_radio: [],
  });
  const history = [makeState(0, 0), makeState(10, 0), makeState(10, 10)];

  render(<TrackMap state={history[history.length - 1]} sessionParams={null} history={history} />);

  expect(await screen.findByTestId("track-outline")).toBeInTheDocument();
  // the outline itself is traced from live positions, with no wait on the
  // background live-circuit-info fetch (used only for corners/sectors/DRS).
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/session/live/track-layout"));
});

test("plots a dot for each driver with known x/y", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ points: [[0, 0], [10, 10]] }),
  });

  const state: SessionState = {
    timestamp: "t1",
    track_status: "green",
    drivers: [
      {
        driver_number: "1", abbreviation: "VER", team: "Red Bull", position: 1,
        gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
        tire: { compound: "SOFT", age_laps: 1 }, x: 5, y: 5,
        lap_number: 1, sector_1_time: null, sector_2_time: null, sector_3_time: null,
      micro_sectors: [], flying_lap: null, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
      },
    ],
    weather: null,
    race_control_messages: [],
  team_radio: [],
  };

  render(<TrackMap state={state} sessionParams={{ year: 2023, event: "Silverstone", sessionType: "R" }} />);
  await waitFor(() => expect(screen.getByTestId("driver-dot-1")).toBeInTheDocument());
});

test("shows the circuit name from sessionParams below the map", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ points: [[0, 0], [10, 0], [10, 10], [0, 10]] }),
  });

  render(<TrackMap state={null} sessionParams={{ year: 2023, event: "Silverstone", sessionType: "R" }} />);

  await waitFor(() => expect(screen.getByText("Silverstone")).toBeInTheDocument());
});

test("colors the outline by marshal sector when the layout includes distance and boundaries", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      points: [[0, 0, 0], [10, 0, 10], [10, 10, 20], [0, 10, 30]],
      corners: [{ number: 1, x: 5, y: 0 }],
      sector_boundaries: [0, 15, 25],
    }),
  });

  render(<TrackMap state={null} sessionParams={{ year: 2023, event: "Suzuka", sessionType: "R" }} />);

  const outline = await waitFor(() => screen.getByTestId("track-outline"));
  const paths = outline.querySelectorAll("path");
  // 1 dark road-bed path, plus 3 sectors present across the sampled points -> 3
  // distinctly-colored centerline segments on top of it.
  expect(paths.length).toBe(4);
  expect(new Set(Array.from(paths).map((p) => p.getAttribute("stroke"))).size).toBe(4);
  expect(screen.getByText("1")).toBeInTheDocument();
});

test("map layer picker switches between blank, sectors, and micro sectors", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      points: [[0, 0, 0], [10, 0, 10], [10, 10, 20], [0, 10, 30]],
      sector_boundaries: [0, 15, 25],
      micro_sector_boundaries: [0, 5, 15, 22, 28],
    }),
  });

  render(<TrackMap state={null} sessionParams={{ year: 2023, event: "Suzuka", sessionType: "R" }} />);

  const outline = await waitFor(() => screen.getByTestId("track-outline"));
  // defaults to the "Sectors" layer: 1 road path + 3 sector segments.
  expect(outline.querySelectorAll("path").length).toBe(4);

  fireEvent.click(screen.getByRole("radio", { name: "Micro sectors" }));
  // more boundaries -> more segments than the 3-way sector split.
  expect(outline.querySelectorAll("path").length).toBeGreaterThan(4);

  fireEvent.click(screen.getByRole("radio", { name: "Blank" }));
  // no division -> 1 road path + 1 plain-colored segment.
  expect(outline.querySelectorAll("path").length).toBe(2);
});

test("shows a name flag above the selected driver's dot", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ points: [[0, 0], [10, 10]] }),
  });

  const state: SessionState = {
    timestamp: "t1",
    track_status: "green",
    drivers: [
      {
        driver_number: "1", abbreviation: "VER", team: "Red Bull Racing", position: 1,
        gap_to_leader: null, gap_to_ahead: null, last_lap_time: null, best_lap_time: null,
        tire: { compound: "SOFT", age_laps: 1 }, x: 5, y: 5,
        lap_number: 1, sector_1_time: null, sector_2_time: null, sector_3_time: null,
        micro_sectors: [], flying_lap: null, speed: null, throttle: null, brake: null, gear: null, rpm: null, drs: null,
      },
    ],
    weather: null,
    race_control_messages: [],
    team_radio: [],
  };

  render(<TrackMap state={state} sessionParams={{ year: 2023, event: "Silverstone", sessionType: "R" }} selectedDriver="1" />);

  await waitFor(() => expect(screen.getByTestId("selected-driver-flag")).toBeInTheDocument());
  expect(screen.getByTestId("selected-driver-flag")).toHaveTextContent("VER");
});

test("renders a DRS zone overlay when the layout includes drs_zones", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      points: [[0, 0], [10, 0], [10, 10], [0, 10]],
      drs_zones: [{ start_x: 2, start_y: 0, end_x: 8, end_y: 0 }],
    }),
  });

  render(<TrackMap state={null} sessionParams={{ year: 2023, event: "Baku", sessionType: "R" }} />);

  const zone = await waitFor(() => screen.getByTestId("drs-zone"));
  // drawn as its own dashed line offset alongside the track, not on top of it.
  expect(zone.getAttribute("stroke-dasharray")).not.toBeNull();
  const [, y] = zone.getAttribute("d")!.replace("M", "").split(" ")[0].split(",").map(Number);
  expect(y).not.toBe(0); // the track's own points sit at y=0; the offset line does not
});

test("rotates a wide track 90deg to fill a portrait-shaped panel instead of leaving it sideways-cramped", async () => {
  // jsdom has no layout engine, so ResizeObserver is mocked to report a tall,
  // narrow panel (portrait) - the opposite orientation of the wide track below.
  const observe = vi.fn();
  class FakeResizeObserver {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      observe(target);
      this.callback(
        [{ contentRect: { width: 200, height: 800 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);

  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ points: [[0, 0], [100, 0], [100, 10], [0, 10]] }),
  });

  render(<TrackMap state={null} sessionParams={{ year: 2023, event: "Silverstone", sessionType: "R" }} />);

  const outline = await waitFor(() => screen.getByTestId("track-outline"));
  const svg = outline.closest("svg");
  const [, , vbWidth, vbHeight] = svg!.getAttribute("viewBox")!.split(" ").map(Number);
  // rotated to match the portrait panel: viewBox is now taller than it is wide.
  expect(vbHeight).toBeGreaterThan(vbWidth);

  vi.unstubAllGlobals();
});

test("fits the viewBox to the track's own aspect ratio instead of padding it to a blank square", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ points: [[0, 0], [100, 0], [100, 10], [0, 10]] }),
  });

  render(<TrackMap state={null} sessionParams={{ year: 2023, event: "Silverstone", sessionType: "R" }} />);

  const outline = await waitFor(() => screen.getByTestId("track-outline"));
  const svg = outline.closest("svg");
  const [, , vbWidth, vbHeight] = svg!.getAttribute("viewBox")!.split(" ").map(Number);
  // a 100x10 track stays wide (not padded out to a square), so no blank bars.
  expect(vbWidth / vbHeight).toBeGreaterThan(5);
});
