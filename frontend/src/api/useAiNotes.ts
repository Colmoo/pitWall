import { useEffect, useState } from "react";
import type { AiNote } from "../types";

const MAX_NOTES = 20;

export function useAiNotes(url: string): AiNote[] {
  const [notes, setNotes] = useState<AiNote[]>([]);

  useEffect(() => {
    const socket = new WebSocket(url);
    socket.onmessage = (event: { data: string }) => {
      const note = JSON.parse(event.data) as AiNote;
      setNotes((prev) => [...prev, note].slice(-MAX_NOTES));
    };
    return () => socket.close();
  }, [url]);

  return notes;
}
