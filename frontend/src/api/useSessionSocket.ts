import { useEffect, useRef, useState } from "react";
import type { SessionState } from "../types";

// Replay can flood many messages per animation frame (fast-forward speeds,
// backlog on connect). Coalescing them into one setState per frame keeps
// every history-consuming panel from re-scanning the array once per message.
export function useSessionSocket(url: string, resetKey?: unknown): SessionState[] {
  const [history, setHistory] = useState<SessionState[]>([]);
  const bufferRef = useRef<SessionState[]>([]);
  const pendingRef = useRef(false);
  const frameIdRef = useRef<number | null>(null);

  useEffect(() => {
    setHistory([]);
    bufferRef.current = [];
    pendingRef.current = false;
    const socket = new WebSocket(url);

    const flush = () => {
      pendingRef.current = false;
      if (bufferRef.current.length === 0) return;
      const batch = bufferRef.current;
      bufferRef.current = [];
      setHistory((prev) => prev.concat(batch));
    };

    socket.onmessage = (event: { data: string }) => {
      bufferRef.current.push(JSON.parse(event.data) as SessionState);
      if (!pendingRef.current) {
        pendingRef.current = true;
        frameIdRef.current = requestAnimationFrame(flush);
      }
    };
    return () => {
      socket.close();
      if (frameIdRef.current !== null) cancelAnimationFrame(frameIdRef.current);
    };
  }, [url, resetKey]);

  return history;
}
