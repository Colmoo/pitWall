from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from app.fastf1_adapter import session_states_from_laps


def _laps_df():
    session_start = datetime(2026, 7, 7, 13, 0, tzinfo=timezone.utc)
    rows = [
        # Driver VER: lap 1 then lap 2 (improves best lap)
        dict(Driver="VER", DriverNumber="1", Team="Red Bull", LapNumber=1,
             Position=1.0, LapTime=timedelta(seconds=92.0),
             Time=timedelta(minutes=1, seconds=32), Compound="SOFT", TyreLife=1.0,
             Sector1Time=timedelta(seconds=28.0), Sector2Time=timedelta(seconds=32.0),
             Sector3Time=timedelta(seconds=32.0)),
        dict(Driver="VER", DriverNumber="1", Team="Red Bull", LapNumber=2,
             Position=1.0, LapTime=timedelta(seconds=90.0),
             Time=timedelta(minutes=3, seconds=2), Compound="SOFT", TyreLife=2.0,
             Sector1Time=timedelta(seconds=27.5), Sector2Time=timedelta(seconds=31.5),
             Sector3Time=timedelta(seconds=31.0)),
        # Driver HAM: lap 1 then lap 2
        dict(Driver="HAM", DriverNumber="44", Team="Mercedes", LapNumber=1,
             Position=2.0, LapTime=timedelta(seconds=93.0),
             Time=timedelta(minutes=1, seconds=33), Compound="MEDIUM", TyreLife=1.0,
             Sector1Time=timedelta(seconds=28.5), Sector2Time=timedelta(seconds=32.5),
             Sector3Time=timedelta(seconds=32.0)),
        dict(Driver="HAM", DriverNumber="44", Team="Mercedes", LapNumber=2,
             Position=2.0, LapTime=timedelta(seconds=91.5),
             Time=timedelta(minutes=3, seconds=4, milliseconds=500), Compound="MEDIUM", TyreLife=2.0,
             Sector1Time=pd.NaT, Sector2Time=timedelta(seconds=32.0),
             Sector3Time=timedelta(seconds=31.5)),
    ]
    return pd.DataFrame(rows), session_start


def test_session_states_from_laps_groups_by_lap_number():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    assert len(states) == 2
    assert all(len(s.drivers) == 2 for s in states)


def test_session_states_from_laps_computes_running_best_lap():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    ver_lap1 = next(d for d in states[0].drivers if d.abbreviation == "VER")
    ver_lap2 = next(d for d in states[1].drivers if d.abbreviation == "VER")
    assert ver_lap1.last_lap_time == 92.0
    assert ver_lap1.best_lap_time == 92.0
    assert ver_lap2.last_lap_time == 90.0
    assert ver_lap2.best_lap_time == 90.0  # improved


def test_session_states_from_laps_maps_tire_and_position():
    laps, session_start = _laps_df()
    states = session_states_from_laps(laps, session_start)
    ham_lap1 = next(d for d in states[0].drivers if d.abbreviation == "HAM")
    assert ham_lap1.tire.compound == "MEDIUM"
    assert ham_lap1.tire.age_laps == 1
    assert ham_lap1.position == 2
    assert ham_lap1.driver_number == "44"


def test_session_states_from_laps_skips_nan_lap_time():
    laps, session_start = _laps_df()
    laps.loc[laps["Driver"] == "HAM", "LapTime"] = [pd.NaT, timedelta(seconds=91.5)]
    states = session_states_from_laps(laps, session_start)
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


def test_session_states_from_laps_defaults_age_laps_when_tyre_life_nan():
    laps, session_start = _laps_df()
    laps.loc[(laps["Driver"] == "HAM") & (laps["LapNumber"] == 1), "TyreLife"] = np.nan
    states = session_states_from_laps(laps, session_start)
    ham_lap1 = next(d for d in states[0].drivers if d.abbreviation == "HAM")
    assert ham_lap1.tire.age_laps == 0


def test_session_states_from_laps_best_lap_time_stays_pinned_to_faster_earlier_lap():
    laps, session_start = _laps_df()
    laps.loc[(laps["Driver"] == "VER") & (laps["LapNumber"] == 2), "LapTime"] = timedelta(seconds=95.0)
    states = session_states_from_laps(laps, session_start)
    ver_lap2 = next(d for d in states[1].drivers if d.abbreviation == "VER")
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
    # HAM's lap 2 (index 3 in the fixture rows) has NaT Sector1Time
    ham_lap2 = next(d for d in states[1].drivers if d.abbreviation == "HAM")
    assert ham_lap2.sector_1_time is None
    assert ham_lap2.sector_2_time == 32.0
    assert ham_lap2.sector_3_time == 31.5
