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

test("updates state when a message arrives", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useSessionSocket("ws://test/ws/session"));
  expect(result.current).toBeNull();

  const socket = FakeWebSocket.instances[0];
  const payload = JSON.stringify({ timestamp: "t", track_status: "green", drivers: [] });
  act(() => {
    socket.onmessage?.({ data: payload });
  });

  expect(result.current).toEqual({ timestamp: "t", track_status: "green", drivers: [] });
});
