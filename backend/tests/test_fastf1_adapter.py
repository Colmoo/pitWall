from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

import fastf1

from app.fastf1_adapter import attach_car_positions, attach_weather, attach_race_control_messages, attach_track_status, list_events_for_year, list_sessions_for_event, list_supported_years, load_driver_lap_telemetry, load_session_states, load_track_layout, session_states_from_laps, track_layout_from_telemetry, _synthesize_positions
from app.schema import TrackStatus


def _laps_df():
    session_start = datetime(2026, 7, 7, 13, 0, tzinfo=timezone.utc)
    rows = [
        # Driver VER: lap 1 then lap 2 (improves best lap)
        dict(Driver="VER", DriverNumber="1", Team="Red Bull", LapNumber=1,
             Position=1.0, LapTime=timedelta(seconds=92.0),
             Time=timedelta(minutes=1, seconds=32), Compound="SOFT", TyreLife=1.0,
             Sector1Time=timedelta(seconds=28.0), Sector2Time=timedelta(seconds=32.0),
             Sector3Time=timedelta(seconds=32.0), PitOutTime=pd.NaT, PitInTime=pd.NaT),
        dict(Driver="VER", DriverNumber="1", Team="Red Bull", LapNumber=2,
             Position=1.0, LapTime=timedelta(seconds=90.0),
             Time=timedelta(minutes=3, seconds=2), Compound="SOFT", TyreLife=2.0,
             Sector1Time=timedelta(seconds=27.5), Sector2Time=timedelta(seconds=31.5),
             Sector3Time=timedelta(seconds=31.0), PitOutTime=pd.NaT, PitInTime=pd.NaT),
        # Driver HAM: lap 1 then lap 2
        dict(Driver="HAM", DriverNumber="44", Team="Mercedes", LapNumber=1,
             Position=2.0, LapTime=timedelta(seconds=93.0),
             Time=timedelta(minutes=1, seconds=33), Compound="MEDIUM", TyreLife=1.0,
             Sector1Time=timedelta(seconds=28.5), Sector2Time=timedelta(seconds=32.5),
             Sector3Time=timedelta(seconds=32.0), PitOutTime=pd.NaT, PitInTime=pd.NaT),
        dict(Driver="HAM", DriverNumber="44", Team="Mercedes", LapNumber=2,
             Position=2.0, LapTime=timedelta(seconds=91.5),
             Time=timedelta(minutes=3, seconds=4, milliseconds=500), Compound="MEDIUM", TyreLife=2.0,
             Sector1Time=pd.NaT, Sector2Time=timedelta(seconds=32.0),
             Sector3Time=timedelta(seconds=31.5), PitOutTime=pd.NaT, PitInTime=pd.NaT),
    ]
    return pd.DataFrame(rows), session_start


def test_session_states_from_laps_builds_one_state_per_chronological_lap_event():
    # 4 lap-completion events across the session (VER lap1, HAM lap1, VER lap2,
    # HAM lap2, in Time order) -> 4 states, not 2 grouped-by-LapNumber states.
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    assert len(states) == 4
    # First event only has one driver on track with a known state yet.
    assert [d.abbreviation for d in states[0].drivers] == ["VER"]
    # From the second event onward, every currently-known driver carries forward.
    assert all(len(s.drivers) == 2 for s in states[1:])


def test_session_states_from_laps_computes_running_best_lap():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    ver_lap1 = next(d for d in states[0].drivers if d.abbreviation == "VER")
    ver_lap2 = next(d for d in states[2].drivers if d.abbreviation == "VER")
    assert ver_lap1.last_lap_time == 92.0
    assert ver_lap1.best_lap_time == 92.0
    assert ver_lap2.last_lap_time == 90.0
    assert ver_lap2.best_lap_time == 90.0  # improved


def test_session_states_from_laps_computes_running_best_sectors():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    ver_lap2 = next(d for d in states[2].drivers if d.abbreviation == "VER")
    assert (ver_lap2.best_sector_1_time, ver_lap2.best_sector_2_time, ver_lap2.best_sector_3_time) == (27.5, 31.5, 31.0)
    # HAM's lap-2 S1 is NaT: the lap-1 best must survive, and S2/S3 still update.
    ham_lap2 = next(d for d in states[3].drivers if d.abbreviation == "HAM")
    assert ham_lap2.sector_1_time is None
    assert (ham_lap2.best_sector_1_time, ham_lap2.best_sector_2_time, ham_lap2.best_sector_3_time) == (28.5, 32.0, 31.5)


def test_session_states_from_laps_maps_tire_and_position():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    # HAM's lap 1 completes on the second chronological event.
    ham_lap1 = next(d for d in states[1].drivers if d.abbreviation == "HAM")
    assert ham_lap1.tire.compound == "MEDIUM"
    assert ham_lap1.tire.age_laps == 1
    assert ham_lap1.position == 2
    assert ham_lap1.driver_number == "44"


def test_session_states_from_laps_skips_nan_lap_time():
    laps, session_start = _laps_df()
    laps.loc[laps["Driver"] == "HAM", "LapTime"] = [pd.NaT, timedelta(seconds=91.5)]
    states = session_states_from_laps(laps, session_start)
    # HAM's lap 1 event is skipped entirely, so the first state is VER-only.
    lap1_drivers = {d.abbreviation for d in states[0].drivers}
    assert lap1_drivers == {"VER"}
    ver_lap1 = next(d for d in states[0].drivers if d.abbreviation == "VER")
    assert ver_lap1.last_lap_time == 92.0


def test_session_states_from_laps_skips_nan_position():
    laps, session_start = _laps_df()
    laps.loc[(laps["Driver"] == "HAM") & (laps["LapNumber"] == 1), "Position"] = np.nan
    states = session_states_from_laps(laps, session_start)
    lap1_drivers = {d.abbreviation for d in states[0].drivers}
    assert lap1_drivers == {"VER"}


def test_synthesize_positions_ranks_by_best_lap_time_so_far():
    # Practice/Qualifying laps have no official Position (all-NaN) - VER is
    # faster on lap 1 so leads, but HAM's lap 2 undercuts VER's best -> HAM
    # takes over P1 from that point on.
    laps, _ = _laps_df()
    laps["Position"] = float("nan")
    laps.loc[(laps["Driver"] == "HAM") & (laps["LapNumber"] == 2), "LapTime"] = timedelta(seconds=85.0)
    positions = _synthesize_positions(laps)
    ver_lap1_idx = laps[(laps["Driver"] == "VER") & (laps["LapNumber"] == 1)].index[0]
    ham_lap1_idx = laps[(laps["Driver"] == "HAM") & (laps["LapNumber"] == 1)].index[0]
    ham_lap2_idx = laps[(laps["Driver"] == "HAM") & (laps["LapNumber"] == 2)].index[0]
    assert positions[ver_lap1_idx] == 1
    assert positions[ham_lap1_idx] == 2
    assert positions[ham_lap2_idx] == 1


def test_load_session_states_falls_back_to_synthesized_positions(monkeypatch):
    # Regression test for practice/qualifying sessions, where FastF1 never
    # populates Position, so every lap used to get filtered out and the
    # replay produced zero states.
    laps, session_start = _laps_df()
    laps["Position"] = float("nan")

    class FakeSession:
        def __init__(self):
            self.laps = laps
            self.date = pd.Timestamp(session_start)
            self.t0_date = pd.Timestamp(session_start)
            self.weather_data = pd.DataFrame(columns=["Time", "AirTemp", "TrackTemp", "Humidity", "WindSpeed", "Rainfall"])
            self.race_control_messages = pd.DataFrame(columns=["Time", "Category", "Message", "Flag"])
            self.pos_data = {}

    monkeypatch.setattr("app.fastf1_adapter.get_or_load_session", lambda *args, **kwargs: FakeSession())
    states = load_session_states(year=2026, event="Test GP", session_type="FP1", cache_dir="/tmp")
    assert len(states) == 4
    assert all(d.position is not None for s in states for d in s.drivers)


def test_load_session_states_fills_partial_nan_positions_in_race(monkeypatch):
    # Regression test: real races can leave Position NaN for just the opening
    # lap(s) (timing system settling after the start) while later laps have
    # real Position - this used to only get filled when the *whole* column
    # was NaN (FP/Q), so those opening laps were silently dropped and replay
    # appeared to start partway into the race.
    laps, session_start = _laps_df()
    laps.loc[laps["LapNumber"] == 1, "Position"] = np.nan

    class FakeSession:
        def __init__(self):
            self.laps = laps
            self.date = pd.Timestamp(session_start)
            self.t0_date = pd.Timestamp(session_start)
            self.weather_data = pd.DataFrame(columns=["Time", "AirTemp", "TrackTemp", "Humidity", "WindSpeed", "Rainfall"])
            self.race_control_messages = pd.DataFrame(columns=["Time", "Category", "Message", "Flag"])
            self.pos_data = {}

    monkeypatch.setattr("app.fastf1_adapter.get_or_load_session", lambda *args, **kwargs: FakeSession())
    states = load_session_states(year=2026, event="Test GP", session_type="R", cache_dir="/tmp")
    assert len(states) == 4
    lap1_drivers = {d.abbreviation for d in states[0].drivers}
    assert lap1_drivers == {"VER"}


def test_session_states_from_laps_carries_forward_driver_skipped_from_early_state():
    # HAM's lap 1 has a NaN Position and is skipped, so HAM is absent from the
    # early states - but HAM's later, valid lap 2 should still show up with
    # correct data once it's chronologically reached.
    laps, session_start = _laps_df()
    laps.loc[(laps["Driver"] == "HAM") & (laps["LapNumber"] == 1), "Position"] = np.nan
    states = session_states_from_laps(laps, session_start)
    final_drivers = {d.abbreviation for d in states[-1].drivers}
    assert final_drivers == {"VER", "HAM"}
    ham_final = next(d for d in states[-1].drivers if d.abbreviation == "HAM")
    assert ham_final.last_lap_time == 91.5
    assert ham_final.position == 2
    assert ham_final.lap_number == 2


def test_session_states_from_laps_defaults_age_laps_when_tyre_life_nan():
    laps, session_start = _laps_df()
    laps.loc[(laps["Driver"] == "HAM") & (laps["LapNumber"] == 1), "TyreLife"] = np.nan
    states = session_states_from_laps(laps, session_start)
    ham_lap1 = next(d for d in states[1].drivers if d.abbreviation == "HAM")
    assert ham_lap1.tire.age_laps == 0


def test_session_states_from_laps_best_lap_time_stays_pinned_to_faster_earlier_lap():
    laps, session_start = _laps_df()
    laps.loc[(laps["Driver"] == "VER") & (laps["LapNumber"] == 2), "LapTime"] = timedelta(seconds=95.0)
    states = session_states_from_laps(laps, session_start)
    ver_lap2 = next(d for d in states[2].drivers if d.abbreviation == "VER")
    assert ver_lap2.last_lap_time == 95.0
    assert ver_lap2.best_lap_time == 92.0  # stays pinned to lap 1, the faster lap


def test_session_states_from_laps_includes_lap_number_and_sector_times():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    ver_lap1 = next(d for d in states[0].drivers if d.abbreviation == "VER")
    assert ver_lap1.lap_number == 1
    assert ver_lap1.sector_1_time == 28.0
    assert ver_lap1.sector_2_time == 32.0
    assert ver_lap1.sector_3_time == 32.0


def test_session_states_from_laps_handles_missing_sector_time():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    # HAM's lap 2 (final chronological event) has NaT Sector1Time
    ham_lap2 = next(d for d in states[-1].drivers if d.abbreviation == "HAM")
    assert ham_lap2.sector_1_time is None
    assert ham_lap2.sector_2_time == 32.0
    assert ham_lap2.sector_3_time == 31.5


def test_session_states_from_laps_sets_flying_lap_false_for_pit_out_or_in_laps():
    laps, session_start = _laps_df()
    laps.loc[(laps["Driver"] == "VER") & (laps["LapNumber"] == 1), "PitOutTime"] = timedelta(seconds=1)
    laps.loc[(laps["Driver"] == "HAM") & (laps["LapNumber"] == 2), "PitInTime"] = timedelta(minutes=3, seconds=4)
    states = session_states_from_laps(laps, session_start)

    ver_lap1 = next(d for d in states[0].drivers if d.abbreviation == "VER")
    assert ver_lap1.flying_lap is False  # out-lap

    ver_lap2 = next(d for d in states[2].drivers if d.abbreviation == "VER")
    assert ver_lap2.flying_lap is True  # ordinary flying lap, no pit columns set

    ham_lap2 = next(d for d in states[-1].drivers if d.abbreviation == "HAM")
    assert ham_lap2.flying_lap is False  # in-lap (box)


def test_track_layout_from_telemetry_downsamples_to_requested_points():
    telemetry = pd.DataFrame({
        "X": [float(i) for i in range(300)],
        "Y": [float(i) * 2 for i in range(300)],
    })
    layout = track_layout_from_telemetry(telemetry, num_points=50)
    assert len(layout) <= 50
    assert len(layout) > 0
    assert all(len(point) == 2 for point in layout)


def test_track_layout_from_telemetry_preserves_point_order():
    telemetry = pd.DataFrame({"X": [0.0, 1.0, 2.0, 3.0], "Y": [0.0, 1.0, 2.0, 3.0]})
    layout = track_layout_from_telemetry(telemetry, num_points=4)
    assert layout[0] == [0.0, 0.0]
    assert layout[-1][0] <= 3.0


def test_track_layout_from_telemetry_handles_fewer_points_than_requested():
    telemetry = pd.DataFrame({"X": [0.0, 1.0, 2.0], "Y": [0.0, 1.0, 2.0]})
    layout = track_layout_from_telemetry(telemetry, num_points=150)
    assert len(layout) == 3


def test_track_layout_from_telemetry_appends_extra_columns():
    telemetry = pd.DataFrame({"X": [0.0, 1.0], "Y": [0.0, 1.0], "Distance": [0.0, 12.5]})
    layout = track_layout_from_telemetry(telemetry, num_points=2, extra_columns=["Distance"])
    assert layout == [[0.0, 0.0, 0.0], [1.0, 1.0, 12.5]]


def test_load_track_layout_includes_corners_and_sector_boundaries(monkeypatch):
    telemetry = pd.DataFrame({"X": [0.0, 1.0, 2.0], "Y": [0.0, 1.0, 2.0], "Distance": [0.0, 100.0, 200.0]})

    class FakeLap:
        # LapTime=100s, split 30/40/30 across the 3 timing sectors.
        _data = {"LapTime": timedelta(seconds=100), "Sector1Time": timedelta(seconds=30), "Sector2Time": timedelta(seconds=40)}

        def get_telemetry(self):
            return telemetry

        def __getitem__(self, key):
            return self._data[key]

    class FakeLaps:
        def pick_fastest(self):
            return FakeLap()

    class FakeCircuitInfo:
        corners = pd.DataFrame([
            {"Number": 1, "X": 5.0, "Y": 5.0, "Angle": 90.0},
            {"Number": 2, "X": 15.0, "Y": 15.0, "Angle": 180.0},
        ])
        marshal_sectors = pd.DataFrame([{"Number": 1, "Distance": 0.0}, {"Number": 2, "Distance": 90.0}, {"Number": 3, "Distance": 150.0}])

    class FakeSession:
        laps = FakeLaps()

        def get_circuit_info(self):
            return FakeCircuitInfo()

    monkeypatch.setattr("app.fastf1_adapter.get_or_load_session", lambda *args, **kwargs: FakeSession())

    layout = load_track_layout(year=2026, event="Suzuka", session_type="R", cache_dir="/tmp/x")

    assert layout["points"] == [[0.0, 0.0, 0.0], [1.0, 1.0, 100.0], [2.0, 2.0, 200.0]]
    assert layout["corners"] == [
        {"number": 1, "x": 5.0, "y": 5.0, "angle": 90.0},
        {"number": 2, "x": 15.0, "y": 15.0, "angle": 180.0},
    ]
    # 30% and 70% of the fastest lap's total distance (200) - splits it into
    # exactly 3 real timing sectors, not FastF1's much finer marshal sectors.
    assert layout["sector_boundaries"] == [60.0, 140.0]
    # marshal sectors are kept separately as the finer-grained "micro sectors" layer.
    assert layout["micro_sector_boundaries"] == [0.0, 90.0, 150.0]
    assert layout["drs_zones"] == []  # fixture telemetry has no DRS column


def test_load_track_layout_approximates_drs_zones_from_open_drs_spans(monkeypatch):
    # DRS opens (>=10) from Distance 100 to 300 - a real zone, kept - then blips
    # open for one sample around Distance 520 - noise, dropped as too short.
    telemetry = pd.DataFrame({
        "X": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
        "Y": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        "Distance": [0.0, 100.0, 200.0, 300.0, 400.0, 500.0, 520.0],
        "DRS": [0, 12, 12, 12, 0, 0, 12],
    })

    class FakeLap:
        def get_telemetry(self):
            return telemetry

    class FakeLaps:
        def pick_fastest(self):
            return FakeLap()

    class FakeSession:
        laps = FakeLaps()

        def get_circuit_info(self):
            return None

    monkeypatch.setattr("app.fastf1_adapter.get_or_load_session", lambda *args, **kwargs: FakeSession())

    layout = load_track_layout(year=2026, event="Suzuka", session_type="R", cache_dir="/tmp/x")

    assert layout["drs_zones"] == [{"start_x": 1.0, "start_y": 0.0, "end_x": 3.0, "end_y": 0.0}]
    # fastest lap here has no sector-time data at all (FakeLap isn't subscriptable) -
    # degrades to an undivided outline instead of crashing.
    assert layout["sector_boundaries"] == []


def test_load_track_layout_degrades_sector_boundaries_when_fastest_lap_has_no_sector_times(monkeypatch):
    # A red-flagged or otherwise incomplete "fastest" lap can have NaT sector
    # times - total_seconds() on NaT is NaN, not an exception, so this must be
    # guarded explicitly rather than relying on a try/except to catch it.
    telemetry = pd.DataFrame({"X": [0.0, 1.0], "Y": [0.0, 1.0], "Distance": [0.0, 100.0]})

    class FakeLap:
        _data = {"LapTime": pd.NaT, "Sector1Time": pd.NaT, "Sector2Time": pd.NaT}

        def get_telemetry(self):
            return telemetry

        def __getitem__(self, key):
            return self._data[key]

    class FakeLaps:
        def pick_fastest(self):
            return FakeLap()

    class FakeSession:
        laps = FakeLaps()

        def get_circuit_info(self):
            return None

    monkeypatch.setattr("app.fastf1_adapter.get_or_load_session", lambda *args, **kwargs: FakeSession())

    layout = load_track_layout(year=2026, event="Suzuka", session_type="R", cache_dir="/tmp/x")

    assert layout["sector_boundaries"] == []


def test_session_states_from_laps_computes_gap_to_leader_and_ahead():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)

    # state[0]: only VER known yet -> no gaps to compute.
    ver_only = next(d for d in states[0].drivers if d.abbreviation == "VER")
    assert ver_only.gap_to_leader is None
    assert ver_only.gap_to_ahead is None

    # state[1]: HAM's lap 1 just completed, VER still on its lap-1 snapshot.
    ver_lap1 = next(d for d in states[1].drivers if d.abbreviation == "VER")
    ham_lap1 = next(d for d in states[1].drivers if d.abbreviation == "HAM")
    assert ver_lap1.gap_to_leader is None  # leader has no gap
    assert ham_lap1.gap_to_leader == pytest.approx(1.0)  # HAM Time 1:33 - VER Time 1:32
    assert ham_lap1.gap_to_ahead == pytest.approx(1.0)   # only VER ahead

    # state[2]: VER has posted lap 2, HAM is still on lap 1. HAM's gap is measured
    # at HAM's lap (1:33 - VER's lap-1 1:32), never against VER's lap-2 crossing
    # (which would come out at -89s).
    ham_behind = next(d for d in states[2].drivers if d.abbreviation == "HAM")
    assert ham_behind.gap_to_leader == pytest.approx(1.0)
    assert ham_behind.gap_to_ahead == pytest.approx(1.0)

    # state[-1]: both drivers have posted lap 2 -> gaps reflect lap-2 times.
    ver_lap2 = next(d for d in states[-1].drivers if d.abbreviation == "VER")
    ham_lap2 = next(d for d in states[-1].drivers if d.abbreviation == "HAM")
    assert ver_lap2.gap_to_leader is None
    assert ham_lap2.gap_to_leader == pytest.approx(2.5)  # HAM Time 3:04.5 - VER Time 3:02


def test_attach_weather_picks_nearest_sample_by_elapsed_time():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    weather_data = pd.DataFrame([
        dict(Time=timedelta(seconds=90), AirTemp=22.0, TrackTemp=35.0, Humidity=50.0, WindSpeed=2.0, Rainfall=False),
        dict(Time=timedelta(seconds=185), AirTemp=23.0, TrackTemp=37.0, Humidity=48.0, WindSpeed=3.0, Rainfall=False),
    ])

    attach_weather(states, weather_data, session_start)

    # HAM's lap 1 event (states[1]) is at elapsed 93s -> distance to 90s is 3, distance to 185s is 92 -> picks 90s sample
    assert states[1].weather.air_temp == 22.0
    # HAM's lap 2 event (states[-1]) is at elapsed 184.5s -> distance to 90s is 94.5, distance to 185s is 0.5 -> picks 185s sample
    assert states[-1].weather.air_temp == 23.0
    assert states[-1].weather.rainfall is False


def test_attach_weather_handles_empty_weather_data():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    attach_weather(states, pd.DataFrame(columns=["Time", "AirTemp", "TrackTemp", "Humidity", "WindSpeed", "Rainfall"]), session_start)
    assert states[0].weather is None


def test_attach_track_status_applies_flag_in_effect_at_each_state():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    track_status_data = pd.DataFrame([
        dict(Time=timedelta(seconds=0), Status="1"),
        dict(Time=timedelta(seconds=95), Status="2"),  # yellow flag right after HAM's lap 1 (93s)
        dict(Time=timedelta(seconds=182), Status="4"),  # SC right before VER's lap 2 (182s)
    ])

    attach_track_status(states, track_status_data, session_start)

    assert states[0].track_status == TrackStatus.GREEN  # VER lap1 @ 92s, before the yellow
    assert states[1].track_status == TrackStatus.GREEN  # HAM lap1 @ 93s, still before the yellow
    assert states[2].track_status == TrackStatus.SC  # VER lap2 @ 182s, at the SC event
    assert states[3].track_status == TrackStatus.SC  # HAM lap2 @ 184.5s, still under SC


def test_attach_track_status_handles_empty_data():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    attach_track_status(states, pd.DataFrame(columns=["Time", "Status"]), session_start)
    assert all(s.track_status == TrackStatus.GREEN for s in states)


def test_attach_race_control_messages_only_includes_messages_up_to_timestamp():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    # states[0].timestamp = session_start + 1:32 (92s), states[-1].timestamp = session_start + 3:04.5 (184.5s)
    rcm = pd.DataFrame([
        dict(Time=session_start + timedelta(seconds=30), Category="Other", Message="PIT EXIT OPEN", Flag=None),
        dict(Time=session_start + timedelta(minutes=3), Category="Flag", Message="YELLOW FLAG", Flag="YELLOW"),
    ])

    attach_race_control_messages(states, rcm)

    assert len(states[0].race_control_messages) == 1
    assert states[0].race_control_messages[0].message == "PIT EXIT OPEN"
    assert len(states[-1].race_control_messages) == 2
    assert states[-1].race_control_messages[1].flag == "YELLOW"


def test_attach_race_control_messages_shares_message_objects_across_states():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    rcm = pd.DataFrame([
        dict(Time=session_start + timedelta(seconds=30), Category="Other", Message="PIT EXIT OPEN", Flag=None),
        dict(Time=session_start + timedelta(minutes=3), Category="Flag", Message="YELLOW FLAG", Flag="YELLOW"),
    ])

    attach_race_control_messages(states, rcm)

    # Built once, shared by slice - fails if anyone reverts to rebuilding per state.
    assert states[0].race_control_messages[0] is states[-1].race_control_messages[0]


def test_load_driver_lap_telemetry_returns_traces(monkeypatch):
    car_data = pd.DataFrame({
        "Distance": [0.0, 10.0, 20.0],
        "Speed": [250, 260, 270],
        "Throttle": [100, 100, 80],
        "Brake": [False, False, True],
        "nGear": [6, 6, 5],
        "RPM": [11000, 11200, 10800],
    })

    class FakeLapRow:
        def get_car_data(self):
            class Result:
                def add_distance(self_inner):
                    return car_data
            return Result()

    class FakeDriverLaps:
        empty = False
        iloc = [FakeLapRow()]

    class FakeLaps:
        def pick_drivers(self, driver):
            assert driver == "1"
            return self

        def pick_laps(self, lap_number):
            assert lap_number == 5
            return FakeDriverLaps()

    class FakeSession:
        laps = FakeLaps()

    monkeypatch.setattr("app.fastf1_adapter.get_or_load_session", lambda **kwargs: FakeSession())

    result = load_driver_lap_telemetry(
        year=2023, event="British Grand Prix", session_type="R", driver="1", lap_number=5, cache_dir="/tmp/x",
    )
    assert result["distance"] == [0.0, 10.0, 20.0]
    assert result["speed"] == [250, 260, 270]
    assert result["brake"] == [False, False, True]
    assert result["gear"] == [6, 6, 5]


def test_load_driver_lap_telemetry_returns_empty_when_lap_not_found(monkeypatch):
    class FakeDriverLaps:
        empty = True

    class FakeLaps:
        def pick_drivers(self, driver):
            return self

        def pick_laps(self, lap_number):
            return FakeDriverLaps()

    class FakeSession:
        laps = FakeLaps()

    monkeypatch.setattr("app.fastf1_adapter.get_or_load_session", lambda **kwargs: FakeSession())

    result = load_driver_lap_telemetry(
        year=2023, event="British Grand Prix", session_type="R", driver="99", lap_number=1, cache_dir="/tmp/x",
    )
    assert result == {"distance": [], "speed": [], "throttle": [], "brake": [], "gear": [], "rpm": []}


def test_load_driver_lap_telemetry_returns_empty_when_car_data_not_loaded(monkeypatch):
    # Regression test: very recent/in-progress sessions can have lap timing
    # published before car telemetry is, which used to 500 the endpoint.
    class FakeLapRow:
        def get_car_data(self):
            raise fastf1.core.DataNotLoadedError("car_data not loaded")

    class FakeDriverLaps:
        empty = False
        iloc = [FakeLapRow()]

    class FakeLaps:
        def pick_drivers(self, driver):
            return self

        def pick_laps(self, lap_number):
            return FakeDriverLaps()

    class FakeSession:
        laps = FakeLaps()

    monkeypatch.setattr("app.fastf1_adapter.get_or_load_session", lambda **kwargs: FakeSession())

    result = load_driver_lap_telemetry(
        year=2026, event="Belgian Grand Prix", session_type="R", driver="30", lap_number=5, cache_dir="/tmp/x",
    )
    assert result == {"distance": [], "speed": [], "throttle": [], "brake": [], "gear": [], "rpm": []}


def test_load_session_states_degrades_to_no_positions_when_pos_data_not_loaded(monkeypatch):
    fake_laps, session_start = _laps_df()

    class FakeSession:
        date = pd.Timestamp(session_start)
        t0_date = pd.Timestamp(session_start)
        laps = fake_laps
        weather_data = pd.DataFrame(columns=["Time"])
        race_control_messages = pd.DataFrame(columns=["Time", "Category", "Message", "Flag"])

        @property
        def pos_data(self):
            raise fastf1.core.DataNotLoadedError("pos_data not loaded")

    monkeypatch.setattr("app.fastf1_adapter.get_or_load_session", lambda *args, **kwargs: FakeSession())

    states = load_session_states(year=2026, event="Monaco Grand Prix", session_type="R", cache_dir="/tmp/x")

    assert len(states) == 4
    assert all(driver.x is None and driver.y is None for state in states for driver in state.drivers)


def test_attach_car_positions_inserts_ticks_between_lap_events_for_smooth_movement():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    assert len(states) == 4  # one per lap-completion event, ~90s apart

    # VER position telemetry sampled every ~30s, moving in a straight line on X.
    ver_pos = pd.DataFrame({
        "Time": [timedelta(seconds=s) for s in range(0, 200, 30)],
        "X": [float(s) for s in range(0, 200, 30)],
        "Y": [0.0 for _ in range(0, 200, 30)],
    })
    ham_pos = pd.DataFrame({
        "Time": [timedelta(seconds=s) for s in range(0, 200, 30)],
        "X": [float(s) for s in range(0, 200, 30)],
        "Y": [1.0 for _ in range(0, 200, 30)],
    })
    pos_data = {"1": ver_pos, "44": ham_pos}

    expanded = attach_car_positions(states, pos_data, session_start, tick_seconds=1.0)

    # ~90s between VER's two lap events => roughly that many 1s ticks inserted.
    assert len(expanded) > len(states)
    # every state (original and inserted) got a position for VER.
    assert all(
        any(d.driver_number == "1" and d.x is not None for d in s.drivers) for s in expanded
    )
    # timestamps are strictly increasing and evenly spaced by ~1s between originals.
    timestamps = [pd.Timestamp(s.timestamp) for s in expanded]
    assert timestamps == sorted(timestamps)
    # inserted ticks carry forward the last lap-event's timing/gap data untouched.
    mid = expanded[1]
    assert mid.drivers[0].lap_number == states[0].drivers[0].lap_number


def test_attach_car_positions_shallow_copy_interpolates_without_corrupting_originals():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)

    # VER moving straight along X, sampled every second so the nearest-sample x
    # at any (integer) tick time equals that time exactly - lets us assert the
    # interpolated position precisely.
    ver_pos = pd.DataFrame({
        "Time": [timedelta(seconds=s) for s in range(0, 200)],
        "X": [float(s) for s in range(0, 200)],
        "Y": [0.0 for _ in range(0, 200)],
    })
    original_states = list(states)  # identities of the lap-event states
    expanded = attach_car_positions(states, {"1": ver_pos}, session_start, tick_seconds=10.0)

    def ver(state):
        return next(d for d in state.drivers if d.driver_number == "1")

    # Every state (original or inserted tick) carries its OWN interpolated x for
    # its own timestamp - proving inserted ticks weren't just a stale copy of the
    # previous state's position (the shallow copy still gives each tick fresh x/y).
    for state in expanded:
        elapsed = (pd.Timestamp(state.timestamp) - pd.Timestamp(session_start)).total_seconds()
        # nearest 1s telemetry sample => within half a second of the true time.
        assert abs(ver(state).x - elapsed) <= 0.5

    # First lap-event state stays put at its own time; later ticks didn't mutate it.
    assert ver(original_states[0]).x == 92.0

    # Inserted ticks are DISTINCT driver objects (so mutating x/y never corrupted
    # the originals) yet SHARE unchanged nested data by reference (shallow, not
    # deep, copy) - that's the whole point of the lighter path.
    ticks = [s for s in expanded if s not in original_states]
    assert ticks, "expected intermediate ticks to be inserted"
    assert all(ver(t) is not ver(original_states[0]) for t in ticks)
    assert all(ver(t).tire is ver(original_states[0]).tire for t in ticks)


def test_attach_car_positions_is_a_noop_when_pos_data_empty():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    result = attach_car_positions(states, {}, session_start)
    assert result is states
    assert len(result) == 4


def test_list_supported_years_starts_at_2018_and_ends_at_current_year():
    years = list_supported_years()
    assert years[0] == 2018
    assert years[-1] == datetime.now().year


def test_list_events_for_year_returns_event_names_in_round_order(monkeypatch, tmp_path):
    monkeypatch.setattr("app.fastf1_adapter._schedule_cache", {})
    schedule = pd.DataFrame([
        dict(RoundNumber=2, EventName="Saudi Arabian Grand Prix"),
        dict(RoundNumber=1, EventName="Bahrain Grand Prix"),
    ])
    monkeypatch.setattr("app.fastf1_adapter.fastf1.get_event_schedule", lambda year, include_testing: schedule)
    events = list_events_for_year(year=2023, cache_dir=str(tmp_path))
    assert events == ["Bahrain Grand Prix", "Saudi Arabian Grand Prix"]


def test_list_sessions_for_event_returns_non_null_session_names_in_order(monkeypatch, tmp_path):
    monkeypatch.setattr("app.fastf1_adapter._schedule_cache", {})
    schedule = pd.DataFrame([
        dict(
            RoundNumber=1, EventName="Bahrain Grand Prix",
            Session1="Practice 1", Session2="Practice 2", Session3="Practice 3",
            Session4="Qualifying", Session5="Race",
        ),
        dict(
            RoundNumber=4, EventName="Azerbaijan Grand Prix",
            Session1="Practice 1", Session2="Qualifying", Session3="Sprint Shootout",
            Session4="Sprint", Session5="Race",
        ),
    ])
    monkeypatch.setattr("app.fastf1_adapter.fastf1.get_event_schedule", lambda year, include_testing: schedule)

    bahrain_sessions = list_sessions_for_event(year=2023, event="Bahrain Grand Prix", cache_dir=str(tmp_path))
    assert bahrain_sessions == ["Practice 1", "Practice 2", "Practice 3", "Qualifying", "Race"]

    baku_sessions = list_sessions_for_event(year=2023, event="Azerbaijan Grand Prix", cache_dir=str(tmp_path))
    assert baku_sessions == ["Practice 1", "Qualifying", "Sprint Shootout", "Sprint", "Race"]


def test_list_sessions_for_event_returns_empty_for_unknown_event(monkeypatch, tmp_path):
    monkeypatch.setattr("app.fastf1_adapter._schedule_cache", {})
    schedule = pd.DataFrame([dict(RoundNumber=1, EventName="Bahrain Grand Prix", Session1="Race", Session2=None, Session3=None, Session4=None, Session5=None)])
    monkeypatch.setattr("app.fastf1_adapter.fastf1.get_event_schedule", lambda year, include_testing: schedule)
    assert list_sessions_for_event(year=2023, event="Nonexistent Grand Prix", cache_dir=str(tmp_path)) == []
