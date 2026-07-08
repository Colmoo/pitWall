import { renderHook, act } from "@testing-library/react";
import { useSessionSocket } from "./useSessionSocket";

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
  return { timestamp, track_status: "green", drivers: [] };
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
