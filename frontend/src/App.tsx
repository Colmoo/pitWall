import { useState } from "react";
import { useSessionSocket } from "./api/useSessionSocket";
import { ReplayControls } from "./controls/ReplayControls";
import { TimingTower } from "./panels/TimingTower";

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8000/ws/session";

export default function App() {
  const history = useSessionSocket(WS_URL);
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const [sessionParams, setSessionParams] = useState<{ year: number; event: string; sessionType: string } | null>(null);

  return (
    <div>
      <header><h1>PitWall</h1></header>
      <ReplayControls onStarted={setSessionParams} />
      <nav>
        <button>Timing Tower</button>
      </nav>
      <main>
        <TimingTower state={latest} />
      </main>
    </div>
  );
}
