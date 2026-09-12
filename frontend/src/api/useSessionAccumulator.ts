import { useRef } from "react";
import type { SessionState } from "../types";

// Three panels need data older than the rolling `history` window (see
// useSessionSocket): the gap trend, the tire stints, and the live traced
// circuit. They fold every state into an accumulator as it arrives.
//
// ponytail: this lives in App, not in the panels, because a panel's own ref
// dies whenever the dashboard unmounts - switching to the Telemetry tab used to
// silently rebuild each accumulator from the handful of states the window still
// held. Owning it above the tab switch is also what lets HISTORY_CAP stay small.
// Upgrade path: persist to IndexedDB if accumulators must survive a reload.
//
// `fold` mutates `acc` in place and the SAME object is returned every render, so
// consumers of this data must not be wrapped in React.memo - they re-render
// because App re-renders, not because this identity changed.
export function useSessionAccumulator<T>(
  history: SessionState[],
  create: () => T,
  fold: (acc: T, state: SessionState) => void,
  resetKey?: unknown,
): T {
  const ref = useRef<{ acc: T; last: SessionState | null; key: unknown } | null>(null);
  if (ref.current === null || ref.current.key !== resetKey) {
    ref.current = { acc: create(), last: null, key: resetKey };
  }
  const self = ref.current;

  let start = 0;
  if (self.last !== null) {
    // Resume by scanning back from the end: it stops after the states added
    // since the last render (usually one). Marker missing => the session reset,
    // or the window rolled past it - rebuild from what the window still holds.
    let found = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i] === self.last) {
        found = i;
        break;
      }
    }
    if (found === -1) self.acc = create();
    else start = found + 1;
  }
  for (let i = start; i < history.length; i++) fold(self.acc, history[i]);
  if (history.length > 0) self.last = history[history.length - 1];
  return self.acc;
}
