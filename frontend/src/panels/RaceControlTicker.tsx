import type { RaceControlMessage, SessionState } from "../types";

function flagColor(flag: string | null): string | undefined {
  if (!flag) return undefined;
  const upper = flag.toUpperCase();
  if (upper.includes("YELLOW")) return "var(--yellow)";
  if (upper.includes("RED")) return "var(--red)";
  if (upper.includes("GREEN")) return "var(--green)";
  return undefined;
}

export function RaceControlTicker({ state }: { state: SessionState | null }) {
  const messages: RaceControlMessage[] = state?.race_control_messages ?? [];

  if (messages.length === 0) {
    return <p>No race control messages yet.</p>;
  }

  const newestFirst = [...messages].reverse();

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {newestFirst.map((m, i) => (
        <li key={`${m.timestamp}-${i}`} style={{ marginBottom: 4, fontSize: 12, color: flagColor(m.flag) }}>
          {m.message}
        </li>
      ))}
    </ul>
  );
}
