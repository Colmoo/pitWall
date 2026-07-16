import { useEffect, useState } from "react";
import "./App.css";
import { Panel } from "./panels/Panel";
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
import { RaceControlTicker } from "./panels/RaceControlTicker";

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

  function goHome() {
    setSessionStarted(false);
    setSessionParams(null);
    setSelectedDriver(null);
  }

  return (
    <div>
      <header className="pitwall-header">
        <h1>PitWall</h1>
        <button type="button" className="pitwall-home-button" onClick={goHome}>
          ← Home
        </button>
        <div className="pitwall-stat-value" style={{ fontSize: 11 }}>
          {latest ? latest.track_status.replaceAll("_", " ").toUpperCase() : "—"}
        </div>
      </header>
      <main className="pitwall-grid">
        <div className="pitwall-sidebar-left">
          <OverviewPanel state={latest} />
          <Panel id="timing-tower" title="Timing Tower">
            <TimingTower state={latest} selectedDriver={selectedDriver} onSelectDriver={setSelectedDriver} />
          </Panel>
        </div>
        <div className="pitwall-center">
          <Panel id="circuit" title="Circuit" className="pitwall-circuit-bezel">
            <TrackMap state={latest} sessionParams={sessionParams} />
          </Panel>
          <Panel id="sector-times" title="Sector Times">
            <SectorTimes state={latest} />
          </Panel>
          <Panel id="gap-trend" title="Gap Trend (to Leader)">
            <GapTrendChart history={history} selectedDriver={selectedDriver} />
          </Panel>
          <Panel id="tire-strategy" title="Tire Strategy">
            <TireStrategy history={history} />
          </Panel>
        </div>
        <div className="pitwall-sidebar-right">
          <Panel id="selected-driver" title="Selected Driver">
            <SelectedDriverCard state={latest} selectedDriver={selectedDriver} />
          </Panel>
          <Panel id="telemetry" title="Telemetry">
            <TelemetryStack sessionParams={sessionParams} state={latest} selectedDriver={selectedDriver} />
          </Panel>
          <Panel id="weather" title="Weather">
            <WeatherPanel state={latest} />
          </Panel>
          <Panel id="race-engineer-notes" title="Race Engineer Notes">
            <RaceEngineerNotes notes={notes} />
          </Panel>
          <Panel id="ai-chat" title="Ask The Engineer">
            <AiChat />
          </Panel>
        </div>
      </main>
      <footer className="pitwall-panel" style={{ margin: "0 8px 8px" }}>
        <div className="pitwall-panel-title">Race Control</div>
        <RaceControlTicker state={latest} />
      </footer>
    </div>
  );
}
