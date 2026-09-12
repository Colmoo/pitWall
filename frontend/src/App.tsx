import { lazy, Suspense, useEffect, useState } from "react";
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
import { TeamRadioPanel } from "./panels/TeamRadioPanel";
import { useLapAnalysis } from "./api/useLapAnalysis";
import { useSessionAccumulator } from "./api/useSessionAccumulator";

// Tab-level code splitting: the app opens on the dashboard, so the telemetry and
// analysis chart modules ship as separate chunks fetched on first tab click.
const TelemetryTab = lazy(() => import("./panels/TelemetryTab").then((m) => ({ default: m.TelemetryTab })));
const AnalysisTab = lazy(() => import("./panels/AnalysisTab").then((m) => ({ default: m.AnalysisTab })));

// ponytail: fixed heuristic heights tuned by eye per panel's typical content density,
// not a true content-driven autosize. Upgrade path: measure content and size dynamically.
const DASHBOARD_DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  { i: "circuit", x: 0, y: 0, w: 9, h: 16 },
  { i: "overview", x: 9, y: 0, w: 3, h: 4 },
  { i: "timing-tower", x: 9, y: 4, w: 3, h: 10 },
  { i: "sector-times", x: 0, y: 16, w: 9, h: 8 },
  { i: "gap-trend", x: 0, y: 24, w: 9, h: 8 },
  { i: "tire-strategy", x: 0, y: 32, w: 9, h: 8 },
  { i: "selected-driver", x: 9, y: 14, w: 3, h: 8 },
  { i: "telemetry", x: 9, y: 22, w: 3, h: 10 },
  { i: "weather", x: 9, y: 32, w: 3, h: 5 },
  { i: "team-radio", x: 9, y: 37, w: 3, h: 5 },
  { i: "race-engineer-notes", x: 9, y: 42, w: 3, h: 6 },
  { i: "ai-chat", x: 9, y: 48, w: 3, h: 8 },
];

const LAYOUT_KEY = "pitwall-dashboard-layout";
const HIDDEN_KEY = "pitwall-hidden-widgets";

// Practice and qualifying sessions want the timing view (fastest lap + sectors,
// no gap-to-leader). Race ("R") and Sprint ("S") stay in race mode by default.
function isTimingSession(sessionType: string | null | undefined): boolean {
  if (!sessionType) return false;
  const t = sessionType.toUpperCase();
  return t.startsWith("FP") || t === "Q" || t === "SQ" || t.includes("PRACTICE") || t.includes("QUALI");
}

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
  // Bumped on every session start (including back-to-back live sessions, where
  // sessionParams stays null) so the socket reconnects and history/team-radio
  // from the previous session don't bleed into the new one.
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const history = useSessionSocket(WS_URL, sessionGeneration);
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const notes = useAiNotes(AI_NOTES_WS_URL);

  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"dashboard" | "telemetry" | "analysis">("dashboard");
  const analysis = useLapAnalysis(sessionParams);

  // Qualifying/timing view: auto-on for practice/quali sessions, off for race,
  // and a manual header toggle overrides the auto default once the user clicks.
  // Whole-session data the rolling history window can't hold on its own. Owned
  // here rather than in the panels so it survives the dashboard unmounting on a
  // tab switch - see useSessionAccumulator.
  const gapPoints = useSessionAccumulator<number[]>(
    history,
    () => [],
    (acc, s) => {
      const gap = s.drivers.find((d) => d.driver_number === selectedDriver)?.gap_to_leader ?? null;
      if (gap !== null) acc.push(gap);
    },
    selectedDriver,
  );
  const tireStints = useSessionAccumulator(
    history,
    () => ({ byDriver: new Map<string, Map<number, string>>(), maxLap: 0 }),
    (acc, s) => {
      for (const d of s.drivers) {
        if (d.lap_number === null) continue;
        let laps = acc.byDriver.get(d.driver_number);
        if (!laps) {
          laps = new Map();
          acc.byDriver.set(d.driver_number, laps);
        }
        laps.set(d.lap_number, d.tire.compound);
        if (d.lap_number > acc.maxLap) acc.maxLap = d.lap_number;
      }
    },
  );
  // Live mode has no FastF1 identifier to fetch a layout with, so the circuit is
  // traced from the leader's live x/y instead; replay always fetches a real one.
  const tracedPoints = useSessionAccumulator<[number, number][]>(
    history,
    () => [],
    (acc, s) => {
      const d = s.drivers.find((dr) => dr.position === 1) ?? s.drivers[0];
      if (d != null && d.x != null && d.y != null) acc.push([d.x, d.y]);
    },
  );

  const [qualifyingView, setQualifyingView] = useState(false);
  const [qualifyingTouched, setQualifyingTouched] = useState(false);
  useEffect(() => {
    if (qualifyingTouched) return;
    setQualifyingView(isTimingSession(latest?.session_type));
  }, [latest?.session_type, qualifyingTouched]);

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
          setSessionGeneration((g) => g + 1);
        }}
        onLiveStarted={() => {
          setSessionStarted(true);
          setSessionGeneration((g) => g + 1);
        }}
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
      node: <TimingTower state={latest} selectedDriver={selectedDriver} onSelectDriver={setSelectedDriver} qualifyingMode={qualifyingView} />,
    },
    {
      id: "circuit",
      title: "Circuit",
      className: "pitwall-circuit-bezel",
      node: (
        <TrackMap
          state={latest}
          sessionParams={sessionParams}
          tracedPoints={sessionParams ? [] : tracedPoints}
          selectedDriver={selectedDriver}
          onSelectDriver={setSelectedDriver}
        />
      ),
    },
    { id: "sector-times", title: "Sector Times", node: <SectorTimes state={latest} qualifyingMode={qualifyingView} /> },
    { id: "gap-trend", title: "Gap Trend (to Leader)", node: <GapTrendChart points={gapPoints} selectedDriver={selectedDriver} /> },
    { id: "tire-strategy", title: "Tire Strategy", node: <TireStrategy state={latest} byDriver={tireStints.byDriver} maxLap={tireStints.maxLap} /> },
    { id: "selected-driver", title: "Selected Driver", node: <SelectedDriverCard state={latest} selectedDriver={selectedDriver} /> },
    {
      id: "telemetry",
      title: "Telemetry",
      node: <TelemetryStack sessionParams={sessionParams} state={latest} history={history} selectedDriver={selectedDriver} />,
    },
    { id: "weather", title: "Weather", node: <WeatherPanel state={latest} /> },
    { id: "team-radio", title: "Team Radio", node: <TeamRadioPanel state={latest} selectedDriver={selectedDriver} /> },
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
          <button
            type="button"
            className={activeTab === "analysis" ? "pitwall-tab pitwall-tab-active" : "pitwall-tab"}
            onClick={() => setActiveTab("analysis")}
          >
            Analysis
          </button>
        </nav>
        <button
          type="button"
          className={qualifyingView ? "pitwall-tab pitwall-tab-active" : "pitwall-tab"}
          onClick={() => {
            setQualifyingTouched(true);
            setQualifyingView((on) => !on);
          }}
          title="Timing view: fastest lap and sectors instead of gap to leader"
        >
          Qualifying View
        </button>
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
          <Suspense fallback={<p>Loading telemetry…</p>}>
            <TelemetryTab sessionParams={sessionParams} state={latest} history={history} />
          </Suspense>
        </main>
      )}
      {activeTab === "analysis" && (
        <main className="pitwall-main">
          <Suspense fallback={<p>Loading analysis…</p>}>
            <AnalysisTab
              sessionParams={sessionParams}
              analysis={analysis}
              state={latest}
              history={history}
              selectedDriver={selectedDriver}
              onSelectDriver={setSelectedDriver}
            />
          </Suspense>
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
