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
import { WidgetGrid } from "./panels/WidgetGrid";
import type { WidgetLayoutItem } from "./panels/WidgetGrid";
import { TelemetryTab } from "./panels/TelemetryTab";

const DASHBOARD_DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  { i: "overview", x: 0, y: 0, w: 3, h: 6 },
  { i: "timing-tower", x: 0, y: 6, w: 3, h: 10 },
  { i: "circuit", x: 3, y: 0, w: 6, h: 10 },
  { i: "sector-times", x: 3, y: 10, w: 6, h: 6 },
  { i: "gap-trend", x: 3, y: 16, w: 6, h: 8 },
  { i: "tire-strategy", x: 3, y: 24, w: 6, h: 8 },
  { i: "selected-driver", x: 9, y: 0, w: 3, h: 6 },
  { i: "telemetry", x: 9, y: 6, w: 3, h: 10 },
  { i: "weather", x: 9, y: 16, w: 3, h: 6 },
  { i: "race-engineer-notes", x: 9, y: 22, w: 3, h: 6 },
  { i: "ai-chat", x: 9, y: 28, w: 3, h: 8 },
];

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8000/ws/session";
const AI_NOTES_WS_URL = import.meta.env.VITE_BACKEND_AI_NOTES_WS_URL ?? "ws://localhost:8000/ws/ai-notes";

export default function App() {
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionParams, setSessionParams] = useState<{ year: number; event: string; sessionType: string } | null>(null);
  const history = useSessionSocket(WS_URL, sessionParams);
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const notes = useAiNotes(AI_NOTES_WS_URL);

  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"dashboard" | "telemetry">("dashboard");

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
        <nav className="pitwall-tab-bar">
          <button
            type="button"
            className={activeTab === "dashboard" ? "pitwall-tab pitwall-tab-active" : "pitwall-tab"}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={activeTab === "telemetry" ? "pitwall-tab pitwall-tab-active" : "pitwall-tab"}
            onClick={() => setActiveTab("telemetry")}
          >
            Telemetry
          </button>
        </nav>
        <div className="pitwall-stat-value" style={{ fontSize: 11 }}>
          {latest ? latest.track_status.replaceAll("_", " ").toUpperCase() : "—"}
        </div>
      </header>
      {activeTab === "dashboard" && (
        <main>
          <WidgetGrid storageKey="pitwall-dashboard-layout" defaultLayout={DASHBOARD_DEFAULT_LAYOUT}>
            <Panel key="overview" id="overview" title="Overview">
              <OverviewPanel state={latest} />
            </Panel>
            <Panel key="timing-tower" id="timing-tower" title="Timing Tower">
              <TimingTower state={latest} selectedDriver={selectedDriver} onSelectDriver={setSelectedDriver} />
            </Panel>
            <Panel key="circuit" id="circuit" title="Circuit" className="pitwall-circuit-bezel">
              <TrackMap state={latest} sessionParams={sessionParams} />
            </Panel>
            <Panel key="sector-times" id="sector-times" title="Sector Times">
              <SectorTimes state={latest} />
            </Panel>
            <Panel key="gap-trend" id="gap-trend" title="Gap Trend (to Leader)">
              <GapTrendChart history={history} selectedDriver={selectedDriver} />
            </Panel>
            <Panel key="tire-strategy" id="tire-strategy" title="Tire Strategy">
              <TireStrategy history={history} />
            </Panel>
            <Panel key="selected-driver" id="selected-driver" title="Selected Driver">
              <SelectedDriverCard state={latest} selectedDriver={selectedDriver} />
            </Panel>
            <Panel key="telemetry" id="telemetry" title="Telemetry">
              <TelemetryStack sessionParams={sessionParams} state={latest} selectedDriver={selectedDriver} />
            </Panel>
            <Panel key="weather" id="weather" title="Weather">
              <WeatherPanel state={latest} />
            </Panel>
            <Panel key="race-engineer-notes" id="race-engineer-notes" title="Race Engineer Notes">
              <RaceEngineerNotes notes={notes} />
            </Panel>
            <Panel key="ai-chat" id="ai-chat" title="Ask The Engineer">
              <AiChat />
            </Panel>
          </WidgetGrid>
        </main>
      )}
      {activeTab === "telemetry" && (
        <main>
          <TelemetryTab sessionParams={sessionParams} state={latest} />
        </main>
      )}
      <footer className="pitwall-panel" style={{ margin: "0 8px 8px" }}>
        <div className="pitwall-panel-title">Race Control</div>
        <RaceControlTicker state={latest} />
      </footer>
    </div>
  );
}
