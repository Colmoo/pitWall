import { useState } from "react";
import "./App.css";
import { useSessionSocket } from "./api/useSessionSocket";
import { ReplayControls } from "./controls/ReplayControls";
import { TimingTower } from "./panels/TimingTower";
import { TrackMap } from "./panels/TrackMap";
import { TireStrategy } from "./panels/TireStrategy";
import { SectorTimes } from "./panels/SectorTimes";
import { OverviewPanel } from "./panels/OverviewPanel";

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8000/ws/session";

export default function App() {
  const [sessionParams, setSessionParams] = useState<{ year: number; event: string; sessionType: string } | null>(null);
  const history = useSessionSocket(WS_URL, sessionParams);
  const latest = history.length > 0 ? history[history.length - 1] : null;

  return (
    <div>
      <header className="pitwall-header">
        <h1>PitWall</h1>
        <ReplayControls onStarted={setSessionParams} />
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
            <TimingTower state={latest} />
          </div>
          <div className="pitwall-panel">
            <div className="pitwall-panel-title">Sector Times</div>
            <SectorTimes state={latest} />
          </div>
        </div>
        <div className="pitwall-sidebar-right">
          <div className="pitwall-panel pitwall-circuit-bezel">
            <div className="pitwall-panel-title">Circuit</div>
            <TrackMap state={latest} sessionParams={sessionParams} />
          </div>
        </div>
      </main>
    </div>
  );
}
