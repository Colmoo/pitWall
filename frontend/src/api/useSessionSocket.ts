import { useEffect, useState } from "react";
import type { SessionState } from "../types";

export function useSessionSocket(url: string): SessionState | null {
  const [state, setState] = useState<SessionState | null>(null);

  useEffect(() => {
    const socket = new WebSocket(url);
    socket.onmessage = (event: { data: string }) => {
      setState(JSON.parse(event.data) as SessionState);
    };
    return () => socket.close();
  }, [url]);

  return state;
}
