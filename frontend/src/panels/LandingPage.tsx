import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

export function LandingPage({
  onReplayStarted,
  onLiveStarted,
}: {
  onReplayStarted: (params: { year: number; event: string; sessionType: string }) => void;
  onLiveStarted: () => void;
}) {
  const [years, setYears] = useState<number[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [sessions, setSessions] = useState<string[]>([]);
  const [year, setYear] = useState("");
  const [event, setEvent] = useState("");
  const [sessionType, setSessionType] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/meta/years`)
      .then((res) => res.json())
      .then((data: { years: number[] }) => setYears(data.years));
  }, []);

  useEffect(() => {
    setEvents([]);
    setEvent("");
    if (!year) return;
    fetch(`${API_URL}/meta/events?year=${year}`)
      .then((res) => res.json())
      .then((data: { events: string[] }) => setEvents(data.events));
  }, [year]);

  useEffect(() => {
    setSessions([]);
    setSessionType("");
    if (!year || !event) return;
    fetch(`${API_URL}/meta/sessions?year=${year}&event=${encodeURIComponent(event)}`)
      .then((res) => res.json())
      .then((data: { sessions: string[] }) => setSessions(data.sessions));
  }, [year, event]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedYear = Number(year);
    const response = await fetch(`${API_URL}/session/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: parsedYear, event, session_type: sessionType, speed: 10 }),
    });
    if (response.ok) {
      onReplayStarted({ year: parsedYear, event, sessionType });
    }
  }

  async function handleGoLive() {
    const response = await fetch(`${API_URL}/session/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (response.ok) {
      onLiveStarted();
    }
  }

  return (
    <div className="pitwall-landing">
      <h1>PitWall</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="landing-year">Year</label>
        <select id="landing-year" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="" disabled>
            Select year
          </option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <label htmlFor="landing-track">Track</label>
        <select id="landing-track" value={event} onChange={(e) => setEvent(e.target.value)} disabled={!year}>
          <option value="" disabled>
            Select track
          </option>
          {events.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>

        <label htmlFor="landing-session">Session</label>
        <select id="landing-session" value={sessionType} onChange={(e) => setSessionType(e.target.value)} disabled={!event}>
          <option value="" disabled>
            Select session
          </option>
          {sessions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <button type="submit" disabled={!year || !event || !sessionType}>
          Start replay
        </button>
      </form>
      <button type="button" onClick={handleGoLive}>
        Go live
      </button>
    </div>
  );
}
