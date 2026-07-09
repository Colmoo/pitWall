import type { AiNote } from "../types";

export function RaceEngineerNotes({ notes }: { notes: AiNote[] }) {
  if (notes.length === 0) {
    return <p>No notes yet.</p>;
  }
  const newestFirst = [...notes].reverse();
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {newestFirst.map((note) => (
        <li key={note.timestamp} style={{ marginBottom: 6, fontSize: 12 }}>
          {note.text}
        </li>
      ))}
    </ul>
  );
}
