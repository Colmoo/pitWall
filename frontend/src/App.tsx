import { useSessionSocket } from "./api/useSessionSocket";
import { TimingTower } from "./panels/TimingTower";

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8000/ws/session";

export default function App() {
  const state = useSessionSocket(WS_URL);
  return (
    <div>
      <header><h1>PitWall</h1></header>
      <nav>
        <button>Timing Tower</button>
      </nav>
      <main>
        <TimingTower state={state} />
      </main>
    </div>
  );
}
