import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import "./App.css";
import type { SessionState } from "./types";
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
import { TeamRadioPanel } from "./panels/TeamRadioPanel";

// ponytail: fixed heuristic heights tuned by eye per panel's typical content density,
// not a true content-driven autosize. Upgrade path: measure content and size dynamically.
const DASHBOARD_DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  { i: "overview", x: 0, y: 0, w: 3, h: 4 },
  { i: "timing-tower", x: 0, y: 4, w: 3, h: 10 },
  { i: "circuit", x: 3, y: 0, w: 6, h: 10 },
  { i: "sector-times", x: 3, y: 10, w: 6, h: 8 },
  { i: "gap-trend", x: 3, y: 18, w: 6, h: 8 },
  { i: "tire-strategy", x: 3, y: 26, w: 6, h: 8 },
  { i: "selected-driver", x: 9, y: 0, w: 3, h: 8 },
  { i: "telemetry", x: 9, y: 8, w: 3, h: 10 },
  { i: "weather", x: 9, y: 18, w: 3, h: 5 },
  { i: "team-radio", x: 9, y: 23, w: 3, h: 5 },
  { i: "race-engineer-notes", x: 9, y: 28, w: 3, h: 6 },
  { i: "ai-chat", x: 9, y: 34, w: 3, h: 8 },
];

const LAYOUT_KEY = "pitwall-dashboard-layout";
const HIDDEN_KEY = "pitwall-hidden-widgets";

function trackStatusColorClass(status: SessionState["track_status"] | undefined): string {
  if (status === "green") return "pitwall-flag-green";
  if (status === "yellow" || status === "safety_car" || status === "virtual_safety_car") return "pitwall-flag-yellow";
  if (status === "red") return "pitwall-flag-red";
  return "";
}

function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <div className="pitwall-clock">{now.toISOString().slice(11, 19)} UTC</div>;
}

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

  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [widgetsMenuOpen, setWidgetsMenuOpen] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);

  function setHidden(next: string[]) {
    setHiddenWidgets(next);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
  }

  function toggleWidget(id: string) {
    setHidden(hiddenWidgets.includes(id) ? hiddenWidgets.filter((w) => w !== id) : [...hiddenWidgets, id]);
  }

  function resetLayout() {
    localStorage.removeItem(LAYOUT_KEY);
    setHidden([]);
    setLayoutVersion((v) => v + 1);
  }

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

  const widgets: { id: string; title: string; className?: string; node: ReactNode }[] = [
    { id: "overview", title: "Overview", node: <OverviewPanel state={latest} /> },
    {
      id: "timing-tower",
      title: "Timing Tower",
      node: <TimingTower state={latest} selectedDriver={selectedDriver} onSelectDriver={setSelectedDriver} />,
    },
    {
      id: "circuit",
      title: "Circuit",
      className: "pitwall-circuit-bezel",
      node: (
        <TrackMap
          state={latest}
          sessionParams={sessionParams}
          history={history}
          selectedDriver={selectedDriver}
          onSelectDriver={setSelectedDriver}
        />
      ),
    },
    { id: "sector-times", title: "Sector Times", node: <SectorTimes state={latest} /> },
    { id: "gap-trend", title: "Gap Trend (to Leader)", node: <GapTrendChart history={history} selectedDriver={selectedDriver} /> },
    { id: "tire-strategy", title: "Tire Strategy", node: <TireStrategy history={history} /> },
    { id: "selected-driver", title: "Selected Driver", node: <SelectedDriverCard state={latest} selectedDriver={selectedDriver} /> },
    {
      id: "telemetry",
      title: "Telemetry",
      node: <TelemetryStack sessionParams={sessionParams} state={latest} history={history} selectedDriver={selectedDriver} />,
    },
    { id: "weather", title: "Weather", node: <WeatherPanel state={latest} /> },
    { id: "team-radio", title: "Team Radio", node: <TeamRadioPanel state={latest} /> },
    { id: "race-engineer-notes", title: "Race Engineer Notes", node: <RaceEngineerNotes notes={notes} /> },
    { id: "ai-chat", title: "Ask The Engineer", node: <AiChat /> },
  ];

  return (
    <div className="pitwall-shell">
      <header className="pitwall-header">
        <h1 className="pitwall-brand">
          <span className="pitwall-brand-block" aria-hidden="true" />
          PitWall
        </h1>
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
        {activeTab === "dashboard" && (
          <div className="pitwall-widgets-menu">
            <button
              type="button"
              className={widgetsMenuOpen ? "pitwall-tab pitwall-tab-active" : "pitwall-tab"}
              onClick={() => setWidgetsMenuOpen((open) => !open)}
            >
              Widgets ▾
            </button>
            {widgetsMenuOpen && (
              <div className="pitwall-widgets-menu-list">
                {widgets.map((w) => (
                  <label key={w.id}>
                    <input
                      type="checkbox"
                      checked={!hiddenWidgets.includes(w.id)}
                      onChange={() => toggleWidget(w.id)}
                    />
                    {w.title}
                  </label>
                ))}
                <button type="button" className="pitwall-home-button" onClick={resetLayout}>
                  Reset layout
                </button>
              </div>
            )}
          </div>
        )}
        <UtcClock />
        <div className={`pitwall-flag-badge ${trackStatusColorClass(latest?.track_status)}`}>
          {latest ? latest.track_status.replaceAll("_", " ").toUpperCase() : "—"}
        </div>
      </header>
      {activeTab === "dashboard" && (
        <main className="pitwall-main">
          <WidgetGrid key={layoutVersion} storageKey={LAYOUT_KEY} defaultLayout={DASHBOARD_DEFAULT_LAYOUT}>
            {widgets
              .filter((w) => !hiddenWidgets.includes(w.id))
              .map((w) => (
                <Panel key={w.id} id={w.id} title={w.title} className={w.className} onClose={() => toggleWidget(w.id)}>
                  {w.node}
                </Panel>
              ))}
          </WidgetGrid>
        </main>
      )}
      {activeTab === "telemetry" && (
        <main className="pitwall-main">
          <TelemetryTab sessionParams={sessionParams} state={latest} history={history} />
        </main>
      )}
      <footer className="pitwall-ticker">
        <span className="pitwall-ticker-label">Race Control</span>
        <div className="pitwall-ticker-body">
          <RaceControlTicker state={latest} />
        </div>
      </footer>
    </div>
  );
}
