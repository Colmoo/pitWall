import { useEffect, useRef, useState } from "react";
import type { SessionState } from "../types";

// ponytail: keep only the last N states in memory. The full-session panels (gap
// trend, tire stints, live track trace) no longer rebuild from this window -
// they fold each state into an accumulator owned by App (useSessionAccumulator)
// that outlives every remount - so the only consumer that still reads raw
// states is useLiveDriverTelemetry. That sets the floor: live states arrive at
// ~4 Hz (LiveAdapter.min_emit_interval), and it may be pinned to one lap, so the
// window has to span a lap plus margin. 600 ~= 150s.
// Upgrade path: accumulate telemetry the same way and the cap can drop further.
export const HISTORY_CAP = 600;

// Replay can flood many messages per animation frame (fast-forward speeds,
// backlog on connect). Coalescing them into one setState per frame keeps
// every history-consuming panel from re-scanning the array once per message.
export function useSessionSocket(url: string, resetKey?: unknown): SessionState[] {
  const [history, setHistory] = useState<SessionState[]>([]);
  const bufferRef = useRef<SessionState[]>([]);
  const pendingRef = useRef(false);
  const frameIdRef = useRef<number | null>(null);
  const rcRef = useRef<SessionState["race_control_messages"]>([]);
  const radioRef = useRef<SessionState["team_radio"]>([]);

  useEffect(() => {
    setHistory([]);
    bufferRef.current = [];
    pendingRef.current = false;
    rcRef.current = [];
    radioRef.current = [];
    const socket = new WebSocket(url);

    const flush = () => {
      pendingRef.current = false;
      if (bufferRef.current.length === 0) return;
      const batch = bufferRef.current;
      bufferRef.current = [];
      setHistory((prev) => {
        const next = prev.concat(batch);
        return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
      });
    };

    socket.onmessage = (event: { data: string }) => {
      const state = JSON.parse(event.data) as SessionState;
      // Broadcast frames carry only entries new since the previous frame; the
      // priming frame on connect carries the full lists with snapshot: true.
      if (state.snapshot) {
        rcRef.current = state.race_control_messages ?? [];
        radioRef.current = state.team_radio ?? [];
      } else {
        // New array only when the frame actually brought entries, so the common
        // empty tick keeps array identity stable for memoized consumers.
        if (state.race_control_messages?.length) rcRef.current = rcRef.current.concat(state.race_control_messages);
        if (state.team_radio?.length) radioRef.current = radioRef.current.concat(state.team_radio);
      }
      state.race_control_messages = rcRef.current;
      state.team_radio = radioRef.current;
      bufferRef.current.push(state);
      if (bufferRef.current.length >= HISTORY_CAP / 2) {
        // requestAnimationFrame never fires in a backgrounded tab, so flush before
        // the backlog is big enough that one batch evicts the whole window and
        // strands the panels' accumulator markers outside it.
        flush();
      } else if (!pendingRef.current) {
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
