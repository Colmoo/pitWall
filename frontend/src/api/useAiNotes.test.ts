import { renderHook, act } from "@testing-library/react";
import { useAiNotes } from "./useAiNotes";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {}
}

test("accumulates notes as they arrive", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useAiNotes("ws://test/ws/ai-notes"));
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

  act(() => {
    socket.onmessage?.({ data: JSON.stringify({ timestamp: "t1", text: "note one" }) });
  });
  act(() => {
    socket.onmessage?.({ data: JSON.stringify({ timestamp: "t2", text: "note two" }) });
  });

  expect(result.current).toHaveLength(2);
  expect(result.current[1].text).toBe("note two");
});

test("keeps only the most recent 20 notes", () => {
  // @ts-expect-error test double
  global.WebSocket = FakeWebSocket;
  const { result } = renderHook(() => useAiNotes("ws://test/ws/ai-notes"));
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

  for (let i = 0; i < 25; i++) {
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ timestamp: `t${i}`, text: `note ${i}` }) });
    });
  }

  expect(result.current).toHaveLength(20);
  expect(result.current[0].text).toBe("note 5");
  expect(result.current[19].text).toBe("note 24");
});
