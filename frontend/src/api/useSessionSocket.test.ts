import { renderHook, act } from "@testing-library/react";
import { useSessionSocket, HISTORY_CAP } from "./useSessionSocket";

// Batching flushes on requestAnimationFrame; run it synchronously in tests
// so existing act()-wrapped assertions don't need to await a real frame.
global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
  cb(0);
  return 0;
}) as typeof requestAnimationFrame;
global.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {}
}

function sampleState(timestamp: string) {
  return { timestamp, track_status: "green", drivers: [], weather: null, race_control_messages: [] };
}

test("returns an empty history before any message arrives", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useSessionSocket("ws://test/ws/session"));
  expect(result.current).toEqual([]);
});

test("accumulates each received message into history, in order", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useSessionSocket("ws://test/ws/session"));
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

  act(() => {
    socket.onmessage?.({ data: JSON.stringify(sampleState("t1")) });
  });
  act(() => {
    socket.onmessage?.({ data: JSON.stringify(sampleState("t2")) });
  });

  expect(result.current).toHaveLength(2);
  expect(result.current[0].timestamp).toBe("t1");
  expect(result.current[1].timestamp).toBe("t2");
});

test("caps history to a bounded rolling window, dropping the oldest states", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useSessionSocket("ws://test/ws/session"));
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

  const overflow = HISTORY_CAP + 5;
  act(() => {
    for (let i = 0; i < overflow; i++) {
      socket.onmessage?.({ data: JSON.stringify(sampleState(`t${i}`)) });
    }
  });

  // never exceeds the cap, and it's the newest states that are kept.
  expect(result.current).toHaveLength(HISTORY_CAP);
  expect(result.current[result.current.length - 1].timestamp).toBe(`t${overflow - 1}`);
  expect(result.current[0].timestamp).toBe(`t${overflow - HISTORY_CAP}`);
});

test("flushes without a frame when the backlog would evict the whole window", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const raf = global.requestAnimationFrame;
  // backgrounded tab: requestAnimationFrame is scheduled but never fires.
  global.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
  const { result } = renderHook(() => useSessionSocket("ws://test/ws/session"));
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

  act(() => {
    for (let i = 0; i < HISTORY_CAP; i++) {
      socket.onmessage?.({ data: JSON.stringify(sampleState(`t${i}`)) });
    }
  });
  global.requestAnimationFrame = raf;

  // states landed in history rather than piling up unflushed in the buffer.
  expect(result.current.length).toBe(HISTORY_CAP);
});

test("resets history when resetKey changes, even if url stays the same", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result, rerender } = renderHook(
    ({ resetKey }: { resetKey: unknown }) => useSessionSocket("ws://test/ws/session", resetKey),
    { initialProps: { resetKey: "session-1" } }
  );
  const firstSocket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

  act(() => {
    firstSocket.onmessage?.({ data: JSON.stringify(sampleState("t1")) });
  });
  expect(result.current).toHaveLength(1);

  rerender({ resetKey: "session-2" });

  expect(result.current).toEqual([]);

  const secondSocket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  act(() => {
    secondSocket.onmessage?.({ data: JSON.stringify(sampleState("t2")) });
  });
  expect(result.current).toHaveLength(1);
  expect(result.current[0].timestamp).toBe("t2");
});

function rcState(timestamp: string, messages: string[], snapshot?: boolean) {
  return {
    ...sampleState(timestamp),
    race_control_messages: messages.map((message) => ({ timestamp, message })),
    team_radio: [],
    snapshot,
  };
}

test("accumulates delta frames so the newest state carries the full cumulative list", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useSessionSocket("ws://test/ws/session"));
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

  act(() => {
    socket.onmessage?.({ data: JSON.stringify(rcState("t1", ["yellow"])) });
  });
  act(() => {
    socket.onmessage?.({ data: JSON.stringify(rcState("t2", ["green"])) });
  });

  const latest = result.current[result.current.length - 1];
  expect(latest.race_control_messages.map((m) => m.message)).toEqual(["yellow", "green"]);
});

test("a snapshot frame resets the accumulator instead of appending", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useSessionSocket("ws://test/ws/session"));
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

  act(() => {
    socket.onmessage?.({ data: JSON.stringify(rcState("t1", ["stale"])) });
  });
  act(() => {
    socket.onmessage?.({ data: JSON.stringify(rcState("t2", ["a", "b"], true)) });
  });

  const latest = result.current[result.current.length - 1];
  expect(latest.race_control_messages.map((m) => m.message)).toEqual(["a", "b"]);
});

test("a frame with no new messages reuses the same array reference", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useSessionSocket("ws://test/ws/session"));
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

  act(() => {
    socket.onmessage?.({ data: JSON.stringify(rcState("t1", ["yellow"])) });
  });
  act(() => {
    socket.onmessage?.({ data: JSON.stringify(rcState("t2", [])) });
  });

  expect(result.current[1].race_control_messages).toBe(result.current[0].race_control_messages);
  expect(result.current[1].team_radio).toBe(result.current[0].team_radio);
});
