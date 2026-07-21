import { renderHook, act } from "@testing-library/react";
import { useSessionSocket } from "./useSessionSocket";

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
