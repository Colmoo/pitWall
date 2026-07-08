import { useEffect, useState } from "react";
import "./App.css";
import { useSessionSocket } from "./api/useSessionSocket";
import { ReplayControls } from "./controls/ReplayControls";
import { TimingTower } from "./panels/TimingTower";
import { TrackMap } from "./panels/TrackMap";
import { TireStrategy } from "./panels/TireStrategy";
import { SectorTimes } from "./panels/SectorTimes";

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8000/ws/session";

const TABS = ["Timing Tower", "Track Map", "Tire Strategy", "Sector Times"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const history = useSessionSocket(WS_URL);
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const [sessionParams, setSessionParams] = useState<{ year: number; event: string; sessionType: string } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Timing Tower");

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = document.activeElement;
      if (target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }
      const index = Number(e.key) - 1;
      if (index >= 0 && index < TABS.length) {
        setActiveTab(TABS[index]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div>
      <header className="pitwall-header"><h1>PitWall</h1></header>
      <ReplayControls onStarted={setSessionParams} />
      <nav className="pitwall-tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`pitwall-tab${tab === activeTab ? " active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
      <main className="pitwall-main">
        {activeTab === "Timing Tower" && <TimingTower state={latest} />}
        {activeTab === "Track Map" && <TrackMap state={latest} sessionParams={sessionParams} />}
        {activeTab === "Tire Strategy" && <TireStrategy history={history} />}
        {activeTab === "Sector Times" && <SectorTimes state={latest} />}
      </main>
    </div>
  );
}
