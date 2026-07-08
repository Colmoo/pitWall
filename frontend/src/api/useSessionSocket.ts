import { useEffect, useState } from "react";
import type { SessionState } from "../types";

export function useSessionSocket(url: string, resetKey?: unknown): SessionState[] {
  const [history, setHistory] = useState<SessionState[]>([]);

  useEffect(() => {
    setHistory([]);
    const socket = new WebSocket(url);
    socket.onmessage = (event: { data: string }) => {
      const state = JSON.parse(event.data) as SessionState;
      setHistory((prev) => [...prev, state]);
    };
    return () => socket.close();
  }, [url, resetKey]);

  return history;
}
