import { useState } from "react";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

export function ReplayControls({
  onStarted,
}: {
  onStarted: (params: { year: number; event: string; sessionType: string }) => void;
}) {
  const [year, setYear] = useState("2023");
  const [event, setEvent] = useState("Silverstone");
  const [sessionType, setSessionType] = useState("R");
  const [speed, setSpeed] = useState("10");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedYear = Number(year);
    const response = await fetch(`${API_URL}/session/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: parsedYear,
        event,
        session_type: sessionType,
        speed: Number(speed),
      }),
    });
    if (response.ok) {
      onStarted({ year: parsedYear, event, sessionType });
    }
  }

  async function handleStartLive() {
    await fetch(`${API_URL}/session/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="replay-year">Year</label>
      <input id="replay-year" value={year} onChange={(e) => setYear(e.target.value)} />

      <label htmlFor="replay-event">Event</label>
      <input id="replay-event" value={event} onChange={(e) => setEvent(e.target.value)} />

      <label htmlFor="replay-session-type">Session type</label>
      <input id="replay-session-type" value={sessionType} onChange={(e) => setSessionType(e.target.value)} />

      <label htmlFor="replay-speed">Speed</label>
      <input id="replay-speed" value={speed} onChange={(e) => setSpeed(e.target.value)} />

      <button type="submit">Start replay</button>
      <button type="button" onClick={handleStartLive}>Start live</button>
    </form>
  );
}
