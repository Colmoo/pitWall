import { useEffect, useState } from "react";
import "./App.css";
import { useSessionSocket } from "./api/useSessionSocket";
import { LandingPage } from "./panels/LandingPage";
import { TimingTower } from "./panels/TimingTower";
import { TrackMap } from "./panels/TrackMap";
import { TireStrategy } from "./panels/TireStrategy";
import { SectorTimes } from "./panels/SectorTimes";
import { OverviewPanel } from "./panels/OverviewPanel";
import { useAiNotes } from "./api/useAiNotes";
import { RaceEngineerNotes } from "./panels/RaceEngineerNotes";
import { AiChat } from "./panels/AiChat";
import { SelectedDriverCard } from "./panels/SelectedDriverCard";
import { GapTrendChart } from "./panels/GapTrendChart";
import { TelemetryStack } from "./panels/TelemetryStack";
import { WeatherPanel } from "./panels/WeatherPanel";

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8000/ws/session";
const AI_NOTES_WS_URL = import.meta.env.VITE_BACKEND_AI_NOTES_WS_URL ?? "ws://localhost:8000/ws/ai-notes";

export default function App() {
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionParams, setSessionParams] = useState<{ year: number; event: string; sessionType: string } | null>(null);
  const history = useSessionSocket(WS_URL, sessionParams);
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const notes = useAiNotes(AI_NOTES_WS_URL);

  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);

  useEffect(() => {
    if (selectedDriver === null && latest && latest.drivers.length > 0) {
      setSelectedDriver(latest.drivers[0].driver_number);
    }
  }, [latest, selectedDriver]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!latest || latest.drivers.length === 0) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const sorted = [...latest.drivers].sort((a, b) => a.position - b.position);
      const currentIndex = sorted.findIndex((d) => d.driver_number === selectedDriver);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const nextIndex = Math.min(Math.max(currentIndex + delta, 0), sorted.length - 1);
      setSelectedDriver(sorted[nextIndex].driver_number);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [latest, selectedDriver]);

  if (!sessionStarted) {
    return (
      <LandingPage
        onReplayStarted={(params) => {
          setSessionParams(params);
          setSessionStarted(true);
        }}
        onLiveStarted={() => setSessionStarted(true)}
      />
    );
  }

  return (
    <div>
      <header className="pitwall-header">
        <h1>PitWall</h1>
      </header>
      <main className="pitwall-grid">
        <div className="pitwall-sidebar-left">
          <OverviewPanel state={latest} />
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Tire Strategy</div>
            <TireStrategy history={history} />
          </div>
        </div>
        <div className="pitwall-center">
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Timing Tower</div>
            <TimingTower state={latest} selectedDriver={selectedDriver} onSelectDriver={setSelectedDriver} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Sector Times</div>
            <SectorTimes state={latest} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Gap Trend (to Leader)</div>
            <GapTrendChart history={history} selectedDriver={selectedDriver} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Telemetry</div>
            <TelemetryStack sessionParams={sessionParams} state={latest} selectedDriver={selectedDriver} />
          </div>
        </div>
        <div className="pitwall-sidebar-right">
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Selected Driver</div>
            <SelectedDriverCard state={latest} selectedDriver={selectedDriver} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Weather</div>
            <WeatherPanel state={latest} />
          </div>
          <div className="pitwall-panel pitwall-circuit-bezel">
            <div className="pitwall-panel-title">Circuit</div>
            <TrackMap state={latest} sessionParams={sessionParams} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Race Engineer Notes</div>
            <RaceEngineerNotes notes={notes} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Ask The Engineer</div>
            <AiChat />
          </div>
        </div>
      </main>
    </div>
  );
}
